using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using SupercarsTiming.Natsoft;
using SupercarsTiming.Server.Feed;

namespace SupercarsTiming.Server.F1;

/// <summary>
/// F1 sessions for the results and replay pages (the F1 twin of SessionCatalog + ReplayService): our recordings in
/// F1:RecordDirectory (data/recordings/f1) and archive folders downloaded from F1's live timing archive
/// (data/recordings/f1-archive/&lt;folder&gt; with *.jsonStream files, e.g. last year's races).
///
/// Recordings are split into sessions by F1's SessionInfo key; parts with the same key are one session (the server
/// restarted mid-race: 2026 Singapore GP, two files). Each file starts with the full state F1's hub sends on
/// connecting, which days later is the last session's: such parts have no live timing and are left out (they need
/// <see cref="MinTimingPatches"/>). Meeting names get the year in front ("2026 Singapore Grand Prix"), so the menu's
/// "Past seasons" works as for Supercars.
/// </summary>
public sealed class F1SessionCatalog(RepoPaths paths, IOptions<F1Options> options)
{
    /// <summary>Live TimingData patches a part needs to be a session (the hub's on-connect snapshot has none).</summary>
    const int MinTimingPatches = 50;

    /// <summary>One message of a session: its time (F1State's clock: UTC + the track's GMT offset) and the raw line.</summary>
    public readonly record struct Message(double Time, string Topic, bool Snapshot, string Json, DateTimeOffset Utc);

    sealed record Part(string Source, bool Archive, int StartLine, int EndLine, DateTimeOffset Start, DateTimeOffset End, int Patches);
    sealed record Info(string Key, string Meeting, string Name, string Type, string Track, string TrackCode, TimeSpan GmtOffset, int Year);

    readonly Lock _lock = new();
    string _signature = "";
    List<(RecordedSession Session, Info Info, List<Part> Parts)> _sessions = [];
    readonly Dictionary<string, (int Messages, TimingSnapshot Results, LapHistory Laps)> _results = [];
    readonly Dictionary<string, (int Count, IReadOnlyList<Message> Messages)> _messages = [];

    string RecordDirectory => paths.Resolve(options.Value.RecordDirectory);
    string ArchiveDirectory => Path.Combine(paths.RecordingsDirectory, "f1-archive");

    public IReadOnlyList<RecordedSession> List()
    {
        var files = Directory.Exists(RecordDirectory) ? new DirectoryInfo(RecordDirectory).GetFiles("*.jsonl").OrderBy(f => f.Name).ToList() : [];
        var archives = Directory.Exists(ArchiveDirectory)
            ? new DirectoryInfo(ArchiveDirectory).GetDirectories().Where(d => File.Exists(Path.Combine(d.FullName, "SessionInfo.jsonStream"))).OrderBy(d => d.Name).ToList()
            : [];
        var signature = string.Join("|", files.Select(f => $"{f.Name}:{f.Length}:{f.LastWriteTimeUtc.Ticks}").Concat(archives.Select(d => d.Name)));
        lock (_lock)
        {
            if (signature != _signature)
            {
                _sessions = Scan(files.Select(f => f.FullName), archives.Select(d => d.FullName));
                _signature = signature;
            }
            return _sessions.Select(s => s.Session).ToList();
        }
    }

    public RecordedSession? Find(string id) => List().FirstOrDefault(s => s.Id == id);

    public TimingSnapshot? Results(string id) => Load(id)?.Results;

    public LapHistory? Laps(string id) => Load(id)?.Laps;

    (TimingSnapshot Results, LapHistory Laps)? Load(string id)
    {
        if (Messages(id) is not { } messages) return null;
        lock (_lock)
        {
            if (_results.TryGetValue(id, out var cached) && cached.Messages == messages.Count) return (cached.Results, cached.Laps);
        }
        var state = new F1State();
        foreach (var m in messages) Apply(state, m);
        var entry = (messages.Count, state.Snapshot(), state.Laps());
        lock (_lock) { _results[id] = entry; }
        return (entry.Item2, entry.Item3);
    }

    /// <summary>A session's messages in order, loaded once (and again if it grows).</summary>
    public IReadOnlyList<Message>? Messages(string id)
    {
        List();
        (RecordedSession Session, Info Info, List<Part> Parts) found;
        lock (_lock)
        {
            found = _sessions.FirstOrDefault(s => s.Session.Id == id);
            if (found.Session is null) return null;
            if (_messages.TryGetValue(id, out var cached) && cached.Count == found.Session.Messages) return cached.Messages;
        }
        var list = new List<Message>();
        double last = 0;
        foreach (var part in found.Parts)
        {
            var source = part.Archive
                ? F1Recording.ReadArchive(part.Source).Select(m => (m.Utc, m.Topic, m.Snapshot, Json: m.Data?.ToJsonString() ?? "null"))
                : ReadLines(part.Source, part.StartLine, part.EndLine);
            foreach (var (utc, topic, snapshot, json) in source)
            {
                var t = (utc + found.Info.GmtOffset).ToUnixTimeMilliseconds() / 1000.0;
                if (t > last) last = t; // carried forward, like Natsoft times
                list.Add(new Message(last, topic, snapshot, json, utc));
            }
        }
        lock (_lock) { _messages[id] = (found.Session.Messages, list); }
        return list;
    }

    public static void Apply(F1State state, Message m)
    {
        try { state.Apply(new F1Message(m.Utc, m.Topic, JsonNode.Parse(m.Json), m.Snapshot)); } catch { /* skip a bad line */ }
    }

    static IEnumerable<(DateTimeOffset Utc, string Topic, bool Snapshot, string Json)> ReadLines(string file, int start, int end)
    {
        int line = -1;
        foreach (var text in File.ReadLines(file))
        {
            line++;
            if (line < start || string.IsNullOrWhiteSpace(text)) continue;
            if (line >= end) yield break;
            var o = JsonNode.Parse(text)!.AsObject();
            yield return (DateTimeOffset.Parse((string)o["utc"]!), (string)o["topic"]!, (bool?)o["snapshot"] ?? false, o["data"]?.ToJsonString() ?? "null");
        }
    }

    static List<(RecordedSession, Info, List<Part>)> Scan(IEnumerable<string> files, IEnumerable<string> archives)
    {
        var parts = new List<(Info Info, Part Part)>();
        foreach (var file in files) parts.AddRange(ScanFile(file));
        foreach (var dir in archives) if (ScanArchive(dir) is { } p) parts.Add(p);

        var sessions = new List<(RecordedSession, Info, List<Part>)>();
        foreach (var group in parts.Where(p => p.Part.Patches >= MinTimingPatches).GroupBy(p => p.Info.Key))
        {
            // An archive and our own recording of the same session: keep the one with more timing.
            var chosen = group.GroupBy(p => p.Part.Archive).Select(g => g.ToList()).MaxBy(g => g.Sum(p => p.Part.Patches))!;
            var ordered = chosen.OrderBy(p => p.Part.Start).ToList();
            var info = ordered[0].Info;
            var first = ordered[0].Part;
            var id = $"F1_{info.Key}";
            var session = new RecordedSession(id, $"{info.Year} {info.Meeting}".Trim(), info.Name, info.Type, info.Track, info.TrackCode,
                first.Start, ordered[^1].Part.End, ordered.Sum(p => p.Part.EndLine - p.Part.StartLine),
                ordered.Select(p => new RecordedSessionPart(p.Part.Source, p.Part.StartLine, p.Part.EndLine, p.Part.Start, p.Part.End, p.Part.Patches)).ToList());
            sessions.Add((session, info, ordered.Select(p => p.Part).ToList()));
        }
        return sessions.OrderByDescending(s => s.Item1.Start).ToList();
    }

    /// <summary>A recording's parts: split where SessionInfo's key changes; lines before the first SessionInfo (the
    /// hub's snapshot of other topics) belong to the first session.</summary>
    static IEnumerable<(Info, Part)> ScanFile(string file)
    {
        Info? info = null;
        int start = 0, line = -1, patches = 0;
        DateTimeOffset first = default, last = default;
        var results = new List<(Info, Part)>();
        foreach (var text in File.ReadLines(file))
        {
            line++;
            if (string.IsNullOrWhiteSpace(text)) continue;
            JsonObject o;
            try { o = JsonNode.Parse(text)!.AsObject(); } catch { continue; }
            var utc = DateTimeOffset.Parse((string)o["utc"]!);
            var topic = (string?)o["topic"];
            if (topic == "SessionInfo" && ReadInfo(o["data"]) is { } next && next.Key != info?.Key)
            {
                if (info is not null) results.Add((info, new Part(file, false, start, line, first, last, patches)));
                else start = 0; // the snapshot lines before it are this session's
                if (info is not null) { start = line; patches = 0; first = utc; }
                info = next;
            }
            if (first == default) first = utc;
            last = utc;
            if (topic == "TimingData" && !((bool?)o["snapshot"] ?? false)) patches++;
        }
        if (info is not null) results.Add((info, new Part(file, false, start, line + 1, first, last, patches)));
        return results;
    }

    static (Info, Part)? ScanArchive(string dir)
    {
        var infoLine = File.ReadLines(Path.Combine(dir, "SessionInfo.jsonStream")).Select(l => l.TrimStart('﻿')).FirstOrDefault(l => l.Length > 12);
        if (infoLine is null || ReadInfo(JsonNode.Parse(infoLine[12..])) is not { } info) return null;
        var timing = Path.Combine(dir, "TimingData.jsonStream");
        var heartbeat = Path.Combine(dir, "Heartbeat.jsonStream");
        if (!File.Exists(timing) || !File.Exists(heartbeat)) return null;
        var beats = File.ReadLines(heartbeat).Select(l => l.TrimStart('﻿')).Where(l => l.Length > 12).ToList();
        DateTimeOffset At(string l) => DateTimeOffset.Parse((string)JsonNode.Parse(l[12..])!["Utc"]!);
        var patches = File.ReadLines(timing).Count();
        return (info, new Part(dir, true, 0, patches, At(beats[0]), At(beats[^1]), patches));
    }

    static Info? ReadInfo(JsonNode? d)
    {
        var key = d?["Key"]?.ToString();
        if (d is null || string.IsNullOrEmpty(key)) return null;
        var meeting = d["Meeting"];
        TimeSpan.TryParse((string?)d["GmtOffset"], out var offset);
        var year = DateTimeOffset.TryParse((string?)d["StartDate"], out var startDate) ? startDate.Year : 0;
        var circuit = meeting?["Circuit"];
        return new Info(key, (string?)meeting?["Name"] ?? "", (string?)d["Name"] ?? "", (string?)d["Type"] ?? "",
            (string?)meeting?["Location"] ?? (string?)circuit?["ShortName"] ?? "", circuit?["Key"] is { } c ? $"F1-{c}" : "", offset, year);
    }
}

/// <summary>Replays of F1 sessions: one cursor per viewer and session (the F1 twin of ReplayService).</summary>
public sealed class F1ReplayService(F1SessionCatalog catalog)
{
    static readonly TimeSpan Idle = TimeSpan.FromMinutes(10);
    const int MaxCursors = 16;

    readonly Lock _lock = new();
    readonly Dictionary<(string Viewer, string Session), (Cursor Cursor, DateTime Used)> _cursors = [];

    public (double Start, double End)? Info(string sessionId) =>
        catalog.Messages(sessionId) is { Count: > 0 } m ? (m[0].Time, m[^1].Time) : null;

    public TimingSnapshot? At(string sessionId, string viewer, double t)
    {
        if (catalog.Messages(sessionId) is not { } messages) return null;
        Cursor cursor;
        lock (_lock)
        {
            var now = DateTime.UtcNow;
            foreach (var key in _cursors.Where(c => now - c.Value.Used > Idle).Select(c => c.Key).ToList()) _cursors.Remove(key);
            if (!_cursors.TryGetValue((viewer, sessionId), out var entry) || entry.Cursor.Messages != messages)
            {
                if (_cursors.Count >= MaxCursors) _cursors.Remove(_cursors.MinBy(c => c.Value.Used).Key);
                entry = (new Cursor(messages), now);
            }
            _cursors[(viewer, sessionId)] = (entry.Cursor, now);
            cursor = entry.Cursor;
        }
        lock (cursor) return cursor.At(t);
    }

    /// <summary>Forward: applies only the new messages; back: rebuilds from the start (like SessionReplay).</summary>
    sealed class Cursor(IReadOnlyList<F1SessionCatalog.Message> messages)
    {
        public IReadOnlyList<F1SessionCatalog.Message> Messages => messages;
        F1State _state = new();
        int _next;
        double _time = double.NegativeInfinity;

        public TimingSnapshot At(double t)
        {
            if (t < _time) { _state = new F1State(); _next = 0; }
            while (_next < messages.Count && messages[_next].Time <= t) F1SessionCatalog.Apply(_state, messages[_next++]);
            _time = t;
            return _state.Snapshot();
        }
    }
}

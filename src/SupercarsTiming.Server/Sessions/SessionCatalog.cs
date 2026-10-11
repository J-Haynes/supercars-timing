using SupercarsTiming.Natsoft;
using SupercarsTiming.Server.Feed;

namespace SupercarsTiming.Server.Sessions;

/// <summary>Recorded sessions found in data/recordings, and their results. Rescans when files change.</summary>
public sealed class SessionCatalog(RepoPaths paths)
{
    readonly Lock _lock = new();
    string _signature = "";
    List<RecordedSession> _sessions = [];
    // Results and lap history are cached per session and size: a session still being recorded gets recomputed as
    // it grows. Both come from one replay of the recording.
    readonly Dictionary<string, (int Messages, TimingSnapshot Results, LapHistory Laps)> _results = [];

    public IReadOnlyList<RecordedSession> List()
    {
        var dir = paths.RecordingsDirectory;
        if (!Directory.Exists(dir)) return [];
        var files = new DirectoryInfo(dir).GetFiles("*.jsonl").OrderBy(f => f.Name).ToList();
        // Cheap change detection: names, sizes and timestamps. The live recording grows, so this rescans it.
        var signature = string.Join("|", files.Select(f => $"{f.Name}:{f.Length}:{f.LastWriteTimeUtc.Ticks}"));
        lock (_lock)
        {
            if (signature != _signature)
            {
                _sessions = SessionIndex.Scan(files.Select(f => f.FullName));
                _signature = signature;
            }
            return _sessions;
        }
    }

    public RecordedSession? Find(string id) => List().FirstOrDefault(s => s.Id == id);

    public TimingSnapshot? Results(string id) => Load(id)?.Results;

    /// <summary>Per-car lap history of a recorded session, for the results page's charts.</summary>
    public LapHistory? Laps(string id) => Load(id)?.Laps;

    (TimingSnapshot Results, LapHistory Laps)? Load(string id)
    {
        if (Find(id) is not { } session) return null;
        lock (_lock)
        {
            if (_results.TryGetValue(id, out var cached) && cached.Messages == session.Messages) return (cached.Results, cached.Laps);
        }
        var state = SessionIndex.Replay(session);
        var entry = (session.Messages, TimingSnapshot.From(state), LapHistory.From(state));
        lock (_lock) { _results[id] = entry; }
        return (entry.Item2, entry.Item3);
    }
}

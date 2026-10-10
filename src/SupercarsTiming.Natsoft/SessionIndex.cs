using System.Text.Json;
using System.Xml.Linq;

namespace SupercarsTiming.Natsoft;

/// <summary>A stretch of one recording file belonging to one session: lines [StartLine, EndLine).</summary>
public sealed record RecordedSessionPart(string File, int StartLine, int EndLine, DateTimeOffset Start, DateTimeOffset End, int Messages);

/// <summary>
/// One session found in recordings (e.g. "Practice 6"). A session can span several parts when the recorder
/// was restarted mid-session; each part starts with Natsoft's full snapshot, so they replay seamlessly.
/// </summary>
public sealed record RecordedSession(
    string Id, string Meeting, string Name, string Type, string Track, string TrackCode,
    DateTimeOffset Start, DateTimeOffset End, int Messages, IReadOnlyList<RecordedSessionPart> Parts)
{
    public double DurationSeconds => (End - Start).TotalSeconds;
}

/// <summary>Finds sessions in recording files and reads their messages back.</summary>
public static class SessionIndex
{
    /// <summary>Gap under which two parts with the same meeting and session name are treated as one session.</summary>
    public static readonly TimeSpan MergeGap = TimeSpan.FromMinutes(15);

    sealed record PartInfo(RecordedSessionPart Part, string Meeting, string Name, string Type, string Track, string TrackCode);

    /// <summary>
    /// Scans recording files for sessions. A session starts at each <c>&lt;New&gt;</c> snapshot and ends at the
    /// next one, at <c>&lt;NotFound&gt;</c> (meeting no longer live) or at the end of the file.
    /// </summary>
    /// <param name="minMessages">Ignore fragments shorter than this (e.g. a reconnect just as a session ended).</param>
    public static List<RecordedSession> Scan(IEnumerable<string> files, int minMessages = 50)
    {
        var parts = files.SelectMany(f => ScanFile(f)).Where(p => p.Part.Messages >= minMessages).OrderBy(p => p.Part.Start).ToList();

        var sessions = new List<(PartInfo First, List<RecordedSessionPart> Parts)>();
        foreach (var p in parts)
        {
            var match = sessions.LastOrDefault(s => s.First.Meeting == p.Meeting && s.First.Name == p.Name
                && p.Part.Start - s.Parts[^1].End < MergeGap);
            if (match.First is not null) match.Parts.Add(p.Part);
            else sessions.Add((p, [p.Part]));
        }

        return sessions.Select(s => new RecordedSession(
                Id: $"{Path.GetFileNameWithoutExtension(s.First.Part.File)}-{s.First.Part.StartLine}",
                s.First.Meeting, s.First.Name, s.First.Type, s.First.Track, s.First.TrackCode,
                s.Parts[0].Start, s.Parts[^1].End, s.Parts.Sum(x => x.Messages), s.Parts))
            .OrderByDescending(s => s.Start)
            .ToList();
    }

    /// <summary>All timing messages of a session in order (NotFound/Redirect frames skipped).</summary>
    public static IEnumerable<NatsoftMessage> Read(RecordedSession session)
    {
        foreach (var part in session.Parts)
        {
            int line = 0;
            foreach (var text in File.ReadLines(part.File))
            {
                if (line >= part.EndLine) break;
                if (line++ < part.StartLine || string.IsNullOrWhiteSpace(text)) continue;
                if (ParseLine(text) is { } m && !m.IsNotFound && !m.IsRedirect) yield return m;
            }
        }
    }

    static IEnumerable<PartInfo> ScanFile(string file)
    {
        PartInfo? current = null;
        int line = -1, count = 0;
        DateTimeOffset last = default;

        PartInfo Close(int endLine) => current! with { Part = current!.Part with { EndLine = endLine, End = last, Messages = count } };

        foreach (var text in File.ReadLines(file))
        {
            line++;
            if (string.IsNullOrWhiteSpace(text) || ParseLine(text) is not { } m) continue;

            if (m.IsNotFound || m.Root == "New")
            {
                if (current is not null) yield return Close(line);
                current = null;
            }
            if (m.Root == "New")
            {
                var root = XElement.Parse(m.Xml);
                var e = root.Element("E");
                var t = root.Element("T");
                current = new PartInfo(
                    new RecordedSessionPart(file, line, line, m.ReceivedAt, m.ReceivedAt, 0),
                    root.Element("M")?.Attribute("D")?.Value ?? "",
                    e?.Attribute("D")?.Value ?? "",
                    e?.Attribute("Y")?.Value ?? "",
                    t?.Attribute("N")?.Value ?? "",
                    t?.Attribute("C")?.Value ?? "");
                count = 0;
            }
            if (current is not null && !m.IsNotFound) { count++; last = m.ReceivedAt; }
        }
        if (current is not null) yield return Close(line + 1);
    }

    static NatsoftMessage? ParseLine(string text)
    {
        using var doc = JsonDocument.Parse(text.TrimStart('﻿'));
        var r = doc.RootElement;
        if (r.GetProperty("kind").GetString() != "msg") return null;
        var raw = r.GetProperty("raw").GetString() ?? "";
        var xml = r.TryGetProperty("xml", out var x) && x.ValueKind == JsonValueKind.String ? x.GetString()! : NatsoftDecoder.Decode(raw);
        return new NatsoftMessage(r.GetProperty("t").GetDateTimeOffset(), raw, xml);
    }
}

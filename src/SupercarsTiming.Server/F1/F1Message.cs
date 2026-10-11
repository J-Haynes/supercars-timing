using System.Text.Json;
using System.Text.Json.Nodes;

namespace SupercarsTiming.Server.F1;

/// <summary>
/// One update from F1's live timing hub: a topic ("TimingData", "TrackStatus", ...) and a JSON patch that is merged
/// into that topic's state. F1 only sends the fields that changed (see docs/PROTOCOL-F1.md).
/// </summary>
/// <param name="Utc">When the update was sent (F1's timestamp when it has one, else when we received it).</param>
/// <param name="Snapshot">True for the full state the hub sends when we subscribe (no crossing times in it).</param>
public sealed record F1Message(DateTimeOffset Utc, string Topic, JsonNode? Data, bool Snapshot = false);

/// <summary>
/// F1 recordings: JSON Lines, one <c>{"utc","topic","snapshot","data"}</c> object per message, in
/// data/recordings/f1 (kept apart from the Natsoft recordings, which have a different format).
/// Also reads F1's public archive (livetiming.formula1.com/static/...) for replays and tests.
/// </summary>
public static class F1Recording
{
    public static string NewFileName(DateTimeOffset utc) => $"F1_{utc:yyyyMMdd_HHmmss}.jsonl";

    public static string ToLine(F1Message m) => new JsonObject
    {
        ["utc"] = m.Utc.ToString("O"),
        ["topic"] = m.Topic,
        ["snapshot"] = m.Snapshot,
        ["data"] = m.Data?.DeepClone(),
    }.ToJsonString();

    public static IEnumerable<F1Message> Read(string file)
    {
        foreach (var line in File.ReadLines(file))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var o = JsonNode.Parse(line)!.AsObject();
            yield return new F1Message(DateTimeOffset.Parse((string)o["utc"]!), (string)o["topic"]!, o["data"]?.DeepClone(),
                (bool?)o["snapshot"] ?? false);
        }
    }

    /// <summary>
    /// Reads a session folder downloaded from F1's archive (<c>&lt;Topic&gt;.jsonStream</c> files, each line
    /// "HH:MM:SS.fff{json}" with the time since the stream started). The stream's start time comes from the
    /// Heartbeat topic, which carries UTC. Compressed topics (.z) are skipped.
    /// </summary>
    public static List<F1Message> ReadArchive(string dir)
    {
        var heartbeat = Path.Combine(dir, "Heartbeat.jsonStream");
        DateTimeOffset start = DateTimeOffset.UnixEpoch;
        if (File.Exists(heartbeat))
        {
            var first = File.ReadLines(heartbeat).Select(l => l.TrimStart('﻿')).First(l => l.Length > 12);
            var utc = DateTimeOffset.Parse((string)JsonNode.Parse(first[12..])!["Utc"]!);
            start = utc - TimeSpan.Parse(first[..12]);
        }

        var all = new List<F1Message>();
        foreach (var file in Directory.GetFiles(dir, "*.jsonStream"))
        {
            var topic = Path.GetFileNameWithoutExtension(file);
            if (topic.EndsWith(".z")) continue;
            foreach (var raw in File.ReadLines(file))
            {
                var line = raw.TrimStart('﻿');
                if (line.Length <= 12) continue;
                try { all.Add(new F1Message(start + TimeSpan.Parse(line[..12]), topic, JsonNode.Parse(line[12..]))); }
                catch (JsonException) { }
            }
        }
        return all.OrderBy(m => m.Utc).ToList();
    }
}

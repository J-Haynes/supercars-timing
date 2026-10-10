using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;

namespace SupercarsTiming.Natsoft;

/// <summary>
/// Recording format: JSON Lines, one object per line.
/// <code>{ "t": "2026-10-09T23:06:53.93+00:00", "kind": "msg" | "connect" | "error", "raw": "...", "xml": "..." }</code>
/// <c>raw</c> is kept so recordings can be re-decoded if the decoder changes.
/// </summary>
public sealed class RecordingWriter : IAsyncDisposable
{
    readonly StreamWriter _writer;
    public string Path { get; }

    public RecordingWriter(string path)
    {
        Path = path;
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(path))!);
        _writer = new StreamWriter(path, append: true, new UTF8Encoding(false)) { AutoFlush = true };
    }

    /// <summary>Creates <c>{dir}/{meeting}_{yyyyMMdd_HHmmss}.jsonl</c> using local time.</summary>
    public static RecordingWriter Create(string directory, string meeting) =>
        new(System.IO.Path.Combine(directory, $"{meeting}_{DateTime.Now:yyyyMMdd_HHmmss}.jsonl"));

    public Task WriteAsync(NatsoftMessage m) => WriteLineAsync(m.ReceivedAt, "msg", m.Raw, m.Xml);
    public Task WriteEventAsync(string kind, string detail) => WriteLineAsync(DateTimeOffset.UtcNow, kind, detail, null);

    Task WriteLineAsync(DateTimeOffset t, string kind, string raw, string? xml) =>
        _writer.WriteLineAsync(JsonSerializer.Serialize(new RecordingLine(t, kind, raw, xml), RecordingLine.JsonOptions));

    public ValueTask DisposeAsync() => _writer.DisposeAsync();
}

public static class RecordingReader
{
    /// <summary>Reads timing messages (kind "msg") from a recording. Tolerates a UTF-8 BOM from early recordings.</summary>
    public static IEnumerable<NatsoftMessage> Read(string path)
    {
        foreach (var line in File.ReadLines(path))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var rec = JsonSerializer.Deserialize<RecordingLine>(line.TrimStart('﻿'), RecordingLine.JsonOptions);
            if (rec is null || rec.Kind != "msg") continue;
            yield return new NatsoftMessage(rec.T, rec.Raw, rec.Xml ?? NatsoftDecoder.Decode(rec.Raw));
        }
    }

    /// <summary>
    /// Replays a recording with its original timing, divided by <paramref name="speed"/>.
    /// Gaps longer than <paramref name="maxGap"/> (e.g. between sessions) are shortened to it.
    /// </summary>
    public static async IAsyncEnumerable<NatsoftMessage> ReplayAsync(
        string path, double speed = 1, TimeSpan? maxGap = null, [EnumeratorCancellation] CancellationToken ct = default)
    {
        var cap = maxGap ?? TimeSpan.FromSeconds(5);
        DateTimeOffset? prev = null;
        foreach (var m in Read(path))
        {
            if (prev is { } p)
            {
                var gap = (m.ReceivedAt - p) / Math.Max(speed, 0.01);
                if (gap > cap) gap = cap;
                if (gap > TimeSpan.Zero) await Task.Delay(gap, ct);
            }
            prev = m.ReceivedAt;
            yield return m;
        }
    }
}

internal sealed record RecordingLine(DateTimeOffset T, string Kind, string Raw, string? Xml)
{
    public static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
}

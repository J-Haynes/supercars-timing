using System.Globalization;
using System.Text.Json;

namespace SupercarsTiming.Server.Feed;

/// <summary>
/// When to be connected to Natsoft: from <see cref="Before"/> each scheduled Supercars session starts until
/// <see cref="After"/> it ends, and not otherwise (one connection, only while there's something to time; see
/// docs/PLANNING.md, "Using Natsoft's data responsibly"). Session times come from src/web/src/schedule/supercars.json,
/// the same file the event pages read, in local track time.
///
/// - Sessions without an end time: races last 1.6 min a lap (at least 90 min); anything else an hour.
/// - Windows that overlap or are less than <see cref="Before"/> apart are merged, so a busy day is one connection.
/// - Events whose timetable isn't complete (complete: false, e.g. only the races published) are covered from
///   07:00 to 19:00 track time on every event day instead, so untimed practice and qualifying aren't missed.
/// </summary>
public sealed class SessionSchedule
{
    public static readonly TimeSpan Before = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan After = TimeSpan.FromMinutes(30);
    static readonly TimeSpan DayStart = TimeSpan.FromHours(7), DayEnd = TimeSpan.FromHours(19);

    /// <summary>A stretch of time to be connected, and what it's for (for the status line).</summary>
    public sealed record Window(DateTimeOffset Start, DateTimeOffset End, string Reason);

    public IReadOnlyList<Window> Windows { get; }

    public SessionSchedule(IEnumerable<Window> windows) => Windows = Merge(windows);

    /// <summary>The window we're in at <paramref name="now"/>, or null.</summary>
    public Window? Current(DateTimeOffset now) => Windows.FirstOrDefault(w => w.Start <= now && now < w.End);

    /// <summary>The next window starting after <paramref name="now"/>, or null when nothing more is scheduled.</summary>
    public Window? Next(DateTimeOffset now) => Windows.FirstOrDefault(w => w.Start > now);

    /// <summary>Reads schedule/supercars.json (see the class summary). A missing file gives an empty schedule.</summary>
    public static SessionSchedule Load(string path)
    {
        if (!File.Exists(path)) return new([]);
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        var windows = new List<Window>();
        foreach (var e in doc.RootElement.GetProperty("events").EnumerateArray())
        {
            var name = e.GetProperty("name").GetString() ?? "";
            var offset = ParseOffset(e.GetProperty("utcOffset").GetString() ?? "+00:00");
            DateTimeOffset Local(string s) => new(DateTime.ParseExact(s, "yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture), offset);
            bool complete = e.TryGetProperty("complete", out var c) && c.GetBoolean();
            if (complete && e.TryGetProperty("sessions", out var sessions))
            {
                foreach (var s in sessions.EnumerateArray())
                {
                    var start = Local(s.GetProperty("start").GetString()!);
                    int laps = s.TryGetProperty("laps", out var l) ? l.GetInt32() : 0;
                    var end = s.TryGetProperty("end", out var en) ? Local(en.GetString()!)
                        : start + (laps > 0 ? TimeSpan.FromMinutes(Math.Max(90, laps * 1.6)) : TimeSpan.FromHours(1));
                    windows.Add(new(start - Before, end + After, $"{name}: {s.GetProperty("name").GetString()}"));
                }
            }
            else
            {
                var first = DateTime.ParseExact(e.GetProperty("startDate").GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);
                var last = DateTime.ParseExact(e.GetProperty("endDate").GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);
                for (var day = first; day <= last; day = day.AddDays(1))
                    windows.Add(new(new DateTimeOffset(day + DayStart, offset), new DateTimeOffset(day + DayEnd, offset),
                        $"{name}: all day (not every session is timed yet)"));
            }
        }
        return new(windows);
    }

    static TimeSpan ParseOffset(string s) =>
        (s.StartsWith('-') ? -1 : 1) * TimeSpan.ParseExact(s.TrimStart('+', '-'), @"hh\:mm", CultureInfo.InvariantCulture);

    /// <summary>Sorted, with overlapping or nearly touching windows joined (the first one's reason kept).</summary>
    static List<Window> Merge(IEnumerable<Window> windows)
    {
        var merged = new List<Window>();
        foreach (var w in windows.OrderBy(w => w.Start))
        {
            if (merged.Count > 0 && w.Start - merged[^1].End < Before)
                merged[^1] = merged[^1] with { End = w.End > merged[^1].End ? w.End : merged[^1].End };
            else merged.Add(w);
        }
        return merged;
    }
}

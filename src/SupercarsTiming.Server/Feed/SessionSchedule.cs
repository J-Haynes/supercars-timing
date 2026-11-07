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
        return Parse(File.ReadAllText(path));
    }

    /// <summary>Validates an imported timetable before it can replace the working schedule.</summary>
    public static SessionSchedule Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var events = doc.RootElement.GetProperty("events");
        if (events.GetArrayLength() == 0) throw new FormatException("The schedule must contain events.");
        var windows = new List<Window>();
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in events.EnumerateArray())
        {
            var name = e.GetProperty("name").GetString() ?? "";
            if (string.IsNullOrWhiteSpace(name) || !names.Add(name)) throw new FormatException("Event names must be unique and non-empty.");
            foreach (var field in new[] { "venue", "location", "trackCode", "format", "sessionsSource", "sessionsNote" })
                if (e.TryGetProperty(field, out var value) && value.ValueKind != JsonValueKind.String)
                    throw new FormatException($"{field} must be text.");
            if (e.TryGetProperty("sessionsSource", out var source) &&
                (!Uri.TryCreate(source.GetString(), UriKind.Absolute, out var uri) ||
                 !uri.IsWellFormedOriginalString() || uri.Scheme is not ("https" or "http")))
                throw new FormatException("Session sources must be full HTTP or HTTPS URLs.");
            var first = DateTime.ParseExact(e.GetProperty("startDate").GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            var last = DateTime.ParseExact(e.GetProperty("endDate").GetString()!, "yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (last < first || (last - first).TotalDays > 31) throw new FormatException("Invalid event dates.");
            var offset = ParseOffset(e.GetProperty("utcOffset").GetString() ?? throw new FormatException("A UTC offset is required."));
            _ = new DateTimeOffset(first, offset);
            DateTimeOffset Local(string s) => new(DateTime.ParseExact(s, "yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture), offset);
            bool complete = e.GetProperty("complete").GetBoolean();
            var hasSessions = e.TryGetProperty("sessions", out var sessions);
            if (complete && (!hasSessions || sessions.GetArrayLength() == 0)) throw new FormatException("A complete timetable needs sessions.");
            if (hasSessions)
            {
                foreach (var s in sessions.EnumerateArray())
                {
                    if (string.IsNullOrWhiteSpace(s.GetProperty("name").GetString())) throw new FormatException("Sessions need names.");
                    var start = Local(s.GetProperty("start").GetString()!);
                    if (start.Date < first || start.Date > last) throw new FormatException("Session is outside its event dates.");
                    int laps = s.TryGetProperty("laps", out var l) ? l.GetInt32() : 0;
                    if (s.TryGetProperty("laps", out _) && (laps < 1 || laps > 1000)) throw new FormatException("Invalid lap count.");
                    var end = s.TryGetProperty("end", out var en) ? Local(en.GetString()!)
                        : start + (laps > 0 ? TimeSpan.FromMinutes(Math.Max(90, laps * 1.6)) : TimeSpan.FromHours(1));
                    if (end <= start || end - start > TimeSpan.FromDays(2)) throw new FormatException("Invalid session end time.");
                    if (complete) windows.Add(new(start - Before, end + After, $"{name}: {s.GetProperty("name").GetString()}"));
                }
            }
            if (!complete)
            {
                for (var dayIndex = 0; dayIndex <= (last - first).Days; dayIndex++)
                {
                    var day = first.AddDays(dayIndex);
                    windows.Add(new(new DateTimeOffset(day + DayStart, offset), new DateTimeOffset(day + DayEnd, offset),
                        $"{name}: all day (not every session is timed yet)"));
                }
            }
        }
        return new(windows);
    }

    static TimeSpan ParseOffset(string s)
    {
        if (s.Length != 6 || s[0] is not ('+' or '-')) throw new FormatException("Use a UTC offset such as +10:00.");
        return (s[0] == '-' ? -1 : 1) * TimeSpan.ParseExact(s[1..], @"hh\:mm", CultureInfo.InvariantCulture);
    }

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

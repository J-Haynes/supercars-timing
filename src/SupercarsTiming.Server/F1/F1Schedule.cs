using System.Globalization;
using System.Text.Json;
using SupercarsTiming.Server.Feed;

namespace SupercarsTiming.Server.F1;

/// <summary>The same F1 timetable as the event pages, embedded in the server.</summary>
public sealed class F1Schedule(SessionSchedule sessions)
{
    SessionSchedule.Window? _window;

    // Keep overruns across reconnects; a restart recovers only a window matching the restored session.
    public SessionSchedule.Window? Current(DateTimeOffset now, bool sessionActive = false, DateTimeOffset? sessionStart = null)
    {
        var window = sessions.Current(now);
        if (window is null && sessionActive)
            window = sessionStart is { } start
                ? sessions.Windows.FirstOrDefault(w => w.Start <= start && start < w.End) : _window;
        return _window = window;
    }

    public SessionSchedule.Window? Next(DateTimeOffset now) => sessions.Next(now);

    public static F1Schedule Load()
    {
        using var stream = typeof(F1Schedule).Assembly.GetManifestResourceStream("F1.schedule.json")!;
        using var reader = new StreamReader(stream);
        return Parse(reader.ReadToEnd());
    }

    public static F1Schedule Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        var windows = new List<SessionSchedule.Window>();
        foreach (var meeting in document.RootElement.GetProperty("events").EnumerateArray())
        {
            var offset = meeting.GetProperty("utcOffset").GetString();
            DateTimeOffset At(string local) => DateTimeOffset.Parse(local + offset, CultureInfo.InvariantCulture);
            foreach (var session in meeting.GetProperty("sessions").EnumerateArray())
            {
                var name = session.GetProperty("name").GetString();
                var start = At(session.GetProperty("start").GetString()!);
                // Unpublished ends are connection budgets, not advertised session durations.
                var end = session.TryGetProperty("end", out var value) ? At(value.GetString()!)
                    : start.AddHours(name == "Race" ? 4 : 1);
                windows.Add(new(start - SessionSchedule.Before, end + SessionSchedule.After,
                    $"{meeting.GetProperty("name").GetString()}: {name}"));
            }
        }
        return new(new SessionSchedule(windows));
    }
}

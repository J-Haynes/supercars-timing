using SupercarsTiming.Server.Feed;

namespace SupercarsTiming.Natsoft.Tests;

/// <summary>When the server connects to Natsoft, from the real timetable (src/web/src/schedule/supercars.json).</summary>
public class SessionScheduleTests
{
    static readonly TimeSpan Aest = TimeSpan.FromHours(10), Aedt = TimeSpan.FromHours(11);

    static SessionSchedule Real()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && dir.GetFiles("SupercarsTiming.slnx").Length == 0) dir = dir.Parent;
        return SessionSchedule.Load(Path.Combine(dir!.FullName, "src/web/src/schedule/supercars.json"));
    }

    static DateTimeOffset At(int month, int day, int hour, int minute, TimeSpan offset) => new(2026, month, day, hour, minute, 0, offset);

    [Fact]
    public void Not_connected_between_events_and_the_next_window_is_30_min_before_practice_1()
    {
        var s = Real();
        var now = At(10, 12, 16, 0, Aedt);
        Assert.Null(s.Current(now));
        var next = s.Next(now)!;
        Assert.Equal(At(10, 23, 11, 15, Aest), next.Start); // Gold Coast Practice 1 is 11:45 AEST
        Assert.Contains("Practice 1", next.Reason);
    }

    [Fact]
    public void Gold_Coast_connects_30_min_either_side_of_each_session()
    {
        var s = Real();
        Assert.Null(s.Current(At(10, 23, 11, 14, Aest)));
        Assert.NotNull(s.Current(At(10, 23, 11, 15, Aest)));
        Assert.Equal(At(10, 23, 12, 40, Aest), s.Current(At(10, 23, 12, 0, Aest))!.End); // P1 ends 12:10
        Assert.Null(s.Current(At(10, 23, 13, 0, Aest)));   // between P1 and P2 (40 min apart: two connections)
        Assert.NotNull(s.Current(At(10, 23, 13, 20, Aest))); // 30 min before P2
    }

    [Fact]
    public void A_race_without_an_end_time_lasts_1_6_min_a_lap()
    {
        var s = Real();
        // Race 31: 15:15 AEST, 85 laps -> 136 min -> 17:31, plus 30 min.
        Assert.Equal(At(10, 24, 18, 1, Aest), s.Current(At(10, 24, 17, 0, Aest))!.End);
    }

    [Fact]
    public void An_event_without_a_full_timetable_is_covered_all_day()
    {
        var s = Real();
        // Bathurst was never fully timed in the file (complete=false), so 07:00-19:00 AEDT on every event day.
        Assert.NotNull(s.Current(At(10, 8, 9, 0, Aedt)));
        Assert.Null(s.Current(At(10, 8, 6, 59, Aedt)));
        Assert.Null(s.Current(At(10, 11, 19, 1, Aedt)));
    }

    [Fact]
    public void Sandown_practice_sessions_20_min_apart_are_one_connection()
    {
        var s = Real();
        // Practice 1 14:40-15:05 AEDT, Practice 2 15:25-15:50 (Supercars, correct as of 30 Sep): 14:10 to 16:20.
        Assert.Null(s.Current(At(11, 6, 14, 9, Aedt)));
        Assert.Equal(At(11, 6, 16, 20, Aedt), s.Current(At(11, 6, 14, 10, Aedt))!.End);
    }

    [Fact]
    public void Close_windows_merge_into_one_connection()
    {
        var t0 = At(10, 1, 10, 0, Aest);
        var s = new SessionSchedule([
            new(t0, t0.AddHours(1), "a"),
            new(t0.AddMinutes(80), t0.AddHours(3), "b"),   // 20 min after a: merged
            new(t0.AddHours(5), t0.AddHours(6), "c"),      // 2 h later: separate
        ]);
        Assert.Equal(2, s.Windows.Count);
        Assert.Equal(t0.AddHours(3), s.Windows[0].End);
    }
}

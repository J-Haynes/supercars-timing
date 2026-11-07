using System.Text.Json.Nodes;
using SupercarsTiming.Server.F1;
using SupercarsTiming.Server.Feed;

namespace SupercarsTiming.Natsoft.Tests;

public class F1ScheduleTests
{
    [Theory]
    [InlineData("2026-11-06T12:30:00-03:00", "Practice 1")]
    [InlineData("2026-10-10T17:00:00+08:00", "Sprint")]
    public void Connects_only_from_30_minutes_before_the_scheduled_session(string time, string name)
    {
        var start = DateTimeOffset.Parse(time);
        var schedule = F1Schedule.Load();
        Assert.Null(schedule.Current(start.AddMinutes(-30).AddTicks(-1)));
        var window = Assert.IsType<SessionSchedule.Window>(schedule.Current(start.AddMinutes(-30)));
        Assert.Equal(start.AddMinutes(-30), window.Start);
        Assert.Contains(name, window.Reason);
        Assert.NotNull(schedule.Current(start));
    }

    [Fact]
    public void Disconnects_between_sessions_and_after_the_race_window()
    {
        var schedule = F1Schedule.Load();
        Assert.Null(schedule.Current(DateTimeOffset.Parse("2026-11-06T14:30:00-03:00")));
        Assert.Equal(DateTimeOffset.Parse("2026-11-06T15:30:00-03:00"),
            schedule.Next(DateTimeOffset.Parse("2026-11-06T14:30:00-03:00"))!.Start);
        // The upstream timetable has no race end: allow the four-hour connection budget, plus 30 minutes.
        var end = DateTimeOffset.Parse("2026-11-08T18:30:00-03:00");
        Assert.NotNull(schedule.Current(end.AddTicks(-1)));
        Assert.Null(schedule.Current(end));
        Assert.Null(schedule.Current(DateTimeOffset.Parse("2026-11-05T12:00:00Z")));
    }

    [Fact]
    public void Active_red_flag_keeps_the_window_through_reconnects_until_the_session_finishes()
    {
        var now = DateTimeOffset.Parse("2026-11-08T18:29:00-03:00");
        var clock = new Clock(now);
        var store = new F1Store(clock);
        var schedule = F1Schedule.Load();
        var window = schedule.Current(now);
        store.Apply(new(now, "SessionStatus", JsonNode.Parse("""{"Status":"Aborted"}""")));
        clock.UtcNow = now.AddMinutes(2);
        foreach (var status in new[] { "error", "connecting", "live" })
        {
            store.SetStatus(new(FeedMode.Live, status, "F1 live timing"));
            Assert.True(store.HasActiveSession);
            Assert.Same(window, schedule.Current(clock.UtcNow, store.HasActiveSession));
        }
        store.Apply(new(clock.UtcNow, "SessionStatus", JsonNode.Parse("""{"Status":"Finished"}""")));
        Assert.False(store.HasActiveSession);
        Assert.Null(schedule.Current(clock.UtcNow, store.HasActiveSession));
    }

    [Theory]
    [InlineData(15, true)]
    [InlineData(600, false)]
    public void Restart_recovers_only_a_matching_overrun_with_fresh_recorded_activity(int ageSeconds, bool active)
    {
        var now = DateTimeOffset.Parse("2026-11-08T18:31:00-03:00");
        var store = new F1Store(new Clock(now));
        var recordedAt = now.AddSeconds(-ageSeconds);
        store.Apply(new(recordedAt, "SessionInfo", JsonNode.Parse("""
            {"Key":123,"Type":"Race","Name":"Race","StartDate":"2026-11-08T14:00:00","GmtOffset":"-03:00:00"}
            """)), recorded: true);
        store.Apply(new(recordedAt, "SessionStatus", JsonNode.Parse("""{"Status":"Aborted"}""")), recorded: true);
        Assert.Equal(active, store.HasActiveSession);
        Assert.Null(F1Schedule.Load().Current(now, sessionActive: true));
        var window = F1Schedule.Load().Current(now, store.HasActiveSession, store.SessionStartUtc);
        if (active)
        {
            Assert.NotNull(window);
            Assert.Equal(DateTimeOffset.Parse("2026-11-08T13:30:00-03:00"), window.Start);
            Assert.Equal(DateTimeOffset.Parse("2026-11-08T18:30:00-03:00"), window.End);
        }
        else Assert.Null(window);
    }

    sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset UtcNow { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => UtcNow;
    }
}

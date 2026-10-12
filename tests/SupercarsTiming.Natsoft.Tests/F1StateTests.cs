using System.Text.Json.Nodes;
using SupercarsTiming.Server.F1;

namespace SupercarsTiming.Natsoft.Tests;

/// <summary>F1 live timing state, with message shapes copied from the Singapore 2026 Sprint archive.</summary>
public class F1StateTests
{
    static readonly DateTimeOffset T0 = new(2026, 10, 10, 9, 0, 0, TimeSpan.Zero);

    static F1Message Msg(double seconds, string topic, string json) => new(T0.AddSeconds(seconds), topic, JsonNode.Parse(json));

    static F1Message Segment(double seconds, string car, int sector, int segment, int status = 2048) =>
        Msg(seconds, "TimingData",
            "{\"Lines\":{\"" + car + "\":{\"Sectors\":{\"" + sector + "\":{\"Segments\":{\"" + segment + "\":{\"Status\":" + status + "}}}}}}}");

    static F1State Session()
    {
        var s = new F1State();
        s.Apply(Msg(0, "SessionInfo", """{"Meeting":{"Name":"Singapore Grand Prix","Location":"Marina Bay","Circuit":{"Key":61,"ShortName":"Singapore"}},"Key":11383,"Type":"Race","Name":"Sprint","GmtOffset":"08:00:00"}"""));
        s.Apply(Msg(0, "DriverList", """{"3":{"RacingNumber":"3","FirstName":"Max","LastName":"VERSTAPPEN","TeamName":"Red Bull Racing","TeamColour":"4781D7"}}"""));
        s.Apply(Msg(0, "TimingData", """{"Lines":{"3":{"Position":"1","NumberOfLaps":5,"Sectors":[{"Segments":[{"Status":0},{"Status":0},{"Status":0},{"Status":0},{"Status":0},{"Status":0},{"Status":0},{"Status":0}]},{"Segments":[{"Status":0},{"Status":0},{"Status":0},{"Status":0},{"Status":0},{"Status":0},{"Status":0},{"Status":0}]},{"Segments":[{"Status":0},{"Status":0},{"Status":0},{"Status":0},{"Status":0},{"Status":0},{"Status":0},{"Status":0}]}]}}}"""));
        return s;
    }

    [Fact]
    public void Times_the_stretches_either_side_of_the_line()
    {
        var s = Session();
        s.Apply(Segment(100, "3", 2, 6));
        s.Apply(Segment(101, "3", 2, 7)); // last mini-sector: ends at the line
        s.Apply(Msg(101.1, "TimingData", """{"Lines":{"3":{"NumberOfLaps":6,"LastLapTime":{"Value":"2:35.705"}}}}"""));
        // The lap reset: first segment done, the rest cleared.
        s.Apply(Msg(104.4, "TimingData", """{"Lines":{"3":{"Sectors":{"0":{"Segments":{"0":{"Status":2051},"1":{"Status":0},"2":{"Status":0}}},"1":{"Segments":{"0":{"Status":0}}}}}}}"""));
        s.Apply(Segment(106.4, "3", 0, 0, 2049)); // colour re-sent: not a crossing
        s.Apply(Segment(107.3, "3", 0, 1));

        var car = s.Snapshot().Cars.Single();
        Assert.Equal("1.2", car.LastPoint);
        Assert.Equal(3.4, car.CurrentSegments[0], 2); // M -> 1.1
        Assert.Equal(2.9, car.CurrentSegments[1], 2); // 1.1 -> 1.2
        Assert.Equal(1.0, car.BestSegments[^1], 2); // 2.7 -> 2.8 (the line); no "last lap": we joined mid-lap
        Assert.Equal(6, car.Laps);
    }

    [Fact]
    public void A_new_session_drops_the_old_sessions_timing()
    {
        // Singapore 2026: the race's lines arrived fresh (no lap count, no pit stops yet) but were merged onto
        // qualifying's, so every car started the race on its qualifying laps and pit stops, "in the pit" for minutes.
        var s = Session();
        s.Apply(Msg(10, "TimingData", """{"Lines":{"3":{"NumberOfPitStops":5,"InPit":true}}}"""));
        s.Apply(Msg(20, "SessionInfo", """{"Key":11390,"Type":"Race","Name":"Race","GmtOffset":"08:00:00"}"""));
        s.Apply(Msg(24, "TimingData", """{"Lines":{"3":{"Position":"1","InPit":true,"PitOut":false}}}"""));

        var car = s.Snapshot().Cars.Single();
        Assert.Equal(0, car.Laps);
        Assert.Equal(0, car.PitStops);
        Assert.True(car.InPit);
        Assert.Empty(car.PitLog); // in the garage before the start: not a pit stop
    }

    [Theory]
    [InlineData("FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 87 (BEA) - CAUSING A COLLISION", "87", "5 seconds")]
    [InlineData("FIA STEWARDS: DRIVE THROUGH PENALTY FOR CAR 4 (NOR) - PIT LANE SPEEDING", "4", "drive through")]
    public void Reads_penalties(string text, string car, string what) =>
        Assert.Equal((car, what), F1State.Penalty(text));

    [Theory]
    [InlineData("+1.141", 1.141, 0)]
    [InlineData("1L", 0, 1)]
    [InlineData("LAP 20", 0, 0)]
    public void Reads_gaps(string text, double seconds, int laps) =>
        Assert.Equal((seconds, laps), F1State.ParseGap(text));

    /// <summary>
    /// Connected isn't live: between sessions F1's hub sends the last session's saved state (flag Ended) and nothing
    /// more, and the header said LIVE all day (12 Oct 2026). The store reports "waiting" then.
    /// </summary>
    [Fact]
    public void Status_is_waiting_not_live_once_the_session_has_ended()
    {
        var store = new F1Store();
        store.SetStatus(new(SupercarsTiming.Server.Feed.FeedMode.Live, "live", "F1 live timing"));
        var now = DateTimeOffset.UtcNow;
        store.Apply(new F1Message(now, "SessionInfo", JsonNode.Parse("""{"Meeting":{"Name":"Singapore Grand Prix"},"Key":11383,"Type":"Race","Name":"Race","GmtOffset":"08:00:00"}""")));
        store.Apply(new F1Message(now, "SessionStatus", JsonNode.Parse("""{"Status":"Started"}""")));
        Assert.Equal("live", store.Status.State);

        store.Apply(new F1Message(now, "SessionStatus", JsonNode.Parse("""{"Status":"Finalised"}""")));
        Assert.Equal("waiting", store.Status.State);
        Assert.Contains("no session running", store.Status.Detail);
    }
}

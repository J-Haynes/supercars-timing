using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Natsoft.Tests;

/// <summary>Endurance-race tracking: laps per driver, pit stops, stints, and keeping history across reconnects.</summary>
public class RaceTrackingTests
{
    // Trimmed from the Bathurst 2026 snapshots; E L is the scheduled distance (the Shootout sends L="1").
    const string Snapshot = """
        <New T="1000.0000">
          <M D="2026 Repco Bathurst 1000" Y="Cars" />
          <T C="MOUN" N="MOUNT PANORAMA - BATHURST"><TP ID="1" Y="Pos1" /></T>
          <E C="R31" D="2026 Repco Supercars Championship - Race 31" Y="Race" L="161" />
          <RL><R ID="22" N="88" V="Ford Mustang GT"><V ID="1" N="Broc Feeney" /><V ID="2" N="Jamie Whincup" /></R></RL>
          <L><P L="1" C="22" D="1"><D L="10" P="N" PS="0" /></P></L>
        </New>
        """;

    static void Car(TimingState s, double t, string attrs, string driver = "1") =>
        s.Apply($"""<L T="{t:0.0000}" Y="p"><P L="1" C="22" D="{driver}"><D {attrs} /></P></L>""");

    static TimingState Fresh()
    {
        var s = new TimingState();
        s.Apply(Snapshot);
        return s;
    }

    [Fact]
    public void Scheduled_laps_come_from_the_session_element()
    {
        Assert.Equal(161, Fresh().ScheduledLaps);
        Assert.Equal(161, TimingSnapshot.From(Fresh()).Session.ScheduledLaps);
    }

    [Fact]
    public void Laps_are_credited_to_the_driver_in_the_car_and_snapshot_laps_are_unattributed()
    {
        var s = Fresh();
        Car(s, 1100, """L="11" """);
        Car(s, 1200, """L="12" """);
        Car(s, 1300, """L="13" """, driver: "2");

        Assert.Equal(2, s.Cars["22"].LapsByDriver["1"]);
        Assert.Equal(1, s.Cars["22"].LapsByDriver["2"]);
        var row = TimingSnapshot.From(s).Cars.Single();
        Assert.Equal([2, 1], row.DriverLaps);
        Assert.Equal(10, row.UnattributedLaps);   // laps before we connected
    }

    [Fact]
    public void Natsofts_current_driver_lap_count_wins_including_in_a_snapshot()
    {
        // Practice 6, car 10: LCD resumes from the driver's earlier laps after swapping back.
        var s = new TimingState();
        s.Apply(Snapshot.Replace("""<P L="1" C="22" D="1"><D L="10" P="N" PS="0" /></P>""", """<P L="1" C="22" D="2"><D L="30" LCD="12" P="N" PS="2" /></P>"""));
        Assert.Equal(12, s.Cars["22"].LapsByDriver["2"]);
        Assert.Equal(18, TimingSnapshot.From(s).Cars.Single().UnattributedLaps);

        Car(s, 1100, """L="31" LCD="13" """, driver: "2");
        Car(s, 1200, """LDC="31" LCD="9" """, driver: "1");           // swap: driver 1 already had 9
        Assert.Equal([9, 13], TimingSnapshot.From(s).Cars.Single().DriverLaps);
    }

    [Fact]
    public void Pit_stop_is_logged_with_pit_lane_time_driver_swap_and_new_stint()
    {
        var s = Fresh();
        Car(s, 1100, """L="11" """);
        Car(s, 1150, """P="Y" LLP="11" PS="1" PF="P" PI="1149.5000" """);
        Car(s, 1188, """P="N" PF="T" PI="0.0000" PT="38.4000" """);
        Car(s, 1190, """SC="N" """, driver: "2");                      // swap arrives just after the exit
        Car(s, 1300, """L="12" """, driver: "2");
        Car(s, 1400, """L="13" """, driver: "2");

        var stop = Assert.Single(s.Cars["22"].PitLog);
        Assert.Equal(11, stop.Lap);
        Assert.Equal(1149.5, stop.InAt, 3);
        Assert.Equal(38.4, stop.Seconds, 3);
        var row = TimingSnapshot.From(s).Cars.Single();
        Assert.Equal("Broc Feeney", row.PitLog[0].DriverIn);
        Assert.Equal("Jamie Whincup", row.PitLog[0].DriverOut);
        Assert.Equal(2, row.StintLaps);
    }

    [Fact]
    public void Reconnecting_to_the_same_session_keeps_history()
    {
        var s = Fresh();
        Car(s, 1100, """L="11" """);
        Car(s, 1150, """P="Y" LLP="11" PS="1" PI="1150.0000" """);
        Car(s, 1188, """P="N" PT="38.0000" """);
        Car(s, 1300, """L="12" """);

        // Connection drops for two laps; the new snapshot says 14 laps, same driver, no extra stop.
        s.Apply(Snapshot.Replace("""<D L="10" P="N" PS="0" />""", """<D L="14" P="N" PS="1" />""").Replace("1000.0000", "1500.0000"));

        var car = s.Cars["22"];
        Assert.Single(car.PitLog);
        Assert.Equal(4, car.LapsByDriver["1"]);                       // 1 + 1 seen live, + 2 while disconnected
        Assert.Equal(11, car.StintStartLap);
        Assert.Equal(10, TimingSnapshot.From(s).Cars.Single().UnattributedLaps);
    }

    [Fact]
    public void A_different_session_starts_from_scratch()
    {
        var s = Fresh();
        Car(s, 1100, """L="11" """);
        s.Apply(Snapshot.Replace("Race 31", "Race 32").Replace("R31", "R32"));
        Assert.Empty(s.Cars["22"].LapsByDriver);
    }

    [Fact]
    public void Reconnect_keeps_history_when_the_cars_come_after_the_snapshot()
    {
        // Live, Natsoft's <New> has no cars; they arrive in a full <L Y="f"> straight after (Bathurst 1000 restart).
        var s = Fresh();
        Car(s, 1100, """L="11" LCD="11" """);
        Car(s, 1150, """P="Y" LLP="11" PS="1" PI="1150.0000" """);
        Car(s, 1188, """P="N" PT="38.0000" """);
        Car(s, 1300, """L="12" LCD="10" """, driver: "2");         // co-driver: 10 laps (Natsoft's count)

        var noCars = Snapshot.Replace("""<L><P L="1" C="22" D="1"><D L="10" P="N" PS="0" /></P></L>""", "").Replace("1000.0000", "1500.0000");
        s.Apply(noCars);
        Assert.Empty(s.Cars);
        s.Apply("""<L T="1500.5000" Y="f" L="26"><P L="1" LP="1" C="22" D="2"><D L="14" LCD="12" P="N" PS="1" /></P></L>""");

        var car = s.Cars["22"];
        Assert.Single(car.PitLog);                                  // pit stop carried over
        Assert.Equal(11, car.LapsByDriver["1"]);                    // primary's laps carried over
        Assert.Equal(12, car.LapsByDriver["2"]);                    // Natsoft's newer LCD wins over our 10
        Assert.Equal(11, car.StintStartLap);
    }

    [Fact]
    public void Reconnect_while_a_car_is_in_the_pits_logs_the_stop_once_and_closes_it()
    {
        // Bathurst 1000: Wood pitted 26 s before a restart; the stop was logged twice and the copy stayed "in pit".
        var s = Fresh();
        Car(s, 1100, """L="11" """);
        Car(s, 1150, """P="Y" LLP="11" PS="1" PI="1150.0000" """);

        var noCars = Snapshot.Replace("""<L><P L="1" C="22" D="1"><D L="10" P="N" PS="0" /></P></L>""", "").Replace("1000.0000", "1170.0000");
        s.Apply(noCars);
        s.Apply("""<L T="1170.5000" Y="f" L="26"><P L="1" LP="1" C="22" D="1"><D L="11" P="Y" PS="1" PI="1150.0000" /></P></L>""");
        Car(s, 1188, """P="N" PT="38.0000" """, driver: "2");

        var stop = Assert.Single(s.Cars["22"].PitLog);
        Assert.Equal(1150, stop.InAt, 3);
        Assert.Equal(38, stop.Seconds, 3);
        Assert.Equal("2", stop.DriverOut);
    }

    [Fact]
    public void Each_completed_lap_is_kept_with_time_position_gap_and_pit()
    {
        var s = Fresh();
        s.Apply("""<L T="1100.0000" Y="p"><P L="2" C="22" D="1"><D L="11" I="128.5000" GI="1.2500" GL="0" T="1099.9000" LP="M" /></P></L>""");
        Car(s, 1150, """P="Y" LLP="11" PS="1" PI="1150.0000" """);
        Car(s, 1188, """P="N" PT="38.0000" """);
        s.Apply("""<L T="1260.0000" Y="p"><P L="5" C="22" D="2"><D L="12" I="160.1000" GI="30.0000" GL="0" T="1259.8000" LP="M" /></P></L>""");

        var laps = s.Cars["22"].LapHistory;
        Assert.Equal([11, 12], laps.Select(l => l.Lap));
        Assert.Equal(new LapEntry(11, 128.5, 2, 1.25, 0, "1", false, 1099.9), laps[0]);
        Assert.True(laps[1].Pitted || s.Cars["22"].PitLog[0].Lap == 11);   // the stop was logged against lap 11
        Assert.Equal(12, LapHistory.From(s).Cars.Single().Laps[^1].Lap);
    }

    [Fact]
    public void Pit_entry_after_the_chequered_flag_is_not_a_stop()
    {
        var s = Fresh();
        s.Apply("""<S T="1100.0000" S="Checkered" I="1100.0000" />""");
        Car(s, 1150, """P="Y" LLP="161" PS="2" PI="1150.0000" """);   // cool-down lap into the pit lane
        Assert.Empty(s.Cars["22"].PitLog);
    }
}

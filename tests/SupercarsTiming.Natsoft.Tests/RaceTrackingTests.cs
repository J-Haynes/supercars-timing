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
    public void A_lap_time_of_question_mark_on_a_flying_lap_is_a_deleted_lap_and_clears_the_last_lap()
    {
        // Gold Coast Practice 1 (23 Oct 2026): a kerb hop withholds the lap time and the last sector at the line.
        // Before, "?" didn't parse and the previous lap's time stayed on as the last lap.
        var s = Fresh();
        Car(s, 1100, """L="11" I="78.1000" S3="28.9000" LP="M" """);
        Car(s, 1180, """L="12" I="?" S3="?" LP="M" """);

        var car = s.Cars["22"];
        Assert.True(car.LastLapDeleted);
        Assert.Equal(0, car.LastLap);
        Assert.Equal(0, car.S3);
        Assert.Equal(1, car.DeletedLaps);
        Assert.True(car.LapHistory[^1].Deleted);
        Assert.Equal(0, car.LapHistory[^1].Time);
        Assert.True(TimingSnapshot.From(s).Cars.Single().LastLapDeleted);

        Car(s, 1258, """L="13" I="77.9000" LP="M" """);
        Assert.False(car.LastLapDeleted);
        Assert.Equal(77.9, car.LastLap);

        // An in-lap without a time isn't a deleted lap (at Bathurst "?" came on in- and out-laps).
        Car(s, 1345, """L="14" I="?" P="Y" PF="P" LP="M" """);
        Assert.False(car.LastLapDeleted);
        Assert.Equal(1, car.DeletedLaps);
    }

    [Fact]
    public void Only_a_sector_time_of_question_mark_at_the_line_is_a_deleted_lap_too()
    {
        // Gold Coast Practice 2: some deleted laps come with S3="?" and no lap time at all.
        var s = Fresh();
        Car(s, 1100, """L="11" I="70.1000" LP="M" """);
        Car(s, 1172, """L="12" S3="?" LP="M" """);

        var car = s.Cars["22"];
        Assert.True(car.LastLapDeleted);
        Assert.Equal(0, car.LastLap);
        Assert.Equal(1, car.DeletedLaps);
        Assert.True(car.LapHistory[^1].Deleted);
    }

    [Fact]
    public void A_question_mark_mid_lap_deletes_the_lap_at_once_and_counts_it_once()
    {
        // Gold Coast Shootout: I2="?" at Int2, then I="?" at the line (or a pit stop instead) for the same lap.
        var s = Fresh();
        Car(s, 1100, """L="11" I="70.1000" LP="M" """);
        Car(s, 1140, """I2="?" S2="?" LP="6" """);

        var car = s.Cars["22"];
        Assert.True(car.LastLapDeleted);
        Assert.Equal(0, car.LastLap);
        Assert.Equal(1, car.DeletedLaps);

        Car(s, 1172, """L="12" I="?" S3="?" LP="M" """);
        Assert.True(car.LastLapDeleted);
        Assert.Equal(1, car.DeletedLaps);

        // The next lap stands.
        Car(s, 1244, """L="13" I="71.0000" LP="M" """);
        Assert.False(car.LastLapDeleted);
        Assert.Equal(1, car.DeletedLaps);

        // Deleted mid-lap, then into the pits before the line: still deleted.
        Car(s, 1280, """I2="?" S2="?" LP="6" """);
        Car(s, 1300, """P="Y" PF="P" """);
        Assert.True(car.LastLapDeleted);
        Assert.Equal(2, car.DeletedLaps);
    }

    [Fact]
    public void Times_withheld_under_a_red_flag_are_not_deleted_laps()
    {
        var s = Fresh();
        Car(s, 1100, """L="11" I="70.1000" LP="M" """);
        s.Apply("""<S T="1120.0000" S="Red" I="1120.0000" />""");
        Car(s, 1130, """I1="?" S1="?" LP="3" """);
        Assert.False(s.Cars["22"].LastLapDeleted);
        Assert.Equal(0, s.Cars["22"].DeletedLaps);
    }

    [Fact]
    public void The_grid_is_the_order_as_the_race_leaves_WaitStart_even_when_Natsoft_resends_the_session_then()
    {
        // Gold Coast Race 31: WaitStart, then at the start a fresh <New> of the same session, the safety car flag
        // (the race started behind it), and only then the cars, in a separate update.
        const string Session = """
            <M D="2026 Boost Mobile Gold Coast 500" Y="Cars" />
            <E C="R7" D="2026 Repco Supercars Championship - Race 31" Y="Race" L="85" />
            <RL><R ID="1" N="88" V="Ford Mustang GT"><V ID="1" N="Broc Feeney" /></R>
                <R ID="2" N="888" V="Ford Mustang GT"><V ID="1" N="Will Brown" /></R></RL>
            """;
        var s = new TimingState();
        s.Apply($"""<New T="1000.0000">{Session}<S T="1000.0000" S="WaitStart" I="0.0000" /></New>""");
        s.Apply("""<L T="1000.0000" Y="f"><P L="1" C="1" D="1"><D L="0" /></P><P L="2" C="2" D="1"><D L="0" /></P></L>""");
        Assert.All(s.Cars.Values, c => Assert.Equal(0, c.GridPosition));   // not before the start

        s.Apply($"""<New T="1300.0000">{Session}</New>""");
        s.Apply("""<S T="1300.0000" S="Yellow" I="1300.0000" />""");
        s.Apply("""<L T="1300.0000" Y="f"><P L="1" C="1" D="1"><D L="0" /></P><P L="2" C="2" D="1"><D L="0" /></P></L>""");
        Assert.Equal(1, s.Cars["1"].GridPosition);
        Assert.Equal(2, s.Cars["2"].GridPosition);

        // Positions change; the grid doesn't, nor at the green after the safety car.
        s.Apply("""<L T="1400.0000" Y="p"><P L="1" C="2" D="1"><D L="2" /></P><P L="2" C="1" D="1"><D L="2" /></P></L>""");
        s.Apply("""<S T="1700.0000" S="Green" I="1300.0000" />""");
        Assert.Equal(2, TimingSnapshot.From(s).Cars.Single(c => c.CarNumber == "888").GridPosition);
    }

    [Fact]
    public void Connecting_after_the_start_gives_no_grid()
    {
        var s = Fresh();   // a race snapshot with no WaitStart: it has already started
        s.Apply("""<S T="1100.0000" S="Green" I="1100.0000" />""");
        Assert.Equal(0, s.Cars["22"].GridPosition);
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

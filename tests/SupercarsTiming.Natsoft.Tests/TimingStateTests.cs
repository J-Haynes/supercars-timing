using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Natsoft.Tests;

/// <summary>Messages are trimmed-down versions of real Bathurst 2026 Practice 5 frames.</summary>
public class TimingStateTests
{
    const string Snapshot = """
        <New T="1791626813.9136" Seq="212">
          <M D="2026 Repco Bathurst 1000" Y="Cars" />
          <T C="MOUN" N="MOUNT PANORAMA - BATHURST" I="2" P="7" PI1="3" PI2="5">
            <TP ID="1" Y="Pos1" /><TP ID="2" Y="Pos2" /><TP ID="3" Y="Int1" /><TP ID="4" Y="Pos3" />
            <TP ID="5" Y="Int2" /><TP ID="6" Y="Pos4" /><TP ID="7" Y="Pos5" />
          </T>
          <E C="P12" D="2026 Repco Supercars Championship - Practice 5 (Co-Drivers)" Y="Practice" />
          <RL>
            <R ID="9" CC="0" C="10" S="" N="10" V="Chev Camaro ZL1"><V ID="1" B="1" N="Zach Bates" /><V ID="2" B="2" N="Aaron Seton" /></R>
            <R ID="22" CC="0" C="88" S="" N="88" V="Ford Mustang GT"><V ID="1" B="1" N="Broc Feeney" /><V ID="2" B="2" N="Nick Percat" /></R>
            <R ID="14" CC="0" C="18" S="" N="18" V="Chev Camaro ZL1"><V ID="1" B="1" N="Anton De_Pasquale" /><V ID="2" B="2" N="Lee Holdsworth" /></R>
          </RL>
        </New>
        """;

    static TimingState Loaded()
    {
        var s = new TimingState();
        s.Apply(Snapshot);
        s.Apply("""<S T="1791626813.9136" S="Green" I="1791626700.0000" R="0" E="P12" P="1" SN="0" />""");
        s.Apply("""<C T="1791626813.9136" Y="T" C="3487" E="113" />""");
        s.Apply("""
            <L T="1791626813.9136" Y="f" L="25">
              <P L="1" LL="1" P="" LP="" C="22" D="2" T="0"><D LT="0" L="3" I="126.1000" FI="125.5861" FL="3" GI="0.0000" GNI="0.0000" LP="4" PS="0" P="N" /></P>
              <P L="2" LL="2" P="" LP="" C="9" D="2" T="0"><D LT="0" L="3" I="126.5000" FI="126.2000" FL="2" GI="0.6139" GNI="0.6139" LP="2" PS="1" P="N" /></P>
            </L>
            """);
        return s;
    }

    [Fact]
    public void Snapshot_loads_meeting_track_session_and_entries()
    {
        var s = Loaded();
        Assert.Equal("2026 Repco Bathurst 1000", s.Meeting);
        Assert.Equal("MOUNT PANORAMA - BATHURST", s.TrackName);
        Assert.Equal("Practice", s.SessionType);
        Assert.Equal(7, s.TimingPoints.Count);
        Assert.Equal("Int1", s.TimingPoints[2].Name);
        Assert.Equal(3, s.Entries.Count);
        Assert.Equal("88", s.Entries["22"].CarNumber);
        Assert.Equal("Anton De Pasquale", s.Entries["14"].Drivers["1"]);   // underscores become spaces
    }

    [Fact]
    public void Status_and_clock_are_tracked()
    {
        var s = Loaded();
        Assert.Equal("Green", s.Flag);
        Assert.Equal(3487, s.ClockRemaining);
        Assert.Equal(113, s.ClockElapsed);
    }

    [Fact]
    public void Full_leaderboard_sets_car_state()
    {
        var car = Loaded().Cars["22"];
        Assert.Equal(1, car.Position);
        Assert.Equal("2", car.DriverIndex);
        Assert.Equal(3, car.Laps);
        Assert.Equal(125.5861, car.BestLap, 4);
        Assert.Equal("4", car.LastPoint);
        Assert.False(car.InPit);
    }

    [Fact]
    public void Partial_updates_only_change_sent_fields()
    {
        var s = Loaded();
        s.Apply("""<L T="1791626830.0000" Y="p" L="25"><P L="1" LL="1" P="" LP="" C="22" D="2" T="0"><D LP="5" I2="92.5170" S2="37.4917" /></P></L>""");

        var car = s.Cars["22"];
        Assert.Equal("5", car.LastPoint);
        Assert.Equal(1791626830.0, car.LastPointAt, 3);
        Assert.Equal(37.4917, car.S2, 4);
        Assert.Equal(125.5861, car.BestLap, 4);   // untouched
        Assert.Equal(3, car.Laps);                 // untouched
    }

    [Fact]
    public void Speed_trap_zero_reset_is_ignored()
    {
        var s = Loaded();
        s.Apply("""<L T="1" Y="p"><P L="1" C="22" D="2"><D SP="279" /></P></L>""");
        s.Apply("""<L T="2" Y="p"><P L="1" C="22" D="2"><D SP="0" LP="6" /></P></L>""");
        Assert.Equal(279, s.Cars["22"].Speed);
    }

    [Fact]
    public void Pit_entry_is_tracked()
    {
        var s = Loaded();
        s.Apply("""<L T="1" Y="p"><P L="2" C="9" D="2"><D P="Y" LLP="3" PS="2" PF="P" PI="1791627287.5874" /></P></L>""");
        Assert.True(s.Cars["9"].InPit);
        Assert.Equal(2, s.Cars["9"].PitStops);
    }

    [Fact]
    public void New_snapshot_resets_previous_session()
    {
        var s = Loaded();
        s.Apply(Snapshot);
        Assert.Empty(s.Cars);
        Assert.Equal(3, s.Entries.Count);
    }

    [Fact]
    public void TimingSnapshot_orders_cars_and_resolves_names()
    {
        var snap = TimingSnapshot.From(Loaded());
        Assert.Equal(["88", "10"], snap.Cars.Select(c => c.CarNumber));
        Assert.Equal("Nick Percat", snap.Cars[0].Driver);         // driver index 2 = co-driver
        Assert.Equal("Ford", snap.Cars[0].Manufacturer);
        Assert.Equal(125.5861, snap.Best.Lap!.Value, 4);
    }

    [Fact]
    public void NotFound_messages_are_ignored()
    {
        var s = Loaded();
        var before = s.MessageCount;
        s.Apply(NatsoftMessage.FromRaw(DateTimeOffset.UtcNow, "<NotFound />\r\n"));
        Assert.Equal(before, s.MessageCount);
    }

    [Fact]
    public void Last_line_crossing_survives_a_pit_entry()
    {
        // After the chequered flag the UI marks cars that crossed the line since (finishedCars in session.ts).
        // Entering the pits clears LapStartAt, so the crossing time needs its own field.
        var s = Loaded();
        s.Apply("""<S T="1791630300.0000" S="Checkered" I="1791630300.0000" R="0" E="P12" P="1" SN="0" />""");
        s.Apply("""<L T="1791630310.0000" Y="p"><P L="1" C="22" D="2"><D L="4" I="126.0000" T="1791630310.0000" LP="M" /></P></L>""");
        s.Apply("""<L T="1791630400.0000" Y="p"><P L="1" C="22" D="2"><D P="Y" PF="P" PI="1791630400.0000" /></P></L>""");

        var car = TimingSnapshot.From(s).Cars.Single(c => c.Id == "22");
        Assert.Equal(0, car.LapStartAt);
        Assert.Equal(1791630310.0, car.LastLineAt);
        Assert.Equal("Checkered", s.FlagHistory[^1].Flag);
        Assert.True(car.LastLineAt >= s.FlagHistory[^1].Time);
    }
}

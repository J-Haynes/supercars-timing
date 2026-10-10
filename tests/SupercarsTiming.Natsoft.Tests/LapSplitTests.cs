using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Natsoft.Tests;

/// <summary>Lap splits for the Shootout card: out-lap, flying lap, in-lap.</summary>
public class LapSplitTests
{
    // Bathurst-like: 3 timing points, intermediate 1 measured at point "2".
    const string Snapshot = """
        <New T="1000.0000">
          <T C="MOUN" N="MOUNT PANORAMA - BATHURST" I="1" P="3" PI1="2"><TP ID="1" Y="Pos1" /><TP ID="2" Y="Int1" /><TP ID="3" Y="Pos2" /></T>
          <E C="TTS" D="Top Ten Shootout" Y="Qualifying" />
          <RL><R ID="22" N="88" V="Ford Mustang GT"><V ID="1" N="Broc Feeney" /></R></RL>
        </New>
        """;

    static void Send(TimingState s, double t, string d) =>
        s.Apply($"""<L T="{t:0.0000}" Y="p"><P L="1" C="22" D="1"><D {d} /></P></L>""");

    static TimingState RunLap()
    {
        var s = new TimingState();
        s.Apply(Snapshot);
        Send(s, 1000, "P=\"Y\" LP=\"M\"");                       // in the pit lane
        Send(s, 1010, "P=\"N\" LP=\"1\"");                       // out-lap begins
        Send(s, 1040, "LP=\"2\"");
        Send(s, 1060, "LP=\"3\"");
        Send(s, 1080, "LP=\"M\" T=\"1079.9000\"");               // starts the flying lap
        Send(s, 1093, "LP=\"1\"");
        Send(s, 1130, "LP=\"2\" I1=\"50.1234\"");
        Send(s, 1160, "LP=\"3\"");
        Send(s, 1205, "LP=\"M\" T=\"1204.0000\" I=\"124.1000\" FI=\"124.1000\" L=\"2\"");   // lap complete
        return s;
    }

    [Fact]
    public void Out_lap_has_no_lap_start()
    {
        var s = new TimingState();
        s.Apply(Snapshot);
        Send(s, 1000, "P=\"Y\" LP=\"M\"");
        Send(s, 1010, "P=\"N\" LP=\"1\"");
        var car = s.Cars["22"];
        Assert.Equal(0, car.LapsSincePit);
        Assert.Equal(0, car.LapStartAt);
        Assert.Empty(car.CurrentLapSplits);
    }

    [Fact]
    public void Flying_lap_splits_use_exact_intermediates_and_lap_time()
    {
        var car = RunLap().Cars["22"];
        Assert.Equal(2, car.LapsSincePit);                       // now on the in-lap
        Assert.Equal(1204.0, car.LapStartAt, 3);                 // exact crossing time
        Assert.Equal(13.1, car.LastLapSplits["1"], 3);           // 1093 - 1079.9 (message time)
        Assert.Equal(50.1234, car.LastLapSplits["2"], 4);        // Natsoft's exact I1
        Assert.Equal(124.1, car.LastLapSplits["M"], 4);          // official lap time
        Assert.Equal(car.LastLapSplits, car.BestLapSplits);      // it was the best lap
    }

    [Fact]
    public void Snapshot_orders_splits_with_lap_time_last()
    {
        var row = TimingSnapshot.From(RunLap()).Cars.Single();
        Assert.Equal(4, row.BestLapSplits.Count);                // 3 points + lap
        Assert.Equal(124.1, row.BestLapSplits[3], 4);
        Assert.Equal(50.1234, row.BestLapSplits[1], 4);
        Assert.All(row.CurrentSplits, v => Assert.Equal(0, v));  // in-lap: nothing yet
    }

    [Fact]
    public void Best_splits_fall_back_to_best_intermediates()
    {
        var s = new TimingState();
        s.Apply(Snapshot);
        Send(s, 1000, "FI=\"125.0000\" F1=\"51.0000\"");         // best lap set before we connected
        var row = TimingSnapshot.From(s).Cars.Single();
        Assert.Equal([0, 51.0, 0, 125.0], row.BestLapSplits);
    }

    [Fact]
    public void Entering_pits_resets_the_run()
    {
        var s = RunLap();
        Send(s, 1300, "P=\"Y\" LP=\"M\"");
        var car = s.Cars["22"];
        Assert.Equal(0, car.LapsSincePit);
        Assert.Equal(0, car.LapStartAt);
    }
}

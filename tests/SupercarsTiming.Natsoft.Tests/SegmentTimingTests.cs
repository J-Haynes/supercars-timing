using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Natsoft.Tests;

/// <summary>Per-car pace between timing points, used by the track map.</summary>
public class SegmentTimingTests
{
    const string Snapshot = """
        <New T="1000.0000">
          <T C="MOUN" N="MOUNT PANORAMA - BATHURST"><TP ID="1" Y="Pos1" /><TP ID="2" Y="Pos2" /></T>
          <E C="P12" D="Practice" Y="Practice" />
          <RL><R ID="9" N="10" V="Chev Camaro ZL1"><V ID="1" N="Zach Bates" /></R>
              <R ID="22" N="88" V="Ford Mustang GT"><V ID="1" N="Broc Feeney" /></R></RL>
        </New>
        """;

    static void Cross(TimingState s, double t, string car, string point, string? pit = null)
    {
        var pitAttr = pit is null ? "" : $" P=\"{pit}\"";
        s.Apply($"""<L T="{t:0.0000}" Y="p"><P L="1" C="{car}" D="1"><D LP="{point}"{pitAttr} /></P></L>""");
    }

    static TimingState Fresh()
    {
        var s = new TimingState();
        s.Apply(Snapshot);
        return s;
    }

    [Fact]
    public void Consecutive_points_record_segment_time()
    {
        var s = Fresh();
        Cross(s, 1000, "22", "M");
        Cross(s, 1012.5, "22", "1");
        Cross(s, 1027, "22", "2");
        Cross(s, 1050, "22", "M");   // wraps back to the control line

        var seg = s.Cars["22"].SegmentSeconds;
        Assert.Equal(12.5, seg["M"], 3);
        Assert.Equal(14.5, seg["1"], 3);
        Assert.Equal(23.0, seg["2"], 3);
    }

    [Fact]
    public void Skipped_point_is_not_recorded()
    {
        var s = Fresh();
        Cross(s, 1000, "22", "M");
        Cross(s, 1030, "22", "2");    // missed point 1
        Assert.Empty(s.Cars["22"].SegmentSeconds);
    }

    [Fact]
    public void Pit_lane_time_is_not_recorded()
    {
        var s = Fresh();
        Cross(s, 1000, "22", "2");
        Cross(s, 1060, "22", "M", pit: "Y");
        Assert.Empty(s.Cars["22"].SegmentSeconds);
    }

    [Fact]
    public void Snapshot_uses_own_pace_when_close_to_field_otherwise_field()
    {
        var s = Fresh();
        Cross(s, 1000, "22", "M"); Cross(s, 1012, "22", "1");   // 12 s
        Cross(s, 1000, "9", "M"); Cross(s, 1013, "9", "1");     // 13 s

        Assert.Equal(["M", "1", "2"], s.PointOrder);
        var snap = TimingSnapshot.From(s);
        Assert.Equal(13, snap.SegmentReference[0], 3);         // median of [12, 13] (upper middle)
        var feeney = snap.Cars.Single(c => c.CarNumber == "88");
        Assert.Equal(12, feeney.SegmentSeconds[0], 3);         // own time: close to the field
        Assert.Equal(0, feeney.SegmentSeconds[1]);             // no data anywhere yet

        Cross(s, 1100, "22", "M"); Cross(s, 1140, "22", "1");   // a 40 s crawl, way off the field
        feeney = TimingSnapshot.From(s).Cars.Single(c => c.CarNumber == "88");
        Assert.Equal(13, feeney.SegmentSeconds[0], 3);         // falls back to the field reference
    }

    [Fact]
    public void Mini_sectors_track_current_last_and_best()
    {
        var s = Fresh();
        Cross(s, 1000, "22", "M");
        Cross(s, 1012, "22", "1"); Cross(s, 1026, "22", "2"); Cross(s, 1050, "22", "M");   // lap 1: 12, 14, 24
        Cross(s, 1061, "22", "1");                                                           // lap 2: 11 so far
        Cross(s, 1000, "9", "M"); Cross(s, 1010.5, "9", "1");                                // car 10: 10.5

        var car = s.Cars["22"];
        Assert.Equal(11, car.CurrentLapSegments["M"], 3);
        Assert.Equal([12.0, 14.0, 24.0], new[] { car.LastLapSegments["M"], car.LastLapSegments["1"], car.LastLapSegments["2"] });
        Assert.Equal(11, car.BestSegments["M"], 3);

        var snap = TimingSnapshot.From(s);
        var row = snap.Cars.Single(c => c.CarNumber == "88");
        Assert.Equal([11.0, 0, 0], row.CurrentSegments);
        Assert.Equal([12.0, 14.0, 24.0], row.LastLapSegments);
        Assert.Equal([10.5, 14.0, 24.0], snap.SegmentBest);                                  // purple: fastest of anyone
    }

    [Fact]
    public void Implausibly_quick_stretches_are_ignored()
    {
        var s = Fresh();
        s.Apply("""<RL><R ID="5" N="5" V="Ford Mustang GT"><V ID="1" N="A" /></R><R ID="6" N="6" V="Ford Mustang GT"><V ID="1" N="B" /></R></RL>""");
        foreach (var car in new[] { "9", "5", "6" }) { Cross(s, 1000, car, "M"); Cross(s, 1012, car, "1"); }   // field: 12 s
        Cross(s, 1000, "22", "M"); Cross(s, 1001.7, "22", "1");                                             // 1.7 s: pit line
        Assert.False(s.Cars["22"].BestSegments.ContainsKey("M"));
        Assert.Equal(12, TimingSnapshot.From(s).SegmentBest[0], 3);
    }

    [Fact]
    public void Slow_out_laps_dont_make_real_times_look_implausible()
    {
        // Bathurst, start of practice: the whole field queues out of pit lane at well under half pace.
        var s = Fresh();
        s.Apply("""<RL><R ID="5" N="5" V="Ford Mustang GT"><V ID="1" N="A" /></R><R ID="6" N="6" V="Ford Mustang GT"><V ID="1" N="B" /></R></RL>""");
        foreach (var car in new[] { "9", "5", "6", "22" }) { Cross(s, 1000, car, "1"); Cross(s, 1025, car, "2"); }   // out-lap: 25 s
        Assert.Empty(s.Cars["22"].SegmentSeconds);                              // not the car's pace
        Assert.Equal(25, s.Cars["22"].CurrentLapSegments["1"], 3);             // but still a mini-sector
        // Nor a best: in a Shootout the out-lap was each car's green (purple for the first car out) mini-sectors.
        Assert.Empty(s.Cars["22"].BestSegments);
        Assert.Equal(0, TimingSnapshot.From(s).SegmentBest[0]);

        Cross(s, 1040, "22", "M"); Cross(s, 1053, "22", "1"); Cross(s, 1067.5, "22", "2");   // flying lap: 14.5 s
        var car22 = s.Cars["22"];
        Assert.Equal(14.5, car22.SegmentSeconds["1"], 3);
        Assert.Equal(14.5, car22.CurrentLapSegments["1"], 3);
        Assert.Equal(14.5, car22.BestSegments["1"], 3);
    }

    [Fact]
    public void Snapshot_position_does_not_start_a_timed_stretch()
    {
        // Connecting mid-session: the snapshot says car 88 last passed point 1, not when.
        var s = new TimingState();
        s.Apply(Snapshot.Replace("</New>", """<L><P L="1" C="22" D="1"><D LP="1" /></P></L></New>"""));
        Assert.Equal("1", s.Cars["22"].LastPoint);
        Cross(s, 1000.75, "22", "2");                                           // 0.75 s after the snapshot
        Assert.Empty(s.Cars["22"].CurrentLapSegments);
        Cross(s, 1024, "22", "M");                                              // the next stretch is real
        Assert.Equal(23.25, s.Cars["22"].LastLapSegments["2"], 3);            // completed the lap
    }

    [Fact]
    public void Crossing_made_in_the_pits_does_not_start_a_timed_stretch()
    {
        var s = Fresh();
        Cross(s, 1000, "22", "M", pit: "Y");     // pit-lane crossing of the line, then a stop
        Cross(s, 1074, "22", "1", pit: "N");     // out of the pits: 74 s isn't a stretch time
        Assert.Empty(s.Cars["22"].CurrentLapSegments);
    }
}

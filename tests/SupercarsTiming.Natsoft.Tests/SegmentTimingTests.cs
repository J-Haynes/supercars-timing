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
}

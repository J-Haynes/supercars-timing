using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Natsoft.Tests;

/// <summary>Race control messages, road position, race start and lap record. Frames from the Bathurst 1000, 2026.</summary>
public class RaceControlTests
{
    const string Snapshot = """
        <New T="1000.0000">
          <M D="2026 Repco Bathurst 1000" Y="Cars" />
          <T C="MOUN" N="MOUNT PANORAMA - BATHURST"><TP ID="1" Y="Pos1" /></T>
          <E C="R17" D="2026 Repco Supercars Championship - Race 30" Y="Race" L="161" RY="Race" RI="126.7265" RD="739901" RC="William Brown" RS="" RV="Chev Camaro ZL1" />
          <RL><R ID="15" N="19" V="Ford Mustang GT"><V ID="1" N="Matthew Payne" /><V ID="2" N="Will Davison" /></R>
              <R ID="24" N="48" V="Chev Camaro ZL1"><V ID="1" N="David Reynolds" /><V ID="2" N="James Courtney" /></R></RL>
          <L><P L="7" LP="7" C="15" D="2"><D L="10" /></P><P L="8" LP="8" C="24" D="2"><D L="10" /></P></L>
        </New>
        """;

    static TimingState Fresh()
    {
        var s = new TimingState();
        s.Apply(Snapshot);
        return s;
    }

    [Fact]
    public void Race_control_messages_and_penalties()
    {
        var s = Fresh();
        s.Apply("""<G T="1100.0000" R="Race Control: Turn 19.2 Incident Cars 19 &amp; 48 noted" C="" />""");
        s.Apply("""<G T="1130.0000" R="" C="" />""");   // Natsoft sends empty ones too
        s.Apply("""<G T="1285.0000" R="Stewards: Penalty Car 19 - 5 seconds - driving infringement" C="" />""");

        Assert.Equal(2, s.RaceControl.Count);
        var snap = TimingSnapshot.From(s);
        Assert.StartsWith("Stewards: Penalty Car 19", snap.RaceControl[0].Text);   // newest first
        Assert.Equal(1285, snap.RaceControl[0].Time, 3);
        Assert.Equal(["5 seconds"], snap.Cars.Single(c => c.CarNumber == "19").Penalties);
        Assert.Empty(snap.Cars.Single(c => c.CarNumber == "48").Penalties);
    }

    [Theory]
    [InlineData("Stewards: Penalty Car 19 - 5 seconds - driving infringement", "19", "5 seconds")]
    [InlineData("Stewards: penalty car 7 - Drive Through", "7", "Drive Through")]
    [InlineData("Stewards: Turn 4 Incident under investigation Cars 34 & 38 & 777", null, null)]
    public void Penalty_wording(string text, string? car, string? what)
    {
        var penalty = TimingSnapshot.Penalty(text);
        Assert.Equal(car, penalty?.Car);
        Assert.Equal(what, penalty?.What);
    }

    [Fact]
    public void Road_position_comes_from_LP_on_the_car_not_the_timing_point()
    {
        var s = Fresh();
        // Davison passes Reynolds mid-lap: Natsoft's official L doesn't change until the line, LP does.
        s.Apply("""<L T="1200.0000" Y="p" L="26"><P L="8" LL="7" P="8" LP="7" C="24" D="2"><D LP="3" /></P></L>""");
        s.Apply("""<L T="1200.5000" Y="p" L="26"><P L="7" LL="8" P="7" LP="8" C="15" D="2"><D LP="3" /></P></L>""");
        var car48 = s.Cars["24"];
        Assert.Equal(8, car48.Position);
        Assert.Equal(7, car48.RoadPosition);
        Assert.Equal("3", car48.LastPoint);
    }

    [Fact]
    public void First_green_is_the_race_start_and_later_greens_dont_move_it()
    {
        var s = Fresh();
        s.Apply("""<S T="1790.0000" S="WaitStart" I="0.0000" R="0" E="R17" P="1" SN="0" />""");
        s.Apply("""<S T="1800.5000" S="Green" I="1800.3107" R="0" E="R17" P="1" SN="0" />""");
        s.Apply("""<S T="2500.0000" S="Yellow" I="2500.0000" R="0" E="R17" P="1" SN="0" />""");
        s.Apply("""<S T="2700.0000" S="Green" I="2700.0000" R="0" E="R17" P="1" SN="0" />""");
        Assert.Equal(1800.3107, s.GreenAt, 4);
        Assert.Equal(1800.3107, TimingSnapshot.From(s).Session.GreenAt, 4);
    }

    [Fact]
    public void Lap_record_comes_from_the_session_element()
    {
        var record = TimingSnapshot.From(Fresh()).Session.LapRecord;
        Assert.NotNull(record);
        Assert.Equal(126.7265, record.Seconds, 4);
        Assert.Equal("William Brown", record.Driver);
        Assert.Equal("Chev Camaro ZL1", record.Vehicle);
    }

    [Fact]
    public void Reconnect_keeps_race_control_and_start_but_a_new_session_clears_them()
    {
        var s = Fresh();
        s.Apply("""<S T="1800.0000" S="Green" I="1800.0000" />""");
        s.Apply("""<G T="1900.0000" R="Race Control: Safety Car deployed" C="" />""");
        s.Apply(Snapshot.Replace("1000.0000", "2000.0000"));   // same session
        Assert.Single(s.RaceControl);
        Assert.Equal(1800, s.GreenAt, 3);

        s.Apply(Snapshot.Replace("Race 30", "Race 31").Replace("R17", "R18"));
        Assert.Empty(s.RaceControl);
        Assert.Equal(0, s.GreenAt);
    }
}

using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Natsoft.Tests;

public class SessionReplayTests
{
    static readonly SessionReplay.Message[] Messages =
    [
        new(1000, """<New T="1000.0000"><T C="MOUN" N="MOUNT PANORAMA - BATHURST"><TP ID="1" Y="Pos1" /></T><E C="R1" D="Race" Y="Race" /><RL><R ID="22" N="88" V="Ford" /></RL><L><P L="1" C="22" D="1"><D L="10" /></P></L></New>"""),
        new(1100, """<L T="1100.0000" Y="p"><P L="1" C="22" D="1"><D L="11" /></P></L>"""),
        new(1200, """<L T="1200.0000" Y="p"><P L="1" C="22" D="1"><D L="12" /></P></L>"""),
    ];

    [Fact]
    public void Snapshot_at_a_time_and_seeking_back()
    {
        var replay = new SessionReplay(Messages);
        Assert.Equal(1000, replay.Start, 3);
        Assert.Equal(1200, replay.End, 3);
        Assert.Equal(11, replay.At(1150).Cars.Single().Laps);   // forward
        Assert.Equal(12, replay.At(1250).Cars.Single().Laps);   // forward again (incremental)
        Assert.Equal(10, replay.At(1050).Cars.Single().Laps);   // back: rebuilt from the start
    }
}

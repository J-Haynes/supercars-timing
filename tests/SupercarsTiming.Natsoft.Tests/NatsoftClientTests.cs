using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Natsoft.Tests;

public class NatsoftClientTests
{
    // Trimmed from the meeting page Natsoft served at the Gold Coast 500 (token made up).
    const string Page = """
        <link rel="stylesheet" type="text/css" href="/LiveFile/LiveMeeting.css" />
        <script type="text/javascript">var gsLiveToken="abc-DEF_123";</script>
        </head>
        """;

    [Fact]
    public void Reads_the_token_from_the_meeting_page()
    {
        Assert.Equal("abc-DEF_123", NatsoftClient.ParseToken(Page));
        Assert.Null(NatsoftClient.ParseToken("<html>no token here</html>"));
        Assert.Null(NatsoftClient.ParseToken("""var gsLiveToken="";"""));
    }

    [Fact]
    public void Adds_the_token_like_Natsofts_script()
    {
        var start = new Uri("wss://server.natsoft.com.au:8080/LiveMeeting/V8SUPER");
        Assert.Equal("wss://server.natsoft.com.au:8080/LiveMeeting/V8SUPER?Token=abc", NatsoftClient.WithToken(start, "abc").ToString());
        Assert.Equal(start, NatsoftClient.WithToken(start, null));

        var redirect = new Uri("wss://server.natsoft.com.au:8080/LiveMeeting/V8SUPER?Seq=4");
        Assert.Equal("wss://server.natsoft.com.au:8080/LiveMeeting/V8SUPER?Seq=4&Token=abc", NatsoftClient.WithToken(redirect, "abc").ToString());

        var hasOne = new Uri("wss://server.natsoft.com.au:8080/LiveMeeting/V8SUPER?Token=old");
        Assert.Equal(hasOne, NatsoftClient.WithToken(hasOne, "abc"));
    }

    [Fact]
    public void Knows_when_a_session_is_running_from_the_flag()
    {
        // Frames from Race 32 Q1 (Gold Coast, 25 Oct 2026) and Bathurst Practice 6's red flag.
        const string green = """<S T="1792927322.5584" S="Green" I="1792927200.0000" R="0" E="Q6" P="1" SN="0" />""";
        const string red = """<S T="1791638041.8379" S="Red" I="1791638041.7521" R="0" E="P13" P="1" SN="0" />""";
        const string tick = """<C T="1792927323.0227" Y="T" C="597" E="123" />""";
        Assert.True(NatsoftClient.SessionRunning(green, false));
        Assert.True(NatsoftClient.SessionRunning(tick, true)); // no flag: as before
        Assert.False(NatsoftClient.SessionRunning(tick, false));
        Assert.True(NatsoftClient.SessionRunning(red, false));
        Assert.False(NatsoftClient.SessionRunning(green.Replace("Green", "Checkered"), true));
        Assert.False(NatsoftClient.SessionRunning(green.Replace("Green", "WaitStart"), true));
        // A snapshot carries its flag inside <New>; a <New> without one, or <NotFound>, ends it.
        Assert.True(NatsoftClient.SessionRunning("""<New T="1792927660.6561" Seq="503"><M D="x" />""" + green + "</New>", false));
        Assert.False(NatsoftClient.SessionRunning("""<New T="1" Seq="1"><M D="x" /></New>""", true));
        Assert.False(NatsoftClient.SessionRunning("<NotFound/>", true));
        // SN="0" and other S-something attributes aren't the flag.
        Assert.False(NatsoftClient.SessionRunning("""<SP C="1" SN="Green" />""", false));
    }

    [Fact]
    public void Notices_when_the_connections_address_has_gone()
    {
        // 25 Oct 2026: the connection was on the USB ethernet's 192.168.1.112; when it dropped off only Wi-Fi's
        // 192.168.1.111 was left.
        var ethernet = System.Net.IPAddress.Parse("192.168.1.112");
        var wifi = System.Net.IPAddress.Parse("192.168.1.111");
        Assert.False(NatsoftClient.AddressGone(ethernet, [System.Net.IPAddress.Loopback, ethernet, wifi]));
        Assert.True(NatsoftClient.AddressGone(ethernet, [System.Net.IPAddress.Loopback, wifi]));
        // Ethernet plugged back in while connected over Wi-Fi: Wi-Fi's address is still there, so no reconnect.
        Assert.False(NatsoftClient.AddressGone(wifi, [wifi, ethernet]));
        Assert.False(NatsoftClient.AddressGone(System.Net.IPAddress.Loopback, []));
    }
}

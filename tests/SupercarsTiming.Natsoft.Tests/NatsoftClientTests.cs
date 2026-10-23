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
}

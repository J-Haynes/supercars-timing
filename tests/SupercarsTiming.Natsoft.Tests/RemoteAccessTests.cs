using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using SupercarsTiming.Server;

namespace SupercarsTiming.Natsoft.Tests;

/// <summary>Requests through the Cloudflare Tunnel are told apart by the local port they arrive on.</summary>
public class RemoteAccessTests
{
    static RemoteAccess WithPort(string? port) => new(new ConfigurationBuilder()
        .AddInMemoryCollection(port is null ? [] : [new("Remote:Port", port)])
        .Build());

    static HttpContext On(int localPort) => new DefaultHttpContext { Connection = { LocalPort = localPort } };

    [Fact]
    public void Only_the_tunnel_port_is_remote()
    {
        var remote = WithPort("5082");
        Assert.True(remote.IsRemote(On(5082)));
        Assert.False(remote.IsRemote(On(5080))); // localhost and `tailscale serve`
    }

    [Fact]
    public void Cloudflare_requests_are_remote_on_any_port()
    {
        // A tunnel pointed at the local port by mistake still can't use replays.
        var context = On(5080);
        context.Request.Headers["CF-Connecting-IP"] = "203.0.113.7";
        Assert.True(WithPort("5082").IsRemote(context));
        Assert.True(WithPort(null).IsRemote(context));
    }

    [Fact]
    public void Without_a_tunnel_port_everything_is_local()
    {
        var remote = WithPort(null);
        Assert.Null(remote.Port);
        Assert.False(remote.IsRemote(On(5082)));
    }
}

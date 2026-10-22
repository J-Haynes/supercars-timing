namespace SupercarsTiming.Server;

/// <summary>
/// Remote access through the Cloudflare Tunnel (deploy/README.md). cloudflared connects from this machine, like
/// `tailscale serve` does, so the remote address can't tell them apart. Instead the tunnel has its own local port
/// (<c>Remote:Port</c>, 5082; localhost and the tailnet use 5080), and requests on that port can't use replays.
/// Owner's decision (Oct 2026): live timing, results and upcoming events are open remotely, replays aren't. A replay
/// keeps server cursors per viewer and rebuilds state on this laptop's CPU (0.2-0.5 s per seek on Bathurst Race 30),
/// and a playing viewer pulls ~3 Mbit/s of snapshots over the home connection.
/// </summary>
public sealed class RemoteAccess(IConfiguration config)
{
    public const string Section = "Remote";

    /// <summary>The tunnel's local port; null when remote access isn't configured (every request is local).</summary>
    public int? Port { get; } = config.GetValue<int?>($"{Section}:Port");

    /// <summary>
    /// Through the tunnel: on its port, or carrying the header Cloudflare adds to every request it forwards. The header
    /// catches a tunnel pointed at the local port by mistake (19 Oct 2026: the dashboard had localhost:5080, and
    /// replays worked remotely). Visitors can't remove it; sending it locally only turns replays off for that request.
    /// </summary>
    public bool IsRemote(HttpContext context) =>
        (Port is int port && context.Connection.LocalPort == port) || context.Request.Headers.ContainsKey(CloudflareHeader);

    const string CloudflareHeader = "CF-Connecting-IP";
}

public static class RemoteAccessExtensions
{
    /// <summary>Refuses the endpoint (403) for requests that came through the tunnel (<see cref="RemoteAccess"/>).</summary>
    public static RouteHandlerBuilder LocalOnly(this RouteHandlerBuilder endpoint) =>
        endpoint.AddEndpointFilter(async (context, next) =>
            context.HttpContext.RequestServices.GetRequiredService<RemoteAccess>().IsRemote(context.HttpContext)
                ? Results.Text("Replays are only available on the local network.", statusCode: StatusCodes.Status403Forbidden)
                : await next(context));
}

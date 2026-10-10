using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using SupercarsTiming.Server.Hubs;

namespace SupercarsTiming.Server.Replay;

/// <summary>One <see cref="ReplayPlayer"/> per SignalR connection that's watching a replay.</summary>
public sealed class ReplayManager(SessionCatalog catalog, IHubContext<TimingHub> hub, ILogger<ReplayManager> log)
{
    readonly ConcurrentDictionary<string, ReplayPlayer> _players = new();

    public async Task<bool> StartAsync(string connectionId, string sessionId)
    {
        await StopAsync(connectionId);
        if (catalog.Find(sessionId) is not { } session) return false;
        log.LogInformation("Replay {Session} for {Connection}", session.Name, connectionId);
        var player = new ReplayPlayer(session, update => hub.Clients.Client(connectionId).SendAsync(TimingHub.SnapshotMethod, update));
        _players[connectionId] = player;
        return true;
    }

    public ReplayPlayer? Get(string connectionId) => _players.GetValueOrDefault(connectionId);

    public async Task StopAsync(string connectionId)
    {
        if (_players.TryRemove(connectionId, out var player)) await player.DisposeAsync();
    }
}

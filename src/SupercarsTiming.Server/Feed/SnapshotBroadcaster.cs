using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using SupercarsTiming.Server.Hubs;

namespace SupercarsTiming.Server.Feed;

/// <summary>Pushes the live timing snapshot to viewers in the live group when it changes, at most every BroadcastIntervalMs.</summary>
public sealed class SnapshotBroadcaster(TimingStore store, IHubContext<TimingHub> hub, IOptions<FeedOptions> options) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(Math.Max(50, options.Value.BroadcastIntervalMs)));
        try
        {
            while (await timer.WaitForNextTickAsync(ct))
            {
                if (store.SnapshotIfChanged() is { } snapshot)
                    await hub.Clients.Group(TimingHub.LiveGroup).SendAsync(TimingHub.SnapshotMethod, new TimingUpdate(store.Status, snapshot), ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
    }
}

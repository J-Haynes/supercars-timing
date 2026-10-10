using Microsoft.AspNetCore.SignalR;
using SupercarsTiming.Natsoft;
using SupercarsTiming.Server.Feed;

namespace SupercarsTiming.Server.Hubs;

/// <summary>
/// SignalR hub at /hubs/timing. Server -> client only: sends "snapshot" with a <see cref="TimingUpdate"/>
/// on connect and whenever live timing changes.
/// </summary>
public sealed class TimingHub(TimingStore store) : Hub
{
    public const string Path = "/hubs/timing";
    public const string SnapshotMethod = "snapshot";

    public override Task OnConnectedAsync() =>
        Clients.Caller.SendAsync(SnapshotMethod, new TimingUpdate(store.Status, store.Snapshot()));
}

public sealed record TimingUpdate(FeedStatus Feed, TimingSnapshot Timing);

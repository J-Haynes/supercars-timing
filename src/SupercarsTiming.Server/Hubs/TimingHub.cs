using Microsoft.AspNetCore.SignalR;
using SupercarsTiming.Natsoft;
using SupercarsTiming.Server.Feed;
using SupercarsTiming.Server.Replay;

namespace SupercarsTiming.Server.Hubs;

/// <summary>
/// SignalR hub at /hubs/timing. The server sends "snapshot" with a <see cref="TimingUpdate"/> whenever timing
/// changes. Viewers start in the live group; calling <see cref="StartReplay"/> switches that connection to its
/// own replay of a recorded session, and <see cref="WatchLive"/> switches back.
/// </summary>
public sealed class TimingHub(TimingStore store, ReplayManager replays) : Hub
{
    public const string Path = "/hubs/timing";
    public const string SnapshotMethod = "snapshot";
    public const string LiveGroup = "live";

    public override async Task OnConnectedAsync()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, LiveGroup);
        await Clients.Caller.SendAsync(SnapshotMethod, LiveUpdate());
    }

    public override Task OnDisconnectedAsync(Exception? exception) => replays.StopAsync(Context.ConnectionId);

    /// <summary>Replay a recorded session (an id from GET /api/sessions). Returns false if it doesn't exist.</summary>
    public async Task<bool> StartReplay(string sessionId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, LiveGroup);
        if (await replays.StartAsync(Context.ConnectionId, sessionId)) return true;
        await WatchLive();
        return false;
    }

    public void ReplayPlay(bool playing) => replays.Get(Context.ConnectionId)?.SetPlaying(playing);
    public void ReplaySeek(double seconds) => replays.Get(Context.ConnectionId)?.SeekTo(seconds);
    public void ReplaySpeed(double speed) => replays.Get(Context.ConnectionId)?.SetSpeed(speed);

    public async Task WatchLive()
    {
        await replays.StopAsync(Context.ConnectionId);
        await Groups.AddToGroupAsync(Context.ConnectionId, LiveGroup);
        await Clients.Caller.SendAsync(SnapshotMethod, LiveUpdate());
    }

    TimingUpdate LiveUpdate() => new(store.Status, store.Snapshot());
}

/// <param name="Replay">Set while this connection is watching a replay; null for live.</param>
public sealed record TimingUpdate(FeedStatus Feed, TimingSnapshot Timing, ReplayStatus? Replay = null);

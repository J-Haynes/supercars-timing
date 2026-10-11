using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using SupercarsTiming.Natsoft;
using SupercarsTiming.Server.Feed;
using SupercarsTiming.Server.Hubs;

namespace SupercarsTiming.Server.F1;

/// <summary>Bound from the "F1" config section, e.g. <c>--F1:Mode=Replay --F1:ReplayArchive=&lt;dir&gt;</c>.</summary>
public sealed class F1Options
{
    public const string Section = "F1";

    /// <summary>Off = no F1 connection at all.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Live = F1's live timing hub. Replay = a recording (ReplayFile) or a downloaded archive folder (ReplayArchive).</summary>
    public FeedMode Mode { get; set; } = FeedMode.Live;

    /// <summary>Live mode: save every message here (separate from the Natsoft recordings).</summary>
    public string RecordDirectory { get; set; } = "data/recordings/f1";

    public string ReplayFile { get; set; } = "";

    /// <summary>A session folder from livetiming.formula1.com/static (the *.jsonStream files).</summary>
    public string ReplayArchive { get; set; } = "";

    public double ReplaySpeed { get; set; } = 1;

    /// <summary>Replay: skip ahead this many minutes from the start of the recording (archives start ~1 h before a race).</summary>
    public double ReplaySkipMinutes { get; set; }
}

/// <summary>Thread-safe owner of the live <see cref="F1State"/> (the F1 twin of <see cref="TimingStore"/>).</summary>
public sealed class F1Store
{
    readonly Lock _lock = new();
    F1State _state = new();
    TimingSnapshot _snapshot = TimingSnapshot.Empty;
    bool _dirty;

    public FeedStatus Status { get; private set; } = new(FeedMode.Live, "starting", null);

    public void Apply(F1Message m)
    {
        lock (_lock) { _state.Apply(m); _dirty = true; }
    }

    public void Reset()
    {
        lock (_lock) { _state = new F1State(); _dirty = true; }
    }

    public void SetStatus(FeedStatus status)
    {
        lock (_lock) { Status = status; _dirty = true; }
    }

    public LapHistory Laps()
    {
        lock (_lock) return _state.Laps();
    }

    public TimingSnapshot Snapshot()
    {
        lock (_lock)
        {
            if (_dirty) { _snapshot = _state.Snapshot(); _dirty = false; }
            return _snapshot;
        }
    }

    public TimingSnapshot? SnapshotIfChanged()
    {
        lock (_lock)
        {
            if (!_dirty) return null;
            _snapshot = _state.Snapshot();
            _dirty = false;
            return _snapshot;
        }
    }
}

/// <summary>SignalR hub at /hubs/f1: same contract as /hubs/timing ("snapshot" with a <see cref="TimingUpdate"/>).</summary>
public sealed class F1Hub(F1Store store) : Hub
{
    public const string Path = "/hubs/f1";

    public override Task OnConnectedAsync() =>
        Clients.Caller.SendAsync(TimingHub.SnapshotMethod, new TimingUpdate(store.Status, store.Snapshot()));
}

/// <summary>Pulls F1 messages (live or replayed) into the <see cref="F1Store"/> and pushes snapshots to viewers.</summary>
public sealed class F1FeedService(
    F1Store store,
    IHubContext<F1Hub> hub,
    IOptions<F1Options> options,
    IOptions<FeedOptions> feedOptions,
    RepoPaths paths,
    ILoggerFactory loggerFactory,
    ILogger<F1FeedService> log) : BackgroundService
{
    readonly F1Options _opt = options.Value;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!_opt.Enabled)
        {
            store.SetStatus(new(FeedMode.Live, "error", "F1 feed disabled (F1:Enabled=false)"));
            return;
        }
        var broadcast = Broadcast(ct);
        try { await (_opt.Mode == FeedMode.Replay ? RunReplay(ct) : RunLive(ct)); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        await broadcast;
    }

    async Task Broadcast(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(Math.Max(50, feedOptions.Value.BroadcastIntervalMs)));
        try
        {
            while (await timer.WaitForNextTickAsync(ct))
                if (store.SnapshotIfChanged() is { } snapshot)
                    await hub.Clients.All.SendAsync(TimingHub.SnapshotMethod, new TimingUpdate(store.Status, snapshot), ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
    }

    async Task RunLive(CancellationToken ct)
    {
        var dir = string.IsNullOrWhiteSpace(_opt.RecordDirectory) ? null : paths.Resolve(_opt.RecordDirectory);
        WarmStart(dir);
        StreamWriter? writer = null;
        if (dir is not null)
        {
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, F1Recording.NewFileName(DateTimeOffset.UtcNow));
            writer = new StreamWriter(file, append: true) { AutoFlush = true };
            log.LogInformation("Recording F1 live timing to {Path}", file);
        }

        var client = new F1Client(loggerFactory.CreateLogger<F1Client>());
        client.StatusChanged += s => store.SetStatus(new(FeedMode.Live, s.StartsWith("error") ? "error" : s, "F1 live timing"));
        try
        {
            await client.RunAsync(async m =>
            {
                if (writer is not null) await writer.WriteLineAsync(F1Recording.ToLine(m));
                Apply(m);
            }, ct);
        }
        finally
        {
            if (writer is not null) await writer.DisposeAsync();
        }
    }

    /// <summary>
    /// After a restart, replay the recent F1 recordings first, so lap history, pit stops and
    /// mini-sector times survive (the hub's state on reconnect has none of that history).
    /// </summary>
    void WarmStart(string? dir)
    {
        if (dir is null || !Directory.Exists(dir)) return;
        try
        {
            // Every file written in the last 3 hours, oldest first: each restart starts a new file, so one race
            // can span several. A change of session inside them resets our tracking (F1State).
            var recent = new DirectoryInfo(dir).GetFiles("F1_*.jsonl")
                .Where(f => DateTime.UtcNow - f.LastWriteTimeUtc < TimeSpan.FromHours(3))
                .OrderBy(f => f.Name).ToList();
            foreach (var file in recent)
            {
                log.LogInformation("Restoring F1 state from {File}", file.Name);
                foreach (var m in F1Recording.Read(file.FullName)) Apply(m);
            }
        }
        catch (Exception ex) { log.LogWarning(ex, "Couldn't restore F1 state from recordings"); }
    }

    async Task RunReplay(CancellationToken ct)
    {
        List<F1Message> messages;
        string name;
        if (!string.IsNullOrWhiteSpace(_opt.ReplayArchive))
        {
            name = _opt.ReplayArchive;
            messages = F1Recording.ReadArchive(paths.Resolve(_opt.ReplayArchive));
        }
        else
        {
            name = _opt.ReplayFile;
            messages = F1Recording.Read(paths.Resolve(_opt.ReplayFile)).ToList();
        }
        if (messages.Count == 0)
        {
            store.SetStatus(new(FeedMode.Replay, "error", "Nothing to replay (set F1:ReplayArchive or F1:ReplayFile)"));
            return;
        }

        while (!ct.IsCancellationRequested)
        {
            store.Reset();
            store.SetStatus(new(FeedMode.Replay, "replaying", Path.GetFileName(name.TrimEnd('/')), _opt.ReplaySpeed));
            var skipTo = messages[0].Utc.AddMinutes(_opt.ReplaySkipMinutes);
            var started = DateTimeOffset.UtcNow;
            DateTimeOffset? first = null;
            foreach (var m in messages)
            {
                if (m.Utc >= skipTo)
                {
                    first ??= m.Utc;
                    var due = started + (m.Utc - first.Value) / Math.Max(0.01, _opt.ReplaySpeed);
                    var wait = due - DateTimeOffset.UtcNow;
                    if (wait > TimeSpan.Zero) await Task.Delay(wait, ct);
                }
                Apply(m);
            }
            store.SetStatus(new(FeedMode.Replay, "ended", name, 0));
            await Task.Delay(TimeSpan.FromSeconds(10), ct);
        }
    }

    void Apply(F1Message m)
    {
        try { store.Apply(m); }
        catch (Exception ex) { log.LogWarning(ex, "Failed to apply F1 {Topic} message", m.Topic); }
    }
}

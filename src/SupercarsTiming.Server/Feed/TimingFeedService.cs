using Microsoft.Extensions.Options;
using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Server.Feed;

/// <summary>Pulls messages from Natsoft (live) or a recording (replay) into the <see cref="TimingStore"/>.</summary>
public sealed class TimingFeedService(
    TimingStore store,
    IOptions<FeedOptions> options,
    RepoPaths paths,
    ILoggerFactory loggerFactory,
    ILogger<TimingFeedService> log) : BackgroundService
{
    readonly FeedOptions _opt = options.Value;

    protected override Task ExecuteAsync(CancellationToken ct) =>
        _opt.Mode == FeedMode.Replay ? RunReplay(ct) : RunLive(ct);

    /// <summary>
    /// Live: connected to Natsoft only while a scheduled session is near (SessionSchedule), disconnected otherwise.
    /// Feed:Schedule=Always keeps the old behaviour (always connected, retrying every 30 s between meetings).
    /// </summary>
    async Task RunLive(CancellationToken ct)
    {
        WarmStart();
        bool always = string.Equals(_opt.Schedule, "Always", StringComparison.OrdinalIgnoreCase);
        try
        {
            while (!ct.IsCancellationRequested)
            {
                if (always) { await Connect(ct); continue; }

                // Re-read each time round: the timetable gets updated as Supercars publishes times.
                var schedule = SessionSchedule.Load(paths.Resolve(_opt.ScheduleFile));
                var now = DateTimeOffset.UtcNow;
                if (schedule.Current(now) is { } window)
                {
                    log.LogInformation("Connecting to Natsoft for {Reason}, until {End:yyyy-MM-dd HH:mm zzz}", window.Reason, window.End);
                    using var windowCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    windowCts.CancelAfter(window.End - now);
                    await Connect(windowCts.Token);
                    if (!ct.IsCancellationRequested) log.LogInformation("Disconnected from Natsoft: {Reason} is over", window.Reason);
                    continue;
                }

                var next = schedule.Next(now);
                store.SetStatus(new(FeedMode.Live, "waiting", next is null
                    ? "Not connected to Natsoft: no Supercars sessions scheduled"
                    : $"Not connected to Natsoft until 30 min before the next session: {next.Reason}, connecting {next.Start:ddd d MMM HH:mm} track time"));
                // Sleep until the next window, but wake at least every 10 min to pick up timetable changes.
                var wait = next is null ? TimeSpan.FromMinutes(10) : TimeSpan.FromTicks(Math.Min((next.Start - now).Ticks, TimeSpan.FromMinutes(10).Ticks));
                await Task.Delay(wait < TimeSpan.FromSeconds(1) ? TimeSpan.FromSeconds(1) : wait, ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
    }

    /// <summary>One connection to Natsoft, until <paramref name="ct"/> is cancelled (the window ends, or shutdown).
    /// NatsoftClient handles reconnects inside it (30 s while the meeting isn't live, 10 s after errors).</summary>
    async Task Connect(CancellationToken ct)
    {
        var client = new NatsoftClient(_opt.Meeting, loggerFactory.CreateLogger<NatsoftClient>());
        client.Connected += uri => store.SetStatus(new(FeedMode.Live, "connecting", uri.ToString()));
        client.Error += ex => store.SetStatus(new(FeedMode.Live, "error", ex.Message));
        store.SetStatus(new(FeedMode.Live, "connecting", client.StartUri.ToString()));

        await using var recorder = string.IsNullOrWhiteSpace(_opt.RecordDirectory)
            ? null
            : RecordingWriter.Create(paths.Resolve(_opt.RecordDirectory), _opt.Meeting);
        if (recorder is not null) log.LogInformation("Recording live feed to {Path}", recorder.Path);

        try
        {
            await foreach (var m in client.ReadAllAsync(ct))
            {
                if (recorder is not null) await recorder.WriteAsync(m);
                if (m.IsNotFound) { store.SetStatus(new(FeedMode.Live, "waiting", $"{_opt.Meeting} is not live")); continue; }
                if (store.Status.State != "live") store.SetStatus(new(FeedMode.Live, "live", _opt.Meeting));
                Apply(m);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
    }

    async Task RunReplay(CancellationToken ct)
    {
        var file = paths.FindRecording(_opt.ReplayFile);
        if (file is null)
        {
            log.LogError("No recording found (Feed:ReplayFile = '{File}'). Record one with tools/NatsoftRecorder.", _opt.ReplayFile);
            store.SetStatus(new(FeedMode.Replay, "error", "No recording found in data/recordings"));
            return;
        }

        try
        {
            do
            {
                log.LogInformation("Replaying {File} at {Speed}x", file, _opt.ReplaySpeed);
                store.Reset();
                store.SetStatus(new(FeedMode.Replay, "replaying", Path.GetFileName(file), _opt.ReplaySpeed));
                await foreach (var m in RecordingReader.ReplayAsync(file, _opt.ReplaySpeed, ct: ct))
                    if (!m.IsNotFound) Apply(m);
                store.SetStatus(new(FeedMode.Replay, "ended", Path.GetFileName(file), 0));
                if (_opt.ReplayLoop) await Task.Delay(TimeSpan.FromSeconds(5), ct);
            } while (_opt.ReplayLoop && !ct.IsCancellationRequested);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
    }

    /// <summary>
    /// After a restart mid-session, replay the session from our own recordings first. Natsoft's snapshot doesn't
    /// include history (laps per driver, pit stops, mini-sector bests); TimingState keeps it when the live snapshot
    /// turns out to be the same session. Only sessions recorded in the last <see cref="SessionIndex.MergeGap"/>.
    /// </summary>
    void WarmStart()
    {
        if (string.IsNullOrWhiteSpace(_opt.RecordDirectory)) return;
        var dir = paths.Resolve(_opt.RecordDirectory);
        if (!Directory.Exists(dir)) return;
        try
        {
            var latest = SessionIndex.Scan(Directory.GetFiles(dir, "*.jsonl")).MaxBy(s => s.End);
            if (latest is null || DateTimeOffset.UtcNow - latest.End > SessionIndex.MergeGap) return;
            log.LogInformation("Restoring {Session} from recordings ({Messages} messages)", latest.Name, latest.Messages);
            foreach (var m in SessionIndex.Read(latest)) Apply(m);
        }
        catch (Exception ex) { log.LogWarning(ex, "Couldn't restore the current session from recordings"); }
    }

    void Apply(NatsoftMessage m)
    {
        try { store.Apply(m); }
        catch (Exception ex) { log.LogWarning(ex, "Failed to apply <{Root}> message", m.Root); }
    }
}

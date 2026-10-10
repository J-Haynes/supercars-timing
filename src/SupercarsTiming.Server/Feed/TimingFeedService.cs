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

    async Task RunLive(CancellationToken ct)
    {
        var client = new NatsoftClient(_opt.Meeting, loggerFactory.CreateLogger<NatsoftClient>());
        client.Connected += uri => store.SetStatus(new(FeedMode.Live, "connecting", uri.ToString()));
        client.Error += ex => store.SetStatus(new(FeedMode.Live, "error", ex.Message));
        store.SetStatus(new(FeedMode.Live, "connecting", client.StartUri.ToString()));
        WarmStart();

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

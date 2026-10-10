using SupercarsTiming.Natsoft;
using SupercarsTiming.Server.Feed;
using SupercarsTiming.Server.Hubs;

namespace SupercarsTiming.Server.Replay;

/// <summary>
/// Plays one recorded session for one viewer, with its own <see cref="TimingState"/>, so each viewer can
/// play, pause, seek and change speed independently of the live feed and of each other.
/// </summary>
public sealed class ReplayPlayer : IAsyncDisposable
{
    static readonly TimeSpan Tick = TimeSpan.FromMilliseconds(50);
    static readonly TimeSpan SendInterval = TimeSpan.FromMilliseconds(250);

    readonly RecordedSession _session;
    readonly List<NatsoftMessage> _messages;
    readonly double[] _offsets;              // seconds from session start
    readonly Func<TimingUpdate, Task> _send;
    readonly Lock _lock = new();
    readonly CancellationTokenSource _cts = new();
    readonly Task _loop;

    TimingState _state = new();
    int _next;                               // index of the next message to apply
    double _position;                        // seconds from session start
    bool _playing = true;
    double _speed = 1;
    bool _dirty = true;

    public string SessionId => _session.Id;
    public double Duration => _offsets.Length > 0 ? _offsets[^1] : 0;

    public ReplayPlayer(RecordedSession session, Func<TimingUpdate, Task> send)
    {
        _session = session;
        _send = send;
        _messages = SessionIndex.Read(session).ToList();
        var start = _messages.Count > 0 ? _messages[0].ReceivedAt : session.Start;
        _offsets = _messages.Select(m => (m.ReceivedAt - start).TotalSeconds).ToArray();
        ApplyUntil(0);
        _loop = Task.Run(RunAsync);
    }

    public void SetPlaying(bool playing)
    {
        lock (_lock)
        {
            if (playing && _position >= Duration) Seek(0);   // play again from the start after the end
            _playing = playing;
            _dirty = true;
        }
    }

    public void SetSpeed(double speed)
    {
        lock (_lock) { _speed = Math.Clamp(speed, 0.25, 120); _dirty = true; }
    }

    public void SeekTo(double seconds)
    {
        lock (_lock) { Seek(seconds); }
    }

    void Seek(double seconds)
    {
        seconds = Math.Clamp(seconds, 0, Duration);
        if (seconds < _position)
        {
            // Rebuild from the start: applying a session's messages takes milliseconds.
            _state = new TimingState();
            _next = 0;
        }
        ApplyUntil(seconds);
        _position = seconds;
        _dirty = true;
    }

    void ApplyUntil(double seconds)
    {
        while (_next < _messages.Count && _offsets[_next] <= seconds)
        {
            try { _state.Apply(_messages[_next]); }
            catch { /* skip malformed frames, as the live feed does */ }
            _next++;
            _dirty = true;
        }
    }

    async Task RunAsync()
    {
        var clock = System.Diagnostics.Stopwatch.StartNew();
        var lastTick = clock.Elapsed;
        var lastSend = TimeSpan.Zero;
        using var timer = new PeriodicTimer(Tick);
        try
        {
            while (await timer.WaitForNextTickAsync(_cts.Token))
            {
                TimingUpdate? update = null;
                lock (_lock)
                {
                    var now = clock.Elapsed;
                    if (_playing)
                    {
                        _position = Math.Min(Duration, _position + (now - lastTick).TotalSeconds * _speed);
                        ApplyUntil(_position);
                        if (_position >= Duration) { _playing = false; _dirty = true; }
                    }
                    lastTick = now;
                    if (_dirty && now - lastSend >= SendInterval)
                    {
                        update = BuildUpdate();
                        _dirty = false;
                        lastSend = now;
                    }
                }
                if (update is not null) await _send(update);
            }
        }
        catch (OperationCanceledException) { }
    }

    TimingUpdate BuildUpdate()
    {
        var feed = new FeedStatus(FeedMode.Replay, _playing ? "replaying" : "paused", _session.Name, _playing ? _speed : 0);
        var status = new ReplayStatus(_session.Id, _session.Meeting, _session.Name, Math.Round(_position, 2), Math.Round(Duration, 2), _playing, _speed);
        return new TimingUpdate(feed, TimingSnapshot.From(_state), status);
    }

    public async ValueTask DisposeAsync()
    {
        _cts.Cancel();
        try { await _loop; } catch { }
        _cts.Dispose();
    }
}

/// <summary>Replay position and controls state, sent with each update while replaying.</summary>
public sealed record ReplayStatus(string SessionId, string Meeting, string Name, double Position, double Duration, bool Playing, double Speed);

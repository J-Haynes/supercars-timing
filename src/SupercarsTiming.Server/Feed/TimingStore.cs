using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Server.Feed;

/// <summary>Thread-safe owner of the live <see cref="TimingState"/>.</summary>
public sealed class TimingStore
{
    readonly Lock _lock = new();
    TimingState _state = new();
    TimingSnapshot _snapshot = TimingSnapshot.Empty;
    bool _dirty;

    public FeedStatus Status { get; private set; } = new(FeedMode.Live, "starting", null);

    public void Apply(NatsoftMessage message)
    {
        lock (_lock)
        {
            _state.Apply(message);
            _dirty = true;
        }
    }

    public void Reset()
    {
        lock (_lock) { _state = new TimingState(); _dirty = true; }
    }

    public void SetStatus(FeedStatus status)
    {
        lock (_lock) { Status = status; _dirty = true; }
    }

    /// <summary>Per-car lap history for the charts. Built on request (a few times a minute), not with every update.</summary>
    public LapHistory Laps()
    {
        lock (_lock) return LapHistory.From(_state);
    }

    /// <summary>Current snapshot, rebuilt only when something changed.</summary>
    public TimingSnapshot Snapshot()
    {
        lock (_lock)
        {
            if (_dirty) { _snapshot = TimingSnapshot.From(_state); _dirty = false; }
            return _snapshot;
        }
    }

    /// <summary>Returns a fresh snapshot if anything changed since the last call, otherwise null.</summary>
    public TimingSnapshot? SnapshotIfChanged()
    {
        lock (_lock)
        {
            if (!_dirty) return null;
            _snapshot = TimingSnapshot.From(_state);
            _dirty = false;
            return _snapshot;
        }
    }
}

/// <param name="State">starting | connecting | waiting (meeting not live) | live | replaying | error | ended</param>
/// <param name="ClockRate">How fast session time passes relative to real time (replay speed, 1 when live).
/// The map uses it to animate cars between updates.</param>
public sealed record FeedStatus(FeedMode Mode, string State, string? Detail, double ClockRate = 1);

namespace SupercarsTiming.Server.Feed;

public enum FeedMode { Live, Replay }

/// <summary>Bound from the "Feed" config section. Override with e.g. <c>--Feed:Mode=Replay</c>.</summary>
public sealed class FeedOptions
{
    public const string Section = "Feed";

    /// <summary>Live = connect to Natsoft. Replay = play back a recording from data/recordings.</summary>
    public FeedMode Mode { get; set; } = FeedMode.Live;

    /// <summary>Natsoft meeting ID. Supercars weekends use V8SUPER (support categories included).</summary>
    public string Meeting { get; set; } = "V8SUPER";

    /// <summary>Live mode: if set, also save every message here (same format as tools/NatsoftRecorder).</summary>
    public string RecordDirectory { get; set; } = "";

    /// <summary>Replay mode: recording to play. Relative paths resolve from the repo root. Empty = newest in data/recordings.</summary>
    public string ReplayFile { get; set; } = "";

    /// <summary>Replay speed multiplier (1 = real time).</summary>
    public double ReplaySpeed { get; set; } = 1;

    /// <summary>Start the recording again when it ends.</summary>
    public bool ReplayLoop { get; set; } = true;

    /// <summary>How often changed state is pushed to clients.</summary>
    public int BroadcastIntervalMs { get; set; } = 250;
}

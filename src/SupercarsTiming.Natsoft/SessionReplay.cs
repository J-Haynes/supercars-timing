using System.Globalization;
using System.Text.RegularExpressions;

namespace SupercarsTiming.Natsoft;

/// <summary>
/// Plays a recorded session back to any point: <see cref="At"/> gives the timing snapshot as it stood at Natsoft
/// time t. Moving forward applies only the new messages; going back rebuilds from the start (about a second for a
/// six-hour race). One instance per viewer: it keeps its own <see cref="TimingState"/>.
/// </summary>
public sealed partial class SessionReplay(IReadOnlyList<SessionReplay.Message> messages)
{
    /// <summary>A message's Natsoft time (carried forward for messages without one) and its XML.</summary>
    public readonly record struct Message(double Time, string Xml);

    TimingState _state = new();
    int _next;
    double _time = double.NegativeInfinity;

    public double Start { get; } = messages.Count > 0 ? messages[0].Time : 0;
    public double End { get; } = messages.Count > 0 ? messages[^1].Time : 0;

    public TimingSnapshot At(double t)
    {
        if (t < _time) { _state = new TimingState(); _next = 0; }
        while (_next < messages.Count && messages[_next].Time <= t)
        {
            try { _state.Apply(messages[_next].Xml); } catch { /* skip malformed frames */ }
            _next++;
        }
        _time = t;
        return TimingSnapshot.From(_state);
    }

    /// <summary>A recorded session's messages with their Natsoft times (the root's T attribute), in order.</summary>
    public static IReadOnlyList<Message> Load(RecordedSession session)
    {
        var list = new List<Message>();
        double last = 0;
        foreach (var m in SessionIndex.Read(session))
        {
            var match = RootTime().Match(m.Xml);
            if (match.Success && double.TryParse(match.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var t) && t >= last) last = t;
            list.Add(new Message(last, m.Xml));
        }
        return list;
    }

    [GeneratedRegex("""^<\w+[^>]*?\sT="([\d.]+)""")]
    private static partial Regex RootTime();
}

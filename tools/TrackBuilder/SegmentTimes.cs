using System.Globalization;
using System.Xml.Linq;
using SupercarsTiming.Natsoft;

namespace TrackBuilder;

/// <summary>Representative time between consecutive timing points, measured from a recording.</summary>
public sealed record SegmentTimes(string TrackCode, IReadOnlyList<string> PointOrder, IReadOnlyDictionary<string, string> PointNames, IReadOnlyList<double> Seconds, IReadOnlyList<int> Samples, int TopSpeed)
{
    public double LapTime => Seconds.Sum();

    /// <param name="sessionFilter">Only use sessions whose name contains this (e.g. "Supercars" to skip support categories).</param>
    public static SegmentTimes FromRecording(string path, string trackCode, string sessionFilter)
    {
        var order = new List<string>();
        var names = new Dictionary<string, string> { ["M"] = "Control line" };
        var samples = new Dictionary<string, List<double>>();
        var last = new Dictionary<string, (string Point, double At)>();
        var speeds = new List<int>();
        bool use = false;

        foreach (var m in RecordingReader.Read(path))
        {
            if (m.IsNotFound || m.IsRedirect) continue;
            var root = XElement.Parse(m.Xml);
            if (root.Name.LocalName == "New")
            {
                var track = root.Element("T");
                var session = root.Element("E")?.Attribute("D")?.Value ?? "";
                use = track?.Attribute("C")?.Value == trackCode && session.Contains(sessionFilter, StringComparison.OrdinalIgnoreCase);
                if (use && order.Count == 0)
                {
                    order = ["M", .. track!.Elements("TP").Select(tp => tp.Attribute("ID")!.Value)];
                    foreach (var tp in track.Elements("TP")) names[tp.Attribute("ID")!.Value] = tp.Attribute("Y")?.Value ?? "";
                }
                last.Clear();
                continue;
            }
            if (!use || root.Name.LocalName != "L") continue;

            var now = double.Parse(root.Attribute("T")!.Value, CultureInfo.InvariantCulture);
            foreach (var p in root.Elements("P"))
            {
                if (p.Element("D") is not { } d || p.Attribute("C")?.Value is not { } car) continue;
                if (int.TryParse(d.Attribute("SP")?.Value, out var sp) && sp > 0) speeds.Add(sp);
                if (d.Attribute("P")?.Value == "Y") { last.Remove(car); continue; }   // pit lane: not representative
                if (d.Attribute("LP")?.Value is not { } lp) continue;

                if (last.TryGetValue(car, out var prev))
                {
                    int i = order.IndexOf(prev.Point);
                    if (i >= 0 && order[(i + 1) % order.Count] == lp)
                    {
                        if (!samples.TryGetValue(prev.Point, out var list)) samples[prev.Point] = list = [];
                        list.Add(now - prev.At);
                    }
                }
                last[car] = (lp, now);
            }
        }

        if (order.Count == 0) throw new InvalidOperationException($"No '{sessionFilter}' sessions at track {trackCode} in {path}");

        // Median of the fastest third: clean, representative laps without traffic, cool-downs or spins.
        var seconds = order.Select(o =>
        {
            var xs = samples.GetValueOrDefault(o)?.Order().ToList() ?? throw new InvalidOperationException($"No samples for segment starting at {o}");
            var fast = xs.Take(Math.Max(1, xs.Count / 3)).ToList();
            return fast[fast.Count / 2];
        }).ToList();
        var counts = order.Select(o => samples.GetValueOrDefault(o)?.Count ?? 0).ToList();
        return new SegmentTimes(trackCode, order, names, seconds, counts, speeds.Count > 0 ? speeds.Max() : 0);
    }
}

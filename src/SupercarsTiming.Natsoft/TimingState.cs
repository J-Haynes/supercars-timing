using System.Globalization;
using System.Xml.Linq;

namespace SupercarsTiming.Natsoft;

/// <summary>
/// Rebuilds live timing state from decoded Natsoft XML messages.
/// Field meanings were worked out from the 2026 Bathurst Practice 5 capture; see docs/PROTOCOL.md.
/// Not thread-safe: apply messages from one thread and lock around reads if needed.
/// </summary>
public sealed class TimingState
{
    public string Meeting { get; private set; } = "";
    public string Category { get; private set; } = "";
    public string SessionCode { get; private set; } = "";
    public string SessionName { get; private set; } = "";
    public string SessionType { get; private set; } = "";
    public string TrackCode { get; private set; } = "";
    public string TrackName { get; private set; } = "";

    /// <summary>Timing points in lap order. The control line "M" is implicit before the first.</summary>
    public List<TimingPoint> TimingPoints { get; } = [];

    /// <summary>Entry list keyed by Natsoft's internal car ID (R ID), not the car number.</summary>
    public Dictionary<string, Entry> Entries { get; } = [];

    /// <summary>Live car state keyed by Natsoft's internal car ID (R ID).</summary>
    public Dictionary<string, CarState> Cars { get; } = [];

    /// <summary>Green, Yellow, Red, Checkered, Ended, ... as sent by Natsoft.</summary>
    public string Flag { get; private set; } = "";
    public int? ClockRemaining { get; private set; }
    public int? ClockElapsed { get; private set; }
    public SessionBest Best { get; } = new();

    /// <summary>
    /// Natsoft timestamp of the last message in seconds. This is the track's local wall clock
    /// encoded as if it were Unix time (AEDT at Bathurst = real Unix time + 39600).
    /// </summary>
    public double Now { get; private set; }

    /// <summary>Number of messages applied since the last snapshot reset.</summary>
    public long MessageCount { get; private set; }

    public void Apply(NatsoftMessage message)
    {
        if (message.IsNotFound || message.IsRedirect) return;
        Apply(message.Xml);
    }

    public void Apply(string xml) => Apply(XElement.Parse(xml));

    public void Apply(XElement root)
    {
        MessageCount++;
        if (Dbl(root, "T") is double t && t > 0) Now = t;
        switch (root.Name.LocalName)
        {
            case "New" or "Change" or "WaitCat":
                Entries.Clear(); Cars.Clear(); TimingPoints.Clear();
                Best.Reset();
                foreach (var child in root.Elements()) ApplyChild(child);
                break;
            default:
                ApplyChild(root);
                break;
        }
    }

    void ApplyChild(XElement e)
    {
        switch (e.Name.LocalName)
        {
            case "M":
                Meeting = Str(e, "D") ?? Meeting;
                Category = Str(e, "Y") ?? Category;
                break;
            case "T":
                TrackCode = Str(e, "C") ?? "";
                TrackName = Str(e, "N") ?? "";
                TimingPoints.Clear();
                TimingPoints.AddRange(e.Elements("TP").Select(tp => new TimingPoint(Str(tp, "ID") ?? "", Str(tp, "Y") ?? "")));
                break;
            case "E":
                SessionCode = Str(e, "C") ?? SessionCode;
                SessionName = Str(e, "D") ?? SessionName;
                SessionType = Str(e, "Y") ?? SessionType;
                break;
            case "RL":
                foreach (var r in e.Elements("R"))
                {
                    var id = Str(r, "ID") ?? "";
                    var drivers = r.Elements("V").ToDictionary(v => Str(v, "ID") ?? "", v => (Str(v, "N") ?? "").Replace('_', ' '));
                    Entries[id] = new Entry(id, Str(r, "N") ?? "", Str(r, "V") ?? "", drivers);
                }
                break;
            case "S":
                Flag = Str(e, "S") ?? Flag;
                break;
            case "C":
                ClockRemaining = Int(e, "C");
                ClockElapsed = Int(e, "E");
                break;
            case "A":
                Best.Lap = Dbl(e, "I") ?? Best.Lap;
                Best.CarId = Str(e, "C") ?? Best.CarId;
                Best.S1 = Dbl(e, "S1") ?? Best.S1;
                Best.S2 = Dbl(e, "S2") ?? Best.S2;
                Best.S3 = Dbl(e, "S3") ?? Best.S3;
                break;
            case "L":
                foreach (var p in e.Elements("P")) ApplyCar(p);
                break;
            // H = heartbeat, F = flag/finish echo, G = unknown, OL = other categories: ignored for now.
        }
    }

    void ApplyCar(XElement p)
    {
        var id = Str(p, "C");
        if (id is null) return;
        if (!Cars.TryGetValue(id, out var c)) Cars[id] = c = new CarState { Id = id };

        c.Position = Int(p, "L") ?? c.Position;
        c.DriverIndex = Str(p, "D") ?? c.DriverIndex;

        if (p.Element("D") is not { } d) return;

        // Pit status first, so a pit-lane crossing in the same update isn't counted as racing pace.
        if (Str(d, "P") is { } inPit) c.InPit = inPit == "Y";
        if (Str(d, "LP") is { } lp && lp != c.LastPoint) OnTimingPoint(c, lp);
        c.Laps = Int(d, "L") ?? c.Laps;
        c.LastLap = Dbl(d, "I") ?? c.LastLap;
        c.BestLap = Dbl(d, "FI") ?? c.BestLap;
        c.BestLapNo = Int(d, "FL") ?? c.BestLapNo;
        c.Gap = Dbl(d, "GI") ?? c.Gap;
        c.Interval = Dbl(d, "GNI") ?? c.Interval;
        c.GapLaps = Int(d, "GL") ?? c.GapLaps;
        c.IntervalLaps = Int(d, "GNL") ?? c.IntervalLaps;
        c.LiveGap = Dbl(d, "LGI") ?? c.LiveGap;
        c.LiveInterval = Dbl(d, "LGNI") ?? c.LiveInterval;
        c.LiveGapLaps = Int(d, "LGL") ?? c.LiveGapLaps;
        c.LiveIntervalLaps = Int(d, "LGNL") ?? c.LiveIntervalLaps;
        c.S1 = Dbl(d, "S1") ?? c.S1;
        c.S2 = Dbl(d, "S2") ?? c.S2;
        c.S3 = Dbl(d, "S3") ?? c.S3;
        c.BestS1 = Dbl(d, "FS1") ?? c.BestS1;
        c.BestS2 = Dbl(d, "FS2") ?? c.BestS2;
        c.BestS3 = Dbl(d, "FS3") ?? c.BestS3;
        if (Int(d, "SP") is int sp && sp > 0) c.Speed = sp;   // sent as 0 then the value
        c.PitStops = Int(d, "PS") ?? c.PitStops;
        if (Dbl(d, "T") is double crossed && crossed > 0) c.LastLineCrossing = crossed;
    }

    /// <summary>Points in lap order: "M" (control line) then each timing point ID.</summary>
    public IEnumerable<string> PointOrder => TimingPoints.Select(tp => tp.Id).Prepend("M");

    void OnTimingPoint(CarState c, string point)
    {
        // Record how long the car took since the previous point, if it's the next one in order
        // (a missed crossing or a pit visit would make the time meaningless).
        var order = PointOrder.ToList();
        int prev = order.IndexOf(c.LastPoint);
        if (!c.InPit && prev >= 0 && c.LastPointAt > 0 && order[(prev + 1) % order.Count] == point)
        {
            var seconds = Now - c.LastPointAt;
            if (seconds > 0) c.SegmentSeconds[c.LastPoint] = seconds;
        }
        c.LastPoint = point;
        c.LastPointAt = Now;
    }

    static string? Str(XElement e, string a) => e.Attribute(a)?.Value;

    static int? Int(XElement e, string a) =>
        int.TryParse(Str(e, a), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : null;

    static double? Dbl(XElement e, string a) =>
        double.TryParse(Str(e, a), NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null;
}

public sealed record TimingPoint(string Id, string Name);

public sealed record Entry(string Id, string CarNumber, string Vehicle, IReadOnlyDictionary<string, string> Drivers);

public sealed class SessionBest
{
    public double? Lap { get; set; }
    public double? S1 { get; set; }
    public double? S2 { get; set; }
    public double? S3 { get; set; }
    public string? CarId { get; set; }

    public void Reset() { Lap = S1 = S2 = S3 = null; CarId = null; }
}

public sealed class CarState
{
    public string Id { get; init; } = "";
    public int Position { get; set; }
    /// <summary>Key into <see cref="Entry.Drivers"/> for the driver currently in the car.</summary>
    public string DriverIndex { get; set; } = "1";
    public int Laps { get; set; }
    public double LastLap { get; set; }
    public double BestLap { get; set; }
    public int BestLapNo { get; set; }
    /// <summary>Gap to the leader in seconds. See <see cref="GapLaps"/> when lapped.</summary>
    public double Gap { get; set; }
    public int GapLaps { get; set; }
    /// <summary>Interval to the car ahead in seconds.</summary>
    public double Interval { get; set; }
    public int IntervalLaps { get; set; }
    /// <summary>
    /// Gap to the leader updated at every timing point (LGI). In races this updates far more often than
    /// <see cref="Gap"/>, which appears to update at the control line. Unconfirmed; see docs/PROTOCOL.md.
    /// </summary>
    public double LiveGap { get; set; }
    public int LiveGapLaps { get; set; }
    /// <summary>Interval to the car ahead updated at every timing point (LGNI).</summary>
    public double LiveInterval { get; set; }
    public int LiveIntervalLaps { get; set; }
    public double S1 { get; set; }
    public double S2 { get; set; }
    public double S3 { get; set; }
    public double BestS1 { get; set; }
    public double BestS2 { get; set; }
    public double BestS3 { get; set; }
    /// <summary>Speed trap, km/h.</summary>
    public int Speed { get; set; }
    public int PitStops { get; set; }
    public bool InPit { get; set; }
    /// <summary>Last timing point passed: "M" = control line, otherwise a <see cref="TimingPoint.Id"/>.</summary>
    public string LastPoint { get; set; } = "";
    /// <summary>Natsoft time (see <see cref="TimingState.Now"/>) when <see cref="LastPoint"/> changed.</summary>
    public double LastPointAt { get; set; }
    /// <summary>
    /// The car's most recent time (s) from each timing point to the next, keyed by the starting point.
    /// Used to animate the car between points on the track map.
    /// </summary>
    public Dictionary<string, double> SegmentSeconds { get; } = [];
    public double LastLineCrossing { get; set; }
}

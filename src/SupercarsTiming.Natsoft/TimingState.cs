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

    /// <summary>Timing point IDs where Natsoft's exact intermediate times (I1/I2) are measured, e.g. "3" and "5" at Bathurst.</summary>
    public string? Intermediate1 { get; private set; }
    public string? Intermediate2 { get; private set; }

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
                Intermediate1 = Str(e, "PI1");
                Intermediate2 = Str(e, "PI2");
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
        if (Str(p, "D") is { } driver && driver != c.DriverIndex)
        {
            // A change after the first value we see is a driver swap (co-driver events, practice changeovers).
            if (c.DriverSeen) c.DriverChangedAt = Now;
            c.DriverIndex = driver;
        }
        c.DriverSeen = true;

        if (p.Element("D") is not { } d) return;

        // Pit status first, so a pit-lane crossing in the same update isn't counted as racing pace.
        if (Str(d, "P") is { } inPit)
        {
            var entering = inPit == "Y" && !c.InPit;
            c.InPit = inPit == "Y";
            if (entering) { c.LapsSincePit = 0; c.LapStartAt = 0; c.CurrentLapSplits.Clear(); }
        }
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
        c.BestI1 = Dbl(d, "F1") ?? c.BestI1;
        c.BestI2 = Dbl(d, "F2") ?? c.BestI2;

        // Timing point last: the lap time (I), best lap (FI) and intermediates (I1/I2) in this same
        // update are needed to record the lap's splits.
        if (Str(d, "LP") is { } lp && lp != c.LastPoint) OnTimingPoint(c, lp, d);
    }

    /// <summary>Points in lap order: "M" (control line) then each timing point ID.</summary>
    public IEnumerable<string> PointOrder => TimingPoints.Select(tp => tp.Id).Prepend("M");

    void OnTimingPoint(CarState c, string point, XElement d)
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
        if (c.InPit) return;

        if (point == "M")
        {
            // Completing a timed lap: store its splits, with the official lap time as the last one.
            if (c.LapStartAt > 0 && Dbl(d, "I") is double lap && lap > 0)
            {
                c.CurrentLapSplits["M"] = lap;
                c.LastLapSplits = new(c.CurrentLapSplits);
                if (Math.Abs(lap - c.BestLap) < 0.0005) c.BestLapSplits = new(c.CurrentLapSplits);
            }
            // A new lap starts. Prefer Natsoft's exact crossing time (D/@T) over the message time.
            c.LapStartAt = Dbl(d, "T") is double t && t > 0 ? t : Now;
            c.LapsSincePit++;
            c.CurrentLapSplits.Clear();
            return;
        }

        if (c.LapStartAt <= 0) return; // out-lap: no lap start to measure from
        // Exact intermediate times where Natsoft gives them, otherwise time since the lap started.
        double split = point == Intermediate1 && Dbl(d, "I1") is double i1 && i1 > 0 ? i1
            : point == Intermediate2 && Dbl(d, "I2") is double i2 && i2 > 0 ? i2
            : Now - c.LapStartAt;
        c.CurrentLapSplits[point] = split;
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
    internal bool DriverSeen { get; set; }
    /// <summary>Natsoft time of the last driver swap in this session; 0 if none seen.</summary>
    public double DriverChangedAt { get; set; }
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
    /// LGI field. Updates more often than <see cref="Gap"/> in races but is frequently out of step with
    /// race order, so the UI uses <see cref="Gap"/>. Meaning unconfirmed; see docs/PROTOCOL.md.
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

    /// <summary>Natsoft time the current lap started at the control line; 0 when unknown (e.g. an out-lap).</summary>
    public double LapStartAt { get; set; }
    /// <summary>Laps started since leaving the pits: 0 = out-lap, 1 = first flying lap (the Shootout lap), 2+ = later.</summary>
    public int LapsSincePit { get; set; }
    /// <summary>Seconds from the line to each timing point on the current lap ("M" = lap time once complete).</summary>
    public Dictionary<string, double> CurrentLapSplits { get; } = [];
    public Dictionary<string, double> LastLapSplits { get; set; } = [];
    /// <summary>Splits of the car's best lap, if that lap was seen live.</summary>
    public Dictionary<string, double> BestLapSplits { get; set; } = [];
    /// <summary>Best intermediate times (F1/F2), which may come from different laps.</summary>
    public double BestI1 { get; set; }
    public double BestI2 { get; set; }
    public double LastLineCrossing { get; set; }
}

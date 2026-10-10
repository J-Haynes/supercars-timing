namespace SupercarsTiming.Natsoft;

/// <summary>
/// Flat, serialisable view of <see cref="TimingState"/> for the UI and tools.
/// Times are in seconds; 0 means "no time yet".
/// </summary>
public sealed record TimingSnapshot(
    SessionInfo Session,
    IReadOnlyList<TimingPoint> TimingPoints,
    BestTimes Best,
    IReadOnlyList<CarRow> Cars,
    IReadOnlyList<double> SegmentReference,
    /// <summary>Fastest time anyone has done through each stretch this session (mini-sector purple). 0 = none yet.</summary>
    IReadOnlyList<double> SegmentBest,
    double Now,
    long MessageCount)
{
    public static TimingSnapshot Empty { get; } =
        new(new SessionInfo("", "", "", "", "", "", null, null), [], new BestTimes(null, null, null, null, null), [], [], [], 0, 0);

    public static TimingSnapshot From(TimingState s)
    {
        var order = s.PointOrder.ToList();
        var reference = FieldSegmentTimes(s, order);

        var cars = s.Cars.Values
            .OrderBy(c => c.Position == 0 ? int.MaxValue : c.Position)
            .Select(c =>
            {
                var e = s.Entries.GetValueOrDefault(c.Id);
                return new CarRow(
                    c.Id, c.Position, e?.CarNumber ?? c.Id,
                    e?.Drivers.GetValueOrDefault(c.DriverIndex) ?? "",
                    e?.Vehicle ?? "", Manufacturer(e?.Vehicle),
                    c.Laps, c.LastLap, c.BestLap, c.BestLapNo,
                    c.Gap, c.GapLaps, c.Interval, c.IntervalLaps,
                    c.LiveGap, c.LiveGapLaps, c.LiveInterval, c.LiveIntervalLaps,
                    c.S1, c.S2, c.S3, c.BestS1, c.BestS2, c.BestS3,
                    c.Speed, c.PitStops, c.InPit, c.LastPoint, c.LastPointAt,
                    ExpectedSegments(c, order, reference),
                    c.LapStartAt, c.LapsSincePit,
                    Splits(c.CurrentLapSplits, s), Splits(c.LastLapSplits, s), BestSplits(c, s),
                    e?.Drivers.OrderBy(d => d.Key).Select(d => d.Value).ToArray() ?? [],
                    c.DriverIndex, c.DriverChangedAt,
                    Segments(c.CurrentLapSegments, order), Segments(c.LastLapSegments, order), Segments(c.BestSegments, order));
            })
            .ToList();

        // Natsoft only sends the session-best lap/sectors (A element) in some cases,
        // so fall back to the fastest values across the field.
        static double? Fastest(IEnumerable<double> times)
        {
            var set = times.Where(t => t > 0).ToList();
            return set.Count > 0 ? set.Min() : null;
        }
        var topSpeed = cars.Select(c => c.Speed).DefaultIfEmpty(0).Max();
        var best = new BestTimes(
            Fastest(cars.Select(c => c.BestLap)) ?? s.Best.Lap,
            Fastest(cars.Select(c => c.BestS1)) ?? s.Best.S1,
            Fastest(cars.Select(c => c.BestS2)) ?? s.Best.S2,
            Fastest(cars.Select(c => c.BestS3)) ?? s.Best.S3,
            topSpeed > 0 ? topSpeed : null);

        return new TimingSnapshot(
            new SessionInfo(s.Meeting, s.SessionName, s.SessionType, s.TrackName, s.TrackCode, s.Flag, s.ClockRemaining, s.ClockElapsed),
            s.TimingPoints.ToList(), best, cars, reference, SessionBestSegments(s, order), s.Now, s.MessageCount);
    }

    /// <summary>
    /// Field-wide typical time for each segment: the median of every car's latest time, ignoring
    /// anything over twice the fastest (cool-down laps, spins). 0 when there's no data yet.
    /// </summary>
    static double[] FieldSegmentTimes(TimingState s, List<string> order) => order.Select(point =>
    {
        var times = s.Cars.Values.Select(c => c.SegmentSeconds.GetValueOrDefault(point)).Where(t => t > 0).Order().ToList();
        if (times.Count == 0) return 0;
        var plausible = times.Where(t => t < times[0] * 2).ToList();
        return Math.Round(plausible[plausible.Count / 2], 3);
    }).ToArray();

    /// <summary>
    /// Expected time for this car through each segment: its own latest time when it's close to the
    /// field's (so a car on a slow lap animates slowly), otherwise the field reference.
    /// </summary>
    static double[] ExpectedSegments(CarState c, List<string> order, double[] reference) => order.Select((point, i) =>
    {
        var own = c.SegmentSeconds.GetValueOrDefault(point);
        var field = reference[i];
        if (own > 0 && (field == 0 || (own > field * 0.8 && own < field * 1.6))) return Math.Round(own, 3);
        return field;
    }).ToArray();

    /// <summary>Per-stretch times in point order (index i = from point i to the next). 0 = no time.</summary>
    static double[] Segments(Dictionary<string, double> segments, List<string> order) =>
        order.Select(p => Math.Round(segments.GetValueOrDefault(p), 3)).ToArray();

    static double[] SessionBestSegments(TimingState s, List<string> order) => order.Select(p =>
    {
        var times = s.Cars.Values.Select(c => c.BestSegments.GetValueOrDefault(p)).Where(t => t > 0).ToList();
        return times.Count > 0 ? Math.Round(times.Min(), 3) : 0;
    }).ToArray();

    /// <summary>Splits in timing point order with the lap time last: [TP1, TP2, ..., TPn, lap]. 0 = not reached.</summary>
    static double[] Splits(Dictionary<string, double> splits, TimingState s) =>
        s.TimingPoints.Select(tp => tp.Id).Append("M").Select(id => Math.Round(splits.GetValueOrDefault(id), 4)).ToArray();

    /// <summary>
    /// Best-lap splits if the lap was seen live; otherwise what Natsoft tells us anyway (best intermediates
    /// and best lap), so comparisons still work at those points for laps set before we connected.
    /// </summary>
    static double[] BestSplits(CarState c, TimingState s)
    {
        var splits = Splits(c.BestLapSplits, s);
        if (splits[^1] > 0 || c.BestLap <= 0) return splits;
        var ids = s.TimingPoints.Select(tp => tp.Id).ToList();
        if (ids.IndexOf(s.Intermediate1 ?? "") is int i1 && i1 >= 0) splits[i1] = c.BestI1;
        if (ids.IndexOf(s.Intermediate2 ?? "") is int i2 && i2 >= 0) splits[i2] = c.BestI2;
        splits[^1] = c.BestLap;
        return splits;
    }

    static string Manufacturer(string? vehicle) => vehicle switch
    {
        null or "" => "",
        _ when vehicle.Contains("Ford", StringComparison.OrdinalIgnoreCase) => "Ford",
        _ when vehicle.Contains("Chev", StringComparison.OrdinalIgnoreCase) => "Chevrolet",
        _ when vehicle.Contains("Toyota", StringComparison.OrdinalIgnoreCase) => "Toyota",
        _ => vehicle.Split(' ')[0],
    };
}

public sealed record SessionInfo(
    string Meeting, string Name, string Type, string Track, string TrackCode, string Flag,
    int? ClockRemaining, int? ClockElapsed);

public sealed record BestTimes(double? Lap, double? S1, double? S2, double? S3, int? Speed);

public sealed record CarRow(
    string Id, int Position, string CarNumber, string Driver, string Vehicle, string Manufacturer,
    int Laps, double LastLap, double BestLap, int BestLapNo,
    double Gap, int GapLaps, double Interval, int IntervalLaps,
    double LiveGap, int LiveGapLaps, double LiveInterval, int LiveIntervalLaps,
    double S1, double S2, double S3, double BestS1, double BestS2, double BestS3,
    int Speed, int PitStops, bool InPit, string LastPoint, double LastPointAt,
    IReadOnlyList<double> SegmentSeconds,
    double LapStartAt, int LapsSincePit,
    IReadOnlyList<double> CurrentSplits, IReadOnlyList<double> LastLapSplits, IReadOnlyList<double> BestLapSplits,
    /// <summary>All drivers entered in the car, in Natsoft's order (co-driver events have two).</summary>
    IReadOnlyList<string> Drivers,
    string DriverIndex,
    double DriverChangedAt,
    /// <summary>Mini-sector times in point order: this lap so far, the last complete lap, and the car's best.</summary>
    IReadOnlyList<double> CurrentSegments,
    IReadOnlyList<double> LastLapSegments,
    IReadOnlyList<double> BestSegments);

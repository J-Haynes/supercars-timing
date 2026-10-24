using System.Globalization;
using System.Text.RegularExpressions;
using System.Text.Json.Nodes;
using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Server.F1;

/// <summary>
/// F1 live timing state. Keeps each topic's merged JSON (F1 sends partial patches) and works out what the
/// patches don't say directly: when each car crossed each mini-sector (for the map and mini-sector times),
/// lap history, pit stops and flag changes. <see cref="Snapshot"/> turns it into the same
/// <see cref="TimingSnapshot"/> the Supercars app uses, so the tower, map and charts are shared.
///
/// Times are "track-local seconds" like Natsoft's: UTC + the session's GMT offset, as Unix seconds.
/// </summary>
public sealed partial class F1State
{
    /// <summary>Mini-sectors per lap at Singapore 2026 (8 per sector); read from the data, this is just the default.</summary>
    const int DefaultSegments = 24;

    readonly Dictionary<string, JsonNode> _topics = [];
    readonly Dictionary<string, F1Car> _cars = [];
    readonly List<FlagChange> _flags = [];
    string _sessionKey = "";
    TimeSpan _gmtOffset;
    int[] _segmentsPerSector = [8, 8, 8];
    double _greenAt;

    public double Now { get; private set; }
    public long MessageCount { get; private set; }
    public string SessionName => (string?)Topic("SessionInfo")?["Name"] ?? "";

    int SegmentCount => _segmentsPerSector.Sum();

    JsonNode? Topic(string name) => _topics.GetValueOrDefault(name);

    public void Apply(F1Message m)
    {
        if (m.Data is null) return;
        MessageCount++;

        if (m.Topic == "SessionInfo")
        {
            var key = m.Data["Key"]?.ToString();
            if (key is not null && key != _sessionKey)
            {
                // A different session: start our own tracking again. The driver list and weather stay (F1 may not
                // resend them in full), but the timing topics go: F1 sends the new session's lines fresh, and merging
                // them onto the old ones kept qualifying's laps, pit stops and tyres in the race (Singapore 2026).
                if (_sessionKey != "")
                {
                    ResetTracking();
                    if (!m.Snapshot)
                        foreach (var topic in SessionTopics) _topics.Remove(topic);
                }
                _sessionKey = key;
            }
            if ((string?)m.Data["GmtOffset"] is { } offset && TimeSpan.TryParse(offset, out var o) && o != _gmtOffset)
            {
                // Messages before this one were stamped with the old offset (none yet: on connecting, F1 sends the
                // Heartbeat before SessionInfo). Now only moves forward, so at Austin (UTC-5) that Heartbeat's time
                // stayed "now" all day: 5 h ahead, the session clock always 0:00 (2026 qualifying).
                _gmtOffset = o;
                Now = 0;
            }
        }

        var t = (m.Utc + _gmtOffset).ToUnixTimeMilliseconds() / 1000.0;
        if (t > Now) Now = t;

        if (m.Topic == "TimingData" && m.Data["Lines"] is JsonObject lines)
            foreach (var (number, patch) in lines)
                if (patch is JsonObject p) BeforeLinePatch(number, p, t, m.Snapshot);

        if (m.Snapshot || !_topics.TryGetValue(m.Topic, out var existing)) _topics[m.Topic] = m.Data.DeepClone();
        else Merge(existing, m.Data);

        switch (m.Topic)
        {
            case "TimingData" when m.Data["Lines"] is JsonObject changed:
                foreach (var (number, _) in changed) AfterLinePatch(number, t, m.Snapshot);
                break;
            case "TrackStatus" or "SessionStatus":
                RecordFlag(t);
                break;
        }
    }

    /// <summary>Topics that belong to one session, dropped when a new session starts.</summary>
    static readonly string[] SessionTopics =
        ["TimingData", "TimingAppData", "TimingStats", "LapCount", "RaceControlMessages", "SessionData", "ExtrapolatedClock"];

    void ResetTracking()
    {
        _cars.Clear();
        _flags.Clear();
        _greenAt = 0;
    }

    /// <summary>
    /// Deep-merges an F1 patch. Lists are patched as objects keyed by index ("Sectors": {"1": {...}}), and an index
    /// one past the end appends (race control messages arrive like that).
    /// </summary>
    static void Merge(JsonNode target, JsonNode patch)
    {
        if (patch is not JsonObject po) return;
        if (target is JsonObject to)
        {
            foreach (var (key, value) in po.ToList())
            {
                if (key == "_deleted") continue;
                if (value is JsonObject && to[key] is JsonObject or JsonArray) Merge(to[key]!, value);
                else to[key] = value?.DeepClone();
            }
        }
        else if (target is JsonArray ta)
        {
            foreach (var (key, value) in po.ToList())
            {
                if (!int.TryParse(key, out var i) || i < 0) continue;
                while (ta.Count < i) ta.Add(null);
                if (i == ta.Count) ta.Add(value?.DeepClone());
                else if (value is JsonObject && ta[i] is JsonObject or JsonArray) Merge(ta[i]!, value);
                else ta[i] = value?.DeepClone();
            }
        }
    }

    F1Car Car(string number) => _cars.TryGetValue(number, out var c) ? c : _cars[number] = new F1Car(number);

    /// <summary>
    /// Mini-sector crossings, from a TimingData line patch before it's merged. A segment's status turns non-zero
    /// when the car finishes it. F1 also re-sends earlier segments' colours later in the lap (purple downgraded to
    /// green), so only a segment further round the lap than the car's last one counts as a crossing.
    /// </summary>
    void BeforeLinePatch(string number, JsonObject patch, double t, bool snapshot)
    {
        var car = Car(number);
        if (patch["Sectors"] is JsonNode sectors)
        {
            // Mini-sectors per sector differ by circuit: learn them from any full list (the state on connecting,
            // or the start of an archive). Archives send the sectors as an object keyed "0", "1", "2": without
            // reading that form, the 2024 Monaco GP kept the default 8/8/8 (it has 6/10/5) and its mini-sector ids
            // didn't match the map's.
            // (Only every sector at once: a patch of one sector's whole list isn't the circuit's sector count.)
            var all = sectors is JsonArray array ? array.ToList()
                : sectors is JsonObject keyed && keyed.Count == _segmentsPerSector.Length
                  && Enumerable.Range(0, keyed.Count).All(i => keyed.ContainsKey(i.ToString()))
                    ? Enumerable.Range(0, keyed.Count).Select(i => keyed[i.ToString()]).ToList()
                    : null;
            if (all is not null && all.All(x => (x?["Segments"] as JsonArray)?.Count > 0))
                _segmentsPerSector = all.Select(x => ((JsonArray)x!["Segments"]!).Count).ToArray();

            var crossed = new List<int>();
            for (var s = 0; s < _segmentsPerSector.Length; s++)
            {
                var segs = sectors is JsonArray a ? a.ElementAtOrDefault(s)?["Segments"] : sectors[s.ToString()]?["Segments"];
                if (segs is null) continue;
                var offset = _segmentsPerSector.Take(s).Sum();
                IEnumerable<(int Index, JsonNode? Node)> entries = segs is JsonArray sa
                    ? sa.Select((n, i) => (i, n))
                    : segs.AsObject().Select(kv => (int.TryParse(kv.Key, out var i) ? i : -1, kv.Value));
                foreach (var (i, node) in entries)
                    if (i >= 0 && (int?)node?["Status"] is > 0) crossed.Add(offset + i);
            }

            if (snapshot)
            {
                // The full state has no crossing times: just note how far round the lap each car is.
                if (crossed.Count > 0) car.Reached(PointIndex(crossed.Max()), t, timed: false);
            }
            else
            {
                foreach (var flat in crossed.Order()) car.Cross(PointIndex(flat), PointCount, t);
            }
        }

        if (!snapshot && patch["InPit"] is JsonNode inPit)
        {
            var now = (bool?)inPit ?? false;
            if (now && !car.InPit) car.PitIn(t, Laps(number));
            else if (!now && car.InPit) car.PitOut(t, Laps(number));
            car.InPit = now;
        }
        else if (snapshot && (bool?)patch["InPit"] == true) car.InPit = true;
    }

    /// <summary>Lap completion and lap times, after the patch is merged (so the new values are in place).</summary>
    void AfterLinePatch(string number, double t, bool snapshot)
    {
        var line = Line(number);
        if (line is null) return;
        var car = Car(number);
        var laps = (int?)line["NumberOfLaps"] ?? 0;
        var lapTime = ParseTime((string?)line["LastLapTime"]?["Value"]);
        if (laps > car.Laps)
        {
            // Only an increase we saw happen is a line crossing (and a lap for the history). The first lap count we
            // see for a car (the full state on connecting, or the start of a recording) is just where it's up to.
            var seen = !snapshot && (car.Laps > 0 || laps == 1);
            if (seen)
            {
                var (gap, gapLaps) = ParseGap((string?)line["GapToLeader"]);
                car.LapHistory.Add(new LapEntry(laps, lapTime, ParseInt(line["Position"]), gap, gapLaps, DriverName(number),
                    car.PitLog.Count > 0 && car.PitLog[^1].Lap == laps, t));
            }
            car.Laps = laps;
            car.LapTimeSeenAt = t;
            car.LastLapTime = lapTime;
            // The line is the last mini-sector's end; if its status came first we already counted it.
            if (seen) car.Cross(0, PointCount, t);
        }
        else if (lapTime > 0 && lapTime != car.LastLapTime && t - car.LapTimeSeenAt < 5 && car.LapHistory.Count > 0)
        {
            // The lap time arrived just after the lap count.
            car.LapHistory[^1] = car.LapHistory[^1] with { Time = lapTime };
            car.LastLapTime = lapTime;
        }
    }

    JsonNode? Line(string number) => Topic("TimingData")?["Lines"]?[number];
    int Laps(string number) => (int?)Line(number)?["NumberOfLaps"] ?? 0;

    /// <summary>Point order for the map: "M" (the line) then one point at the end of each mini-sector but the last.</summary>
    int PointCount => SegmentCount; // M + (segments - 1) points

    /// <summary>Flat segment index (0-based) to point index in <see cref="PointOrder"/> (0 = the line).</summary>
    int PointIndex(int flat) => flat >= SegmentCount - 1 ? 0 : flat + 1;

    List<string> PointOrder()
    {
        var order = new List<string> { "M" };
        for (var s = 0; s < _segmentsPerSector.Length; s++)
            for (var i = 0; i < _segmentsPerSector[s]; i++)
                order.Add($"{s + 1}.{i + 1}");
        order.RemoveAt(order.Count - 1); // the last mini-sector ends at the line
        return order;
    }

    string Flag()
    {
        var session = (string?)Topic("SessionStatus")?["Status"] ?? "";
        switch (session)
        {
            case "Finished": return "Checkered";
            case "Finalised" or "Ends": return "Ended";
            case "Aborted": return "Red";
            case "Inactive" or "": return "WaitStart";
        }
        // TrackStatus: 1 all clear, 2 yellow (a local yellow: not a caution), 4 safety car, 5 red, 6 VSC, 7 VSC ending.
        return (string?)Topic("TrackStatus")?["Status"] switch
        {
            "4" => "Safety Car",
            "5" => "Red",
            "6" => "VSC",
            "7" => "VSC Ending",
            _ => "Green",
        };
    }

    void RecordFlag(double t)
    {
        var flag = Flag();
        if (_flags.Count > 0 && _flags[^1].Flag == flag) return;
        _flags.Add(new FlagChange(t, flag));
        if (flag == "Green" && _greenAt == 0 && IsRace) _greenAt = t;
    }

    bool IsRace => ((string?)Topic("SessionInfo")?["Type"] ?? "").Contains("Race", StringComparison.OrdinalIgnoreCase);

    string DriverName(string number)
    {
        var d = Topic("DriverList")?[number];
        if (d is null) return number;
        var first = (string?)d["FirstName"] ?? "";
        var last = (string?)d["LastName"] ?? "";
        if (last == "") return (string?)d["FullName"] ?? number;
        // "NORRIS" -> "Norris" (the tower uses mixed case for Supercars names too).
        return $"{first} {CultureInfo.InvariantCulture.TextInfo.ToTitleCase(last.ToLowerInvariant())}".Trim();
    }

    public TimingSnapshot Snapshot()
    {
        var order = PointOrder();
        var reference = FieldSegmentTimes(order);
        var info = Topic("SessionInfo");
        var stats = Topic("TimingStats")?["Lines"];
        var app = Topic("TimingAppData")?["Lines"];
        var penalties = RaceControlMessages().Select(m => Penalty(m.Text)).OfType<(string Car, string What)>()
            .ToLookup(p => p.Car, p => p.What);

        var rows = new List<CarRow>();
        foreach (var number in (Topic("DriverList")?.AsObject().Select(kv => kv.Key) ?? []).Union(_cars.Keys))
        {
            var line = Line(number);
            var driverInfo = Topic("DriverList")?[number];
            if (line is null || driverInfo is null) continue;
            var car = Car(number);
            var pos = ParseInt(line["Position"]);
            var (gap, gapLaps) = ParseGap((string?)line["GapToLeader"] ?? (string?)line["TimeDiffToFastest"] ?? StatsGap(line, "TimeDiffToFastest"));
            var (interval, intervalLaps) = ParseGap((string?)line["IntervalToPositionAhead"]?["Value"] ?? (string?)line["TimeDiffToPositionAhead"] ?? StatsGap(line, "TimeDifftoPositionAhead"));
            var sectors = line["Sectors"] as JsonArray;
            double Sector(int i) => ParseTime((string?)sectors?.ElementAtOrDefault(i)?["Value"]);
            double BestSector(int i) => ParseTime((string?)stats?[number]?["BestSectors"]?[i]?["Value"]);
            var stints = app?[number]?["Stints"] as JsonArray;
            var stint = stints?.LastOrDefault(s => s is not null);
            var team = (string?)driverInfo["TeamName"] ?? "";
            var name = DriverName(number);
            var retired = (bool?)line["Retired"] == true;
            var expected = ExpectedSegments(car, order);
            // Not time in the garage before the start: cars sit "in the pit" until they go to the grid.
            var pitLog = car.PitLog.Where(p => !IsRace || (_greenAt > 0 && p.InAt >= _greenAt)).ToArray();

            rows.Add(new CarRow(
                number, pos, number, name, team, team,
                car.Laps > 0 ? car.Laps : (int?)line["NumberOfLaps"] ?? 0,
                ParseTime((string?)line["LastLapTime"]?["Value"]),
                ParseTime((string?)line["BestLapTime"]?["Value"]),
                (int?)line["BestLapTime"]?["Lap"] ?? 0,
                gap, gapLaps, interval, intervalLaps,
                // F1's own gaps are live (updated through the lap), so they're the live gaps too.
                gap, gapLaps, interval, intervalLaps,
                Sector(0), Sector(1), Sector(2), BestSector(0), BestSector(1), BestSector(2),
                ParseInt(line["Speeds"]?["ST"]?["Value"]),
                (int?)line["NumberOfPitStops"] ?? pitLog.Length,
                car.InPit || (bool?)line["InPit"] == true,
                car.LastPointIndex is { } li ? order[li] : "",
                car.LastPointAt,
                expected,
                car.LapStartAt, car.Laps - car.StintStartLap,
                Splits(car.CurrentSplits, order), Splits(car.LastLapSplits, order), Splits(car.BestLapSplits, order),
                [name], "1", 0,
                Round(car.CurrentSegments, order.Count), Round(car.LastLapSegments, order.Count), Round(car.BestSegments, order.Count),
                [car.Laps], 0,
                car.Laps - car.StintStartLap,
                pitLog.Select(p => new PitStopRow(p.Lap, p.InAt, p.OutAt, Math.Round(p.Seconds, 1), name, name)).ToArray(),
                retired ? 0 : pos,
                penalties[number].ToArray(),
                Tyre: (string?)stint?["Compound"] ?? "",
                TyreLaps: (int?)stint?["TotalLaps"] ?? 0,
                TeamColour: (string?)driverInfo["TeamColour"] ?? "",
                GridPosition: ParseInt(app?[number]?["GridPos"]),
                Retired: retired || (bool?)line["Stopped"] == true,
                LastLineAt: car.LapStartAt));
        }
        rows = rows.OrderBy(r => r.Position == 0 ? int.MaxValue : r.Position).ToList();

        static double? Fastest(IEnumerable<double> times)
        {
            var set = times.Where(x => x > 0).ToList();
            return set.Count > 0 ? set.Min() : null;
        }
        var topSpeed = rows.Select(c => c.Speed).DefaultIfEmpty(0).Max();
        var best = new BestTimes(Fastest(rows.Select(c => c.BestLap)), Fastest(rows.Select(c => c.BestS1)),
            Fastest(rows.Select(c => c.BestS2)), Fastest(rows.Select(c => c.BestS3)), topSpeed > 0 ? topSpeed : null);

        var circuit = info?["Meeting"]?["Circuit"];
        var session = new SessionInfo(
            (string?)info?["Meeting"]?["Name"] ?? "",
            (string?)info?["Name"] ?? "",
            (string?)info?["Type"] ?? "",
            (string?)info?["Meeting"]?["Location"] ?? (string?)circuit?["ShortName"] ?? "",
            circuit?["Key"] is { } key ? $"F1-{key}" : "",
            Flag(), ClockRemaining(), null,
            (int?)Topic("LapCount")?["TotalLaps"] ?? 0,
            _greenAt, null);

        var timingPoints = order.Skip(1).Select(id => new TimingPoint(id, $"Sector {id.Split('.')[0]} · {id.Split('.')[1]}")).ToList();
        return new TimingSnapshot(session, timingPoints, best, rows, reference, SessionBestSegments(order),
            RaceControlMessages().AsEnumerable().Reverse().Take(TimingSnapshot.RaceControlLimit).ToList(),
            _flags.ToList(), Now, MessageCount);

        double[] ExpectedSegments(F1Car c, List<string> o) => o.Select((_, i) =>
        {
            var own = c.SegmentSeconds.ElementAtOrDefault(i);
            var field = reference[i];
            if (own > 0 && (field == 0 || (own > field * 0.8 && own < field * 1.6))) return Math.Round(own, 3);
            return field;
        }).ToArray();
    }

    static string? StatsGap(JsonNode line, string field) =>
        (line["Stats"] as JsonArray)?.Select(s => (string?)s?[field]).LastOrDefault(v => !string.IsNullOrEmpty(v));

    public LapHistory Laps() => new(SessionName, _cars.Values
        .Where(c => Line(c.Number) is not null)
        .Select(c => new CarLaps(c.Number, c.Number, DriverName(c.Number), [DriverName(c.Number)], c.LapHistory.ToList()))
        .ToList());

    int? ClockRemaining()
    {
        var clock = Topic("ExtrapolatedClock");
        if (clock is null || !TimeSpan.TryParse((string?)clock["Remaining"], out var remaining)) return null;
        var seconds = remaining.TotalSeconds;
        if ((bool?)clock["Extrapolating"] == true && DateTimeOffset.TryParse((string?)clock["Utc"], out var at))
            seconds -= Now - (at + _gmtOffset).ToUnixTimeMilliseconds() / 1000.0;
        return (int)Math.Max(0, seconds);
    }

    List<RaceControlMessage> RaceControlMessages()
    {
        if (Topic("RaceControlMessages")?["Messages"] is not JsonArray messages) return [];
        return messages.OfType<JsonObject>().Select(m =>
        {
            // Utc has no zone suffix but is UTC.
            var utc = DateTime.TryParse((string?)m["Utc"], CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var u) ? u : DateTime.UnixEpoch;
            var t = (new DateTimeOffset(utc, TimeSpan.Zero) + _gmtOffset).ToUnixTimeMilliseconds() / 1000.0;
            return new RaceControlMessage(t, (string?)m["Message"] ?? "");
        }).ToList();
    }

    /// <summary>
    /// Car number and penalty from an F1 race control message, e.g. "FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 87
    /// (BEA) - CAUSING A COLLISION" gives ("87", "5 seconds"); drive-through and stop/go penalties too.
    /// </summary>
    public static (string Car, string What)? Penalty(string text)
    {
        var m = PenaltyRegex().Match(text);
        if (!m.Success) return null;
        var what = m.Groups["secs"].Success ? $"{m.Groups["secs"].Value} seconds"
            : m.Groups["kind"].Value.ToUpperInvariant().Contains("DRIVE") ? "drive through" : "stop/go";
        return (m.Groups["car"].Value, what);
    }

    [GeneratedRegex(@"(?:(?<secs>\d+)\s+SECOND\s+TIME|(?<kind>DRIVE[\s-]THROUGH|STOP[\s/-]*GO)(?:\s+\d+\s+SECONDS?)?)\s+PENALTY\s+FOR\s+CAR\s+(?<car>\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex PenaltyRegex();

    double[] FieldSegmentTimes(List<string> order) => order.Select((_, i) =>
    {
        var times = _cars.Values.Select(c => c.SegmentSeconds.ElementAtOrDefault(i)).Where(x => x > 0).Order().ToList();
        if (times.Count == 0) return 0;
        var plausible = times.Where(x => x < times[0] * 2).ToList();
        return Math.Round(plausible[plausible.Count / 2], 3);
    }).ToArray();

    double[] SessionBestSegments(List<string> order) => order.Select((_, i) =>
    {
        var times = _cars.Values.Select(c => c.BestSegments.ElementAtOrDefault(i)).Where(x => x > 0).ToList();
        return times.Count > 0 ? Math.Round(times.Min(), 3) : 0;
    }).ToArray();

    /// <summary>Splits in point order without the line, then the lap: [P1..Pn, lap], like the Natsoft snapshot.</summary>
    static double[] Splits(double[] splits, List<string> order) =>
        Enumerable.Range(1, order.Count - 1).Select(i => Math.Round(splits.ElementAtOrDefault(i), 3))
            .Append(Math.Round(splits.ElementAtOrDefault(0), 3)).ToArray();

    static double[] Round(double[] values, int count) =>
        Enumerable.Range(0, count).Select(i => Math.Round(values.ElementAtOrDefault(i), 3)).ToArray();

    static int ParseInt(JsonNode? node) => int.TryParse(node?.ToString(), out var i) ? i : 0;

    /// <summary>"1:31.373" or "28.398" to seconds; 0 when empty.</summary>
    public static double ParseTime(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return 0;
        var parts = s.Trim().Split(':');
        double total = 0;
        foreach (var p in parts)
        {
            if (!double.TryParse(p, NumberStyles.Float, CultureInfo.InvariantCulture, out var v)) return 0;
            total = total * 60 + v;
        }
        return total;
    }

    /// <summary>"+1.234" -> (1.234, 0); "1L", "+2 LAPS" -> (0, laps); "LAP 20" (the leader) -> (0, 0).</summary>
    public static (double Seconds, int Laps) ParseGap(string? s)
    {
        if (string.IsNullOrWhiteSpace(s) || s.StartsWith("LAP", StringComparison.OrdinalIgnoreCase)) return (0, 0);
        var lap = Regex.Match(s, @"(\d+)\s*L", RegexOptions.IgnoreCase);
        if (lap.Success) return (0, int.Parse(lap.Groups[1].Value));
        return (ParseTime(s.TrimStart('+')), 0);
    }
}

/// <summary>What we work out per car from the stream of patches.</summary>
sealed class F1Car(string number)
{
    const double MinStretchSeconds = 0.5;

    public string Number { get; } = number;
    public int Laps { get; set; }
    public double LastLapTime { get; set; }
    public double LapTimeSeenAt { get; set; }
    public bool InPit { get; set; }
    public int StintStartLap { get; set; }
    /// <summary>Index in the point order of the last point passed (0 = the line); null = not seen yet.</summary>
    public int? LastPointIndex { get; private set; }
    public double LastPointAt { get; private set; }
    bool _lastTimed;
    public double LapStartAt { get; private set; }
    /// <summary>Per stretch (index i = from point i to the next): latest time, this lap, last lap, best.</summary>
    public double[] SegmentSeconds { get; private set; } = [];
    public double[] CurrentSegments { get; private set; } = [];
    public double[] LastLapSegments { get; private set; } = [];
    public double[] BestSegments { get; private set; } = [];
    /// <summary>Seconds from the lap start at each point (index 0 = the lap time).</summary>
    public double[] CurrentSplits { get; private set; } = [];
    public double[] LastLapSplits { get; private set; } = [];
    public double[] BestLapSplits { get; private set; } = [];
    public List<LapEntry> LapHistory { get; } = [];
    public List<F1PitStop> PitLog { get; } = [];

    void Size(int count)
    {
        if (SegmentSeconds.Length == count) return;
        SegmentSeconds = new double[count];
        CurrentSegments = new double[count];
        LastLapSegments = new double[count];
        BestSegments = new double[count];
        CurrentSplits = new double[count];
        LastLapSplits = new double[count];
        BestLapSplits = new double[count];
    }

    /// <summary>Position known (e.g. from the snapshot) but not when it got there: no stretch time from it.</summary>
    public void Reached(int index, double t, bool timed)
    {
        LastPointIndex = index;
        LastPointAt = t;
        _lastTimed = timed;
    }

    /// <summary>The car passed point <paramref name="index"/> at <paramref name="t"/> (if it's ahead of its last one).</summary>
    public void Cross(int index, int count, double t)
    {
        Size(count);
        if (LastPointIndex is not { } last) { Reached(index, t, timed: true); if (index == 0) LapStartAt = t; return; }
        var forward = (index - last + count) % count;
        // The same point, or backwards (colours re-sent for a segment done earlier this lap): not a crossing. Unless
        // we don't really know where the car is (from the state on connecting) or haven't heard for a minute
        // (pits, missed messages): then start again from this point, without a stretch time.
        if (forward == 0) return;
        if (forward > count / 2)
        {
            if (_lastTimed && t - LastPointAt < 60) return;
            Reached(index, t, timed: true);
            return;
        }

        var seconds = t - LastPointAt;
        // Statuses also come in bursts (formation lap, grid, pit lane): the shortest real stretch is ~1 s.
        if (forward == 1 && _lastTimed && LastPointAt > 0 && seconds >= MinStretchSeconds)
        {
            SegmentSeconds[last] = seconds;
            CurrentSegments[last] = seconds;
            // Out-laps don't count as a best: in a Shootout or a first run the out-lap was a car's "best" (green, or
            // purple for the first car out). Laps > StintStartLap: not the lap out of the pits.
            if (!InPit && Laps > StintStartLap && (BestSegments[last] == 0 || seconds < BestSegments[last])) BestSegments[last] = seconds;
        }

        if (index == 0 || index < last)
        {
            // Crossed the line: close the lap.
            if (LapStartAt > 0)
            {
                CurrentSplits[0] = t - LapStartAt;
                LastLapSegments = (double[])CurrentSegments.Clone();
                LastLapSplits = (double[])CurrentSplits.Clone();
                if (!InPit && (BestLapSplits[0] == 0 || CurrentSplits[0] < BestLapSplits[0])) BestLapSplits = (double[])CurrentSplits.Clone();
            }
            Array.Clear(CurrentSegments);
            Array.Clear(CurrentSplits);
            LapStartAt = t;
        }
        else if (LapStartAt > 0) CurrentSplits[index] = t - LapStartAt;

        Reached(index, t, timed: true);
    }

    public void PitIn(double t, int lap) => PitLog.Add(new F1PitStop { Lap = lap, InAt = t });

    public void PitOut(double t, int lap)
    {
        if (PitLog.Count > 0 && PitLog[^1].OutAt == 0)
        {
            PitLog[^1].OutAt = t;
            PitLog[^1].Seconds = t - PitLog[^1].InAt;
        }
        StintStartLap = lap;
    }
}

sealed class F1PitStop
{
    public int Lap { get; init; }
    public double InAt { get; init; }
    public double OutAt { get; set; }
    public double Seconds { get; set; }
}

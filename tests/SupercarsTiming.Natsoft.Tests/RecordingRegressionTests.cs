using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Natsoft.Tests;

/// <summary>
/// A test that runs only when a real recording it needs is in data/recordings. Recordings are Natsoft's data and
/// git-ignored, so on a machine without them these tests are skipped rather than failing.
/// </summary>
public sealed class RecordingFactAttribute : FactAttribute
{
    public RecordingFactAttribute(string session)
    {
        if (Recordings.Session(session) is null) Skip = $"Needs a recording of \"{session}\" in data/recordings";
    }
}

static class Recordings
{
    static readonly Lazy<List<RecordedSession>> All = new(() =>
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && dir.GetFiles("SupercarsTiming.slnx").Length == 0) dir = dir.Parent;
        var recordings = dir is null ? null : Path.Combine(dir.FullName, "data", "recordings");
        return recordings is not null && Directory.Exists(recordings)
            ? SessionIndex.Scan(Directory.GetFiles(recordings, "*.jsonl"))
            : [];
    });

    /// <summary>The longest recorded session whose name ends with <paramref name="name"/> (merged across restarts).</summary>
    public static RecordedSession? Session(string name) =>
        All.Value.Where(s => s.Name.EndsWith(name, StringComparison.OrdinalIgnoreCase)).MaxBy(s => s.Messages);

    /// <summary>Replays a whole recorded session through <see cref="TimingState"/>, as the server's warm start does.</summary>
    public static TimingState Replay(string name)
    {
        var s = new TimingState();
        foreach (var m in SessionIndex.Read(Session(name)!)) if (m.Xml is not null) s.Apply(m.Xml);
        return s;
    }
}

/// <summary>
/// Regression tests on real recordings from the 2026 Bathurst 1000 weekend. Each one guards a bug found live:
/// see the commit history for the details.
/// </summary>
public class RecordingRegressionTests
{
    const string Race = "Supercars Championship - Race 30";
    const string Practice6 = "Practice 6 (All Drivers)";
    const string GoldCoastPractice1 = "Supercars Championship - Practice 1";

    [RecordingFact(Race)]
    public void Race_pit_log_matches_Natsofts_pit_count_with_no_duplicates_or_stuck_stops()
    {
        // Restarts mid-race logged a stop twice and left a copy "in the pits" (Wood, lap 41).
        var snap = TimingSnapshot.From(Recordings.Replay(Race));
        Assert.Equal(snap.Cars.Sum(c => c.PitStops), snap.Cars.Sum(c => c.PitLog.Count));
        Assert.All(snap.Cars, c => Assert.Equal(c.PitLog.Count, c.PitLog.Select(p => Math.Round(p.InAt)).Distinct().Count()));
        Assert.All(snap.Cars.Where(c => !c.InPit), c => Assert.DoesNotContain(c.PitLog, p => p.OutAt == 0));
    }

    [RecordingFact(Race)]
    public void Race_history_survives_the_restarts_in_the_recording()
    {
        // The recording spans several server restarts; the snapshot after each doesn't list the cars, and history
        // used to be dropped (Pye showed 0 laps instead of 25).
        var session = Recordings.Session(Race)!;
        Assert.True(session.Parts.Count > 1, "expected the race to span restarts");
        var snap = TimingSnapshot.From(Recordings.Replay(Race));
        Assert.All(snap.Cars, c => Assert.Equal(0, c.UnattributedLaps));
        Assert.All(snap.Cars.Where(c => c.Drivers.Count > 1), c => Assert.Equal(c.Laps, c.DriverLaps.Sum()));
    }

    [RecordingFact(Race)]
    public void Race_penalties_are_read_in_both_wordings()
    {
        // "Penalty Car 19 - 5 seconds - ..." and "Penalty Car 19  plp  pit stop infringement" (no dashes).
        var payne = TimingSnapshot.From(Recordings.Replay(Race)).Cars.Single(c => c.CarNumber == "19");
        Assert.Contains("5 seconds", payne.Penalties);
        Assert.Contains("plp", payne.Penalties);
    }

    [RecordingFact(Race)]
    public void Race_road_positions_flags_start_and_record()
    {
        // Road positions are unique while racing. After the finish Natsoft stops updating those of stopped and
        // retired cars, so they can repeat (the frontend falls back to its own road order then): check mid-race.
        var mid = new TimingState();
        foreach (var m in SessionIndex.Read(Recordings.Session(Race)!))
        {
            if (m.Xml is null) continue;
            mid.Apply(m.Xml);
            if (mid.Cars.Count > 0 && mid.Cars.Values.Max(c => c.Laps) >= 80) break;
        }
        Assert.Equal(mid.Cars.Count, mid.Cars.Values.Select(c => c.RoadPosition).Where(p => p > 0).Distinct().Count());

        var s = Recordings.Replay(Race);
        Assert.Contains(s.FlagHistory, f => f.Flag == "Green");
        // Flag changes are in time order (green after the safety car once carried the first green's time).
        Assert.Equal(s.FlagHistory.Select(f => f.Time).Order(), s.FlagHistory.Select(f => f.Time));
        Assert.True(s.GreenAt > 0);
        Assert.Equal(161, s.ScheduledLaps);
        Assert.NotNull(s.Record);
    }

    [RecordingFact(Practice6)]
    public void Practice_mini_sectors_match_the_lap_splits()
    {
        // A slow first out-lap once set the plausibility reference so high that real times were all rejected.
        var s = Recordings.Replay(Practice6);
        var order = s.PointOrder.ToList();
        for (int i = 0; i < order.Count; i++)
        {
            var from = order[i];
            var stored = s.Cars.Values.Select(c => c.SegmentSeconds.GetValueOrDefault(from)).Where(t => t > 0).Order().ToList();
            var fromSplits = s.Cars.Values
                .Where(c => c.LastLapSplits.Count == order.Count && c.LastLapSplits.Values.All(v => v > 0))
                .Select(c => c.LastLapSplits[i == order.Count - 1 ? "M" : order[i + 1]] - (i == 0 ? 0 : c.LastLapSplits[from]))
                .Order().ToList();
            Assert.True(stored.Count >= s.Cars.Count / 2, $"stretch {from}: only {stored.Count} cars have a time");
            if (fromSplits.Count == 0) continue;
            var a = stored[stored.Count / 2];
            var b = fromSplits[fromSplits.Count / 2];
            Assert.True(Math.Abs(a - b) / b < 0.1, $"stretch {from}: stored median {a:0.00}s vs splits {b:0.00}s");
        }
    }

    [RecordingFact(Race)]
    public void Race_lap_history_covers_the_race()
    {
        // Charts need a lap entry for (almost) every lap. A few can be missed while the server restarts.
        var s = Recordings.Replay(Race);
        Assert.All(s.Cars.Values, c =>
        {
            Assert.InRange(c.LapHistory.Count, c.Laps - 3, c.Laps);
            Assert.Equal(c.LapHistory.Count, c.LapHistory.Select(l => l.Lap).Distinct().Count());
        });
        var times = s.Cars.Values.SelectMany(c => c.LapHistory).Where(l => l.Time > 0).Select(l => l.Time).Order().ToList();
        Assert.InRange(times[times.Count / 2], 120, 140);   // a typical Bathurst race lap
    }

    [RecordingFact(GoldCoastPractice1)]
    public void Gold_Coast_deleted_laps_are_flagged_and_never_show_the_previous_laps_time()
    {
        // Kerb hops at the Gold Coast: Natsoft sends I="?" at the line. #19 (Payne) lost laps 11 and 14, at 77.5 s
        // and 79.9 s pace through every timing point.
        var s = Recordings.Replay(GoldCoastPractice1);
        var payne = TimingSnapshot.From(s).Cars.Single(c => c.CarNumber == "19");
        var laps = s.Cars[payne.Id].LapHistory;
        Assert.Contains(laps, l => l.Lap == 11 && l.Deleted && l.Time == 0);
        Assert.Contains(laps, l => l.Lap == 14 && l.Deleted && l.Time == 0);
        Assert.True(payne.DeletedLaps >= 2);
        // Every deleted lap has no time; no lap repeats the one before it (the old bug).
        var all = s.Cars.Values.SelectMany(c => c.LapHistory.Zip(c.LapHistory.Skip(1))).ToList();
        Assert.DoesNotContain(all, p => p.Second.Time > 0 && p.Second.Time == p.First.Time);
        Assert.All(s.Cars.Values.SelectMany(c => c.LapHistory).Where(l => l.Deleted), l => Assert.Equal(0, l.Time));
        Assert.InRange(s.Cars.Values.Sum(c => c.DeletedLaps), 15, 25);
    }
}

using System.Collections.Concurrent;
using System.Text.Json;

namespace SupercarsTiming.Server.Weekend;

/// <summary>Shared, bounded source refreshes with bundled offline snapshots. Independent of timing-feed schedules.</summary>
public sealed class WeekendService(IHttpClientFactory clients, ILogger<WeekendService> logger)
{
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    readonly Dictionary<string, WeekendData> _weekends = Load<WeekendData[]>("Weekend.weekends.json")
        .ToDictionary(w => w.Series + "/" + w.StartDate);
    readonly Dictionary<string, ChampionshipStandings> _standings = Load<ChampionshipStandings[]>("Weekend.standings.json")
        .ToDictionary(s => s.Series + "/" + s.Season);
    readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();
    readonly ConcurrentDictionary<string, DateTimeOffset> _attempts = new();
    // Readers only access a value while holding its key's lock. The dictionaries themselves never change shape.
    readonly ConcurrentDictionary<string, WeekendData> _weekendCache = new();
    readonly ConcurrentDictionary<string, ChampionshipStandings> _standingsCache = new();

    public async Task<WeekendData?> Weekend(string series, string date)
    {
        var key = series + "/" + date;
        if (!_weekends.TryGetValue(key, out var bundled)) return null;
        var gate = _locks.GetOrAdd(key, _ => new(1));
        await gate.WaitAsync();
        try
        {
            var current = _weekendCache.GetValueOrDefault(key) ?? bundled;
            if (!Due(key)) return current;
            _attempts[key] = DateTimeOffset.UtcNow;
            try
            {
                string? source = current.TimetableUrl;
                if (source is null && current.EventUrl is not null && series == "f1")
                    source = WeekendParser.F1TimetableUrl(await Get(current.EventUrl));
                if (source is null) throw new FormatException("The full weekend timetable is not published yet.");
                var html = await Get(source);
                var sessions = series == "v8" ? WeekendParser.SupercarsSessions(html, date, current.UtcOffset) : WeekendParser.F1Sessions(html, current);
                // Preserve explicit, sourced coverage only for the same category/session/start. Moving a session
                // invalidates its old programme time; it must be reconfirmed instead of following the session.
                sessions = sessions.Select(s => s with { Coverage = current.Sessions.FirstOrDefault(old =>
                    old.Start == s.Start && old.Category == s.Category && old.Name == s.Name)?.Coverage }).ToArray();
                var broadcasts = current.Broadcasts;
                string? note = null;
                if (series == "v8")
                {
                    try
                    {
                        var published = WeekendParser.SupercarsBroadcasts(await Get("https://www.supercars.com/tv-schedule"), current);
                        // A daily start is broader than an EPG programme. Keep independently sourced programme
                        // blocks (with their own check date), unless a newer day start contradicts their start.
                        broadcasts = current.Broadcasts.Where(b => b.Scope != "day" && published.Any(day =>
                            TrackDay(day.Start, current) == TrackDay(b.Start, current) && day.Start <= b.Start
                            && day.Channels.SequenceEqual(b.Channels)))
                            .Concat(published).OrderBy(b => b.Start).ToArray();
                        if (published.Length == 0) note = "The current TV page has no listings for this weekend. Individual programme starts remain unconfirmed.";
                    }
                    catch (Exception e) when (SourceFailure(e))
                    {
                        logger.LogWarning(e, "Could not refresh TV times for {Weekend}", key);
                        note = "TV listings could not be refreshed; previously checked listings are shown.";
                    }
                }
                // A daily broadcast block confirms the main championship coverage only. It does not prove every
                // support session is televised, even if its track time falls within the block.
                sessions = sessions.Select(s => !s.Main ? s : s with
                {
                    Coverage = MainCoverage(s, current, broadcasts)
                }).ToArray();
                return _weekendCache[key] = current with { Sessions = sessions, Broadcasts = broadcasts,
                    ScheduleSource = source, TimetableUrl = source, CheckedAt = DateTimeOffset.UtcNow, Note = note };
            }
            catch (Exception e) when (SourceFailure(e))
            {
                logger.LogWarning(e, "Could not refresh weekend {Weekend}", key);
                return _weekendCache[key] = current with { Note = "Could not refresh the published timetable; showing the last checked schedule. Coverage may change." };
            }
        }
        finally { gate.Release(); }
    }

    public async Task<ChampionshipStandings?> Standings(string series, int season)
    {
        var key = series + "/" + season;
        if (!_standings.TryGetValue(key, out var bundled)) return null;
        var gate = _locks.GetOrAdd("standings/" + key, _ => new(1));
        await gate.WaitAsync();
        try
        {
            var current = _standingsCache.GetValueOrDefault(key) ?? bundled;
            if (!Due("standings/" + key)) return current;
            _attempts["standings/" + key] = DateTimeOffset.UtcNow;
            try
            {
                var pages = await Task.WhenAll(Get(current.DriversSource), Get(current.TeamsSource));
                Standing[] drivers, teams;
                string asOf;
                RemainingPoints? remaining = null;
                int? completedRace = null;
                Dictionary<int, string[]>? raceResults = null;
                Dictionary<int, Dictionary<string, decimal>>? racePoints = null;
                Dictionary<int, string>? raceWinners = null;
                if (series == "f1")
                {
                    var d = WeekendParser.F1Standings(pages[0], false);
                    var t = WeekendParser.F1Standings(pages[1], true);
                    if (d.Round != t.Round) throw new FormatException("Drivers and constructors are at different rounds.");
                    (drivers, teams, asOf) = (d.Rows, t.Rows, "After round " + d.Round);
                    var schedule = await Task.WhenAll(Get($"https://api.jolpi.ca/ergast/f1/{season}/races/?limit=100"),
                        Get($"https://api.jolpi.ca/ergast/f1/{season}/results/1/?limit=100"));
                    remaining = WeekendParser.F1Remaining(schedule[0], schedule[1], d.Round);
                }
                else
                {
                    drivers = WeekendParser.SupercarsDrivers(pages[0]);
                    teams = WeekendParser.SupercarsTeams(pages[1]);
                    asOf = "As published by Supercars · includes Finals resets";
                    if (season == 2026)
                    {
                        completedRace = WeekendParser.SupercarsCompletedRace(pages[0]);
                        remaining = WeekendParser.SupercarsRemaining(completedRace.Value, drivers);
                        raceResults = WeekendParser.SupercarsResults(pages[0]);
                        racePoints = WeekendParser.SupercarsRacePoints(pages[0]);
                        raceWinners = raceResults.Where(r => r.Key is >= 31 and <= 34).ToDictionary(r => r.Key, r => r.Value[0]);
                        // At these full-points sprint rounds 150 uniquely identifies a win. Use the explicit
                        // classification when available; don't infer a winner from reduced/ambiguous point scores.
                        foreach (var (race, scores) in racePoints)
                        {
                            var winners = scores.Where(p => p.Value == 150).Select(p => p.Key).ToArray();
                            if (!raceWinners.ContainsKey(race) && winners.Length == 1) raceWinners[race] = winners[0];
                        }
                    }
                }
                if (drivers.Length == 0 || teams.Length == 0) throw new FormatException("Empty championship standings.");
                return _standingsCache[key] = current with { Drivers = drivers, Teams = teams, AsOf = asOf,
                    CheckedAt = DateTimeOffset.UtcNow, Note = null, PointsRemaining = remaining,
                    CompletedRace = completedRace, RaceResults = raceResults, RacePoints = racePoints, RaceWinners = raceWinners };
            }
            catch (Exception e) when (SourceFailure(e))
            {
                logger.LogWarning(e, "Could not refresh standings {Series}", key);
                return _standingsCache[key] = current with { Note = "Could not refresh standings; showing the last checked points." };
            }
        }
        finally { gate.Release(); }
    }

    static Coverage MainCoverage(WeekendSession session, WeekendData weekend, Broadcast[] broadcasts)
    {
        var block = broadcasts.Where(b => TrackDay(b.Start, weekend) == TrackDay(session.Start, weekend) && b.Start <= session.Start
                && (b.End is null || b.End > session.Start))
            .OrderByDescending(b => b.Scope == "programme").ThenByDescending(b => b.Start).FirstOrDefault();
        return block is not null ? new("confirmed", block.Channels, block.Source, block.Start, block.End,
            CheckedAt: block.CheckedAt, Scope: block.Scope)
            : new("confirmed", ["Kayo Sports", "Foxtel"], weekend.Series == "f1"
                ? "https://www.formula1.com/en/information/f1-broadcast-information.45y3LNsT1D6VoK0ZmX8ciJ"
                : "https://www.supercars.com/tv-schedule", Note: "Broadcast start and channel number unconfirmed.", CheckedAt: DateTimeOffset.UtcNow);
    }

    static DateTime TrackDay(DateTimeOffset instant, WeekendData weekend) => instant.ToOffset(TimeSpan.Parse(weekend.UtcOffset.TrimStart('+'))).Date;

    bool Due(string key) => !_attempts.TryGetValue(key, out var at) || DateTimeOffset.UtcNow - at >= TimeSpan.FromMinutes(15);
    async Task<string> Get(string url) => await clients.CreateClient("weekend").GetStringAsync(url);
    static bool SourceFailure(Exception e) => e is HttpRequestException or TaskCanceledException or FormatException
        or JsonException or KeyNotFoundException or InvalidOperationException or ArgumentException or IndexOutOfRangeException;
    static T Load<T>(string name)
    {
        using var stream = typeof(WeekendService).Assembly.GetManifestResourceStream(name)!;
        return JsonSerializer.Deserialize<T>(stream, Json)!;
    }
}

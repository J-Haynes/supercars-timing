using System.Net;
using Microsoft.Extensions.Logging.Abstractions;
using SupercarsTiming.Server.Weekend;

namespace SupercarsTiming.Natsoft.Tests;

public class WeekendTests
{
    static string Fixture(string name)
    {
        var assembly = typeof(WeekendTests).Assembly;
        using var stream = assembly.GetManifestResourceStream("WeekendFixture." + name)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    static readonly WeekendData Brazil = new("f1", "São Paulo Grand Prix", "2026-11-06", "", null, null,
        "-03:00", DateTimeOffset.Parse("2026-11-06T00:00:00Z"), [], []);

    [Fact]
    public void F1_timetable_includes_supports_and_the_grand_prix_in_track_time_but_not_parades()
    {
        var sessions = WeekendParser.F1Sessions(Fixture("brazil.html"), Brazil);
        Assert.Equal(15, sessions.Length);
        Assert.Equal(5, sessions.Count(s => s.Main));
        var practice = Assert.Single(sessions, s => s.Name == "Practice 1");
        Assert.Equal(DateTimeOffset.Parse("2026-11-06T15:30:00Z"), practice.Start);
        Assert.Contains(sessions, s => s.Name == "Race" && s.Start == DateTimeOffset.Parse("2026-11-08T17:00:00Z"));
        Assert.Contains(sessions, s => s.Category == "Porsche Sprint Challenge Brazil" && !s.Main);
        Assert.All(sessions.Where(s => !s.Main), s => Assert.Null(s.Coverage));
        Assert.Throws<FormatException>(() => WeekendParser.F1Sessions(Fixture("brazil.html"), Brazil with { StartDate = "2026-11-19" }));
    }

    [Fact]
    public void Supercars_timetable_preserves_individual_support_sessions_without_confirming_their_coverage()
    {
        var sessions = WeekendParser.SupercarsSessions(Fixture("sandown.html"), "2026-11-06", "+11:00");
        Assert.Equal(30, sessions.Length);
        Assert.Equal(8, sessions.Count(s => s.Main));
        Assert.Contains(sessions, s => s.Category == "DUNLOP Super2 Series" && s.Name == "Practice 2"
            && s.Start == DateTimeOffset.Parse("2026-11-06T02:45:00Z"));
        Assert.All(sessions, s => Assert.Null(s.Coverage));
        Assert.Throws<FormatException>(() => WeekendParser.SupercarsSessions(Fixture("sandown.html"), "2026-11-26", "+10:30"));

        var adelaide = WeekendParser.SupercarsSessions(Fixture("adelaide.html"), "2026-11-26", "+10:30");
        Assert.Equal(13, adelaide.Count(s => s.Main));
        Assert.Contains(adelaide, s => !s.Main && s.Category == "V8 SuperUtes" && s.Name == "Race 1"
            && s.Start == DateTimeOffset.Parse("2026-11-27T08:05:00+10:30") && s.End is null);
        Assert.Contains(adelaide, s => s.Main && s.Name == "Q2 - Race 35"
            && s.Start == DateTimeOffset.Parse("2026-11-27T13:30:00+10:30"));
        Assert.Equal(3, adelaide.Count(s => s.Main && s.Name.StartsWith("Race ")));
        Assert.DoesNotContain(adelaide, s => s.Name.Contains("Rides") || s.Name.Contains("Track Time"));
    }

    [Fact]
    public void TV_listings_use_the_published_channel_and_do_not_leak_into_another_weekend()
    {
        var weekend = Brazil with { Series = "v8", UtcOffset = "+11:00" };
        var broadcasts = WeekendParser.SupercarsBroadcasts(Fixture("tv.html"), weekend);
        Assert.Equal(3, broadcasts.Length);
        Assert.All(broadcasts, b => Assert.Contains("Foxtel · Fox Sports 506", b.Channels));
        Assert.Equal(DateTimeOffset.Parse("2026-11-06T02:45:00Z"), broadcasts[0].Start);
        Assert.Empty(WeekendParser.SupercarsBroadcasts(Fixture("tv.html"), weekend with { StartDate = "2026-11-26" }));
    }

    [Fact]
    public async Task Source_refreshes_are_shared_and_do_not_promote_supports_to_confirmed()
    {
        var handler = new Handler(_ => Fixture("brazil.html"));
        var service = new WeekendService(new Factory(handler), NullLogger<WeekendService>.Instance);
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => service.Weekend("f1", "2026-11-06")));
        Assert.Equal(1, handler.Calls);
        Assert.All(results, result =>
        {
            Assert.NotNull(result);
            Assert.Null(result.Note);
            Assert.Equal(15, result.Sessions.Length);
            Assert.All(result.Sessions.Where(s => !s.Main), s => Assert.Null(s.Coverage));
            var practice = Assert.Single(result.Sessions, s => s.Name == "Practice 1");
            Assert.Equal(DateTimeOffset.Parse("2026-11-06T15:00:00Z"), practice.Coverage!.Start);
        });
        Assert.Null(await service.Weekend("v8", "../../invalid"));
        Assert.Equal(1, handler.Calls);
    }

    [Fact]
    public async Task Offline_refresh_retains_the_snapshot_and_its_original_date_with_an_explicit_notice()
    {
        var handler = new Handler(_ => throw new HttpRequestException("Offline"));
        var service = new WeekendService(new Factory(handler), NullLogger<WeekendService>.Instance);
        var before = DateTimeOffset.UtcNow;
        var first = await service.Weekend("v8", "2026-11-06");
        var second = await service.Weekend("v8", "2026-11-06");
        Assert.NotNull(first);
        Assert.Equal(first, second);
        Assert.Equal(1, handler.Calls);
        Assert.True(first.CheckedAt <= before);
        Assert.Contains("last checked", first.Note);
        Assert.Equal(30, first.Sessions.Length);
    }

    [Fact]
    public void Published_standings_preserve_final_points_positions_ties_and_zero_scores()
    {
        var drivers = WeekendParser.SupercarsDrivers(Fixture("drivers.html"));
        var teams = WeekendParser.SupercarsTeams(Fixture("teams.html"));
        Assert.Equal(33, drivers.Length);
        Assert.Equal(new Standing(1, "Matthew Payne", 4150, "Penrite Racing (19 & 26)"), drivers[0]);
        Assert.Equal(17, teams.Length);
        Assert.Equal(4864, teams[0].Points); // Teams points are published separately: don't sum Finals driver points.
        var f1 = WeekendParser.F1Standings(Fixture("f1-drivers.json"), false);
        Assert.Equal("19", f1.Round);
        Assert.Equal(380, f1.Rows[0].Points);
        Assert.Contains(f1.Rows, r => r.Name == "Valtteri Bottas" && r.Points == 0);
    }

    [Fact]
    public async Task Different_F1_standings_rounds_do_not_publish_a_mixed_championship_snapshot()
    {
        var handler = new Handler(url => url.Contains("constructor")
            ? Fixture("f1-teams.json").Replace("\"round\": \"19\"", "\"round\": \"18\"") : Fixture("f1-drivers.json"));
        var service = new WeekendService(new Factory(handler), NullLogger<WeekendService>.Instance);
        var result = await service.Standings("f1", 2026);
        Assert.NotNull(result);
        Assert.Contains("last checked", result.Note);
        Assert.Equal("After round 19", result.AsOf);
    }

    [Fact]
    public async Task Changed_or_missing_daily_listings_update_session_cards_and_preserve_support_confirmation()
    {
        async Task<WeekendData> Load(string tv)
        {
            var handler = new Handler(url => url.Contains("tv-schedule") ? tv : Fixture("sandown.html"));
            return (await new WeekendService(new Factory(handler), NullLogger<WeekendService>.Instance).Weekend("v8", "2026-11-06"))!;
        }
        var changed = await Load(Fixture("tv.html").Replace("13:45", "14:00").Replace("Channel 506", "Channel 507"));
        var practice = Assert.Single(changed.Sessions, s => s.Name == "Practice 1" && s.Main);
        Assert.Equal(DateTimeOffset.Parse("2026-11-06T03:00:00Z"), practice.Coverage!.Start);
        Assert.Contains("Foxtel · Fox Sports 507", practice.Coverage.Channels);
        Assert.Equal("day", practice.Coverage.Scope);
        Assert.Equal("confirmed", Assert.Single(changed.Sessions, s => s.Category == "Porsche Sprint Challenge Australia" && s.Name == "Race 1").Coverage!.Status);

        var withdrawn = await Load("<script>self.__next_f.push([1,\"8:{\\\"scheduleCollection\\\":{\\\"items\\\":[]}}\\n\"])</script>");
        Assert.Empty(withdrawn.Broadcasts);
        Assert.Contains("no listings", withdrawn.Note);
        Assert.Null(Assert.Single(withdrawn.Sessions, s => s.Name == "Practice 1" && s.Main).Coverage!.Start);

        var unchanged = await Load(Fixture("tv.html"));
        Assert.Equal(DateTimeOffset.Parse("2026-11-06T03:25:00Z"), Assert.Single(unchanged.Sessions, s => s.Name == "Practice 1" && s.Main).Coverage!.Start);
    }

    [Fact]
    public void Remaining_points_include_both_cars_sprints_and_the_correct_Supercars_final_round_scale()
    {
        var f1 = WeekendParser.F1Remaining(Fixture("f1-calendar.json"), Fixture("f1-winners.json"), "19");
        Assert.Equal((100m, 172m, 4, 0), (f1.Drivers, f1.Teams, f1.Races, f1.Sprints));
        var calendar = System.Text.Json.Nodes.JsonNode.Parse(Fixture("f1-calendar.json"))!;
        calendar["MRData"]!["RaceTable"]!["Races"]!.AsArray().Last()!["Sprint"] = new System.Text.Json.Nodes.JsonObject();
        var sprint = WeekendParser.F1Remaining(calendar.ToJsonString(), Fixture("f1-winners.json"), "19");
        Assert.Equal((108m, 187m), (sprint.Drivers, sprint.Teams));
        calendar["MRData"]!["RaceTable"]!["Races"] = new System.Text.Json.Nodes.JsonArray();
        Assert.Throws<FormatException>(() => WeekendParser.F1Remaining(calendar.ToJsonString(), Fixture("f1-winners.json"), "19"));
        var drivers = WeekendParser.SupercarsDrivers(Fixture("drivers.html"));
        var supercars = WeekendParser.SupercarsRemaining(32, drivers);
        Assert.Equal((600m, 1152m, 5, true), (supercars.Drivers, supercars.Teams, supercars.Races, supercars.DriverResetsPending));
        Assert.Equal(300m, WeekendParser.SupercarsRemaining(34, drivers).Drivers);
        var scores = WeekendParser.SupercarsRacePoints(Fixture("drivers.html"));
        Assert.Equal(150, scores[32]["88"]);
        Assert.Equal(32, WeekendParser.SupercarsCompletedRace(Fixture("drivers.html")));
    }

    sealed class Factory(Handler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    sealed class Handler(Func<string, string> respond) : HttpMessageHandler
    {
        public int Calls;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            Interlocked.Increment(ref Calls);
            await Task.Delay(10, token);
            return new(HttpStatusCode.OK) { Content = new StringContent(respond(request.RequestUri!.AbsoluteUri)) };
        }
    }
}

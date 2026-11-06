using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp.Dom;
using AngleSharp.Html.Parser;

namespace SupercarsTiming.Server.Weekend;

/// <summary>Reads published timetable/standings data; it never infers TV coverage from a track time.</summary>
public static partial class WeekendParser
{
    // Supercars sends Contentful records in Next's JSON string chunks. Decode JSON, never execute page scripts.
    public static JsonElement Property(string html, string name)
    {
        foreach (Match match in FlightChunk().Matches(html))
        {
            var text = JsonSerializer.Deserialize<string>(match.Groups[1].Value)!;
            var marker = $"\"{name}\":";
            var index = text.IndexOf(marker, StringComparison.Ordinal);
            if (index < 0) continue;
            var reader = new Utf8JsonReader(System.Text.Encoding.UTF8.GetBytes(text[(index + marker.Length)..]));
            using var value = JsonDocument.ParseValue(ref reader);
            return value.RootElement.Clone();
        }
        throw new FormatException($"The published page has no {name} data.");
    }

    public static WeekendSession[] SupercarsSessions(string html, string startDate, string utcOffset)
    {
        using var document = new HtmlParser().ParseDocument(html);
        if (document.QuerySelector("table") is not null) return SupercarsArticleSessions(document, startDate, utcOffset);
        var sessions = Property(html, "raceSessionsCollection").GetProperty("items").EnumerateArray()
            .Where(s => Text(s, "type") is "Practice" or "Qualifying" or "Race")
            .Select(s =>
            {
                var category = s.GetProperty("series").GetProperty("name").GetString()!;
                return new WeekendSession(Text(s, "name"), category, At(Text(s, "startDate")),
                    At(Text(s, "endDate")), category == "Repco Supercars Championship");
            }).OrderBy(s => s.Start).ToArray();
        if (sessions.Length == 0 || !sessions.Any(s => s.Start.ToString("yyyy-MM-dd") == startDate))
            throw new FormatException("The published track timetable doesn't match this weekend.");
        return sessions;
    }

    // Supercars' updated Adelaide article carries a newer, corrected timetable than the event-page CMS records.
    static WeekendSession[] SupercarsArticleSessions(IDocument document, string startDate, string utcOffset)
    {
        var sessions = new List<WeekendSession>();
        DateTime? day = null;
        foreach (var element in document.QuerySelectorAll("p,table"))
        {
            if (element.LocalName != "table")
            {
                if (DateTime.TryParseExact(element.TextContent.Trim() + " " + startDate[..4], "dddd MMMM d yyyy",
                    CultureInfo.GetCultureInfo("en-GB"), DateTimeStyles.None, out var date)) day = date;
                continue;
            }
            if (day is null) continue;
            foreach (var row in element.QuerySelectorAll("tr"))
            {
                var cells = row.QuerySelectorAll("td").Select(c => c.TextContent.Trim()).ToArray();
                if (cells.Length != 5 || !ArticleActivity().IsMatch(cells[4])) continue;
                if (!TimeOnly.TryParse(cells[0], CultureInfo.InvariantCulture, out var start)) continue;
                var at = At($"{day:yyyy-MM-dd}T{start:HH:mm}:00{utcOffset}");
                // "1 lap after HH:mm" is a time limit, not a promised finish instant.
                var end = TimeOnly.TryParse(cells[1], CultureInfo.InvariantCulture, out var finish)
                    ? At($"{day:yyyy-MM-dd}T{finish:HH:mm}:00{utcOffset}") : (DateTimeOffset?)null;
                var main = cells[2] == "Supercars";
                sessions.Add(new(cells[4], main ? "Repco Supercars Championship" : cells[2], at, end, main));
            }
        }
        if (!sessions.Any(s => s.Main && s.Start.ToString("yyyy-MM-dd") == startDate))
            throw new FormatException("The published article timetable doesn't match this weekend.");
        return sessions.OrderBy(s => s.Start).ToArray();
    }

    public static Broadcast[] SupercarsBroadcasts(string html, WeekendData weekend)
    {
        var collection = Property(html, "scheduleCollection");
        return collection.GetProperty("items").EnumerateArray()
            .Where(s => Text(s, "title").Contains("Foxtel", StringComparison.OrdinalIgnoreCase))
            .Select(s =>
            {
                var channel = Channel().Match(Text(s, "summary"));
                return new Broadcast(weekend.EventName + " · live coverage", At(Text(s, "dateAndTime")), null,
                    ["Kayo Sports", channel.Success ? "Foxtel · Fox Sports " + channel.Groups[1].Value : "Foxtel"],
                    "https://www.supercars.com/tv-schedule", DateTimeOffset.UtcNow, "day");
            })
            .Where(b => b.Start.ToOffset(TimeSpan.Parse(weekend.UtcOffset.TrimStart('+'), CultureInfo.InvariantCulture))
                .ToString("yyyy-MM-dd").CompareTo(weekend.StartDate) >= 0
                && b.Start < DateTimeOffset.Parse(weekend.StartDate + "T00:00:00" + weekend.UtcOffset).AddDays(5))
            .ToArray();
    }

    public static WeekendSession[] F1Sessions(string html, WeekendData weekend)
    {
        using var document = new HtmlParser().ParseDocument(html);
        var sessions = new List<WeekendSession>();
        foreach (var table in document.QuerySelectorAll("table"))
        {
            var rows = table.QuerySelectorAll("tr");
            var heading = rows.FirstOrDefault()?.QuerySelector("th,td")?.TextContent.Trim();
            if (!DateTime.TryParse(heading + " " + weekend.StartDate[..4], CultureInfo.GetCultureInfo("en-GB"), DateTimeStyles.None, out var date)) continue;
            foreach (var row in rows.Skip(1))
            {
                var cells = row.QuerySelectorAll("td").Select(c => c.TextContent.Trim()).ToArray();
                if (cells.Length != 3) continue;
                var main = cells[0].Equals("FORMULA 1", StringComparison.Ordinal);
                if (!main && !RaceActivity().IsMatch(cells[1])) continue;
                if (main && !RaceActivity().IsMatch(cells[1])) continue;
                var times = TimeRange().Match(cells[2]);
                if (!times.Success) continue;
                var start = At($"{date:yyyy-MM-dd}T{times.Groups[1].Value}:00{weekend.UtcOffset}");
                var end = At($"{date:yyyy-MM-dd}T{times.Groups[2].Value}:00{weekend.UtcOffset}");
                if (end < start) end = end.AddDays(1);
                sessions.Add(new(main ? MainSessionName(cells[1]) : cells[1], main ? "Formula 1" : cells[0], start, end, main));
            }
        }
        var firstDay = DateTime.Parse(weekend.StartDate, CultureInfo.InvariantCulture);
        if (!sessions.Any(s => s.Main && s.Start.Date == firstDay)
            || sessions.Any(s => s.Main && (s.Start.Date < firstDay || s.Start.Date > firstDay.AddDays(3))))
            throw new FormatException("The F1 timetable does not match this weekend.");
        return sessions.OrderBy(s => s.Start).ToArray();
    }

    public static string? F1TimetableUrl(string html)
    {
        using var document = new HtmlParser().ParseDocument(html);
        var href = document.QuerySelectorAll("a[href]").FirstOrDefault(a =>
            a.TextContent.Contains("full timetable", StringComparison.OrdinalIgnoreCase))?.GetAttribute("href");
        if (href is null) return null;
        var url = new Uri(new Uri("https://www.formula1.com"), href);
        return url.Scheme == "https" && url.Host == "www.formula1.com" ? url.AbsoluteUri : null;
    }

    public static Standing[] SupercarsDrivers(string html)
    {
        var stats = Property(html, "driverStats").EnumerateArray().ToDictionary(s => Text(s, "driverCode"));
        return Property(html, "seasonDrivers").EnumerateArray()
            .Where(d => stats.ContainsKey(Text(d, "driverCode")) && d.TryGetProperty("position", out var p) && p.ValueKind == JsonValueKind.Number)
            .Select(d =>
            {
                var stat = stats[Text(d, "driverCode")];
                return new Standing(d.GetProperty("position").GetInt32(), Text(stat, "driverName"),
                    stat.GetProperty("totalSeasonPoints").GetDecimal(), Text(stat, "teamName"));
            }).OrderBy(d => d.Position).ToArray();
    }

    public static Standing[] SupercarsTeams(string html) => Property(html, "teams").EnumerateArray()
        .Select(t => t.GetProperty("team"))
        .Select(t => new Standing(t.GetProperty("position").GetInt32(), Text(t, "name"), t.GetProperty("points").GetDecimal(), Text(t, "description")))
        .OrderBy(t => t.Position > 0 ? t.Position : int.MaxValue).ToArray();

    public static (Standing[] Rows, string Round) F1Standings(string json, bool teams)
    {
        using var document = JsonDocument.Parse(json);
        var table = document.RootElement.GetProperty("MRData").GetProperty("StandingsTable");
        var list = table.GetProperty("StandingsLists")[0];
        var rows = list.GetProperty(teams ? "ConstructorStandings" : "DriverStandings").EnumerateArray().Select(s =>
        {
            var name = teams ? Text(s.GetProperty("Constructor"), "name")
                : Text(s.GetProperty("Driver"), "givenName") + " " + Text(s.GetProperty("Driver"), "familyName");
            return new Standing(int.Parse(Text(s, "position"), CultureInfo.InvariantCulture), name,
                decimal.Parse(Text(s, "points"), CultureInfo.InvariantCulture), teams ? null
                    : string.Join(" / ", s.GetProperty("Constructors").EnumerateArray().Select(c => Text(c, "name"))));
        }).ToArray();
        return (rows, Text(list, "round"));
    }

    public static Dictionary<int, string[]> SupercarsResults(string html)
    {
        var results = new Dictionary<int, string[]>();
        foreach (var result in Property(html, "documentResult").EnumerateArray().OrderBy(r => Text(r, "dateCreated")))
        {
            if (Text(result, "raceType") != "RACE" || Text(result, "seriesCode") != "SG3"
                || !int.TryParse(Text(result, "meetingRoundCode").TrimStart('R'), out var race)) continue;
            var competitors = result.GetProperty("data").GetProperty("V8Supercars").GetProperty("Series")[0]
                .GetProperty("Season")[0].GetProperty("Meeting")[0].GetProperty("Event")[0].GetProperty("Competitor");
            var order = competitors.EnumerateArray().Select(c => (Row: c,
                Position: int.TryParse(Text(c, "Position"), out var p) ? p : 0)).Where(c => c.Position > 0)
                .OrderBy(c => c.Position).Select(c => Text(c.Row, "Number")).ToArray();
            if (order.Length > 0) results[race] = order;
        }
        return results;
    }

    public static int SupercarsCompletedRace(string html) => Property(html, "seasonDrivers").EnumerateArray()
        .Where(d => d.TryGetProperty("round", out _)).SelectMany(d => d.GetProperty("round").EnumerateArray())
        .Where(r => decimal.TryParse(Text(r, "Points"), CultureInfo.InvariantCulture, out var points) && points > 0)
        .Select(r => int.Parse(Text(r, "id").TrimStart('R'), CultureInfo.InvariantCulture)).DefaultIfEmpty(0).Max();

    public static Dictionary<int, Dictionary<string, decimal>> SupercarsRacePoints(string html)
    {
        var result = new Dictionary<int, Dictionary<string, decimal>>();
        var cars = Property(html, "driverStats").EnumerateArray().ToDictionary(d => Text(d, "driverCode"), d => Text(d, "driverNumber"));
        foreach (var driver in Property(html, "seasonDrivers").EnumerateArray())
        {
            if (!cars.TryGetValue(Text(driver, "driverCode"), out var car) || !driver.TryGetProperty("round", out var rounds)) continue;
            foreach (var race in rounds.EnumerateArray())
            {
                if (!int.TryParse(Text(race, "id").TrimStart('R'), out var number) || number is < 31 or > 34
                    || !decimal.TryParse(Text(race, "Points"), CultureInfo.InvariantCulture, out var points)) continue;
                if (!result.TryGetValue(number, out var scores)) result[number] = scores = new();
                // Co-drivers may retain the same car number in their profile, with blank/zero sprint-round awards.
                if (points != 0 || !scores.ContainsKey(car)) scores[car] = points;
            }
        }
        return result;
    }

    public static RemainingPoints SupercarsRemaining(int completedRace, Standing[] drivers)
    {
        if (completedRace is < 30 or > 37) throw new FormatException("Unverified remaining Supercars points schedule.");
        // 2026 Operations Manual, Schedule D1: R31–34=150/138, R35=50/46, R36–37=125/115.
        // https://assets.ctfassets.net/xd502h20t7lh/1MXxUX3JNU7sXo0nxCLvKT/964f66c85258b5e5e730b55287ea7387/2026_Points_Structure.pdf
        var scores = Enumerable.Range(completedRace + 1, 37 - completedRace)
            .Select(r => r <= 34 ? (150, 138) : r == 35 ? (50, 46) : (125, 115)).ToArray();
        var resetPending = completedRace < 34 || (completedRace == 34 && drivers.Max(d => d.Points) < 5000);
        return new(scores.Sum(s => s.Item1), scores.Sum(s => s.Item1 + s.Item2), scores.Length, 0, resetPending,
            "https://www.supercars.com/rules-and-regulations");
    }

    public static RemainingPoints F1Remaining(string calendar, string winners, string standingsRound)
    {
        using var results = JsonDocument.Parse(winners);
        var completed = results.RootElement.GetProperty("MRData").GetProperty("RaceTable").GetProperty("Races").EnumerateArray()
            .Select(r => int.Parse(Text(r, "round"), CultureInfo.InvariantCulture)).DefaultIfEmpty(0).Max();
        if (completed > int.Parse(standingsRound, CultureInfo.InvariantCulture)) throw new FormatException("Standings lag race results.");
        using var schedule = JsonDocument.Parse(calendar);
        var mrData = schedule.RootElement.GetProperty("MRData");
        var allRaces = mrData.GetProperty("RaceTable").GetProperty("Races");
        if (allRaces.GetArrayLength() == 0 || allRaces.GetArrayLength() != int.Parse(Text(mrData, "total"), CultureInfo.InvariantCulture)
            || mrData.GetProperty("RaceTable").GetProperty("season").GetString() != results.RootElement.GetProperty("MRData").GetProperty("RaceTable").GetProperty("season").GetString()
            || completed > 0 && !allRaces.EnumerateArray().Any(r => int.Parse(Text(r, "round"), CultureInfo.InvariantCulture) == completed))
            throw new FormatException("Incomplete or inconsistent championship calendar.");
        var races = allRaces.EnumerateArray()
            .Where(r => int.Parse(Text(r, "round"), CultureInfo.InvariantCulture) > completed).ToArray();
        var sprints = races.Count(r => r.TryGetProperty("Sprint", out _));
        // FIA 2026 Section A, A2.2: GP=25/18; Sprint=8/7. Both nominated cars score for constructors.
        // Counting an entire unfinished round is conservative when Sprint points have already been published.
        return new(races.Length * 25 + sprints * 8, races.Length * 43 + sprints * 15, races.Length, sprints, false,
            "https://www.fia.com/system/files/documents/fia_2026_f1_regulations_-_section_a_general_regulatory_provisions_-_iss_01_-_2025-12-10_0.pdf");
    }

    static string Text(JsonElement value, string name) => value.GetProperty(name).GetString() ?? "";
    static DateTimeOffset At(string value) => DateTimeOffset.Parse(value, CultureInfo.InvariantCulture);
    static string MainSessionName(string name) => name switch
    {
        "FIRST PRACTICE SESSION" => "Practice 1", "SECOND PRACTICE SESSION" => "Practice 2",
        "THIRD PRACTICE SESSION" => "Practice 3", "QUALIFYING SESSION" => "Qualifying",
        _ when name.StartsWith("GRAND PRIX", StringComparison.Ordinal) => "Race", _ => name
    };

    [GeneratedRegex("self\\.__next_f\\.push\\(\\[1,(\"(?:\\\\.|[^\"\\\\])*\")\\]\\)")]
    private static partial Regex FlightChunk();
    [GeneratedRegex(@"(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})")]
    private static partial Regex TimeRange();
    [GeneratedRegex(@"practice|qualifying|race|sprint|grand prix", RegexOptions.IgnoreCase)]
    private static partial Regex RaceActivity();
    [GeneratedRegex(@"^(practice|qualifying|Q[12]\b|top ten shootout|race\s+\d)", RegexOptions.IgnoreCase)]
    private static partial Regex ArticleActivity();
    [GeneratedRegex(@"Channel\s+(\d+)", RegexOptions.IgnoreCase)]
    private static partial Regex Channel();
}

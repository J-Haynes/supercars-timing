using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace SupercarsTiming.Natsoft;

/// <summary>
/// Readable addresses for recorded sessions, for the web app's results and replay URLs: "2026/gold-coast-500/race-32"
/// (year, round, session) rather than the id ("V8SUPER_20261025_151501-0", the recording file and the line the session
/// starts at, which changes if the recordings are ever split or merged differently). Support categories get their
/// series as a level: "2026/gold-coast-500/aussie-racing-cars-series/race-4". F1 works the same way
/// ("2026/united-states-grand-prix/race"). Slugs only use a-z, 0-9, '-' and '/': no dots, which would make the
/// web server treat the path as a file.
/// <para>
/// A published link must keep working, so a slug must never change once its session is recorded. Only add a
/// sponsor to <see cref="Sponsors"/> for rounds that haven't been recorded yet.
/// </para>
/// </summary>
public static partial class SessionSlug
{
    /// <summary>
    /// Title sponsors taken off round and series names ("Boost Mobile Gold Coast 500" -> "gold-coast-500"): they change
    /// from year to year, the place doesn't. Matched at the start of the name, after the year.
    /// </summary>
    static readonly string[] Sponsors =
    [
        "Boost Mobile", "Repco", "Penrite Oil", "bp",                               // 2025-26 Supercars rounds
        "Battery World", "Tyrepower", "Dunlop", "Porsche Equity-One", "TOYOTA GAZOO Racing", // support categories
    ];

    /// <summary>
    /// A slug for every session, by id. Two sessions can share a name (Race 31 at the Gold Coast was recorded as a
    /// 4-minute pre-start piece, then the race): the one with the most messages gets the plain slug, the others "-2",
    /// "-3"... in the order they started.
    /// </summary>
    public static Dictionary<string, string> Assign(IEnumerable<RecordedSession> sessions)
    {
        var slugs = new Dictionary<string, string>();
        foreach (var group in sessions.GroupBy(s => For(s.Meeting, s.Name, s.Start)))
        {
            var primary = group.OrderByDescending(s => s.Messages).ThenBy(s => s.Start).First();
            slugs[primary.Id] = group.Key;
            int n = 2;
            foreach (var other in group.Where(s => s != primary).OrderBy(s => s.Start)) slugs[other.Id] = $"{group.Key}-{n++}";
        }
        return slugs;
    }

    /// <summary>
    /// The plain slug for one session (before telling apart sessions with the same name). <paramref name="meeting"/>
    /// is "2026 Boost Mobile Gold Coast 500"; <paramref name="name"/> is Natsoft's "2026 Repco Supercars Championship -
    /// Race 32" or F1's "Race". The year comes from the meeting, else from <paramref name="start"/>.
    /// </summary>
    public static string For(string meeting, string name, DateTimeOffset start)
    {
        var year = LeadingYear().Match(meeting) is { Success: true } m ? m.Groups[1].Value : start.Year.ToString(CultureInfo.InvariantCulture);
        var (series, session) = Split(name);
        var parts = new List<string> { year, Slugify(WithoutSponsor(meeting)) };
        // The championship itself needs no level; support categories (and anything else) do.
        if (series.Length > 0 && !SessionIndex.IsSupercarsChampionship(series)) parts.Add(Slugify(WithoutSponsor(series)));
        parts.Add(Slugify(SessionWords(session)));
        return string.Join('/', parts.Where(p => p.Length > 0));
    }

    /// <summary>"2026 Repco Supercars Championship -Top Ten Shoot Out Race 32" -> ("Repco Supercars Championship",
    /// "Top Ten Shoot Out Race 32"): Natsoft doesn't always space the dash. F1's names are only the session.</summary>
    static (string Series, string Session) Split(string name)
    {
        var parts = SeriesDash().Split(LeadingYear().Replace(name, ""), 2);
        return parts.Length == 2 ? (parts[0].Trim(), parts[1].Trim()) : ("", parts[0].Trim());
    }

    /// <summary>Session names, made consistent: Natsoft writes both "Shootout" and "Shoot Out"; "(All Drivers)" and
    /// "(Co-Drivers)" on Bathurst practice are left off ("practice-6").</summary>
    static string SessionWords(string session) =>
        Parenthetical().Replace(ShootOut().Replace(session, "Shootout"), "");

    static string WithoutSponsor(string name)
    {
        name = LeadingYear().Replace(name, "");
        foreach (var sponsor in Sponsors)
            if (name.StartsWith(sponsor + " ", StringComparison.OrdinalIgnoreCase)) return name[(sponsor.Length + 1)..];
        return name;
    }

    /// <summary>"São Paulo Grand Prix" -> "sao-paulo-grand-prix": lower case, accents off, anything else a dash.</summary>
    static string Slugify(string text)
    {
        var plain = new StringBuilder();
        foreach (var c in text.Normalize(NormalizationForm.FormD))
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark) plain.Append(c);
        return NotSlug().Replace(plain.ToString().ToLowerInvariant(), "-").Trim('-');
    }

    [GeneratedRegex(@"^\s*(\d{4})\s+")] private static partial Regex LeadingYear();
    [GeneratedRegex(@"\s+-\s*")] private static partial Regex SeriesDash();
    [GeneratedRegex(@"shoot\s*out", RegexOptions.IgnoreCase)] private static partial Regex ShootOut();
    [GeneratedRegex(@"\s*\([^)]*\)")] private static partial Regex Parenthetical();
    [GeneratedRegex(@"[^a-z0-9]+")] private static partial Regex NotSlug();
}

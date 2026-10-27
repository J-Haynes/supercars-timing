namespace SupercarsTiming.Natsoft.Tests;

/// <summary>Readable session addresses (SessionSlug), from the names Natsoft and F1 really send.</summary>
public class SessionSlugTests
{
    static readonly DateTimeOffset Oct2026 = new(2026, 10, 25, 4, 15, 0, TimeSpan.Zero);

    [Theory]
    [InlineData("2026 Boost Mobile Gold Coast 500", "2026 Repco Supercars Championship - Race 32", "2026/gold-coast-500/race-32")]
    // Natsoft leaves out the space after the dash on the Shootout, and spells it two ways.
    [InlineData("2026 Boost Mobile Gold Coast 500", "2026 Repco Supercars Championship -Top Ten Shoot Out Race 32", "2026/gold-coast-500/top-ten-shootout-race-32")]
    [InlineData("2026 Repco Bathurst 1000", "2026 Repco Supercars Championship - Top Ten Shootout Race 30", "2026/bathurst-1000/top-ten-shootout-race-30")]
    [InlineData("2026 Repco Bathurst 1000", "2026 Repco Supercars Championship - Practice 6 (All Drivers)", "2026/bathurst-1000/practice-6")]
    [InlineData("2025 Boost Mobile Gold Coast 500", "2025 Repco Supercars Championship - Race 29", "2025/gold-coast-500/race-29")]
    // Support categories get their series as a level.
    [InlineData("2026 Boost Mobile Gold Coast 500", "2026 Battery World Aussie Racing Cars Series - Race 4", "2026/gold-coast-500/aussie-racing-cars-series/race-4")]
    [InlineData("2026 Repco Bathurst 1000", "2026 TOYOTA GAZOO Racing Australia GR CUP - Race 3", "2026/bathurst-1000/australia-gr-cup/race-3")]
    // F1: the session name alone; accents off.
    [InlineData("2026 United States Grand Prix", "Race", "2026/united-states-grand-prix/race")]
    [InlineData("2024 São Paulo Grand Prix", "Race", "2024/sao-paulo-grand-prix/race")]
    public void Slug_from_meeting_and_session_name(string meeting, string name, string slug) =>
        Assert.Equal(slug, SessionSlug.For(meeting, name, Oct2026));

    [Fact]
    public void Without_a_year_in_the_meeting_the_start_gives_it() =>
        Assert.Equal("2026/somewhere/race", SessionSlug.For("Somewhere", "Race", Oct2026));

    [Fact]
    public void Sessions_with_the_same_name_the_longest_gets_the_plain_slug()
    {
        // Race 31 at the Gold Coast: a 4-minute pre-start recording at 15:45, then the race from 16:09.
        RecordedSession Race31(string id, int hour, int minute, int messages) => new(id, "2026 Boost Mobile Gold Coast 500",
            "2026 Repco Supercars Championship - Race 31", "Race", "", "", new(2026, 10, 24, hour, minute, 0, TimeSpan.FromHours(10)),
            new(2026, 10, 24, hour, minute, 0, TimeSpan.FromHours(10)), messages, []);
        var slugs = SessionSlug.Assign([Race31("piece", 15, 45, 120), Race31("race", 16, 9, 40_000)]);
        Assert.Equal("2026/gold-coast-500/race-31", slugs["race"]);
        Assert.Equal("2026/gold-coast-500/race-31-2", slugs["piece"]);
    }

    [RecordingFact("Race 30")]
    public void Every_recorded_session_has_its_own_slug_made_of_url_safe_characters()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && dir.GetFiles("SupercarsTiming.slnx").Length == 0) dir = dir.Parent;
        var sessions = SessionIndex.Scan(Directory.GetFiles(Path.Combine(dir!.FullName, "data", "recordings"), "*.jsonl"));
        var slugs = SessionSlug.Assign(sessions);
        Assert.Equal(sessions.Count, slugs.Values.Distinct().Count());
        Assert.All(slugs.Values, s => Assert.Matches("^[a-z0-9/-]+$", s));
    }
}

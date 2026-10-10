using System.Text.Json;
using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Natsoft.Tests;

public class SessionIndexTests : IDisposable
{
    readonly string _dir = Directory.CreateTempSubdirectory("natsoft-sessions").FullName;
    static readonly DateTimeOffset T0 = new(2026, 10, 10, 0, 0, 0, TimeSpan.Zero);

    static string Line(DateTimeOffset t, string xml) =>
        JsonSerializer.Serialize(new { t, kind = "msg", raw = xml, xml });

    static string New(string session) =>
        $"""<New T="1"><M D="2026 Repco Bathurst 1000" /><T C="MOUN" N="MOUNT PANORAMA - BATHURST" /><E C="X" D="{session}" Y="Practice" /></New>""";

    string Write(string name, IEnumerable<string> lines)
    {
        var path = Path.Combine(_dir, name);
        File.WriteAllLines(path, lines);
        return path;
    }

    static IEnumerable<string> Session(DateTimeOffset start, string name, int messages)
    {
        yield return Line(start, New(name));
        for (int i = 1; i < messages; i++) yield return Line(start.AddSeconds(i), $"""<C T="{i}" Y="T" C="10" E="{i}" />""");
    }

    [Fact]
    public void Splits_sessions_at_snapshots_and_not_found()
    {
        var file = Write("a.jsonl", Session(T0, "Practice 5", 60)
            .Append(Line(T0.AddSeconds(61), "<NotFound />"))
            .Concat(Session(T0.AddHours(1), "Race 3", 80)));

        var sessions = SessionIndex.Scan([file]);
        Assert.Equal(["Race 3", "Practice 5"], sessions.Select(s => s.Name));   // newest first
        var p5 = sessions[1];
        Assert.Equal(60, p5.Messages);
        Assert.Equal(59, p5.DurationSeconds, 3);
        Assert.Equal("2026 Repco Bathurst 1000", p5.Meeting);
        Assert.Equal("MOUN", p5.TrackCode);
        Assert.Equal(60, SessionIndex.Read(p5).Count());
    }

    [Fact]
    public void Merges_a_session_split_across_files_by_a_restart()
    {
        var a = Write("a.jsonl", Session(T0, "Practice 6", 60));
        var b = Write("b.jsonl", Session(T0.AddMinutes(2), "Practice 6", 60));
        var session = Assert.Single(SessionIndex.Scan([a, b]));
        Assert.Equal(2, session.Parts.Count);
        Assert.Equal(120, session.Messages);
        Assert.Equal(120, SessionIndex.Read(session).Count());
    }

    [Fact]
    public void Ignores_short_fragments()
    {
        var file = Write("a.jsonl", Session(T0, "Practice 6", 10));
        Assert.Empty(SessionIndex.Scan([file]));
    }

    [Fact]
    public void Results_are_the_final_state()
    {
        var file = Write("a.jsonl", Session(T0, "2026 Repco Supercars Championship - Practice 6", 60));
        var results = SessionIndex.Results(Assert.Single(SessionIndex.Scan([file])));
        Assert.Equal("MOUNT PANORAMA - BATHURST", results.Session.Track);
        Assert.Equal(59, results.Session.ClockElapsed);     // from the last clock message
    }

    [Theory]
    [InlineData("2026 Repco Supercars Championship - Top Ten Shootout Race 30", true)]
    [InlineData("2026 Dunlop Super 2 Series - Race 2", false)]
    [InlineData("2026 Touring Car Masters - Race 2", false)]
    public void Supercars_filter(string name, bool expected) => Assert.Equal(expected, SessionIndex.IsSupercarsChampionship(name));

    public void Dispose() => Directory.Delete(_dir, true);
}

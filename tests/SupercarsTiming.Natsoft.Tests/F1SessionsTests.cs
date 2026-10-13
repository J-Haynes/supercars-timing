using System.Text.Json.Nodes;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using SupercarsTiming.Server.F1;
using SupercarsTiming.Server.Feed;

namespace SupercarsTiming.Natsoft.Tests;

/// <summary>Finding F1 sessions in our recordings (F1Sessions.cs), with the shapes seen at the 2026 Singapore GP.</summary>
public class F1SessionsTests : IDisposable
{
    readonly string _root = Path.Combine(Path.GetTempPath(), $"f1sessions-{Guid.NewGuid():N}");
    string Dir => Path.Combine(_root, "data", "recordings", "f1");

    public F1SessionsTests()
    {
        Directory.CreateDirectory(Dir);
        File.WriteAllText(Path.Combine(_root, "SupercarsTiming.slnx"), ""); // RepoPaths finds the root by this
    }

    public void Dispose() => Directory.Delete(_root, true);

    static string Line(DateTimeOffset utc, string topic, string json, bool snapshot = false) => new JsonObject
    {
        ["utc"] = utc.ToString("O"), ["topic"] = topic, ["snapshot"] = snapshot, ["data"] = JsonNode.Parse(json),
    }.ToJsonString();

    static string Info(int key, string name) =>
        $$$"""{"Meeting":{"Name":"Singapore Grand Prix","Location":"Marina Bay","Circuit":{"Key":61}},"Key":{{{key}}},"Type":"{{{name}}}","Name":"{{{name}}}","StartDate":"2026-10-11T20:00:00","GmtOffset":"08:00:00"}""";

    static IEnumerable<string> Timing(DateTimeOffset from, int n) =>
        Enumerable.Range(0, n).Select(i => Line(from.AddSeconds(i), "TimingData", """{"Lines":{"3":{"NumberOfLaps":1}}}"""));

    void Write(string name, IEnumerable<string> lines) => File.WriteAllLines(Path.Combine(Dir, name), lines);

    F1SessionCatalog Catalog() => new(new RepoPaths(new Env(_root)), Options.Create(new F1Options()));

    [Fact]
    public void Merges_a_session_across_a_restart_and_leaves_out_the_hubs_stale_snapshot()
    {
        var t = new DateTimeOffset(2026, 10, 11, 11, 0, 0, TimeSpan.Zero);
        // First file: the hub's snapshot of last night's qualifying, then the race starting (live timing).
        Write("F1_20261011_110000.jsonl", new[] { Line(t, "SessionInfo", Info(11384, "Qualifying"), snapshot: true) }
            .Append(Line(t.AddMinutes(5), "SessionInfo", Info(11388, "Race")))
            .Concat(Timing(t.AddMinutes(6), 60)));
        // Second file: the server restarted mid-race; it starts with the hub's snapshot of the race, then more timing.
        Write("F1_20261011_113000.jsonl", new[] { Line(t.AddMinutes(30), "TimingData", """{"Lines":{}}""", snapshot: true),
                Line(t.AddMinutes(30), "SessionInfo", Info(11388, "Race"), snapshot: true) }
            .Concat(Timing(t.AddMinutes(31), 60)));
        // A file from days later: only the hub's snapshot of the finished race (no live timing).
        Write("F1_20261013_090000.jsonl", [Line(t.AddDays(2), "SessionInfo", Info(11388, "Race"), snapshot: true)]);

        var sessions = Catalog().List();

        var race = Assert.Single(sessions);
        Assert.Equal("F1_11388", race.Id);
        Assert.Equal("2026 Singapore Grand Prix", race.Meeting);
        Assert.Equal("F1-61", race.TrackCode);
        Assert.Equal(2, race.Parts.Count);
        // The part of the first file starts at the race's SessionInfo, not the qualifying snapshot before it.
        Assert.Equal(1, race.Parts[0].StartLine);
    }

    [Fact]
    public void Replay_messages_run_on_the_tracks_clock()
    {
        var t = new DateTimeOffset(2026, 10, 11, 12, 0, 0, TimeSpan.Zero);
        Write("F1_20261011_120000.jsonl", new[] { Line(t, "SessionInfo", Info(11388, "Race")) }.Concat(Timing(t.AddSeconds(1), 60)));

        var messages = Catalog().Messages("F1_11388")!;

        // UTC + the GMT offset (8 h), like F1State.Now, so replay times match the snapshots' clock.
        Assert.Equal(t.AddHours(8).ToUnixTimeSeconds(), messages[0].Time, 3);
        Assert.Equal(61, messages.Count);
    }

    sealed class Env(string root) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Test";
        public string ApplicationName { get; set; } = "Test";
        public string ContentRootPath { get; set; } = root;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}

using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using System.Text.Json.Nodes;
using SupercarsTiming.Server.Feed;

namespace SupercarsTiming.Natsoft.Tests;

public sealed class ScheduleStoreTests : IDisposable
{
    readonly string _root = Path.Combine(Path.GetTempPath(), $"schedule-{Guid.NewGuid():N}");
    string FilePath => Path.Combine(_root, "schedule.json");
    const string Valid = """{"events":[{"name":"A round","startDate":"2026-11-06","endDate":"2026-11-08","utcOffset":"+11:00","complete":true,"sessions":[{"name":"Practice 1","start":"2026-11-06T14:40","end":"2026-11-06T15:05"}]}]}""";

    public ScheduleStoreTests()
    {
        Directory.CreateDirectory(_root);
        File.WriteAllText(FilePath, Valid);
    }

    ScheduleStore Store() => new(new RepoPaths(new Env(_root)), Options.Create(new FeedOptions { ScheduleFile = FilePath }));

    [Fact]
    public void Import_persists_and_notifies_the_feed_without_replacing_the_next_change_token()
    {
        using var store = Store();
        var changed = store.Changed;
        var updated = Valid.Replace("14:40", "14:50");

        store.Import(updated);

        Assert.True(changed.IsCancellationRequested);
        Assert.False(store.Changed.IsCancellationRequested);
        using var restarted = Store();
        Assert.Equal(updated, restarted.Read());
        var window = Assert.Single(SessionSchedule.Load(FilePath).Windows);
        Assert.Equal(new DateTimeOffset(2026, 11, 6, 14, 20, 0, TimeSpan.FromHours(11)), window.Start);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("{\"events\":[]}")]
    [InlineData("{\"events\":[{\"name\":\"Missing dates\"}]}")]
    [InlineData("{\"events\":[{\"name\":\"Bad dates\",\"startDate\":\"2026-11-08\",\"endDate\":\"2026-11-06\",\"utcOffset\":\"+11:00\",\"complete\":false}]}")]
    public void Rejected_import_keeps_the_working_file_and_connection_window(string invalid)
    {
        using var store = Store();
        var changed = store.Changed;

        Assert.ThrowsAny<Exception>(() => store.Import(invalid));

        Assert.Equal(Valid, store.Read());
        Assert.False(changed.IsCancellationRequested);
    }

    [Theory]
    [InlineData("utcOffset", null)]
    [InlineData("sessionsSource", "www.supercars.com/news/sandown")]
    [InlineData("sessionsSource", "javascript:alert(1)")]
    public void Metadata_that_the_browser_cannot_display_is_rejected_before_persistence(string field, string? value)
    {
        using var store = Store();
        var changed = store.Changed;
        var document = JsonNode.Parse(Valid)!;
        document["events"]![0]![field] = value;

        Assert.Throws<FormatException>(() => store.Import(document.ToJsonString()));

        Assert.Equal(Valid, store.Read());
        Assert.False(changed.IsCancellationRequested);
    }

    [Fact]
    public void A_session_outside_the_event_or_an_incomplete_complete_timetable_is_rejected()
    {
        Assert.Throws<FormatException>(() => SessionSchedule.Parse(Valid.Replace("2026-11-06T14", "2026-11-09T14")));
        const string empty = """{"events":[{"name":"A round","startDate":"2026-11-06","endDate":"2026-11-08","utcOffset":"+11:00","complete":true,"sessions":[]}]}""";
        Assert.Throws<FormatException>(() => SessionSchedule.Parse(empty));
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    sealed class Env(string root) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Test";
        public string ApplicationName { get; set; } = "Test";
        public string ContentRootPath { get; set; } = root;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}

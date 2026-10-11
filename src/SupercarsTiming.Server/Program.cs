using System.Text.Json.Serialization;
using SupercarsTiming.Server.Feed;
using SupercarsTiming.Server.Hubs;
using SupercarsTiming.Natsoft;
using SupercarsTiming.Server.Sessions;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<FeedOptions>(builder.Configuration.GetSection(FeedOptions.Section));
builder.Services.AddSingleton<RepoPaths>();
builder.Services.AddSingleton<TimingStore>();
builder.Services.AddHostedService<TimingFeedService>();
builder.Services.AddHostedService<SnapshotBroadcaster>();
builder.Services.AddSingleton<SessionCatalog>();
builder.Services.AddSingleton<ReplayService>();

builder.Services.AddSignalR()
    .AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();

app.MapGet("/api/health", (TimingStore store) => Results.Ok(store.Status));
app.MapGet("/api/snapshot", (TimingStore store) => Results.Ok(new TimingUpdate(store.Status, store.Snapshot())));
// Lap history for the charts: large, so it's fetched on its own every few seconds rather than pushed with each update.
app.MapGet("/api/laps", (TimingStore store) => Results.Ok(store.Laps()));
// Recorded sessions, newest first. Supercars Championship only unless ?all=true (support categories are recorded too).
app.MapGet("/api/sessions", (SessionCatalog catalog, bool? all) => Results.Ok(catalog.List()
    .Where(s => all == true || SessionIndex.IsSupercarsChampionship(s.Name))
    .Select(s => new
    {
        s.Id, s.Meeting, s.Name, s.Type, s.Track, s.TrackCode, s.Start, s.End,
        DurationSeconds = Math.Round(s.DurationSeconds), s.Messages,
    })));
// Final classification of a recorded session.
app.MapGet("/api/sessions/{id}/results", (SessionCatalog catalog, string id) =>
    catalog.Results(id) is { } results ? Results.Ok(results) : Results.NotFound());
// Replay of a recorded session: its time range, and the snapshot at Natsoft time t for one viewer (a cursor each).
app.MapGet("/api/sessions/{id}/replay/info", (ReplayService replays, string id) =>
    replays.Info(id) is { } info ? Results.Ok(new { info.Start, info.End }) : Results.NotFound());
app.MapGet("/api/sessions/{id}/replay", (ReplayService replays, string id, double t, string viewer) =>
    replays.At(id, viewer, t) is { } snapshot ? Results.Ok(snapshot) : Results.NotFound());
// Lap history of a recorded session (charts on the results page).
app.MapGet("/api/sessions/{id}/laps", (SessionCatalog catalog, string id) =>
    catalog.Laps(id) is { } laps ? Results.Ok(laps) : Results.NotFound());
app.MapHub<TimingHub>(TimingHub.Path);

// Production: serve the built React app from wwwroot (npm run build in src/web writes there).
// In development, run the Vite dev server instead (npm run dev in src/web -> http://localhost:5173).
if (Directory.Exists(app.Environment.WebRootPath) && File.Exists(Path.Combine(app.Environment.WebRootPath, "index.html")))
{
    app.UseDefaultFiles();
    app.UseStaticFiles();
    app.MapFallbackToFile("index.html");
}
else
{
    app.MapGet("/", () => Results.Text(
        "Frontend not built. For development run `npm run dev` in src/web and open http://localhost:5173, " +
        "or run `npm run build` there and restart this server."));
}

app.Run();

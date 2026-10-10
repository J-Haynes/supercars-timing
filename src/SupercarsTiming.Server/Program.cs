using System.Text.Json.Serialization;
using SupercarsTiming.Server.Feed;
using SupercarsTiming.Server.Hubs;
using SupercarsTiming.Server.Replay;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<FeedOptions>(builder.Configuration.GetSection(FeedOptions.Section));
builder.Services.AddSingleton<RepoPaths>();
builder.Services.AddSingleton<TimingStore>();
builder.Services.AddHostedService<TimingFeedService>();
builder.Services.AddHostedService<SnapshotBroadcaster>();
builder.Services.AddSingleton<SessionCatalog>();
builder.Services.AddSingleton<ReplayManager>();

builder.Services.AddSignalR()
    .AddJsonProtocol(o => o.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();

app.MapGet("/api/health", (TimingStore store) => Results.Ok(store.Status));
app.MapGet("/api/snapshot", (TimingStore store) => Results.Ok(new TimingUpdate(store.Status, store.Snapshot())));
app.MapGet("/api/sessions", (SessionCatalog catalog) => Results.Ok(catalog.List().Select(s => new
{
    s.Id, s.Meeting, s.Name, s.Type, s.Track, s.TrackCode, s.Start, s.End,
    DurationSeconds = Math.Round(s.DurationSeconds), s.Messages,
})));
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

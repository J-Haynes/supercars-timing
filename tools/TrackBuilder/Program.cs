using System.Globalization;
using System.Text.Json;
using TrackBuilder;

// TrackBuilder: turns an OpenStreetMap circuit relation plus a timing recording into a track file
// for the web map (src/web/src/tracks/<CODE>.json). See tools/TrackBuilder/README.md.

var opt = ParseArgs(args);
// F1 (or any track file not in latitude/longitude): scenery only, lined up with the OSM circuit (Georef.cs).
if (opt.ContainsKey("georef")) return await GeorefScenery.RunAsync(opt, FindRepoRoot());
if (!opt.TryGetValue("code", out var code) || !(opt.TryGetValue("relation", out var relationText) || opt.ContainsKey("ways")))
{
    Console.WriteLine("""
        usage: TrackBuilder --code MOUN --relation 6942508 [--recording data/recordings/<file>.jsonl] [options]
               TrackBuilder --code SAND --ways 1,2,3 [--pit-ways 4,5] --name "Sandown" [options]   (no circuit relation in OSM)

          --recording <file>     Learn timing point positions from a recording. Without one, a *provisional*
                                 track is written and the web map places timing points from live pace instead.
          --ways <ids>           Circuit ways in race order, comma-separated, when OSM has no circuit relation
          --pit-ways <ids>       With --ways: the pit lane's ways
          --turn-labels true     Label only numbered corners (OSM nodes named "Turn N" with ref N) as "TN"
          --reverse true         Run the lap the other way (OSM gave the loop against the race direction)
          --name <text>          Display name (default: OSM relation name)
          --match <text>         Also use this file for Natsoft track names containing this text (e.g. "SURFERS")
          --sessions <text>      Only learn timing from sessions containing this (default: "Supercars")
          --osm <file>           OSM cache (default: tools/TrackBuilder/osm/<CODE>.osm.json; downloaded if missing)
          --georef <CODE>        With --relation: scenery for an existing track file not in lat/lon (F1-61 etc.), fitted
                                 to the OSM circuit; also OSM's "Turn N" corners. The track file isn't changed
          --landmarks false      With --scenery: no landmark labels (Las Vegas: the owner asked for none)
          --scenery <metres>     Also write scenery for the 3D map (buildings, water, beach, sea from OSM via Overpass)
                                 for this far around the circuit, to src/web/src/tracks/scenery/<CODE>.json
          --official <file>      Corners and pit lane from the official track map (tools/TrackBuilder/official/<CODE>.json,
                                 made by tools/OfficialMap): they replace OSM's road-name labels and pit lane
          --corners <file>       Corner names placed by hand (tools/TrackBuilder/corners/<CODE>.json, same format as
                                 --official; its "attribution" is credited) when there's no official map yet
          --control-pit true     Put the control line level with the middle of the pit lane (estimated), when OSM has
                                 no Finish Line node but does have the pit lane beside the pit straight
          --elevation <file>     Height cache (default: tools/TrackBuilder/elevation/<CODE>.json; looked up if missing),
                                 or "none" for no heights (flat tracks among buildings, where SRTM shows rooftops)
          --control-node <id>    OSM node for the timing control line (default: node named "Finish Line", then "Start Line")
          --control-way <name>   Otherwise: put the control line at the middle of the road with this name
          --lap-time <seconds>   Provisional tracks: typical lap time for the speed profile (default: fit 2.3 g grip)
          --out <file>           Output (default: src/web/src/tracks/<CODE>.json)
        """);
    return 1;
}
opt.TryGetValue("recording", out var recording);

var root = FindRepoRoot();
var relationId = relationText is null ? 0 : long.Parse(relationText);   // 0: built from --ways
var osmPath = Path.Combine(root, opt.GetValueOrDefault("osm") ?? $"tools/TrackBuilder/osm/{code}.osm.json");
var outPath = Path.Combine(root, opt.GetValueOrDefault("out") ?? $"src/web/src/tracks/{code}.json");
var elevationOption = opt.GetValueOrDefault("elevation");
var elevationPath = elevationOption == "none" ? null : Path.Combine(root, elevationOption ?? $"tools/TrackBuilder/elevation/{code}.json");
var recordingPath = recording is null ? null : Path.Combine(root, recording);
const double Step = 5;   // metres between samples

// 1. Circuit geometry from OSM
if (!File.Exists(osmPath))
{
    Console.WriteLine($"Downloading OSM relation {relationId}...");
    Directory.CreateDirectory(Path.GetDirectoryName(osmPath)!);
    static List<long> Ids(string? list) => (list ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).Select(long.Parse).ToList();
    await File.WriteAllTextAsync(osmPath, opt.TryGetValue("ways", out var wayList)
        ? await OsmCircuit.DownloadWaysAsync(Ids(wayList), Ids(opt.GetValueOrDefault("pit-ways")), opt.GetValueOrDefault("name") ?? code)
        : await OsmCircuit.DownloadAsync(relationId));
}
var osm = OsmCircuit.Parse(await File.ReadAllTextAsync(osmPath));
var allIds = osm.CircuitWays.SelectMany(w => w.Nodes).ToList();
var projection = new Projection(allIds.Average(id => osm.Nodes[id].Lat), allIds.Average(id => osm.Nodes[id].Lon));
Point P(long id) => projection.ToMetres(osm.Nodes[id].Lat, osm.Nodes[id].Lon);
var loopIds = osm.BuildLoop(P);
if (loopIds[0] != loopIds[^1]) throw new InvalidOperationException("Circuit ways don't form a closed loop");
if (opt.GetValueOrDefault("reverse") == "true") loopIds.Reverse();
var ring = new Ring(loopIds.Select(P).ToList());

// 2. Start the lap at the timing control line ("M")
var controlNode = opt.TryGetValue("control-node", out var cn) ? osm.Nodes[long.Parse(cn)]
    : osm.Nodes.Values.FirstOrDefault(n => n.Name == "Finish Line") ?? osm.Nodes.Values.FirstOrDefault(n => n.Name == "Start Line");
var controlEstimated = false;
if (controlNode is not null) ring = ring.RotateTo(ring.Project(P(controlNode.Id)));
else if (opt.TryGetValue("control-way", out var controlWay))
{
    // Middle of the named road's stretch of the lap (e.g. the pit straight).
    var along = osm.CircuitWays.Where(w => w.Name == controlWay).SelectMany(w => w.Nodes).Select(id => ring.Project(P(id))).Order().ToList();
    if (along.Count == 0) throw new InvalidOperationException($"No circuit way named '{controlWay}'");
    // Handle a stretch that wraps past distance 0 by using the largest gap as the break.
    var gaps = along.Zip(along.Skip(1).Append(along[0] + ring.Length), (a, b) => b - a).ToList();
    int breakAt = gaps.IndexOf(gaps.Max());
    var start = along[(breakAt + 1) % along.Count];
    var span = ring.Length - gaps[breakAt];
    ring = ring.RotateTo(start + span / 2);
    controlEstimated = true;
    Console.WriteLine($"Control line estimated at the middle of {controlWay} ({span:0} m of the lap)");
}
else if (opt.GetValueOrDefault("control-pit") == "true" && osm.PitLaneWays.Count > 0)
{
    // Middle of the pit lane, projected onto the lap: start/finish lines sit on the pit straight beside the pits.
    var pit = OsmCircuit.Chain(osm.PitLaneWays).Select(P).ToList();
    var cum = new List<double> { 0 };
    for (int i = 1; i < pit.Count; i++) cum.Add(cum[^1] + Point.Distance(pit[i - 1], pit[i]));
    int mid = cum.FindIndex(c => c >= cum[^1] / 2);
    ring = ring.RotateTo(ring.Project(pit[mid]));
    controlEstimated = true;
    Console.WriteLine($"Control line estimated level with the middle of the pit lane ({cum[^1]:0} m long)");
}
else { controlEstimated = true; Console.WriteLine("warning: no Finish/Start Line node; control line placed at the first circuit node"); }
var samples = ring.Resample(Step);
Console.WriteLine($"{osm.Name}: {ring.Length:0} m, {samples.Count} samples");

// 3. Measured pace between timing points, and a lap simulation matched to it
var seg = recordingPath is null ? null : SegmentTimes.FromRecording(recordingPath, code, opt.GetValueOrDefault("sessions") ?? "Supercars");
var sim = new LapSimulator(samples, Step);
if (seg is not null)
{
    var grip = sim.FitLapTime(seg.LapTime);
    Console.WriteLine($"Measured lap {seg.LapTime:0.00} s from {seg.Samples.Sum()} segment samples; simulated grip {grip:0.00} g");
}
else if (opt.TryGetValue("lap-time", out var lapText))
{
    var grip = sim.FitLapTime(double.Parse(lapText, CultureInfo.InvariantCulture));
    Console.WriteLine($"Provisional: speed profile fitted to a {lapText} s lap (grip {grip:0.00} g)");
}
else
{
    sim.Run(2.3);
    Console.WriteLine($"Provisional: default speed profile, simulated lap {sim.LapTime:0.00} s");
}

// 4. Place each timing point where the simulated car is at the measured time into the lap
var timingPoints = new List<object>();
double elapsed = 0;
for (int i = 0; seg is not null && i < seg.PointOrder.Count; i++)
{
    var id = seg.PointOrder[i];
    var distance = sim.DistanceAtTime(elapsed);
    var speedKmh = sim.Speed[(int)(distance / Step) % samples.Count] * 3.6;
    Console.WriteLine($"  {id,-2} {seg.PointNames.GetValueOrDefault(id),-12} {distance,6:0} m  sim {speedKmh,3:0} km/h  next segment {seg.Seconds[i],6:0.00} s ({seg.Samples[i]} samples)");
    timingPoints.Add(new { id, name = seg.PointNames.GetValueOrDefault(id) ?? id, distance = Math.Round(distance, 1) });
    elapsed += seg.Seconds[i];
}
if (seg is not null) Console.WriteLine($"  Fastest speed trap in recording: {seg.TopSpeed} km/h");
else Console.WriteLine("  No recording: timing points will be placed by the web map from live pace (provisional track)");

// 5. Labels: named nodes, then circuit way names at their midpoint (first one wins per name)
var labels = new Dictionary<string, (string Name, double Distance)>(StringComparer.OrdinalIgnoreCase);
string Key(string s) => s.Replace("'", "").Replace("’", "").Trim();
void AddLabel(string name, double distance) => labels.TryAdd(Key(name), (name, distance));
foreach (var n in osm.Nodes.Values.Where(n => n.Name is { } nm && loopIds.Contains(n.Id) || n.Name is "Start Line" or "Finish Line"))
    AddLabel(n.Name!, ring.Project(P(n.Id)));
foreach (var (name, nodes) in osm.CircuitWays.Where(w => w.Name is not null))
{
    var a = ring.Project(P(nodes[0]));
    var b = ring.Project(P(nodes[^1]));
    if (b < a) b += ring.Length;
    AddLabel(name!, ((a + b) / 2) % ring.Length);
}
foreach (var n in osm.Nodes.Values.Where(n => n.Name is not null && !labels.ContainsKey(Key(n.Name))))
{
    var along = ring.Project(P(n.Id));
    if (Point.Distance(ring.At(along), P(n.Id)) < 60) AddLabel(n.Name!, along);
}

// 5b. Only the numbered corners (where OSM maps them as "Turn N" nodes): drops signs, road names and sponsor names
if (opt.GetValueOrDefault("turn-labels") == "true")
{
    labels.Clear();
    foreach (var n in osm.Nodes.Values.Where(n => n.Ref is { } r && int.TryParse(r, out _) && n.Name == $"Turn {r}"))
    {
        var along = ring.Project(P(n.Id));
        if (Point.Distance(ring.At(along), P(n.Id)) < 60) AddLabel($"T{n.Ref}", along);
    }
    Console.WriteLine($"Turn labels: {labels.Count}");
}

// 6. Heights along the lap (SRTM via OpenTopoData), relative to the lowest point
var elevation = elevationPath is null ? null : await Elevation.ForLapAsync(samples, Step, projection, elevationPath);
if (elevation is not null)
{
    var top = Array.IndexOf(elevation, elevation.Max());
    Console.WriteLine($"Elevation: {elevation.Max():0} m from lowest to highest point (highest at {top * Step:0} m)");
}
else Console.WriteLine("Elevation: none (--elevation none)");

// 7. Scenery for the 3D map (optional): buildings, water, beaches and the sea around the circuit
if (opt.TryGetValue("scenery", out var sceneryMargin))
{
    var scenery = await Scenery.BuildAsync(samples, projection, double.Parse(sceneryMargin, CultureInfo.InvariantCulture),
        Path.Combine(root, $"tools/TrackBuilder/osm/{code}.scenery.osm.json"), landmarkLabels: opt.GetValueOrDefault("landmarks") != "false");
    var sceneryPath = Path.Combine(Path.GetDirectoryName(outPath)!, "scenery", $"{code}.json");
    Directory.CreateDirectory(Path.GetDirectoryName(sceneryPath)!);
    await File.WriteAllTextAsync(sceneryPath, JsonSerializer.Serialize(scenery) + "\n");
    Console.WriteLine($"Wrote {Path.GetRelativePath(root, sceneryPath)} ({new FileInfo(sceneryPath).Length / 1024} KB)");
}

// 8. Pit lane polyline
var pitIds = osm.PitLaneWays.Count > 0 ? OsmCircuit.Chain(osm.PitLaneWays) : [];
var pitLane = pitIds.Select(P).ToList();

// 8b. The official track map (optional): numbered corners and the pit lane, already lined up with this track
var attribution = "Track geometry © OpenStreetMap contributors (ODbL)";
if (opt.TryGetValue("official", out var officialFile) || opt.TryGetValue("corners", out officialFile))
{
    using var official = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(root, officialFile)));
    Point LatLon(JsonElement e) => projection.ToMetres(e[0].GetDouble(), e[1].GetDouble());
    labels.Clear();
    foreach (var c in official.RootElement.GetProperty("corners").EnumerateArray())
        AddLabel(c.GetProperty("name").GetString()!, ring.Project(LatLon(c.GetProperty("at"))));
    var officialPit = official.RootElement.GetProperty("pitLane").EnumerateArray().Select(LatLon).ToList();
    if (officialPit.Count > 1) pitLane = officialPit;
    attribution += official.RootElement.TryGetProperty("attribution", out var credit)
        ? $" · {credit.GetString()}"
        : " · corners and pit lane from the official Supercars track map";
    Console.WriteLine($"Corners from {officialFile}: {labels.Count} corners, pit lane {officialPit.Count} points ({official.RootElement.GetProperty("source").GetString()})");
}

static double R(double v) => Math.Round(v, 1);
var track = new
{
    code,
    name = opt.GetValueOrDefault("name") ?? osm.Name,
    // Natsoft track-name fragments this file also applies to, for when the track code isn't known yet.
    match = opt.TryGetValue("match", out var match) ? new[] { match } : Array.Empty<string>(),
    // True when timing points haven't been learned from a recording yet.
    provisional = seg is null,
    controlLineEstimated = controlEstimated,
    source = new
    {
        attribution = attribution + (elevation is null ? "" : $" · {Elevation.Attribution}"),
        osmRelation = relationId,
        recording = recordingPath is null ? null : Path.GetFileName(recordingPath),
        built = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
    },
    // Latitude/longitude of (0, 0): path coordinates are metres east/north of it (equirectangular, Geometry.cs).
    origin = new[] { Math.Round(projection.Origin.Lat, 7), Math.Round(projection.Origin.Lon, 7) },
    length = R(ring.Length),
    step = Step,
    // Resampled centreline in metres (x east, y north), starting at the control line in race direction.
    path = samples.Select(p => new[] { R(p.X), R(p.Y) }),
    // Simulated cumulative seconds at each sample (one extra at the end = full lap). Used to slow cars for corners.
    simTime = sim.Time.Select(t => Math.Round(t, 3)),
    // Height in metres at each sample, relative to the lowest point of the lap (smoothed SRTM; see Elevation.cs).
    elevation = elevation?.Select(R),
    timingPoints,
    // Representative seconds from each timing point to the next, used when a car has no recent pace.
    segmentSeconds = seg is null
        ? Enumerable.Empty<object>()
        : seg.PointOrder.Select((id, i) => (object)new { from = id, seconds = Math.Round(seg.Seconds[i], 3) }),
    labels = labels.Values.OrderBy(l => l.Distance).Select(l => new { name = l.Name, distance = R(l.Distance) }),
    pitLane = pitLane.Select(p => new[] { R(p.X), R(p.Y) }),
};

Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
await File.WriteAllTextAsync(outPath, JsonSerializer.Serialize(track, new JsonSerializerOptions { WriteIndented = false }) + "\n");

// manifest.json: track code -> name fragments and status, so the web app can find a track by name and show
// which circuits are mapped without loading every file.
var manifestPath = Path.Combine(Path.GetDirectoryName(outPath)!, "manifest.json");
var manifest = new SortedDictionary<string, ManifestEntry>();
if (File.Exists(manifestPath))
{
    try { manifest = JsonSerializer.Deserialize<SortedDictionary<string, ManifestEntry>>(await File.ReadAllTextAsync(manifestPath)) ?? manifest; }
    catch (JsonException) { /* older format: rebuilt as tracks are regenerated */ }
}
manifest[code] = new ManifestEntry(track.name, track.match, track.provisional);
await File.WriteAllTextAsync(manifestPath, JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }) + "\n");
Console.WriteLine($"Wrote {Path.GetRelativePath(root, outPath)} ({new FileInfo(outPath).Length / 1024} KB)");
return 0;

static Dictionary<string, string> ParseArgs(string[] args)
{
    var d = new Dictionary<string, string>();
    for (int i = 0; i + 1 < args.Length; i += 2)
        if (args[i].StartsWith("--")) d[args[i][2..]] = args[i + 1];
    return d;
}

static string FindRepoRoot()
{
    for (var dir = new DirectoryInfo(Directory.GetCurrentDirectory()); dir is not null; dir = dir.Parent)
        if (dir.GetFiles("SupercarsTiming.slnx").Length > 0) return dir.FullName;
    return Directory.GetCurrentDirectory();
}

/// <summary>Entry in src/web/src/tracks/manifest.json (lower-case names: it's read by the web app).</summary>
record ManifestEntry(string name, string[] match, bool provisional);

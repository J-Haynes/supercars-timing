using System.Globalization;
using System.Text.Json;
using TrackBuilder;

// TrackBuilder: turns an OpenStreetMap circuit relation plus a timing recording into a track file
// for the web map (src/web/src/tracks/<CODE>.json). See tools/TrackBuilder/README.md.

var opt = ParseArgs(args);
if (!opt.TryGetValue("code", out var code) || !opt.TryGetValue("relation", out var relationText) || !opt.TryGetValue("recording", out var recording))
{
    Console.WriteLine("""
        usage: TrackBuilder --code MOUN --relation 6942508 --recording data/recordings/<file>.jsonl [options]

          --name <text>          Display name (default: OSM relation name)
          --sessions <text>      Only learn timing from sessions containing this (default: "Supercars")
          --osm <file>           OSM cache (default: tools/TrackBuilder/osm/<CODE>.osm.json; downloaded if missing)
          --control-node <id>    OSM node for the timing control line (default: node named "Finish Line", then "Start Line")
          --out <file>           Output (default: src/web/src/tracks/<CODE>.json)
        """);
    return 1;
}

var root = FindRepoRoot();
var relationId = long.Parse(relationText);
var osmPath = Path.Combine(root, opt.GetValueOrDefault("osm") ?? $"tools/TrackBuilder/osm/{code}.osm.json");
var outPath = Path.Combine(root, opt.GetValueOrDefault("out") ?? $"src/web/src/tracks/{code}.json");
var recordingPath = Path.Combine(root, recording);
const double Step = 5;   // metres between samples

// 1. Circuit geometry from OSM
if (!File.Exists(osmPath))
{
    Console.WriteLine($"Downloading OSM relation {relationId}...");
    Directory.CreateDirectory(Path.GetDirectoryName(osmPath)!);
    await File.WriteAllTextAsync(osmPath, await OsmCircuit.DownloadAsync(relationId));
}
var osm = OsmCircuit.Parse(await File.ReadAllTextAsync(osmPath));
var loopIds = OsmCircuit.Chain(osm.CircuitWays.Select(w => w.Nodes));
if (loopIds[0] != loopIds[^1]) throw new InvalidOperationException("Circuit ways don't form a closed loop");

var projection = new Projection(loopIds.Average(id => osm.Nodes[id].Lat), loopIds.Average(id => osm.Nodes[id].Lon));
Point P(long id) => projection.ToMetres(osm.Nodes[id].Lat, osm.Nodes[id].Lon);
var ring = new Ring(loopIds.Select(P).ToList());

// 2. Start the lap at the timing control line ("M")
var controlNode = opt.TryGetValue("control-node", out var cn) ? osm.Nodes[long.Parse(cn)]
    : osm.Nodes.Values.FirstOrDefault(n => n.Name == "Finish Line") ?? osm.Nodes.Values.FirstOrDefault(n => n.Name == "Start Line");
if (controlNode is null) Console.WriteLine("warning: no Finish/Start Line node; control line placed at the first circuit node");
else ring = ring.RotateTo(ring.Project(P(controlNode.Id)));
var samples = ring.Resample(Step);
Console.WriteLine($"{osm.Name}: {ring.Length:0} m, {samples.Count} samples");

// 3. Measured pace between timing points, and a lap simulation matched to it
var seg = SegmentTimes.FromRecording(recordingPath, code, opt.GetValueOrDefault("sessions") ?? "Supercars");
var sim = new LapSimulator(samples, Step);
var grip = sim.FitLapTime(seg.LapTime);
Console.WriteLine($"Measured lap {seg.LapTime:0.00} s from {seg.Samples.Sum()} segment samples; simulated grip {grip:0.00} g");

// 4. Place each timing point where the simulated car is at the measured time into the lap
var timingPoints = new List<object>();
double elapsed = 0;
for (int i = 0; i < seg.PointOrder.Count; i++)
{
    var id = seg.PointOrder[i];
    var distance = sim.DistanceAtTime(elapsed);
    var speedKmh = sim.Speed[(int)(distance / Step) % samples.Count] * 3.6;
    Console.WriteLine($"  {id,-2} {seg.PointNames.GetValueOrDefault(id),-12} {distance,6:0} m  sim {speedKmh,3:0} km/h  next segment {seg.Seconds[i],6:0.00} s ({seg.Samples[i]} samples)");
    timingPoints.Add(new { id, name = seg.PointNames.GetValueOrDefault(id) ?? id, distance = Math.Round(distance, 1) });
    elapsed += seg.Seconds[i];
}
Console.WriteLine($"  Fastest speed trap in recording: {seg.TopSpeed} km/h");

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

// 6. Pit lane polyline
var pitIds = osm.PitLaneWays.Count > 0 ? OsmCircuit.Chain(osm.PitLaneWays) : [];

static double R(double v) => Math.Round(v, 1);
var track = new
{
    code,
    name = opt.GetValueOrDefault("name") ?? osm.Name,
    source = new
    {
        attribution = "Track geometry © OpenStreetMap contributors (ODbL)",
        osmRelation = relationId,
        recording = Path.GetFileName(recordingPath),
        built = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
    },
    length = R(ring.Length),
    step = Step,
    // Resampled centreline in metres (x east, y north), starting at the control line in race direction.
    path = samples.Select(p => new[] { R(p.X), R(p.Y) }),
    // Simulated cumulative seconds at each sample (one extra at the end = full lap). Used to slow cars for corners.
    simTime = sim.Time.Select(t => Math.Round(t, 3)),
    timingPoints,
    // Representative seconds from each timing point to the next, used when a car has no recent pace.
    segmentSeconds = seg.PointOrder.Select((id, i) => new { from = id, seconds = Math.Round(seg.Seconds[i], 3) }),
    labels = labels.Values.OrderBy(l => l.Distance).Select(l => new { name = l.Name, distance = R(l.Distance) }),
    pitLane = pitIds.Select(id => { var p = P(id); return new[] { R(p.X), R(p.Y) }; }),
};

Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
await File.WriteAllTextAsync(outPath, JsonSerializer.Serialize(track, new JsonSerializerOptions { WriteIndented = false }) + "\n");
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

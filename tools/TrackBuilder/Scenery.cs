using System.Globalization;
using System.Text.Json;

namespace TrackBuilder;

/// <summary>
/// Scenery around a circuit for the 3D map, from OpenStreetMap through the Overpass API: building footprints with
/// heights, water (lakes, rivers), beaches, parks, and the ocean (OSM maps the sea only as a coastline line, so the
/// sea polygon is built from it). Everything is clipped to a box around the circuit and projected to the track
/// file's metres, and written to src/web/src/tracks/scenery/&lt;CODE&gt;.json.
///
/// Building heights: OSM `height` if mapped, else `building:levels` x 3.2 m, else an assumed 2 storeys (6.4 m) so
/// unmapped buildings still show. At Surfers Paradise (Oct 2026) 27 of 1,301 buildings had a height and 825 had
/// levels; the rest use the assumption. Visual only: never used for timing.
/// </summary>
public static class Scenery
{
    public const string Attribution = "Scenery © OpenStreetMap contributors (ODbL), via Overpass";
    const double StoreyMetres = 3.2;
    const double AssumedStoreys = 2;
    static readonly string[] Mirrors =
    [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ];

    /// <summary>
    /// Builds the scenery for the box around the lap (`margin` metres beyond the circuit). The raw Overpass answer is
    /// cached at <paramref name="cachePath"/> (git-ignored: it's large and easy to fetch again).
    /// </summary>
    /// <param name="output">Converts OSM metres to the track file's coordinates (F1 tracks, Georef); default as is.</param>
    /// <param name="corners">Corner labels to include (F1 tracks: OSM's "Turn N" nodes, already in track coordinates).</param>
    /// <param name="extraLandmarks">OSM elements to label whatever their score, e.g. "way/306191909" (Bathurst's hotel).</param>
    /// <param name="terrain">Builds the ground heights for the box [minX, minY, maxX, maxY] (hilly tracks; Terrain.cs).</param>
    public static async Task<object> BuildAsync(IReadOnlyList<Point> lap, Projection projection, double margin, string cachePath,
        Func<Point, Point>? output = null, IReadOnlyList<object>? corners = null, bool landmarkLabels = true,
        IReadOnlyCollection<string>? extraLandmarks = null, Func<double[], Task<object>>? terrain = null)
    {
        extraLandmarks ??= [];
        output ??= p => p;
        var box = new Box(lap.Min(p => p.X) - margin, lap.Min(p => p.Y) - margin, lap.Max(p => p.X) + margin, lap.Max(p => p.Y) + margin);
        var (south, west) = projection.ToLatLon(new Point(box.MinX, box.MinY));
        var (north, east) = projection.ToLatLon(new Point(box.MaxX, box.MaxY));
        if (!File.Exists(cachePath))
        {
            var bb = string.Create(CultureInfo.InvariantCulture, $"{south:0.00000},{west:0.00000},{north:0.00000},{east:0.00000}");
            var query = $"""
                [out:json][timeout:90];
                (way["building"]({bb});way["building:part"]({bb});relation["building"]({bb});
                 way["natural"~"^(water|beach|sand|coastline)$"]({bb});relation["natural"~"^(water|beach)$"]({bb});
                 way["leisure"="park"]({bb});relation["leisure"="park"]({bb});way["landuse"="grass"]({bb});
                 nwr["tourism"~"attraction|theme_park|museum"]["name"]({bb});nwr["man_made"~"^(tower|observation_tower)$"]["name"]({bb});nwr["leisure"="stadium"]["name"]({bb});
                 node["natural"="tree"]({bb});way["natural"~"^(wood|scrub|tree_row)$"]({bb});relation["natural"="wood"]({bb});
                 way["landuse"="forest"]({bb});relation["landuse"="forest"]({bb});{ExtraQuery(extraLandmarks)});
                out body;>;out skel qt;
                """;
            Directory.CreateDirectory(Path.GetDirectoryName(cachePath)!);
            await File.WriteAllTextAsync(cachePath, await DownloadAsync(query));
        }

        using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(cachePath));
        var nodes = new Dictionary<long, Point>();
        var namedNodes = new List<(Point At, Dictionary<string, string> Tags, string Id)>();
        var treeNodes = new List<(Point At, Dictionary<string, string> Tags)>();
        var ways = new Dictionary<long, (List<long> Nodes, Dictionary<string, string> Tags)>();
        var relations = new List<(List<(long Ref, string Role)> Members, Dictionary<string, string> Tags, long Id)>();
        foreach (var e in doc.RootElement.GetProperty("elements").EnumerateArray())
        {
            var tags = e.TryGetProperty("tags", out var t) ? t.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString() ?? "") : [];
            switch (e.GetProperty("type").GetString())
            {
                case "node":
                    var at = projection.ToMetres(e.GetProperty("lat").GetDouble(), e.GetProperty("lon").GetDouble());
                    nodes[e.GetProperty("id").GetInt64()] = at;
                    if (tags.ContainsKey("name")) namedNodes.Add((at, tags, $"node/{e.GetProperty("id").GetInt64()}"));
                    if (tags.GetValueOrDefault("natural") == "tree") treeNodes.Add((at, tags));
                    break;
                case "way": ways[e.GetProperty("id").GetInt64()] = (e.GetProperty("nodes").EnumerateArray().Select(n => n.GetInt64()).ToList(), tags); break;
                case "relation":
                    relations.Add((e.GetProperty("members").EnumerateArray().Where(m => m.GetProperty("type").GetString() == "way")
                        .Select(m => (m.GetProperty("ref").GetInt64(), m.GetProperty("role").GetString() ?? "")).ToList(), tags, e.GetProperty("id").GetInt64()));
                    break;
            }
        }
        List<Point> Pts(List<long> ids) => ids.Where(nodes.ContainsKey).Select(id => nodes[id]).ToList();

        // Areas: closed ways, and multipolygon relations (outer rings with inner rings as holes).
        var areas = new List<(Dictionary<string, string> Tags, List<Point> Outer, List<List<Point>> Holes, string Id)>();
        foreach (var (id, (wayNodes, tags)) in ways)
            if (wayNodes.Count > 3 && wayNodes[0] == wayNodes[^1]) areas.Add((tags, Pts(wayNodes), [], $"way/{id}"));
        foreach (var (members, tags, id) in relations)
        {
            List<List<Point>> RingsOf(string role) => JoinRings(members.Where(m => m.Role == role && ways.ContainsKey(m.Ref)).Select(m => ways[m.Ref].Nodes))
                .Select(Pts).Where(r => r.Count > 3).ToList();
            var inner = RingsOf("inner");
            foreach (var outer in RingsOf("outer")) areas.Add((tags, outer, inner.Where(h => Inside(h[0], outer)).ToList(), $"relation/{id}"));
        }

        static string Kind(Dictionary<string, string> t) =>
            t.ContainsKey("building") || t.ContainsKey("building:part") ? "building"
            : t.GetValueOrDefault("natural") is "water" ? "water"
            : t.GetValueOrDefault("natural") is "beach" or "sand" ? "beach"
            : t.GetValueOrDefault("natural") is "wood" or "scrub" || t.GetValueOrDefault("landuse") == "forest" ? "wood"
            : t.GetValueOrDefault("leisure") == "park" || t.GetValueOrDefault("landuse") == "grass" ? "park"
            // Coloured shapes laid on the ground (Bathurst's hillside sign: white letters of painted stone).
            : t.ContainsKey("colour") && (t.ContainsKey("tourism") || t.ContainsKey("name")) ? "marking" : "";

        double[][] Ring(List<Point> ring) => ring.Select(output).Select(p => new[] { Math.Round(p.X, 1), Math.Round(p.Y, 1) }).ToArray();
        double[] At(Point p) { var q = output(p); return [Math.Round(q.X, 1), Math.Round(q.Y, 1)]; }
        object Polygon(List<Point> outer, List<List<Point>> holes) => new
        {
            outer = Ring(box.Clip(outer)),
            holes = holes.Select(box.Clip).Where(h => h.Count > 2).Select(Ring),
        };

        var buildings = new List<object>();
        // Landmark candidates: attractions, museums and stadiums with a Wikipedia/Wikidata link, and named buildings
        // LandmarkHeight or taller (any link). Scored below.
        var landmarks = new List<(string Name, Point At, double Height, bool Notable, bool Attraction)>();
        // Asked for by name (--landmarks-add): labelled first, whatever their score.
        var forced = new List<(string Name, Point At, double Height)>();
        static bool Notable(Dictionary<string, string> t) => t.ContainsKey("wikidata") || t.ContainsKey("wikipedia");
        foreach (var (tags, outer, _, id) in areas.Where(a => extraLandmarks.Contains(a.Id) && a.Tags.ContainsKey("name")))
            if (!forced.Any(f => f.Name == LandmarkName(tags))) forced.Add((LandmarkName(tags), Centroid(outer), HeightOf(tags) ?? 0));
        foreach (var (at, tags, _) in namedNodes.Where(n => extraLandmarks.Contains(n.Id)))
            forced.Add((LandmarkName(tags), at, Number(tags.GetValueOrDefault("height")) ?? 0));
        foreach (var (tags, outer, _, _) in areas.Where(a => IsAttraction(a.Tags) && a.Tags.ContainsKey("name") && (Notable(a.Tags) || IsLandmarkTower(a.Tags))))
            landmarks.Add((EnglishName(tags), Centroid(outer), Number(tags.GetValueOrDefault("height")) ?? 0, true, true));
        // Nodes: linked attractions, and named towers (COTA's observation tower has no link).
        foreach (var (at, tags, _) in namedNodes.Where(n => IsAttraction(n.Tags) && (Notable(n.Tags) || IsLandmarkTower(n.Tags))))
            landmarks.Add((EnglishName(tags), at, Number(tags.GetValueOrDefault("height")) ?? 0, true, true));
        int measured = 0, fromLevels = 0, assumed = 0;
        foreach (var (tags, outer, _, _) in areas.Where(a => Kind(a.Tags) == "building"))
        {
            var clipped = box.Clip(outer);
            if (clipped.Count < 3 || clipped.Count != outer.Count) continue; // only buildings wholly in the box
            double? height = Number(tags.GetValueOrDefault("height"));
            double? levels = Number(tags.GetValueOrDefault("building:levels"));
            bool grandstand = tags.GetValueOrDefault("building") == "grandstand";
            double h = height ?? (levels is { } l ? l * StoreyMetres : grandstand ? GrandstandMetres : AssumedStoreys * StoreyMetres);
            if (height is not null) measured++; else if (levels is not null) fromLevels++; else assumed++;
            double minH = Number(tags.GetValueOrDefault("min_height")) ?? (Number(tags.GetValueOrDefault("building:min_level")) is { } ml ? ml * StoreyMetres : 0);
            if (h <= minH) continue;
            // Spheres (Las Vegas's Sphere: shape=spherical_cutted) are drawn as spheres, not extruded footprints.
            bool sphere = (tags.GetValueOrDefault("shape") ?? tags.GetValueOrDefault("building:shape") ?? "").StartsWith("spher");
            buildings.Add(new { h = Math.Round(h, 1), min = Math.Round(minH, 1), ring = Ring(outer), assumed = height is null && levels is null,
                shape = sphere ? "sphere" : null, kind = grandstand ? "grandstand" : null });
            if (tags.GetValueOrDefault("name") is { Length: > 0 } && h >= LandmarkHeight && !IsAttraction(tags))
                landmarks.Add((EnglishName(tags), Centroid(outer), h, Notable(tags), false));
        }
        Console.WriteLine($"Scenery: {buildings.Count} buildings ({measured} measured height, {fromLevels} from levels, {assumed} assumed {AssumedStoreys} storeys)");

        var water = areas.Where(a => Kind(a.Tags) == "water").Select(a => Polygon(a.Outer, a.Holes)).ToList();
        var beach = areas.Where(a => Kind(a.Tags) == "beach").Select(a => Polygon(a.Outer, a.Holes)).ToList();
        var parks = areas.Where(a => Kind(a.Tags) == "park").Select(a => Polygon(a.Outer, a.Holes)).ToList();
        var woods = areas.Where(a => Kind(a.Tags) == "wood").ToList();
        var markings = areas.Where(a => Kind(a.Tags) == "marking")
            .Select(a => new { colour = a.Tags["colour"], outer = Ring(box.Clip(a.Outer)), holes = a.Holes.Select(box.Clip).Where(h => h.Count > 2).Select(Ring) }).ToList();
        var trees = Trees(treeNodes, ways.Values.Where(w => w.Tags.GetValueOrDefault("natural") == "tree_row").Select(w => Pts(w.Nodes)).ToList(), woods, box)
            .Select(t => { var q = output(t.At); return new[] { Math.Round(q.X, 1), Math.Round(q.Y, 1), t.Height }; }).ToList();
        Console.WriteLine($"Scenery: {trees.Count} trees ({treeNodes.Count} mapped one by one, the rest along tree rows and in {woods.Count} woods), {markings.Count} ground markings");

        // The sea: each coastline way runs with land on its left and water on its right (OSM convention).
        var coast = JoinLines(ways.Values.Where(w => w.Tags.GetValueOrDefault("natural") == "coastline").Select(w => w.Nodes)).Select(Pts).ToList();
        var ocean = coast.SelectMany(line => box.WaterSide(line)).Select(r => new { outer = Ring(r), holes = Array.Empty<double[][]>() }).ToList();
        Console.WriteLine($"Scenery: {water.Count} water, {beach.Count} beach, {parks.Count} park areas, {ocean.Count} sea polygon(s)");

        // Up to MaxLandmarks within LandmarkReach of the track, by score: height, +300 for a linked attraction (the
        // Singapore Flyer is "0 m" tall in OSM), +50 for any Wikipedia/Wikidata link, -1 per 10 m from the track (what
        // you see from it matters most). At most one per LandmarkSpacing, so a cluster of towers doesn't take every
        // slot (and their labels don't pile up); "X Tower 1/2/3" count as X. Ranking attractions first had picked bars
        // and playgrounds, and a 5 m-per-point penalty left out Marina Bay Sands (473 m from the 2026 Singapore track).
        double ToTrack(Point p) => lap.Min(q => Point.Distance(p, q));
        static string BaseName(string n) => System.Text.RegularExpressions.Regex.Replace(n, @"\s+(Tower\s+)?\d+$", "");
        var ranked = landmarks.Where(l => box.Contains(l.At))
            .Select(l => (Name: BaseName(l.Name), l.At, l.Height, Distance: ToTrack(l.At),
                Score: l.Height + (l.Attraction ? 300 : 0) + (l.Notable || l.Height >= 150 ? 50 : 0)))
            .Where(l => l.Distance <= LandmarkReach)
            .OrderByDescending(l => l.Score - l.Distance / 10);
        var shown = new List<(string Name, Point At, double Height)>(forced);
        foreach (var l in ranked.Where(_ => landmarkLabels))
        {
            if (shown.Count >= MaxLandmarks) break;
            if (shown.Any(s => s.Name == l.Name || Point.Distance(s.At, l.At) < LandmarkSpacing)) continue;
            shown.Add((l.Name, l.At, l.Height));
        }
        Console.WriteLine($"Scenery: {shown.Count} landmarks ({string.Join(", ", shown.Select(l => l.Name))})");
        var corners2 = new[] { new Point(box.MinX, box.MinY), new Point(box.MaxX, box.MinY), new Point(box.MaxX, box.MaxY), new Point(box.MinX, box.MaxY) }.Select(output).ToList();

        var boxOut = new[] { Math.Round(corners2.Min(p => p.X)), Math.Round(corners2.Min(p => p.Y)), Math.Round(corners2.Max(p => p.X)), Math.Round(corners2.Max(p => p.Y)) };
        return new
        {
            attribution = Attribution,
            // In the track file's coordinates (for F1 tracks, the bounding box of the turned box).
            box = boxOut,
            landmarks = shown.Select(l => new { name = l.Name, at = At(l.At), h = Math.Round(l.Height) }),
            corners = corners ?? [],
            buildings,
            water = water.Concat(ocean),
            beach,
            parks,
            woods = woods.Select(a => Polygon(a.Outer, a.Holes)),
            trees,
            markings,
            terrain = terrain is null ? null : await terrain(boxOut),
        };
    }

    /// <summary>Grandstands without a height in OSM (Bathurst's are temporary stands): an assumption, not a measurement.</summary>
    const double GrandstandMetres = 9;
    /// <summary>Trees without a height in OSM.</summary>
    const double TreeMetres = 12;
    const double ScrubMetres = 4;
    /// <summary>Metres between trees along a tree row, and between trees filled into a wood (OSM maps woods as areas).</summary>
    const double RowSpacing = 9;
    const double WoodSpacing = 16;
    const int MaxTrees = 30000;

    /// <summary>OSM height, else levels x a storey.</summary>
    static double? HeightOf(Dictionary<string, string> t) =>
        Number(t.GetValueOrDefault("height")) ?? (Number(t.GetValueOrDefault("building:levels")) is { } l ? l * StoreyMetres : null);

    /// <summary>
    /// Trees to draw: each mapped tree, trees every <see cref="RowSpacing"/> m along tree rows, and woods and scrub
    /// filled on a <see cref="WoodSpacing"/> m grid with a fixed jitter (so a rebuild draws the same trees). OSM maps
    /// where the woods are, not each tree in them: the filled ones show the wood, not real trees.
    /// </summary>
    static List<(Point At, double Height)> Trees(List<(Point At, Dictionary<string, string> Tags)> mapped, List<List<Point>> rows,
        List<(Dictionary<string, string> Tags, List<Point> Outer, List<List<Point>> Holes, string Id)> woods, Box box)
    {
        var trees = new List<(Point, double)>();
        foreach (var (at, tags) in mapped.Where(t => box.Contains(t.At))) trees.Add((at, Number(tags.GetValueOrDefault("height")) ?? TreeMetres));
        foreach (var row in rows)
            for (int i = 0; i + 1 < row.Count; i++)
            {
                int n = Math.Max(1, (int)(Point.Distance(row[i], row[i + 1]) / RowSpacing));
                for (int k = 0; k < n; k++)
                {
                    var p = new Point(row[i].X + (row[i + 1].X - row[i].X) * k / n, row[i].Y + (row[i + 1].Y - row[i].Y) * k / n);
                    if (box.Contains(p)) trees.Add((p, TreeMetres));
                }
            }
        foreach (var (tags, outer, holes, _) in woods)
        {
            double height = tags.GetValueOrDefault("natural") == "scrub" ? ScrubMetres : TreeMetres;
            double minX = outer.Min(p => p.X), maxX = outer.Max(p => p.X), minY = outer.Min(p => p.Y), maxY = outer.Max(p => p.Y);
            for (double x = Math.Floor(minX / WoodSpacing) * WoodSpacing; x <= maxX; x += WoodSpacing)
                for (double y = Math.Floor(minY / WoodSpacing) * WoodSpacing; y <= maxY; y += WoodSpacing)
                {
                    // A fixed pseudo-random jitter from the grid position, so the trees don't stand in rows.
                    double jx = Hash(x, y) - 0.5, jy = Hash(y, x) - 0.5;
                    var p = new Point(x + jx * WoodSpacing * 0.8, y + jy * WoodSpacing * 0.8);
                    if (box.Contains(p) && Inside(p, outer) && !holes.Any(h => Inside(p, h)))
                        trees.Add((p, Math.Round(height * (0.75 + 0.5 * Hash(x + 1, y + 1)), 1)));
                }
        }
        return trees.Count > MaxTrees ? trees.Where((_, i) => i % (trees.Count / MaxTrees + 1) == 0).ToList() : trees;
    }

    static double Hash(double a, double b)
    {
        var h = Math.Sin(a * 12.9898 + b * 78.233) * 43758.5453;
        return h - Math.Floor(h);
    }

    /// <summary>Overpass clauses for --landmarks-add elements ("way/123" -> way(123);), so they're fetched with the rest.</summary>
    static string ExtraQuery(IReadOnlyCollection<string> ids) =>
        string.Concat(ids.Select(id => id.Split('/') is [var type, var n] ? $"{type}({n});" : ""));

    const double LandmarkHeight = 60;
    const int MaxLandmarks = 16;
    const double LandmarkReach = 800;
    const double LandmarkSpacing = 200;

    /// <summary>Attraction, theme park, museum, stadium or named tower. Tags can hold lists ("attraction;theme_park").</summary>
    static bool IsAttraction(Dictionary<string, string> t) =>
        (t.GetValueOrDefault("tourism") ?? "").Split(';').Any(v => v is "attraction" or "theme_park" or "museum")
        || t.GetValueOrDefault("leisure") == "stadium" || IsLandmarkTower(t);

    /// <summary>
    /// A tower worth labelling: an observation tower, one with a Wikipedia/Wikidata link, or 50 m or taller, but not a
    /// lifeguard tower (the Gold Coast's are tagged as observation towers and filled its list).
    /// </summary>
    static bool IsLandmarkTower(Dictionary<string, string> t) =>
        (t.GetValueOrDefault("man_made") is "tower" or "observation_tower") && t.GetValueOrDefault("emergency") != "lifeguard"
        && (t.GetValueOrDefault("man_made") == "observation_tower" || t.GetValueOrDefault("tower:type") == "observation"
            || t.ContainsKey("wikidata") || t.ContainsKey("wikipedia") || (Number(t.GetValueOrDefault("height")) ?? 0) >= 50);

    /// <summary>The English name where OSM has one (Yas Island's Ferrari World is named in Arabic), else the name.</summary>
    static string EnglishName(Dictionary<string, string> t) => t.GetValueOrDefault("name:en") is { Length: > 0 } en ? en : t["name"];

    /// <summary>The English name, with "hotel" added for a hotel whose name doesn't say so (Bathurst's is just "Rydges").</summary>
    static string LandmarkName(Dictionary<string, string> t) =>
        t.GetValueOrDefault("tourism") == "hotel" && !EnglishName(t).Contains("hotel", StringComparison.OrdinalIgnoreCase) ? $"{EnglishName(t)} hotel" : EnglishName(t);

    static Point Centroid(List<Point> ring) => new(ring.Average(p => p.X), ring.Average(p => p.Y));

    static async Task<string> DownloadAsync(string query)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(150) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("supercars-timing-trackbuilder/0.1 (personal hobby project)");
        foreach (var url in Mirrors)
        {
            try
            {
                Console.WriteLine($"Downloading scenery from {url}...");
                var body = await (await http.PostAsync(url, new FormUrlEncodedContent([new("data", query)]))).Content.ReadAsStringAsync();
                if (body.TrimStart().StartsWith('{')) return body;
                Console.WriteLine("  busy or failed; trying the next server");
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException) { Console.WriteLine($"  {e.Message}"); }
        }
        throw new InvalidOperationException("No Overpass server answered; try again later");
    }

    static double? Number(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        var digits = new string(s.Trim().TakeWhile(c => char.IsDigit(c) || c == '.').ToArray());
        return double.TryParse(digits, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null;
    }

    /// <summary>Joins ways that share end nodes into closed rings (reversing ways where needed).</summary>
    static List<List<long>> JoinRings(IEnumerable<List<long>> ways) => JoinLines(ways).Where(r => r.Count > 3 && r[0] == r[^1]).ToList();

    /// <summary>Joins ways that share end nodes into the longest possible lines (closed where they close).</summary>
    static List<List<long>> JoinLines(IEnumerable<List<long>> ways)
    {
        var pending = ways.Select(w => new List<long>(w)).ToList();
        var result = new List<List<long>>();
        while (pending.Count > 0)
        {
            var line = pending[0];
            pending.RemoveAt(0);
            bool grew = true;
            while (grew && line[0] != line[^1])
            {
                grew = false;
                for (int i = 0; i < pending.Count; i++)
                {
                    var w = pending[i];
                    if (w[0] == line[^1]) line.AddRange(w.Skip(1));
                    else if (w[^1] == line[^1]) line.AddRange(Enumerable.Reverse(w).Skip(1));
                    else if (w[^1] == line[0]) line.InsertRange(0, w.Take(w.Count - 1));
                    else if (w[0] == line[0]) line.InsertRange(0, Enumerable.Reverse(w).Take(w.Count - 1));
                    else continue;
                    pending.RemoveAt(i);
                    grew = true;
                    break;
                }
            }
            result.Add(line);
        }
        return result;
    }

    /// <summary>Point in polygon (even-odd rule).</summary>
    static bool Inside(Point p, List<Point> ring)
    {
        bool inside = false;
        for (int i = 0, j = ring.Count - 1; i < ring.Count; j = i++)
            if ((ring[i].Y > p.Y) != (ring[j].Y > p.Y) && p.X < (ring[j].X - ring[i].X) * (p.Y - ring[i].Y) / (ring[j].Y - ring[i].Y) + ring[i].X)
                inside = !inside;
        return inside;
    }

    sealed record Box(double MinX, double MinY, double MaxX, double MaxY)
    {
        public bool Contains(Point p) => p.X >= MinX && p.X <= MaxX && p.Y >= MinY && p.Y <= MaxY;

        /// <summary>Sutherland-Hodgman: the part of a polygon inside the box.</summary>
        public List<Point> Clip(List<Point> polygon)
        {
            var output = polygon;
            foreach (var (inside, cross) in Edges())
            {
                var input = output;
                output = [];
                for (int i = 0; i < input.Count; i++)
                {
                    var a = input[i];
                    var b = input[(i + 1) % input.Count];
                    if (inside(b)) { if (!inside(a)) output.Add(cross(a, b)); output.Add(b); }
                    else if (inside(a)) output.Add(cross(a, b));
                }
                if (output.Count == 0) break;
            }
            return output;
        }

        IEnumerable<(Func<Point, bool> Inside, Func<Point, Point, Point> Cross)> Edges()
        {
            Point AtX(Point a, Point b, double x) => new(x, a.Y + (b.Y - a.Y) * (x - a.X) / (b.X - a.X));
            Point AtY(Point a, Point b, double y) => new(a.X + (b.X - a.X) * (y - a.Y) / (b.Y - a.Y), y);
            yield return (p => p.X >= MinX, (a, b) => AtX(a, b, MinX));
            yield return (p => p.X <= MaxX, (a, b) => AtX(a, b, MaxX));
            yield return (p => p.Y >= MinY, (a, b) => AtY(a, b, MinY));
            yield return (p => p.Y <= MaxY, (a, b) => AtY(a, b, MaxY));
        }

        /// <summary>
        /// Sea polygons from a coastline line: each stretch of the line that crosses the box, closed round the box
        /// edge on its right-hand (water) side, i.e. clockwise from where it leaves the box to where it entered.
        /// </summary>
        public IEnumerable<List<Point>> WaterSide(List<Point> line)
        {
            // Stretches inside the box, with the crossing points on the box edge at each end.
            var stretch = new List<Point>();
            for (int i = 0; i < line.Count; i++)
            {
                var p = line[i];
                if (Contains(p))
                {
                    if (stretch.Count == 0 && i > 0) stretch.Add(EdgeCrossing(line[i - 1], p));
                    stretch.Add(p);
                }
                else if (stretch.Count > 0)
                {
                    stretch.Add(EdgeCrossing(p, line[i - 1]));
                    if (OnEdge(stretch[0])) yield return CloseClockwise(stretch);
                    stretch = [];
                }
            }
        }

        bool OnEdge(Point p) => Math.Abs(p.X - MinX) < 1e-6 || Math.Abs(p.X - MaxX) < 1e-6 || Math.Abs(p.Y - MinY) < 1e-6 || Math.Abs(p.Y - MaxY) < 1e-6;

        /// <summary>Where the segment from the inside point to the outside point crosses the box edge.</summary>
        Point EdgeCrossing(Point outside, Point inside)
        {
            // Fraction of the way from `inside` to `outside` at which each edge is crossed; the first one wins.
            double t = 1, dx = outside.X - inside.X, dy = outside.Y - inside.Y;
            if (outside.X < MinX) t = Math.Min(t, (MinX - inside.X) / dx);
            if (outside.X > MaxX) t = Math.Min(t, (MaxX - inside.X) / dx);
            if (outside.Y < MinY) t = Math.Min(t, (MinY - inside.Y) / dy);
            if (outside.Y > MaxY) t = Math.Min(t, (MaxY - inside.Y) / dy);
            return new Point(inside.X + dx * t, inside.Y + dy * t);
        }

        /// <summary>Position along the box edge, clockwise from the top-left corner (y is north, up).</summary>
        double Around(Point p)
        {
            double w = MaxX - MinX, h = MaxY - MinY;
            if (Math.Abs(p.Y - MaxY) < 1e-6) return p.X - MinX;                // top, going east
            if (Math.Abs(p.X - MaxX) < 1e-6) return w + (MaxY - p.Y);          // right, going south
            if (Math.Abs(p.Y - MinY) < 1e-6) return w + h + (MaxX - p.X);      // bottom, going west
            return 2 * w + h + (p.Y - MinY);                                     // left, going north
        }

        List<Point> CloseClockwise(List<Point> stretch)
        {
            double w = MaxX - MinX, h = MaxY - MinY, perimeter = 2 * (w + h);
            var corners = new[] { (0.0, new Point(MinX, MaxY)), (w, new Point(MaxX, MaxY)), (w + h, new Point(MaxX, MinY)), (2 * w + h, new Point(MinX, MinY)) };
            double from = Around(stretch[^1]), to = Around(stretch[0]);
            double span = ((to - from) % perimeter + perimeter) % perimeter;
            var ring = new List<Point>(stretch);
            foreach (var (at, corner) in corners.OrderBy(c => ((c.Item1 - from) % perimeter + perimeter) % perimeter))
                if (((at - from) % perimeter + perimeter) % perimeter < span) ring.Add(corner);
            return ring;
        }
    }
}

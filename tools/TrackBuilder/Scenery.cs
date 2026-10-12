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
    ];

    /// <summary>
    /// Builds the scenery for the box around the lap (`margin` metres beyond the circuit). The raw Overpass answer is
    /// cached at <paramref name="cachePath"/> (git-ignored: it's large and easy to fetch again).
    /// </summary>
    public static async Task<object> BuildAsync(IReadOnlyList<Point> lap, Projection projection, double margin, string cachePath)
    {
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
                 way["leisure"="park"]({bb});relation["leisure"="park"]({bb});way["landuse"="grass"]({bb}););
                out body;>;out skel qt;
                """;
            Directory.CreateDirectory(Path.GetDirectoryName(cachePath)!);
            await File.WriteAllTextAsync(cachePath, await DownloadAsync(query));
        }

        using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(cachePath));
        var nodes = new Dictionary<long, Point>();
        var ways = new Dictionary<long, (List<long> Nodes, Dictionary<string, string> Tags)>();
        var relations = new List<(List<(long Ref, string Role)> Members, Dictionary<string, string> Tags)>();
        foreach (var e in doc.RootElement.GetProperty("elements").EnumerateArray())
        {
            var tags = e.TryGetProperty("tags", out var t) ? t.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.GetString() ?? "") : [];
            switch (e.GetProperty("type").GetString())
            {
                case "node": nodes[e.GetProperty("id").GetInt64()] = projection.ToMetres(e.GetProperty("lat").GetDouble(), e.GetProperty("lon").GetDouble()); break;
                case "way": ways[e.GetProperty("id").GetInt64()] = (e.GetProperty("nodes").EnumerateArray().Select(n => n.GetInt64()).ToList(), tags); break;
                case "relation":
                    relations.Add((e.GetProperty("members").EnumerateArray().Where(m => m.GetProperty("type").GetString() == "way")
                        .Select(m => (m.GetProperty("ref").GetInt64(), m.GetProperty("role").GetString() ?? "")).ToList(), tags));
                    break;
            }
        }
        List<Point> Pts(List<long> ids) => ids.Where(nodes.ContainsKey).Select(id => nodes[id]).ToList();

        // Areas: closed ways, and multipolygon relations (outer rings with inner rings as holes).
        var areas = new List<(Dictionary<string, string> Tags, List<Point> Outer, List<List<Point>> Holes)>();
        foreach (var (wayNodes, tags) in ways.Values)
            if (wayNodes.Count > 3 && wayNodes[0] == wayNodes[^1]) areas.Add((tags, Pts(wayNodes), []));
        foreach (var (members, tags) in relations)
        {
            List<List<Point>> RingsOf(string role) => JoinRings(members.Where(m => m.Role == role && ways.ContainsKey(m.Ref)).Select(m => ways[m.Ref].Nodes))
                .Select(Pts).Where(r => r.Count > 3).ToList();
            var inner = RingsOf("inner");
            foreach (var outer in RingsOf("outer")) areas.Add((tags, outer, inner.Where(h => Inside(h[0], outer)).ToList()));
        }

        static string Kind(Dictionary<string, string> t) =>
            t.ContainsKey("building") || t.ContainsKey("building:part") ? "building"
            : t.GetValueOrDefault("natural") is "water" ? "water"
            : t.GetValueOrDefault("natural") is "beach" or "sand" ? "beach"
            : t.GetValueOrDefault("leisure") == "park" || t.GetValueOrDefault("landuse") == "grass" ? "park" : "";

        static double[][] Ring(List<Point> ring) => ring.Select(p => new[] { Math.Round(p.X, 1), Math.Round(p.Y, 1) }).ToArray();
        object Polygon(List<Point> outer, List<List<Point>> holes) => new
        {
            outer = Ring(box.Clip(outer)),
            holes = holes.Select(box.Clip).Where(h => h.Count > 2).Select(Ring),
        };

        var buildings = new List<object>();
        int measured = 0, fromLevels = 0, assumed = 0;
        foreach (var (tags, outer, _) in areas.Where(a => Kind(a.Tags) == "building"))
        {
            var clipped = box.Clip(outer);
            if (clipped.Count < 3 || clipped.Count != outer.Count) continue; // only buildings wholly in the box
            double? height = Number(tags.GetValueOrDefault("height"));
            double? levels = Number(tags.GetValueOrDefault("building:levels"));
            double h = height ?? (levels is { } l ? l * StoreyMetres : AssumedStoreys * StoreyMetres);
            if (height is not null) measured++; else if (levels is not null) fromLevels++; else assumed++;
            double minH = Number(tags.GetValueOrDefault("min_height")) ?? (Number(tags.GetValueOrDefault("building:min_level")) is { } ml ? ml * StoreyMetres : 0);
            if (h <= minH) continue;
            buildings.Add(new { h = Math.Round(h, 1), min = Math.Round(minH, 1), ring = Ring(outer), assumed = height is null && levels is null });
        }
        Console.WriteLine($"Scenery: {buildings.Count} buildings ({measured} measured height, {fromLevels} from levels, {assumed} assumed {AssumedStoreys} storeys)");

        var water = areas.Where(a => Kind(a.Tags) == "water").Select(a => Polygon(a.Outer, a.Holes)).ToList();
        var beach = areas.Where(a => Kind(a.Tags) == "beach").Select(a => Polygon(a.Outer, a.Holes)).ToList();
        var parks = areas.Where(a => Kind(a.Tags) == "park").Select(a => Polygon(a.Outer, a.Holes)).ToList();

        // The sea: each coastline way runs with land on its left and water on its right (OSM convention).
        var coast = JoinLines(ways.Values.Where(w => w.Tags.GetValueOrDefault("natural") == "coastline").Select(w => w.Nodes)).Select(Pts).ToList();
        var ocean = coast.SelectMany(line => box.WaterSide(line)).Select(r => new { outer = Ring(r), holes = Array.Empty<double[][]>() }).ToList();
        Console.WriteLine($"Scenery: {water.Count} water, {beach.Count} beach, {parks.Count} park areas, {ocean.Count} sea polygon(s)");

        return new
        {
            attribution = Attribution,
            box = new[] { Math.Round(box.MinX), Math.Round(box.MinY), Math.Round(box.MaxX), Math.Round(box.MaxY) },
            buildings,
            water = water.Concat(ocean),
            beach,
            parks,
        };
    }

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
        bool Contains(Point p) => p.X >= MinX && p.X <= MaxX && p.Y >= MinY && p.Y <= MaxY;

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

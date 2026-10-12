namespace TrackBuilder;

/// <summary>
/// Lines up a track file that isn't in latitude/longitude (F1's, in F1's own x/y metres) with the circuit in
/// OpenStreetMap, so scenery from OSM can be drawn around it. A similarity transform (rotation, one scale, shift,
/// and possibly a mirror: F1's y may point south) is found by a rotation sweep and iterative closest point, from
/// the track file's centreline to every point of the OSM circuit's ways. In 2D a similarity is z -> a*z + b with a
/// and b complex numbers, which keeps the least-squares step to a few sums.
/// </summary>
public sealed class Georef
{
    public double Ar { get; private init; }
    public double Ai { get; private init; }
    public double Br { get; private init; }
    public double Bi { get; private init; }
    public bool Mirror { get; private init; }
    public double MeanMetres { get; private init; }
    public double MaxMetres { get; private init; }
    public double Scale => Math.Sqrt(Ar * Ar + Ai * Ai);
    public double RotationDegrees => Math.Atan2(Ai, Ar) * 180 / Math.PI;

    /// <summary>Track file point -> OSM metres.</summary>
    public Point Forward(Point p)
    {
        double y = Mirror ? -p.Y : p.Y;
        return new(Ar * p.X - Ai * y + Br, Ai * p.X + Ar * y + Bi);
    }

    /// <summary>OSM metres -> track file point.</summary>
    public Point Back(Point q)
    {
        // z = (w - b) / a
        double x = q.X - Br, y = q.Y - Bi, d = Ar * Ar + Ai * Ai;
        double zx = (x * Ar + y * Ai) / d, zy = (y * Ar - x * Ai) / d;
        return new(zx, Mirror ? -zy : zy);
    }

    /// <param name="track">The track file's centreline (closed loop, in its own units).</param>
    /// <param name="osmWays">The OSM circuit's ways in metres. OSM only puts nodes at bends, so they're filled in
    /// every 5 m: matching against bare nodes left whole straights without a point.</param>
    public static Georef Fit(IReadOnlyList<Point> track, IReadOnlyList<IReadOnlyList<Point>> osmWays)
    {
        var src = Thin(track, 15);
        var dst = osmWays.SelectMany(w => Densify(w, 5)).ToList();
        double osmSpan = Span(dst), trackSpan = Span(track);
        Georef? best = null;
        foreach (var mirror in new[] { false, true })
        {
            var s = src.Select(p => mirror ? new Point(p.X, -p.Y) : p).ToList();
            for (int deg = 0; deg < 360; deg += 4)
            {
                double r = deg * Math.PI / 180, scale = osmSpan / trackSpan;
                var (sx, sy) = Mean(s);
                var (ox, oy) = Mean(dst);
                double ar = scale * Math.Cos(r), ai = scale * Math.Sin(r);
                var t = (ar, ai, br: ox - (ar * sx - ai * sy), bi: oy - (ai * sx + ar * sy));
                for (int k = 0; k < 25; k++) t = Solve(s, s.Select(p => Nearest(Apply(t, p), dst).At).ToList());
                double err = s.Average(p => Nearest(Apply(t, p), dst).Dist);
                if (best is null || err < best.MeanMetres)
                    best = new Georef { Ar = t.ar, Ai = t.ai, Br = t.br, Bi = t.bi, Mirror = mirror, MeanMetres = err };
            }
        }
        var all = Thin(track, 2).Select(p => Nearest(best!.Forward(p), dst).Dist).ToList();
        return new Georef { Ar = best!.Ar, Ai = best.Ai, Br = best.Br, Bi = best.Bi, Mirror = best.Mirror, MeanMetres = all.Average(), MaxMetres = all.Max() };
    }

    static Point Apply((double ar, double ai, double br, double bi) t, Point p) => new(t.ar * p.X - t.ai * p.Y + t.br, t.ai * p.X + t.ar * p.Y + t.bi);

    /// <summary>Least squares: a = sum((w - w̄) conj(z - z̄)) / sum|z - z̄|², b = w̄ - a z̄.</summary>
    static (double ar, double ai, double br, double bi) Solve(List<Point> src, List<Point> dst)
    {
        var (zx, zy) = Mean(src);
        var (wx, wy) = Mean(dst);
        double nr = 0, ni = 0, den = 0;
        for (int i = 0; i < src.Count; i++)
        {
            double x = src[i].X - zx, y = src[i].Y - zy, u = dst[i].X - wx, v = dst[i].Y - wy;
            nr += u * x + v * y; ni += v * x - u * y; den += x * x + y * y;
        }
        double ar = nr / den, ai = ni / den;
        return (ar, ai, wx - (ar * zx - ai * zy), wy - (ai * zx + ar * zy));
    }

    static (Point At, double Dist) Nearest(Point q, List<Point> set)
    {
        double best = double.MaxValue; Point at = set[0];
        foreach (var p in set)
        {
            double d = (p.X - q.X) * (p.X - q.X) + (p.Y - q.Y) * (p.Y - q.Y);
            if (d < best) { best = d; at = p; }
        }
        return (at, Math.Sqrt(best));
    }

    static (double, double) Mean(IReadOnlyCollection<Point> ps) => (ps.Average(p => p.X), ps.Average(p => p.Y));
    static double Span(IReadOnlyList<Point> ps) => Math.Max(ps.Max(p => p.X) - ps.Min(p => p.X), ps.Max(p => p.Y) - ps.Min(p => p.Y));

    /// <summary>The polyline with extra points so none are more than `step` metres apart.</summary>
    static IEnumerable<Point> Densify(IReadOnlyList<Point> line, double step)
    {
        for (int i = 0; i + 1 < line.Count; i++)
        {
            var (a, b) = (line[i], line[i + 1]);
            int n = Math.Max(1, (int)Math.Ceiling(Point.Distance(a, b) / step));
            for (int k = 0; k < n; k++) yield return new(a.X + (b.X - a.X) * k / n, a.Y + (b.Y - a.Y) * k / n);
        }
        if (line.Count > 0) yield return line[^1];
    }

    /// <summary>Points every `step` metres along a polyline (or a thinned point cloud when it isn't one).</summary>
    static List<Point> Thin(IReadOnlyList<Point> ps, double step)
    {
        var output = new List<Point> { ps[0] };
        foreach (var p in ps)
            if (Point.Distance(p, output[^1]) >= step) output.Add(p);
        return output;
    }
}

/// <summary>
/// TrackBuilder --georef &lt;track file code&gt;: scenery (and OSM's numbered corners) for a track file that isn't in
/// latitude/longitude, such as F1's. The track file itself isn't changed (tools/F1TrackBuilder writes it).
/// </summary>
public static class GeorefScenery
{
    public static async Task<int> RunAsync(Dictionary<string, string> opt, string root)
    {
        var code = opt["georef"];
        if (!opt.TryGetValue("relation", out var relationText)) { Console.WriteLine("--georef needs --relation <OSM circuit relation>"); return 1; }
        var trackFile = Path.Combine(root, $"src/web/src/tracks/{code}.json");
        using var trackDoc = System.Text.Json.JsonDocument.Parse(await File.ReadAllTextAsync(trackFile));
        var path = trackDoc.RootElement.GetProperty("path").EnumerateArray().Select(p => new Point(p[0].GetDouble(), p[1].GetDouble())).ToList();
        double step = trackDoc.RootElement.GetProperty("step").GetDouble();

        var osmPath = Path.Combine(root, $"tools/TrackBuilder/osm/{code}.osm.json");
        if (!File.Exists(osmPath))
        {
            Console.WriteLine($"Downloading OSM relation {relationText}...");
            await File.WriteAllTextAsync(osmPath, await OsmCircuit.DownloadAsync(long.Parse(relationText)));
        }
        // Every way of the relation except pit lanes (some relations hold several layouts: the fit finds the right one).
        using var osmDoc = System.Text.Json.JsonDocument.Parse(await File.ReadAllTextAsync(osmPath));
        var nodes = new Dictionary<long, (double Lat, double Lon, string? Name, string? Ref)>();
        var ways = new Dictionary<long, List<long>>();
        var members = new List<(long Ref, string Role)>();
        foreach (var e in osmDoc.RootElement.GetProperty("elements").EnumerateArray())
        {
            var tags = e.TryGetProperty("tags", out var t) ? t : default;
            string? Tag(string k) => tags.ValueKind == System.Text.Json.JsonValueKind.Object && tags.TryGetProperty(k, out var v) ? v.GetString() : null;
            switch (e.GetProperty("type").GetString())
            {
                case "node": nodes[e.GetProperty("id").GetInt64()] = (e.GetProperty("lat").GetDouble(), e.GetProperty("lon").GetDouble(), Tag("name"), Tag("ref")); break;
                case "way": ways[e.GetProperty("id").GetInt64()] = e.GetProperty("nodes").EnumerateArray().Select(n => n.GetInt64()).ToList(); break;
                case "relation":
                    members.AddRange(e.GetProperty("members").EnumerateArray().Where(m => m.GetProperty("type").GetString() == "way")
                        .Select(m => (m.GetProperty("ref").GetInt64(), m.GetProperty("role").GetString() ?? "")));
                    break;
            }
        }
        var circuitWays = members.Where(m => m.Role != "pit_lane" && ways.ContainsKey(m.Ref)).Select(m => ways[m.Ref]).ToList();
        var used = circuitWays.SelectMany(w => w).Distinct().Where(nodes.ContainsKey).ToList();
        var projection = new Projection(used.Average(id => nodes[id].Lat), used.Average(id => nodes[id].Lon));
        Point P(long id) => projection.ToMetres(nodes[id].Lat, nodes[id].Lon);

        var fit = Georef.Fit(path, circuitWays.Select(w => (IReadOnlyList<Point>)w.Where(nodes.ContainsKey).Select(P).ToList()).ToList());
        Console.WriteLine($"Fit to OSM relation {relationText}: mean {fit.MeanMetres:0.0} m, max {fit.MaxMetres:0.0} m, scale {fit.Scale:0.000}, " +
            $"rotation {fit.RotationDegrees:0.0}°{(fit.Mirror ? ", mirrored" : "")}");
        if (fit.MeanMetres > 25) { Console.WriteLine("The track doesn't line up with this relation (mean > 25 m): wrong relation or layout?"); return 1; }

        // OSM's numbered corners ("Turn N" nodes on the circuit), at their distance along the track file's lap.
        var corners = new List<object>();
        foreach (var (id, n) in nodes.Where(kv => kv.Value.Ref is { } r && int.TryParse(r, out _) && kv.Value.Name == $"Turn {kv.Value.Ref}"))
        {
            var q = fit.Back(P(id));
            int k = Enumerable.Range(0, path.Count).MinBy(i => Point.Distance(path[i], q));
            if (Point.Distance(path[k], q) < 60) corners.Add(new { name = $"T{n.Ref}", distance = Math.Round(k * step, 1) });
        }
        Console.WriteLine($"Corners from OSM: {corners.Count}");

        var scenery = await Scenery.BuildAsync(path.Select(fit.Forward).ToList(), projection, double.Parse(opt.GetValueOrDefault("scenery") ?? "800",
            System.Globalization.CultureInfo.InvariantCulture), Path.Combine(root, $"tools/TrackBuilder/osm/{code}.scenery.osm.json"), fit.Back, corners,
            landmarkLabels: opt.GetValueOrDefault("landmarks") != "false");
        var outPath = Path.Combine(root, $"src/web/src/tracks/scenery/{code}.json");
        await File.WriteAllTextAsync(outPath, System.Text.Json.JsonSerializer.Serialize(scenery) + "\n");
        Console.WriteLine($"Wrote {Path.GetRelativePath(root, outPath)} ({new FileInfo(outPath).Length / 1024} KB)");
        return 0;
    }
}

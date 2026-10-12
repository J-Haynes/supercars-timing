using System.Globalization;
using System.Text.Json;

namespace TrackBuilder;

/// <summary>
/// The ground around a hilly circuit for the 3D map (Bathurst: the mountain the lap climbs): SRTM heights on a grid
/// over the scenery box, from the same OpenTopoData lookup as the lap's heights (Elevation.cs), so buildings, trees
/// and the hillside sign can sit on the hill instead of floating at track level.
///
/// - Heights are made relative to the lap's lowest point like the track file's `elevation`: shifted by the median
///   difference between the grid and the track's own heights along the lap.
/// - Within <see cref="RoadHalfWidth"/> of the centreline the ground is held just under the road, and it blends back
///   to SRTM over <see cref="Blend"/> metres: SRTM's 30 m cells and the smoothed lap don't agree to the metre, and the
///   road would otherwise sink into the hill in cuttings.
/// Visual only, like all scenery.
/// </summary>
public static class Terrain
{
    /// <summary>Metres between grid points. SRTM cells are ~30 m; 40 m keeps the lookups (100 a request, one request a
    /// second) to about a minute for Bathurst.</summary>
    public const double Spacing = 40;
    const double RoadHalfWidth = 12;
    const double Blend = 50;
    const double UnderRoad = 0.6;

    /// <param name="box">The scenery box [minX, minY, maxX, maxY] in track metres.</param>
    /// <param name="lap">Lap samples every `step` metres, and the track file's heights at them.</param>
    public static async Task<object> BuildAsync(double[] box, IReadOnlyList<Point> lap, double[] lapHeights, Projection projection, string cachePath)
    {
        int cols = (int)Math.Ceiling((box[2] - box[0]) / Spacing) + 1;
        int rows = (int)Math.Ceiling((box[3] - box[1]) / Spacing) + 1;
        var points = new List<Point>();
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++) points.Add(new Point(box[0] + c * Spacing, box[1] + r * Spacing));
        var raw = await Elevation.LookupAsync(points.Select(projection.ToLatLon).ToList(), cachePath);

        double Grid(double x, double y)
        {
            double fx = Math.Clamp((x - box[0]) / Spacing, 0, cols - 1.001), fy = Math.Clamp((y - box[1]) / Spacing, 0, rows - 1.001);
            int c = (int)fx, r = (int)fy;
            double tx = fx - c, ty = fy - r;
            double H(int rr, int cc) => raw[rr * cols + cc];
            return (H(r, c) * (1 - tx) + H(r, c + 1) * tx) * (1 - ty) + (H(r + 1, c) * (1 - tx) + H(r + 1, c + 1) * tx) * ty;
        }
        // Same zero as the track file: the median of (track height - SRTM here) along the lap.
        var offsets = lap.Select((p, k) => lapHeights[k] - Grid(p.X, p.Y)).OrderBy(v => v).ToList();
        double offset = offsets[offsets.Count / 2];
        Console.WriteLine($"Terrain: {cols} x {rows} grid every {Spacing} m; lap vs SRTM: median {offset:0.0} m shift, " +
            $"middle half {offsets[offsets.Count / 4]:0.0} to {offsets[offsets.Count * 3 / 4]:0.0} m");

        var heights = new double[points.Count];
        for (int i = 0; i < points.Count; i++)
        {
            var p = points[i];
            int k = 0;
            double best = double.MaxValue;
            for (int j = 0; j < lap.Count; j++)
            {
                double d = (lap[j].X - p.X) * (lap[j].X - p.X) + (lap[j].Y - p.Y) * (lap[j].Y - p.Y);
                if (d < best) { best = d; k = j; }
            }
            double distance = Math.Sqrt(best), ground = raw[i] + offset, road = lapHeights[k] - UnderRoad;
            double t = Math.Clamp((distance - RoadHalfWidth) / Blend, 0, 1);
            heights[i] = Math.Round(road + (ground - road) * t, 1);
        }
        return new { origin = new[] { box[0], box[1] }, spacing = Spacing, cols, rows, h = heights };
    }
}

namespace TrackBuilder;

public readonly record struct Point(double X, double Y)
{
    public static double Distance(Point a, Point b) => Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y));
}

/// <summary>Equirectangular projection to metres around a reference latitude/longitude. Accurate enough for a circuit.</summary>
public sealed class Projection(double lat0, double lon0)
{
    const double EarthRadius = 6_371_000;
    readonly double _cosLat = Math.Cos(lat0 * Math.PI / 180);

    public Point ToMetres(double lat, double lon) => new(
        (lon - lon0) * Math.PI / 180 * EarthRadius * _cosLat,
        (lat - lat0) * Math.PI / 180 * EarthRadius);

    /// <summary>The inverse of <see cref="ToMetres"/>.</summary>
    public (double Lat, double Lon) ToLatLon(Point p) => (
        lat0 + p.Y / EarthRadius * 180 / Math.PI,
        lon0 + p.X / (EarthRadius * _cosLat) * 180 / Math.PI);
}

/// <summary>A closed loop of points with cumulative distance, starting at distance 0.</summary>
public sealed class Ring
{
    readonly List<Point> _points;   // closed: last == first
    readonly List<double> _cumulative;

    public double Length => _cumulative[^1];

    /// <param name="loop">Closed loop (first point repeated at the end).</param>
    public Ring(IReadOnlyList<Point> loop)
    {
        _points = [.. loop];
        _cumulative = [0];
        for (int i = 1; i < _points.Count; i++) _cumulative.Add(_cumulative[^1] + Point.Distance(_points[i - 1], _points[i]));
    }

    /// <summary>Point at distance <paramref name="d"/> along the loop (wraps).</summary>
    public Point At(double d)
    {
        d = ((d % Length) + Length) % Length;
        int lo = 0, hi = _cumulative.Count - 1;
        while (hi - lo > 1)
        {
            int mid = (lo + hi) / 2;
            if (_cumulative[mid] <= d) lo = mid; else hi = mid;
        }
        double seg = _cumulative[hi] - _cumulative[lo];
        double t = seg > 0 ? (d - _cumulative[lo]) / seg : 0;
        return new(_points[lo].X + t * (_points[hi].X - _points[lo].X), _points[lo].Y + t * (_points[hi].Y - _points[lo].Y));
    }

    /// <summary>Distance along the loop of the closest point to <paramref name="p"/>.</summary>
    public double Project(Point p)
    {
        double bestDist = double.MaxValue, bestAlong = 0;
        for (int i = 0; i < _points.Count - 1; i++)
        {
            var (a, b) = (_points[i], _points[i + 1]);
            double dx = b.X - a.X, dy = b.Y - a.Y, len2 = dx * dx + dy * dy;
            double t = len2 > 0 ? Math.Clamp(((p.X - a.X) * dx + (p.Y - a.Y) * dy) / len2, 0, 1) : 0;
            var q = new Point(a.X + t * dx, a.Y + t * dy);
            double dist = Point.Distance(p, q);
            if (dist < bestDist) { bestDist = dist; bestAlong = _cumulative[i] + t * Math.Sqrt(len2); }
        }
        return bestAlong;
    }

    /// <summary>The same loop re-started at distance <paramref name="start"/>.</summary>
    public Ring RotateTo(double start)
    {
        var step = 1.0;
        var pts = new List<Point>();
        for (double d = 0; d < Length; d += step) pts.Add(At(start + d));
        pts.Add(pts[0]);
        return new Ring(pts);
    }

    /// <summary>Points every <paramref name="step"/> metres (not closed).</summary>
    public List<Point> Resample(double step)
    {
        int n = (int)(Length / step);
        return Enumerable.Range(0, n).Select(k => At(k * step)).ToList();
    }
}

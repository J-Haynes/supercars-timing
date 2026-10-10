namespace TrackBuilder;

/// <summary>
/// A deliberately simple "quasi-static" lap simulation: corner speed limited by lateral grip
/// (v = sqrt(a_lat * radius)), then forward pass for acceleration and backward pass for braking.
/// It ignores elevation, so it isn't a physics model of a Supercar; its job is to give a believable
/// *shape* of speed around the lap, so cars slow for corners when we interpolate between timing points.
/// </summary>
public sealed class LapSimulator(IReadOnlyList<Point> samples, double step)
{
    const double G = 9.81;
    public double TopSpeed { get; init; } = 82;       // m/s (~295 km/h)
    public double Acceleration { get; init; } = 0.65 * G;
    public double Braking { get; init; } = 1.7 * G;

    /// <summary>Simulated speed (m/s) at each sample.</summary>
    public double[] Speed { get; private set; } = [];

    /// <summary>Cumulative simulated time (s) at each sample; one extra entry at the end for the full lap.</summary>
    public double[] Time { get; private set; } = [];

    public double LapTime => Time[^1];

    public void Run(double lateralG)
    {
        int n = samples.Count;
        var radius = Radii();
        var v = new double[n];
        for (int k = 0; k < n; k++) v[k] = Math.Min(TopSpeed, Math.Sqrt(lateralG * G * radius[k]));

        // Two passes each way so the start/finish wraparound settles.
        for (int pass = 0; pass < 2; pass++)
        {
            for (int k = 0; k < n; k++)
            {
                var prev = v[(k - 1 + n) % n];
                var power = Math.Max(0, 1 - prev / TopSpeed * 0.6);   // less acceleration at high speed
                v[k] = Math.Min(v[k], Math.Sqrt(prev * prev + 2 * Acceleration * power * step));
            }
            for (int k = n - 1; k >= 0; k--)
            {
                var next = v[(k + 1) % n];
                v[k] = Math.Min(v[k], Math.Sqrt(next * next + 2 * Braking * step));
            }
        }

        var t = new double[n + 1];
        for (int k = 0; k < n; k++) t[k + 1] = t[k] + step / ((v[k] + v[(k + 1) % n]) / 2);
        Speed = v;
        Time = t;
    }

    /// <summary>Finds the lateral grip that makes the simulated lap match <paramref name="targetLapTime"/>.</summary>
    public double FitLapTime(double targetLapTime)
    {
        double lo = 0.8, hi = 4.0;
        for (int i = 0; i < 40; i++)
        {
            double mid = (lo + hi) / 2;
            Run(mid);
            if (LapTime > targetLapTime) lo = mid; else hi = mid;
        }
        Run((lo + hi) / 2);
        return (lo + hi) / 2;
    }

    /// <summary>Distance (m) at which the simulated car reaches time <paramref name="t"/> into the lap.</summary>
    public double DistanceAtTime(double t)
    {
        int lo = 0, hi = Time.Length - 1;
        while (hi - lo > 1)
        {
            int mid = (lo + hi) / 2;
            if (Time[mid] <= t) lo = mid; else hi = mid;
        }
        double f = (t - Time[lo]) / (Time[hi] - Time[lo]);
        return (lo + f) * step;
    }

    /// <summary>Turning radius at each sample from a circle through points 20 m either side, lightly smoothed.</summary>
    double[] Radii()
    {
        int n = samples.Count, w = Math.Max(1, (int)Math.Round(20 / step));
        var r = new double[n];
        for (int k = 0; k < n; k++)
        {
            Point a = samples[(k - w + n) % n], b = samples[k], c = samples[(k + w) % n];
            double area2 = Math.Abs((b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X));
            r[k] = area2 < 1e-6 ? 1e9 : Point.Distance(a, b) * Point.Distance(b, c) * Point.Distance(c, a) / (2 * area2);
        }
        // Take the tightest radius nearby so braking starts a little before the apex.
        return Enumerable.Range(0, n).Select(k => Enumerable.Range(-2, 5).Min(j => r[(k + j + n) % n])).ToArray();
    }
}

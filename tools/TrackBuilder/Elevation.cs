using System.Globalization;
using System.Text.Json;

namespace TrackBuilder;

/// <summary>
/// Track heights from NASA's SRTM 30 m elevation model, looked up through the public OpenTopoData API
/// (https://www.opentopodata.org/api/ : at most 100 locations per request and 1 request per second).
/// Answers are cached in tools/TrackBuilder/elevation/&lt;CODE&gt;.json, so a rebuild doesn't ask again.
///
/// SRTM is a radar model of the ground at 30 m resolution: single readings are off by a few metres (trees,
/// cuttings, embankments), so the profile is smoothed. Good for a picture of the hills, not for surveying.
/// </summary>
public static class Elevation
{
    public const string Attribution = "Elevation: NASA SRTM 30 m via OpenTopoData";
    const string Dataset = "srtm30m";
    const int BatchSize = 100;
    /// <summary>Metres between looked-up points. SRTM cells are ~30 m, so closer points add no detail.</summary>
    const double LookupSpacing = 20;
    /// <summary>Half-width of the moving average, in metres, applied twice (close to a Gaussian).</summary>
    const double SmoothHalfWidth = 40;

    /// <summary>
    /// Height in metres at each sample, relative to the lowest point of the lap (so the lowest point is 0).
    /// </summary>
    /// <param name="samples">Lap samples every <paramref name="step"/> metres (not closed).</param>
    public static async Task<double[]> ForLapAsync(IReadOnlyList<Point> samples, double step, Projection projection, string cachePath)
    {
        int n = samples.Count;
        int every = Math.Max(1, (int)Math.Round(LookupSpacing / step));
        var lookupIdx = Enumerable.Range(0, n).Where(k => k % every == 0).ToList();
        var places = lookupIdx.Select(k => projection.ToLatLon(samples[k])).ToList();

        var looked = await LookupAsync(places, cachePath);

        // Fill every sample by linear interpolation between looked-up points (wrapping at the line).
        var raw = new double[n];
        for (int a = 0; a < lookupIdx.Count; a++)
        {
            int ka = lookupIdx[a];
            int kb = a + 1 < lookupIdx.Count ? lookupIdx[a + 1] : n + lookupIdx[0];
            double ha = looked[a];
            double hb = looked[(a + 1) % places.Count];
            for (int k = ka; k < kb; k++) raw[k % n] = ha + (hb - ha) * (k - ka) / (kb - ka);
        }

        int w = Math.Max(1, (int)Math.Round(SmoothHalfWidth / step));
        var smooth = MovingAverage(MovingAverage(raw, w), w);
        var min = smooth.Min();
        return smooth.Select(h => h - min).ToArray();
    }

    /// <summary>
    /// SRTM height in metres (above sea level) at each place, from the cache at <paramref name="cachePath"/> or the
    /// public API (in batches of 100, one request a second), adding new answers to the cache.
    /// </summary>
    public static async Task<double[]> LookupAsync(IReadOnlyList<(double Lat, double Lon)> places, string cachePath)
    {
        var cache = File.Exists(cachePath)
            ? JsonSerializer.Deserialize<Dictionary<string, double>>(await File.ReadAllTextAsync(cachePath)) ?? []
            : [];
        var missing = places.Select(Key).Where(k => !cache.ContainsKey(k)).Distinct().ToList();
        if (missing.Count > 0)
        {
            Console.WriteLine($"Looking up {missing.Count} heights from OpenTopoData ({Dataset})...");
            using var http = new HttpClient();
            http.DefaultRequestHeaders.UserAgent.ParseAdd("supercars-timing-trackbuilder/0.1 (personal hobby project)");
            for (int i = 0; i < missing.Count; i += BatchSize)
            {
                if (i > 0) await Task.Delay(1100);   // the public API allows one request a second
                var batch = missing.Skip(i).Take(BatchSize).ToList();
                var url = $"https://api.opentopodata.org/v1/{Dataset}?locations={string.Join('|', batch)}";
                using var doc = JsonDocument.Parse(await http.GetStringAsync(url));
                var results = doc.RootElement.GetProperty("results").EnumerateArray().ToList();
                for (int j = 0; j < batch.Count; j++)
                {
                    var e = results[j].GetProperty("elevation");
                    if (e.ValueKind != JsonValueKind.Number) throw new InvalidOperationException($"No elevation at {batch[j]}");
                    cache[batch[j]] = e.GetDouble();
                }
            }
            Directory.CreateDirectory(Path.GetDirectoryName(cachePath)!);
            await File.WriteAllTextAsync(cachePath, JsonSerializer.Serialize(new SortedDictionary<string, double>(cache)) + "\n");
        }
        return places.Select(p => cache[Key(p)]).ToArray();
    }

    /// <summary>Lat,lon to 5 decimals (~1 m): the API's location format and the cache key.</summary>
    static string Key((double Lat, double Lon) p) =>
        string.Create(CultureInfo.InvariantCulture, $"{p.Lat:0.00000},{p.Lon:0.00000}");

    /// <summary>Centred moving average over a closed loop.</summary>
    static double[] MovingAverage(double[] v, int halfWidth)
    {
        int n = v.Length;
        var result = new double[n];
        for (int k = 0; k < n; k++)
        {
            double sum = 0;
            for (int j = -halfWidth; j <= halfWidth; j++) sum += v[((k + j) % n + n) % n];
            result[k] = sum / (2 * halfWidth + 1);
        }
        return result;
    }
}

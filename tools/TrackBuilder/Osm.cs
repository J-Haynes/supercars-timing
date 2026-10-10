using System.Text.Json;

namespace TrackBuilder;

/// <summary>Minimal reader for an OSM "circuit" relation fetched from /api/0.6/relation/{id}/full.json.</summary>
public sealed class OsmCircuit
{
    public sealed record Node(long Id, double Lat, double Lon, string? Name);

    public string Name { get; private init; } = "";
    public Dictionary<long, Node> Nodes { get; } = [];
    /// <summary>Members with role "circuit", in relation order: (way name, node ids).</summary>
    public List<(string? Name, List<long> Nodes)> CircuitWays { get; } = [];
    /// <summary>Members with role "pit_lane", in relation order.</summary>
    public List<List<long>> PitLaneWays { get; } = [];

    public static async Task<string> DownloadAsync(long relationId)
    {
        using var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("supercars-timing-trackbuilder/0.1 (personal hobby project)");
        http.DefaultRequestHeaders.Accept.ParseAdd("application/json");
        return await http.GetStringAsync($"https://api.openstreetmap.org/api/0.6/relation/{relationId}/full.json");
    }

    public static OsmCircuit Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var nodes = new Dictionary<long, Node>();
        var ways = new Dictionary<long, (string? Name, List<long> Nodes)>();
        JsonElement? relation = null;

        foreach (var e in doc.RootElement.GetProperty("elements").EnumerateArray())
        {
            var id = e.GetProperty("id").GetInt64();
            string? name = e.TryGetProperty("tags", out var tags) && tags.TryGetProperty("name", out var n) ? n.GetString() : null;
            switch (e.GetProperty("type").GetString())
            {
                case "node": nodes[id] = new Node(id, e.GetProperty("lat").GetDouble(), e.GetProperty("lon").GetDouble(), name); break;
                case "way": ways[id] = (name, e.GetProperty("nodes").EnumerateArray().Select(x => x.GetInt64()).ToList()); break;
                case "relation": relation = e.Clone(); break;
            }
        }
        if (relation is not { } rel) throw new InvalidOperationException("No relation in OSM data");

        var circuit = new OsmCircuit { Name = rel.GetProperty("tags").TryGetProperty("name", out var rn) ? rn.GetString() ?? "" : "" };
        foreach (var kv in nodes) circuit.Nodes[kv.Key] = kv.Value;
        foreach (var m in rel.GetProperty("members").EnumerateArray())
        {
            if (m.GetProperty("type").GetString() != "way") continue;
            var w = ways[m.GetProperty("ref").GetInt64()];
            switch (m.GetProperty("role").GetString())
            {
                case "circuit": circuit.CircuitWays.Add(w); break;
                case "pit_lane": circuit.PitLaneWays.Add(w.Nodes); break;
            }
        }
        return circuit;
    }

    /// <summary>Joins ways end-to-end into one node sequence, reversing ways where needed.</summary>
    public static List<long> Chain(IEnumerable<List<long>> ways)
    {
        var seq = new List<long>();
        bool first = true;
        foreach (var way in ways)
        {
            if (seq.Count == 0) { seq.AddRange(way); continue; }

            // The first way may be stored backwards relative to the rest.
            if (first && seq[^1] != way[0] && seq[^1] != way[^1] && (seq[0] == way[0] || seq[0] == way[^1]))
                seq.Reverse();
            first = false;

            List<long> ns = seq[^1] == way[^1] ? [.. Enumerable.Reverse(way)] : way;
            if (seq[^1] != ns[0]) Console.Error.WriteLine($"warning: gap between ways at node {seq[^1]} -> {ns[0]}");
            seq.AddRange(seq[^1] == ns[0] ? ns.Skip(1) : ns);
        }
        return seq;
    }
}

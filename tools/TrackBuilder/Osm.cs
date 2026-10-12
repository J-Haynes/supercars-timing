using System.Text.Json;
using System.Text.Json.Nodes;

namespace TrackBuilder;

/// <summary>Minimal reader for an OSM "circuit" relation fetched from /api/0.6/relation/{id}/full.json.</summary>
public sealed class OsmCircuit
{
    public sealed record Node(long Id, double Lat, double Lon, string? Name, string? Ref = null);

    public string Name { get; private init; } = "";
    public Dictionary<long, Node> Nodes { get; } = [];
    /// <summary>
    /// Lap ways in relation order: (way name, node ids, role). Role "circuit" for circuit relations; for road
    /// routes (e.g. street circuits) "forward"/"backward"/"" give the travel direction along the way.
    /// </summary>
    public List<(string? Name, List<long> Nodes)> CircuitWays { get; } = [];
    public List<string> CircuitRoles { get; } = [];
    /// <summary>Members with role "pit_lane", in relation order.</summary>
    public List<List<long>> PitLaneWays { get; } = [];

    public static async Task<string> DownloadAsync(long relationId)
    {
        using var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("supercars-timing-trackbuilder/0.1 (personal hobby project)");
        http.DefaultRequestHeaders.Accept.ParseAdd("application/json");
        return await http.GetStringAsync($"https://api.openstreetmap.org/api/0.6/relation/{relationId}/full.json");
    }

    /// <summary>
    /// For circuits OSM maps as plain raceway ways with no circuit relation (Sandown): downloads the ways and writes the
    /// same JSON shape as a relation download, with a stand-in relation (id 0) listing them as "circuit" and "pit_lane"
    /// members, so the rest of TrackBuilder works unchanged.
    /// </summary>
    public static async Task<string> DownloadWaysAsync(IReadOnlyList<long> circuitWays, IReadOnlyList<long> pitWays, string name)
    {
        using var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("supercars-timing-trackbuilder/0.1 (personal hobby project)");
        http.DefaultRequestHeaders.Accept.ParseAdd("application/json");
        var elements = new Dictionary<(string, long), JsonNode>();
        foreach (var id in circuitWays.Concat(pitWays))
        {
            var doc = JsonNode.Parse(await http.GetStringAsync($"https://api.openstreetmap.org/api/0.6/way/{id}/full.json"))!;
            foreach (var e in doc["elements"]!.AsArray())
                elements[((string)e!["type"]!, (long)e["id"]!)] = e.DeepClone();
        }
        var members = new JsonArray();
        foreach (var id in circuitWays) members.Add(new JsonObject { ["type"] = "way", ["ref"] = id, ["role"] = "circuit" });
        foreach (var id in pitWays) members.Add(new JsonObject { ["type"] = "way", ["ref"] = id, ["role"] = "pit_lane" });
        var all = new JsonArray(elements.Values.ToArray());
        all.Add(new JsonObject { ["type"] = "relation", ["id"] = 0, ["members"] = members, ["tags"] = new JsonObject { ["name"] = name, ["type"] = "circuit" } });
        return new JsonObject { ["elements"] = all }.ToJsonString();
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
            string? reference = tags.ValueKind == JsonValueKind.Object && tags.TryGetProperty("ref", out var r) ? r.GetString() : null;
            switch (e.GetProperty("type").GetString())
            {
                case "node": nodes[id] = new Node(id, e.GetProperty("lat").GetDouble(), e.GetProperty("lon").GetDouble(), name, reference); break;
                case "way": ways[id] = (name, e.GetProperty("nodes").EnumerateArray().Select(x => x.GetInt64()).ToList()); break;
                case "relation": relation = e.Clone(); break;
            }
        }
        if (relation is not { } rel) throw new InvalidOperationException("No relation in OSM data");

        var circuit = new OsmCircuit { Name = rel.GetProperty("tags").TryGetProperty("name", out var rn) ? rn.GetString() ?? "" : "" };
        foreach (var kv in nodes) circuit.Nodes[kv.Key] = kv.Value;
        var members = rel.GetProperty("members").EnumerateArray()
            .Where(m => m.GetProperty("type").GetString() == "way")
            .Select(m => (Way: ways[m.GetProperty("ref").GetInt64()], Role: m.GetProperty("role").GetString() ?? ""))
            .ToList();
        // Circuit relations use role "circuit"; road-route relations use forward/backward/"" for each road.
        bool hasCircuitRole = members.Any(m => m.Role == "circuit");
        foreach (var (way, role) in members)
        {
            if (role == "pit_lane") circuit.PitLaneWays.Add(way.Nodes);
            else if (role == "circuit" || (!hasCircuitRole && role is "forward" or "backward" or ""))
            {
                circuit.CircuitWays.Add(way);
                circuit.CircuitRoles.Add(role);
            }
        }
        return circuit;
    }

    /// <summary>
    /// Builds a closed loop from ways listed in any order. Ways with role "forward"/"backward" keep that travel
    /// direction; others may be flipped to connect. Small gaps between ways are bridged (with a warning).
    /// Returns node ids; the first id is repeated at the end.
    /// </summary>
    public List<long> BuildLoop(Func<long, Point> position)
    {
        var segments = CircuitWays.Select((w, i) => (Nodes: CircuitRoles[i] == "backward" ? Enumerable.Reverse(w.Nodes).ToList() : w.Nodes, Fixed: CircuitRoles[i] is "forward" or "backward" or "circuit")).ToList();
        if (CircuitRoles.All(r => r == "circuit")) return Chain(CircuitWays.Select(w => w.Nodes));

        var used = new bool[segments.Count];
        var loop = new List<long>(segments[0].Nodes);
        used[0] = true;
        for (int step = 1; step < segments.Count; step++)
        {
            var end = position(loop[^1]);
            int best = -1; bool flip = false; double bestGap = double.MaxValue;
            for (int i = 0; i < segments.Count; i++)
            {
                if (used[i]) continue;
                var gap = Point.Distance(end, position(segments[i].Nodes[0]));
                if (gap < bestGap) { bestGap = gap; best = i; flip = false; }
                if (!segments[i].Fixed)
                {
                    gap = Point.Distance(end, position(segments[i].Nodes[^1]));
                    if (gap < bestGap) { bestGap = gap; best = i; flip = true; }
                }
            }
            var next = flip ? Enumerable.Reverse(segments[best].Nodes).ToList() : segments[best].Nodes;
            if (next[0] == loop[^1]) loop.AddRange(next.Skip(1));
            else
            {
                Console.Error.WriteLine($"warning: bridging a {bestGap:0} m gap between ways at node {loop[^1]} -> {next[0]}");
                loop.AddRange(next);
            }
            used[best] = true;
        }
        var closing = Point.Distance(position(loop[^1]), position(loop[0]));
        if (loop[^1] != loop[0])
        {
            if (closing > 1) Console.Error.WriteLine($"warning: closing a {closing:0} m gap to complete the loop");
            loop.Add(loop[0]);
        }
        return loop;
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

using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;

namespace SupercarsTiming.Server.F1;

/// <summary>
/// Client for F1's public live timing hub (ASP.NET Core SignalR, JSON protocol) at
/// livetiming.formula1.com/signalrcore: the feed behind the official app's live timing.
///
/// Anonymous connections get the timing topics below. Car positions (<c>Position.z</c>) and telemetry
/// (<c>CarData.z</c>) need an F1 TV subscription token, so they aren't requested (checked 11 Oct 2026).
///
/// Same rules as the Natsoft client: one connection, slow reconnects (10 s after an error, 30 s after
/// repeated ones). The hub serves the last session's state even between sessions, so we stay connected.
/// </summary>
public sealed class F1Client(ILogger<F1Client> log)
{
    const string Host = "livetiming.formula1.com";
    const char RecordSeparator = '\u001e';

    public static readonly string[] Topics =
    [
        "Heartbeat", "SessionInfo", "SessionData", "SessionStatus", "TrackStatus", "ExtrapolatedClock", "LapCount",
        "DriverList", "TimingData", "TimingAppData", "TimingStats", "RaceControlMessages", "WeatherData",
    ];

    public event Action<string>? StatusChanged;

    /// <summary>Connects and passes every message to <paramref name="onMessage"/> until cancelled, reconnecting as needed.</summary>
    public async Task RunAsync(Func<F1Message, Task> onMessage, CancellationToken ct)
    {
        var failures = 0;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                StatusChanged?.Invoke("connecting");
                await ConnectOnce(onMessage, ct);
                failures = 0;
                log.LogInformation("F1 live timing connection closed; reconnecting in 10 s");
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception ex)
            {
                failures++;
                log.LogWarning("F1 live timing connection failed ({Failures}): {Message}", failures, ex.Message);
                StatusChanged?.Invoke("error: " + ex.Message);
            }
            await Task.Delay(TimeSpan.FromSeconds(failures >= 3 ? 30 : 10), ct);
        }
    }

    async Task ConnectOnce(Func<F1Message, Task> onMessage, CancellationToken ct)
    {
        // The negotiate response sets a load balancer cookie (AWSALB); without it the WebSocket can land on
        // another server that doesn't know the connection token and returns 404.
        var cookies = new CookieContainer();
        using var http = new HttpClient(new HttpClientHandler { CookieContainer = cookies });
        using var negotiate = await http.PostAsync($"https://{Host}/signalrcore/negotiate?negotiateVersion=1", null, ct);
        negotiate.EnsureSuccessStatusCode();
        var token = (string?)JsonNode.Parse(await negotiate.Content.ReadAsStringAsync(ct))?["connectionToken"]
            ?? throw new InvalidOperationException("No connection token in the negotiate response");

        using var ws = new ClientWebSocket();
        ws.Options.Cookies = cookies;
        await ws.ConnectAsync(new Uri($"wss://{Host}/signalrcore?id={Uri.EscapeDataString(token)}"), ct);
        await Send(ws, new JsonObject { ["protocol"] = "json", ["version"] = 1 }, ct);
        await Send(ws, new JsonObject
        {
            ["type"] = 1, ["invocationId"] = "1", ["target"] = "Subscribe",
            ["arguments"] = new JsonArray(new JsonArray(Topics.Select(t => (JsonNode)t).ToArray())),
        }, ct);
        log.LogInformation("Connected to F1 live timing");
        StatusChanged?.Invoke("live");

        // SignalR servers drop clients that are silent for 30 s: ping every 15 s.
        using var pingCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        var pinger = Task.Run(async () =>
        {
            try
            {
                while (!pingCts.IsCancellationRequested)
                {
                    await Task.Delay(TimeSpan.FromSeconds(15), pingCts.Token);
                    await Send(ws, new JsonObject { ["type"] = 6 }, pingCts.Token);
                }
            }
            catch (Exception) { }
        }, pingCts.Token);

        try
        {
            var buffer = new byte[64 * 1024];
            var text = new StringBuilder();
            while (ws.State == WebSocketState.Open)
            {
                var result = await ws.ReceiveAsync(buffer, ct);
                if (result.MessageType == WebSocketMessageType.Close) break;
                text.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                if (!result.EndOfMessage) continue;

                var frames = text.ToString().Split(RecordSeparator, StringSplitOptions.RemoveEmptyEntries);
                text.Clear();
                foreach (var frame in frames)
                    foreach (var m in Parse(frame))
                        await onMessage(m);
            }
        }
        finally
        {
            await pingCts.CancelAsync();
            await pinger;
        }
    }

    /// <summary>Messages in one SignalR frame: "feed" invocations, or the Subscribe result (the full current state).</summary>
    static IEnumerable<F1Message> Parse(string frame)
    {
        var o = JsonNode.Parse(frame)?.AsObject();
        if (o is null) yield break;
        var type = (int?)o["type"];
        if (type == 1 && (string?)o["target"] == "feed" && o["arguments"] is JsonArray args && args.Count >= 2)
        {
            var utc = args.Count > 2 && DateTimeOffset.TryParse((string?)args[2], out var t) ? t : DateTimeOffset.UtcNow;
            yield return new F1Message(utc, (string)args[0]!, args[1]?.DeepClone());
        }
        else if (type == 3 && o["result"] is JsonObject result)
        {
            var now = DateTimeOffset.UtcNow;
            foreach (var (topic, data) in result)
                yield return new F1Message(now, topic, data?.DeepClone(), Snapshot: true);
        }
        else if (type == 7) throw new InvalidOperationException("Hub closed the connection: " + (string?)o["error"]);
    }

    static Task Send(ClientWebSocket ws, JsonObject message, CancellationToken ct) =>
        ws.SendAsync(Encoding.UTF8.GetBytes(message.ToJsonString() + RecordSeparator), WebSocketMessageType.Text, true, ct);
}

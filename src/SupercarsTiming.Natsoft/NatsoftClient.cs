using System.Net.WebSockets;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace SupercarsTiming.Natsoft;

/// <summary>
/// Connects to Natsoft's public live timing WebSocket and yields every message.
/// Reconnects on its own: every 30s while the meeting isn't live (&lt;NotFound/&gt;),
/// after 10s on errors, and immediately on &lt;Redirect/&gt;.
/// </summary>
/// <remarks>
/// Keep this to a single connection, the same as one browser tab on the classic timing page.
/// The client never sends anything; the server pushes a full snapshot on connect, then deltas.
/// </remarks>
public sealed partial class NatsoftClient(string meeting = NatsoftClient.DefaultMeeting, ILogger<NatsoftClient>? logger = null)
{
    public const string DefaultMeeting = "V8SUPER";
    public const string Host = "wss://server.natsoft.com.au:8080";
    const string Origin = "https://server.natsoft.com.au:8080";

    public TimeSpan NotFoundDelay { get; init; } = TimeSpan.FromSeconds(30);
    public TimeSpan ErrorDelay { get; init; } = TimeSpan.FromSeconds(10);

    public string Meeting { get; } = meeting;
    public Uri StartUri => new($"{Host}/LiveMeeting/{Meeting}");

    /// <summary>Raised after each successful connect, with the URI connected to.</summary>
    public event Action<Uri>? Connected;

    /// <summary>Raised when a connection fails or drops with an error.</summary>
    public event Action<Exception>? Error;

    readonly ILogger _log = logger ?? NullLogger<NatsoftClient>.Instance;

    public async IAsyncEnumerable<NatsoftMessage> ReadAllAsync([EnumeratorCancellation] CancellationToken ct = default)
    {
        var uri = StartUri;
        while (!ct.IsCancellationRequested)
        {
            var delay = ErrorDelay;
            using var ws = new ClientWebSocket();
            ws.Options.SetRequestHeader("Origin", Origin);
            ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);

            // C# can't yield inside try/catch, so connect separately and read through a helper.
            var connected = await TryConnectAsync(ws, uri, ct);
            if (connected)
            {
                var reader = ReadMessagesAsync(ws, ct).GetAsyncEnumerator(ct);
                while (true)
                {
                    NatsoftMessage msg;
                    try
                    {
                        if (!await reader.MoveNextAsync()) break;
                        msg = reader.Current;
                    }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested) { yield break; }
                    catch (Exception ex)
                    {
                        _log.LogWarning(ex, "Natsoft connection dropped");
                        Error?.Invoke(ex);
                        break;
                    }

                    yield return msg;

                    if (msg.IsNotFound) { delay = NotFoundDelay; uri = StartUri; break; }
                    if (msg.IsRedirect && RedirectUrl().Match(msg.Xml) is { Success: true } m)
                    {
                        uri = new Uri(m.Groups[1].Value.Replace("https:", "wss:").Replace("http:", "ws:"));
                        _log.LogInformation("Natsoft redirect to {Uri}", uri);
                        delay = TimeSpan.Zero;
                        break;
                    }
                }
                await reader.DisposeAsync();
            }

            if (ct.IsCancellationRequested) yield break;
            if (delay == NotFoundDelay) _log.LogInformation("Meeting {Meeting} not live, checking again in {Delay}s", Meeting, delay.TotalSeconds);
            else if (delay > TimeSpan.Zero) _log.LogInformation("Reconnecting in {Delay}s", delay.TotalSeconds);

            try { await Task.Delay(delay, ct); }
            catch (OperationCanceledException) { yield break; }
        }
    }

    async Task<bool> TryConnectAsync(ClientWebSocket ws, Uri uri, CancellationToken ct)
    {
        try
        {
            await ws.ConnectAsync(uri, ct);
            _log.LogInformation("Connected to {Uri}", uri);
            Connected?.Invoke(uri);
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return false; }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to connect to {Uri}", uri);
            Error?.Invoke(ex);
            return false;
        }
    }

    static async IAsyncEnumerable<NatsoftMessage> ReadMessagesAsync(ClientWebSocket ws, [EnumeratorCancellation] CancellationToken ct)
    {
        var buf = new byte[64 * 1024];
        using var msg = new MemoryStream();
        while (ws.State == WebSocketState.Open)
        {
            var r = await ws.ReceiveAsync(buf, ct);
            if (r.MessageType == WebSocketMessageType.Close) yield break;
            msg.Write(buf, 0, r.Count);
            if (!r.EndOfMessage) continue;

            var raw = Encoding.UTF8.GetString(msg.GetBuffer(), 0, (int)msg.Length);
            msg.SetLength(0);
            yield return NatsoftMessage.FromRaw(DateTimeOffset.UtcNow, raw);
        }
    }

    [GeneratedRegex("URL=\"([^\"]+)\"")]
    private static partial Regex RedirectUrl();
}

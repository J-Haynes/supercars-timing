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
/// Since the Gold Coast 500 (23 Oct 2026) Natsoft only serves the meeting to a WebSocket opened with
/// <c>?Token=</c>: without one it answers &lt;NotFound/&gt; even while cars are on track. Like the browser,
/// we load the meeting's page (it sets <c>var gsLiveToken="..."</c>) and add that token to the WebSocket URL.
/// The token only works with the same User-Agent as the page request (checked: a WebSocket without one
/// got &lt;NotFound/&gt;), so both requests send <see cref="UserAgent"/>.
/// See docs/PROTOCOL.md, "Connecting".
/// </remarks>
public sealed partial class NatsoftClient(string meeting = NatsoftClient.DefaultMeeting, ILogger<NatsoftClient>? logger = null)
{
    public const string DefaultMeeting = "V8SUPER";
    public const string Host = "wss://server.natsoft.com.au:8080";
    const string Origin = "https://server.natsoft.com.au:8080";
    const string UserAgent = "Mozilla/5.0 (compatible; supercars-timing)";

    // One shared HttpClient for the page that carries the token (the recommended way to use HttpClient).
    static readonly HttpClient Http = CreateHttp();

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
        string? token = null;
        while (!ct.IsCancellationRequested)
        {
            var delay = ErrorDelay;
            // A fresh token for each new connection (the page is loaded once per connection, like a browser
            // reload); a redirect keeps the one it has.
            token ??= await FetchTokenAsync(ct);
            using var ws = new ClientWebSocket();
            ws.Options.SetRequestHeader("Origin", Origin);
            ws.Options.SetRequestHeader("User-Agent", UserAgent);
            ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);

            // C# can't yield inside try/catch, so connect separately and read through a helper.
            var connected = await TryConnectAsync(ws, WithToken(uri, token), ct);
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

                    if (msg.IsNotFound) { delay = NotFoundDelay; uri = StartUri; token = null; break; }
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
            if (delay == ErrorDelay) token = null;
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
            // Logged and reported without the query, so the token never reaches the logs or /api/health.
            var shown = WithoutQuery(uri);
            _log.LogInformation("Connected to {Uri}", shown);
            Connected?.Invoke(shown);
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { return false; }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to connect to {Uri}", WithoutQuery(uri));
            Error?.Invoke(ex);
            return false;
        }
    }

    /// <summary>
    /// Loads the meeting's page and returns its <c>gsLiveToken</c>, or null if the page can't be loaded or
    /// has none (then we connect without one, as before).
    /// </summary>
    async Task<string?> FetchTokenAsync(CancellationToken ct)
    {
        try
        {
            var html = await Http.GetStringAsync($"{Origin}/LiveMeeting/{Meeting}", ct);
            if (ParseToken(html) is { } token) return token;
            _log.LogWarning("No live timing token on the {Meeting} page; connecting without one", Meeting);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex) { _log.LogWarning(ex, "Couldn't load the {Meeting} page for its token; connecting without one", Meeting); }
        return null;
    }

    /// <summary>The token in the meeting page's <c>var gsLiveToken="...";</c>, or null.</summary>
    internal static string? ParseToken(string html) =>
        LiveToken().Match(html) is { Success: true } m && m.Groups[1].Value.Length > 0 ? m.Groups[1].Value : null;

    /// <summary>Adds <c>Token=</c> to the URL the way Natsoft's own script does (unless it already has one).</summary>
    internal static Uri WithToken(Uri uri, string? token)
    {
        if (string.IsNullOrEmpty(token) || uri.Query.Contains("Token=")) return uri;
        var sep = uri.Query.Length > 0 ? "&" : "?";
        return new Uri($"{uri}{sep}Token={Uri.EscapeDataString(token)}");
    }

    static Uri WithoutQuery(Uri uri) => new(uri.GetLeftPart(UriPartial.Path));

    static HttpClient CreateHttp()
    {
        var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd(UserAgent);
        http.DefaultRequestHeaders.Referrer = new Uri("https://www.supercars.com/");
        return http;
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

    [GeneratedRegex("gsLiveToken\\s*=\\s*\"([^\"]*)\"")]
    private static partial Regex LiveToken();
}

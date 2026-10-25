using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
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
/// after 10s on errors, and immediately on &lt;Redirect/&gt;. Also when the connection has stalled
/// (<see cref="StallTimeout"/>) or the laptop's address it was using has gone (a network change).
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

    /// <summary>
    /// While a session is running (last flag Green, Yellow or Red), this long without a message means the connection
    /// has stalled: drop it and reconnect. Natsoft sends something every second then (the clock); the longest gap
    /// in our recordings under those flags is 11 s. On 25 Oct 2026 (Gold Coast, Race 32 Q1) the socket went silent
    /// for 4 minutes without closing and the red flag never arrived. Between sessions minutes of silence are
    /// normal, so there's no limit then (no extra reconnects).
    /// </summary>
    public TimeSpan StallTimeout { get; init; } = TimeSpan.FromSeconds(30);

    /// <summary>
    /// How long to wait before reconnecting when the address the connection was using has gone. On 25 Oct 2026 the
    /// laptop's USB ethernet dropped off at 12:23:40.85 (Race 32 Q1) and NetworkManager moved the default route to
    /// Wi-Fi; the socket, bound to the ethernet address, never heard another thing and never closed. A short pause
    /// lets the new route settle; a failed connect then falls back to <see cref="ErrorDelay"/>.
    /// </summary>
    public TimeSpan NetworkChangeDelay { get; init; } = TimeSpan.FromSeconds(2);

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
        var running = false; // a session running (see StallTimeout), from the last flag seen
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
            // Our own handler, only to learn which local address the connection uses (see AddressGone).
            IPAddress? local = null;
            using var invoker = new HttpMessageInvoker(LocalAddressHandler(a => local = a));

            // C# can't yield inside try/catch, so connect separately and read through a helper.
            var connected = await TryConnectAsync(ws, invoker, WithToken(uri, token), ct);
            if (connected)
            {
                // The laptop's address for this connection gone (cable or dock out, Wi-Fi off): the socket would wait
                // forever, so cancel the read and reconnect over whatever network is left.
                using var gone = CancellationTokenSource.CreateLinkedTokenSource(ct);
                NetworkAddressChangedEventHandler onChange = (_, _) =>
                {
                    // Raised on another thread, possibly just as this connection is being torn down.
                    try { if (local is { } a && AddressGone(a, UpAddresses())) gone.Cancel(); }
                    catch (ObjectDisposedException) { }
                };
                NetworkChange.NetworkAddressChanged += onChange;
                var reader = ReadMessagesAsync(ws, () => running ? StallTimeout : null, gone.Token).GetAsyncEnumerator(gone.Token);
                while (true)
                {
                    NatsoftMessage msg;
                    try
                    {
                        if (!await reader.MoveNextAsync()) break;
                        msg = reader.Current;
                    }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
                    catch (OperationCanceledException) when (gone.IsCancellationRequested)
                    {
                        _log.LogWarning("Network changed: this machine no longer has {Address}, the address the Natsoft connection used; reconnecting", local);
                        Error?.Invoke(new IOException($"Local address {local} gone"));
                        delay = NetworkChangeDelay;
                        break;
                    }
                    catch (Exception ex)
                    {
                        _log.LogWarning(ex, "Natsoft connection dropped");
                        Error?.Invoke(ex);
                        break;
                    }

                    running = SessionRunning(msg.Xml, running);
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
                NetworkChange.NetworkAddressChanged -= onChange;
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

    async Task<bool> TryConnectAsync(ClientWebSocket ws, HttpMessageInvoker invoker, Uri uri, CancellationToken ct)
    {
        try
        {
            await ws.ConnectAsync(uri, invoker, ct);
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

    /// <summary>A handler that connects like the default one and reports the socket's local address.</summary>
    static SocketsHttpHandler LocalAddressHandler(Action<IPAddress> local) => new()
    {
        ConnectCallback = async (context, ct) =>
        {
            var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(context.DnsEndPoint, ct);
                if (socket.LocalEndPoint is IPEndPoint ep) local(ep.Address.IsIPv4MappedToIPv6 ? ep.Address.MapToIPv4() : ep.Address);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        },
    };

    /// <summary>Addresses on this machine's interfaces that are up (IPv4-mapped ones as IPv4).</summary>
    static IEnumerable<IPAddress> UpAddresses() =>
        NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up)
            .SelectMany(n => n.GetIPProperties().UnicastAddresses)
            .Select(u => u.Address);

    /// <summary>Whether the connection's local address is no longer on any interface that's up.</summary>
    internal static bool AddressGone(IPAddress local, IEnumerable<IPAddress> up) =>
        !IPAddress.IsLoopback(local) && !up.Any(a => a.Equals(local));

    static HttpClient CreateHttp()
    {
        var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd(UserAgent);
        http.DefaultRequestHeaders.Referrer = new Uri("https://www.supercars.com/");
        return http;
    }

    /// <summary>
    /// Whether a session is running after this message: its flag (<c>&lt;S S="..."&gt;</c>) if it has one, else as
    /// before. A <c>&lt;New&gt;</c> or <c>&lt;NotFound&gt;</c> without a flag ends it.
    /// </summary>
    internal static bool SessionRunning(string xml, bool running)
    {
        if (FlagState().Match(xml) is { Success: true } m) return m.Groups[1].Value is "Green" or "Yellow" or "Red";
        return !xml.StartsWith("<New") && !xml.StartsWith("<NotFound") && running;
    }

    static async IAsyncEnumerable<NatsoftMessage> ReadMessagesAsync(ClientWebSocket ws, Func<TimeSpan?> stallAfter, [EnumeratorCancellation] CancellationToken ct)
    {
        var buf = new byte[64 * 1024];
        using var msg = new MemoryStream();
        while (ws.State == WebSocketState.Open)
        {
            // Cancelling a receive aborts the socket, which is what a stalled one needs: the caller reconnects.
            var limit = stallAfter();
            using var stall = CancellationTokenSource.CreateLinkedTokenSource(ct);
            if (limit is { } l) stall.CancelAfter(l);
            WebSocketReceiveResult r;
            try { r = await ws.ReceiveAsync(buf, stall.Token); }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                throw new TimeoutException($"Nothing from Natsoft for {limit?.TotalSeconds}s while a session was running");
            }
            if (r.MessageType == WebSocketMessageType.Close) yield break;
            msg.Write(buf, 0, r.Count);
            if (!r.EndOfMessage) continue;

            var raw = Encoding.UTF8.GetString(msg.GetBuffer(), 0, (int)msg.Length);
            msg.SetLength(0);
            yield return NatsoftMessage.FromRaw(DateTimeOffset.UtcNow, raw);
        }
    }

    // The flag in <S T="..." S="Green" I="..." ...>, not SN= or other attributes.
    [GeneratedRegex("<S\\b[^>]*\\sS=\"(\\w+)\"")]
    private static partial Regex FlagState();

    [GeneratedRegex("URL=\"([^\"]+)\"")]
    private static partial Regex RedirectUrl();

    [GeneratedRegex("gsLiveToken\\s*=\\s*\"([^\"]*)\"")]
    private static partial Regex LiveToken();
}

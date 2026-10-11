using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Server.Sessions;

/// <summary>
/// Replays of recorded sessions for the replay page: one <see cref="SessionReplay"/> cursor per viewer and session,
/// asked for "the snapshot at time t" as the viewer plays or scrubs. The recording's messages are loaded once per
/// session and shared. Cursors idle for 10 minutes are dropped (and at most 16 kept).
/// </summary>
public sealed class ReplayService(SessionCatalog catalog)
{
    static readonly TimeSpan Idle = TimeSpan.FromMinutes(10);
    const int MaxCursors = 16;

    readonly Lock _lock = new();
    readonly Dictionary<string, (int Count, IReadOnlyList<SessionReplay.Message> Messages)> _messages = [];
    readonly Dictionary<(string Viewer, string Session), (SessionReplay Replay, DateTime Used)> _cursors = [];

    public (double Start, double End)? Info(string sessionId) =>
        Messages(sessionId) is { } m ? (m.Count > 0 ? m[0].Time : 0, m.Count > 0 ? m[^1].Time : 0) : null;

    public TimingSnapshot? At(string sessionId, string viewer, double t)
    {
        if (Messages(sessionId) is not { } messages) return null;
        SessionReplay replay;
        lock (_lock)
        {
            var now = DateTime.UtcNow;
            foreach (var key in _cursors.Where(c => now - c.Value.Used > Idle).Select(c => c.Key).ToList()) _cursors.Remove(key);
            if (!_cursors.TryGetValue((viewer, sessionId), out var cursor))
            {
                if (_cursors.Count >= MaxCursors) _cursors.Remove(_cursors.MinBy(c => c.Value.Used).Key);
                cursor = (new SessionReplay(messages), now);
            }
            _cursors[(viewer, sessionId)] = (cursor.Replay, now);
            replay = cursor.Replay;
        }
        lock (replay) return replay.At(t); // one viewer's requests can overlap while scrubbing
    }

    IReadOnlyList<SessionReplay.Message>? Messages(string sessionId)
    {
        if (catalog.Find(sessionId) is not { } session) return null;
        lock (_lock)
        {
            if (_messages.TryGetValue(sessionId, out var cached) && cached.Count == session.Messages) return cached.Messages;
        }
        var loaded = SessionReplay.Load(session);
        lock (_lock) { _messages[sessionId] = (session.Messages, loaded); }
        return loaded;
    }
}

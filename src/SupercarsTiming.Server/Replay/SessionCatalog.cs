using SupercarsTiming.Natsoft;
using SupercarsTiming.Server.Feed;

namespace SupercarsTiming.Server.Replay;

/// <summary>Sessions available to replay, found in data/recordings. Rescans when files change.</summary>
public sealed class SessionCatalog(RepoPaths paths)
{
    readonly Lock _lock = new();
    string _signature = "";
    List<RecordedSession> _sessions = [];

    public IReadOnlyList<RecordedSession> List()
    {
        var dir = paths.RecordingsDirectory;
        if (!Directory.Exists(dir)) return [];
        var files = new DirectoryInfo(dir).GetFiles("*.jsonl").OrderBy(f => f.Name).ToList();
        // Cheap change detection: names, sizes and timestamps. The live recording grows, so this rescans it.
        var signature = string.Join("|", files.Select(f => $"{f.Name}:{f.Length}:{f.LastWriteTimeUtc.Ticks}"));
        lock (_lock)
        {
            if (signature != _signature)
            {
                _sessions = SessionIndex.Scan(files.Select(f => f.FullName));
                _signature = signature;
            }
            return _sessions;
        }
    }

    public RecordedSession? Find(string id) => List().FirstOrDefault(s => s.Id == id);
}

using System.Reflection;
using Microsoft.Extensions.Options;

namespace SupercarsTiming.Server.Feed;

/// <summary>The timetable shared by the feed and browser. Imports replace it only after full validation.</summary>
public sealed class ScheduleStore : IDisposable
{
    readonly string _path;
    readonly object _gate = new();
    CancellationTokenSource _changed = new();

    public ScheduleStore(RepoPaths paths, IOptions<FeedOptions> options)
    {
        _path = paths.Resolve(options.Value.ScheduleFile);
        if (StandaloneHost.Enabled && !File.Exists(_path))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            using var bundled = Assembly.GetExecutingAssembly().GetManifestResourceStream("Standalone.supercars.json")!;
            using var file = File.Create(_path);
            bundled.CopyTo(file);
        }
    }

    public CancellationToken Changed { get { lock (_gate) return _changed.Token; } }

    public string Read()
    {
        lock (_gate) return File.Exists(_path) ? File.ReadAllText(_path) : "{\"events\":[]}";
    }

    public SessionSchedule Load()
    {
        lock (_gate) return SessionSchedule.Load(_path);
    }

    public void Import(string json)
    {
        _ = SessionSchedule.Parse(json);
        CancellationTokenSource previous;
        lock (_gate)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            File.WriteAllText(_path + ".tmp", json);
            File.Move(_path + ".tmp", _path, overwrite: true);
            previous = _changed;
            _changed = new();
        }
        // Wake a waiting feed, or end its old session window, before applying the new timetable.
        previous.Cancel();
        previous.Dispose();
    }

    public void Dispose() => _changed.Dispose();
}

namespace SupercarsTiming.Server.Feed;

/// <summary>Resolves paths relative to the repo root (the folder containing SupercarsTiming.slnx).</summary>
public sealed class RepoPaths
{
    public string Root { get; }
    public string RecordingsDirectory => Path.Combine(Root, "data", "recordings");

    public RepoPaths(IHostEnvironment env)
    {
        var dir = new DirectoryInfo(env.ContentRootPath);
        while (dir is not null && dir.GetFiles("SupercarsTiming.slnx").Length == 0) dir = dir.Parent;
        Root = dir?.FullName ?? env.ContentRootPath;
    }

    public string Resolve(string path) => Path.IsPathRooted(path) ? path : Path.GetFullPath(Path.Combine(Root, path));

    /// <summary>The given recording, or the newest non-empty one in data/recordings when blank.</summary>
    public string? FindRecording(string? file)
    {
        if (!string.IsNullOrWhiteSpace(file))
        {
            foreach (var candidate in new[] { Resolve(file), Path.Combine(RecordingsDirectory, file) })
                if (File.Exists(candidate)) return candidate;
            return null;
        }

        if (!Directory.Exists(RecordingsDirectory)) return null;
        return new DirectoryInfo(RecordingsDirectory).GetFiles("*.jsonl")
            .Where(f => f.Length > 10_000)
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .FirstOrDefault()?.FullName;
    }
}

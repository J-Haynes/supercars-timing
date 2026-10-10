using SupercarsTiming.Natsoft;

// NatsoftRecorder: records the Natsoft live timing feed to JSON Lines for development and replay.
//
//   dotnet run --project tools/NatsoftRecorder                       record V8SUPER into data/recordings
//   dotnet run --project tools/NatsoftRecorder -- record V8SUPER ./out
//   dotnet run --project tools/NatsoftRecorder -- decode <file.jsonl>  print decoded XML
//   dotnet run --project tools/NatsoftRecorder -- replay <file.jsonl>  rebuild state, print final timing sheet

var command = args.Length > 0 ? args[0] : "record";
switch (command)
{
    case "record":
        await Record(args.ElementAtOrDefault(1) ?? NatsoftClient.DefaultMeeting, args.ElementAtOrDefault(2) ?? DefaultRecordingsDir());
        break;
    case "decode" when args.Length > 1:
        foreach (var m in RecordingReader.Read(args[1])) Console.WriteLine($"{m.ReceivedAt:O} {m.Xml}");
        break;
    case "replay" when args.Length > 1:
        PrintSheet(args[1]);
        break;
    default:
        Console.WriteLine("usage: NatsoftRecorder [record [meeting] [dir] | decode <file> | replay <file>]");
        Environment.ExitCode = 1;
        break;
}

static async Task Record(string meeting, string dir)
{
    using var cts = new CancellationTokenSource();
    Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

    await using var writer = RecordingWriter.Create(dir, meeting);
    Log($"Recording {meeting} -> {Path.GetFullPath(writer.Path)}  (Ctrl+C to stop)");

    var client = new NatsoftClient(meeting);
    client.Connected += uri => { Log($"connected {uri}"); _ = writer.WriteEventAsync("connect", uri.ToString()); };
    client.Error += ex => { Log($"error: {ex.GetType().Name}: {ex.Message}"); _ = writer.WriteEventAsync("error", ex.Message); };

    long total = 0;
    var counts = new Dictionary<string, int>();
    try
    {
        await foreach (var m in client.ReadAllAsync(cts.Token))
        {
            await writer.WriteAsync(m);
            total++;
            counts[m.Root] = counts.GetValueOrDefault(m.Root) + 1;
            var summary = string.Join(" ", counts.OrderByDescending(k => k.Value).Take(6).Select(k => $"{k.Key}:{k.Value}"));
            Log(m.IsNotFound ? "meeting not live yet, checking again in 30s" : $"#{total,-6} <{m.Root}> {m.Xml.Length,7} chars   {summary}");
        }
    }
    catch (OperationCanceledException) { }
    Log($"stopped. {total} messages saved to {writer.Path}");
}

static void PrintSheet(string path)
{
    var state = new TimingState();
    foreach (var m in RecordingReader.Read(path)) state.Apply(m);
    var s = TimingSnapshot.From(state);

    static string T(double v) => v > 0 ? $"{(int)(v / 60)}:{v % 60:00.000}" : "-";
    Console.WriteLine($"{s.Session.Meeting} - {s.Session.Name}");
    Console.WriteLine($"{s.Session.Track} | flag: {s.Session.Flag} | {s.MessageCount} messages | timing points: M, {string.Join(", ", s.TimingPoints.Select(tp => $"{tp.Id}={tp.Name}"))}");
    Console.WriteLine();
    Console.WriteLine("Pos  No   Driver                Laps  Best       Gap      Int      Last       Pits  Speed  Pt");
    foreach (var c in s.Cars)
        Console.WriteLine($"{c.Position,3}  {c.CarNumber,-4} {c.Driver,-21} {c.Laps,4}  {T(c.BestLap),-9} {c.Gap,7:0.000}  {c.Interval,7:0.000}  {T(c.LastLap),-9} {c.PitStops,4}  {c.Speed,5}  {c.LastPoint,2}{(c.InPit ? " PIT" : "")}");
}

/// <summary>data/recordings at the repo root if we can find it, otherwise ./recordings.</summary>
static string DefaultRecordingsDir()
{
    for (var dir = new DirectoryInfo(Directory.GetCurrentDirectory()); dir is not null; dir = dir.Parent)
        if (dir.GetFiles("SupercarsTiming.slnx").Length > 0)
            return Path.Combine(dir.FullName, "data", "recordings");
    return "recordings";
}

static void Log(string s) => Console.WriteLine($"{DateTime.Now:HH:mm:ss.fff} {s}");

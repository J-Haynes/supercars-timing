namespace SupercarsTiming.Server.Weekend;

public sealed record Coverage(string Status, string[] Channels, string Source, DateTimeOffset? Start = null,
    DateTimeOffset? End = null, string? Note = null, DateTimeOffset? CheckedAt = null, string Scope = "session");

public sealed record WeekendSession(string Name, string Category, DateTimeOffset Start, DateTimeOffset? End,
    bool Main, Coverage? Coverage = null);

public sealed record Broadcast(string Title, DateTimeOffset Start, DateTimeOffset? End, string[] Channels, string Source,
    DateTimeOffset? CheckedAt = null, string Scope = "programme");

public sealed record WeekendData(string Series, string EventName, string StartDate, string ScheduleSource,
    string? EventUrl, string? TimetableUrl, string UtcOffset, DateTimeOffset CheckedAt,
    WeekendSession[] Sessions, Broadcast[] Broadcasts, string? Note = null);

public sealed record Standing(int Position, string Name, decimal Points, string? Team = null);

public sealed record RemainingPoints(decimal Drivers, decimal Teams, int Races, int Sprints, bool DriverResetsPending, string Source);

public sealed record ChampionshipStandings(string Series, int Season, DateTimeOffset CheckedAt, string AsOf,
    string DriversSource, string TeamsSource, Standing[] Drivers, Standing[] Teams, string? Note = null,
    RemainingPoints? PointsRemaining = null, int? CompletedRace = null, Dictionary<int, string[]>? RaceResults = null,
    Dictionary<int, Dictionary<string, decimal>>? RacePoints = null, Dictionary<int, string>? RaceWinners = null);

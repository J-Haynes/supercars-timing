namespace SupercarsTiming.Natsoft;

/// <summary>One message from the Natsoft feed, live or replayed from a recording.</summary>
/// <param name="ReceivedAt">When the message arrived (UTC).</param>
/// <param name="Raw">The frame exactly as received (possibly obfuscated).</param>
/// <param name="Xml">The decoded XML.</param>
public sealed record NatsoftMessage(DateTimeOffset ReceivedAt, string Raw, string Xml)
{
    public string Root { get; } = NatsoftDecoder.RootName(Xml);

    /// <summary>The meeting isn't live (no session on track). Not timing data.</summary>
    public bool IsNotFound => Root == "NotFound";

    public bool IsRedirect => Root == "Redirect";

    public static NatsoftMessage FromRaw(DateTimeOffset receivedAt, string raw) =>
        new(receivedAt, raw, NatsoftDecoder.Decode(raw));
}

using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Natsoft.Tests;

public class RecordingTests
{
    [Fact]
    public async Task Writer_output_reads_back()
    {
        var path = Path.Combine(Path.GetTempPath(), $"natsoft-test-{Guid.NewGuid():N}.jsonl");
        try
        {
            await using (var w = new RecordingWriter(path))
            {
                await w.WriteEventAsync("connect", "wss://example");
                await w.WriteAsync(NatsoftMessage.FromRaw(DateTimeOffset.UtcNow, "<C T=\"1\" Y=\"T\" C=\"10\" E=\"5\" />"));
                await w.WriteAsync(NatsoftMessage.FromRaw(DateTimeOffset.UtcNow, NatsoftDecoder.Encode("<S T=\"2\" S=\"Green\" />")));
            }

            var messages = RecordingReader.Read(path).ToList();
            Assert.Equal(2, messages.Count);                     // the connect event is skipped
            Assert.Equal("C", messages[0].Root);
            Assert.Equal("<S T=\"2\" S=\"Green\" />", messages[1].Xml);
        }
        finally { File.Delete(path); }
    }

    [Fact]
    public void Reader_tolerates_bom_from_early_recordings()
    {
        var path = Path.Combine(Path.GetTempPath(), $"natsoft-test-{Guid.NewGuid():N}.jsonl");
        try
        {
            // Early recordings were written with a UTF-8 BOM and anonymous-type property names.
            File.WriteAllText(path,
                "{\"t\":\"2026-10-09T23:06:53.93+00:00\",\"kind\":\"msg\",\"raw\":\"<H T=\\\"1\\\" />\",\"xml\":\"<H T=\\\"1\\\" />\"}\n",
                new System.Text.UTF8Encoding(true));
            var m = Assert.Single(RecordingReader.Read(path));
            Assert.Equal("H", m.Root);
        }
        finally { File.Delete(path); }
    }
}

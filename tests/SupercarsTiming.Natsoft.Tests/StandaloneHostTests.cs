using Microsoft.Extensions.Configuration;
using SupercarsTiming.Server;

namespace SupercarsTiming.Natsoft.Tests;

public sealed class StandaloneHostTests
{
    [Theory]
    [InlineData(null, null, "http://127.0.0.1:5085")]
    [InlineData(null, "5090", "http://127.0.0.1:5090")]
    [InlineData("http://0.0.0.0:5091", "5090", "http://127.0.0.1:5091")]
    [InlineData("http://[::]:5092", null, "http://127.0.0.1:5092")]
    [InlineData("http://*:5093", null, "http://127.0.0.1:5093")]
    [InlineData("http://+:5094", null, "http://127.0.0.1:5094")]
    [InlineData("http://192.168.1.20:5095;http://localhost:5096", null, "http://192.168.1.20:5095")]
    public void Browser_address_follows_the_explicit_listener_or_default_local_port(string? urls, string? port, string expected)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["urls"] = urls, ["Standalone:Port"] = port,
        }).Build();

        Assert.Equal(expected, StandaloneHost.Url(config));
    }

    [Fact]
    public void A_trailing_separator_does_not_start_another_instance_for_the_same_data_folder()
    {
        var path = Path.Combine(Path.GetTempPath(), $"standalone-{Guid.NewGuid():N}");
        using var first = StandaloneHost.SingleInstance(path, out var firstCreated);
        using var alias = StandaloneHost.SingleInstance(path + Path.DirectorySeparatorChar, out var aliasCreated);
        try
        {
            Assert.True(firstCreated);
            Assert.False(aliasCreated);
        }
        finally
        {
            if (aliasCreated) alias.ReleaseMutex();
            if (firstCreated) first.ReleaseMutex();
        }
    }
}

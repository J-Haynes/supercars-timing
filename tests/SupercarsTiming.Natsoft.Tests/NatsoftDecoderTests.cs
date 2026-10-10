using SupercarsTiming.Natsoft;

namespace SupercarsTiming.Natsoft.Tests;

public class NatsoftDecoderTests
{
    [Fact]
    public void Plain_xml_passes_through()
    {
        Assert.Equal("<NotFound />\r\n", NatsoftDecoder.Decode("<NotFound />\r\n"));
    }

    [Fact]
    public void Xor_chain_round_trips()
    {
        const string xml = "<L T=\"1791626814.7636\" Y=\"p\" L=\"25\"><P L=\"24\" C=\"4\" D=\"2\"><D LP=\"2\" /></P></L>";
        Assert.Equal(xml, NatsoftDecoder.Decode(NatsoftDecoder.Encode(xml)));
    }

    [Fact]
    public void Control_codes_expand_to_xml_fragments()
    {
        // "<S" then code 23 (-> ' T="') then "5"
        var encoded = new string([(char)('<' ^ 0x7F), (char)('S' ^ '<'), (char)(23 ^ 'S'), (char)('5' ^ 23)]);
        Assert.Equal("<S T=\"5", NatsoftDecoder.Decode(encoded));
    }

    [Theory]
    [InlineData("<New T=\"1\">", "New")]
    [InlineData("<NotFound />", "NotFound")]
    [InlineData("  <L Y=\"p\" />", "L")]
    [InlineData("garbage", "?")]
    public void Root_name(string xml, string expected) => Assert.Equal(expected, NatsoftDecoder.RootName(xml));
}

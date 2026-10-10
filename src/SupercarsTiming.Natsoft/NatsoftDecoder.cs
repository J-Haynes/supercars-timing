using System.Text;

namespace SupercarsTiming.Natsoft;

/// <summary>
/// Decodes Natsoft live timing WebSocket frames.
/// Frames starting with '&lt;' are plain XML. Anything else is XOR-chained:
/// each char is XORed with the previous *decoded* char (seed 0x7F), and the
/// control codes 22-31 expand into common XML fragments.
/// Ported from Natsoft's browser client (LiveFile/Live_Obfs.js).
/// </summary>
public static class NatsoftDecoder
{
    public static string Decode(string data)
    {
        if (data.Length == 0 || data[0] == '<') return data;

        var sb = new StringBuilder(data.Length * 2);
        int prev = 0x7F;
        foreach (char ch in data)
        {
            int c = ch ^ prev;
            switch (c)
            {
                case > 31: sb.Append((char)c); break;
                case 22: sb.Append("><"); break;
                case 23: sb.Append(" T=\""); break;
                case 24: sb.Append("=\"0.0000\" "); break;
                case 25: sb.Append("=\"0\" "); break;
                case 26: sb.Append("=\"\" "); break;
                case 27: sb.Append("\" /><"); break;
                case 28: sb.Append("\"><"); break;
                case 29: sb.Append("\" />"); break;
                case 30: sb.Append("=\""); break;
                case 31: sb.Append("\" "); break;
                default: sb.Append((char)c); break;
            }
            prev = c;
        }
        return sb.ToString();
    }

    /// <summary>Inverse of <see cref="Decode"/> for plain characters only (no macro codes). Used by tests.</summary>
    public static string Encode(string plain)
    {
        var sb = new StringBuilder(plain.Length);
        int prev = 0x7F;
        foreach (char ch in plain) { sb.Append((char)(ch ^ prev)); prev = ch; }
        return sb.ToString();
    }

    /// <summary>Root element name, e.g. New / L / C / S / NotFound. Returns "?" if there is none.</summary>
    public static string RootName(string xml)
    {
        int i = xml.IndexOf('<');
        if (i < 0) return "?";
        int j = i + 1;
        while (j < xml.Length && (char.IsLetterOrDigit(xml[j]) || xml[j] == '_')) j++;
        return j > i + 1 ? xml[(i + 1)..j] : "?";
    }
}

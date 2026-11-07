using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;

namespace SupercarsTiming.Server;

/// <summary>The portable application's startup; normal server deployments keep their existing configuration.</summary>
public static class StandaloneHost
{
#if STANDALONE
    public static bool Enabled => true;
#else
    public static bool Enabled => false;
#endif

    public static WebApplicationBuilder CreateBuilder(string[] args)
    {
        var startup = new ConfigurationBuilder().AddEnvironmentVariables().AddCommandLine(args).Build();
        var data = Path.GetFullPath(startup["Standalone:DataDirectory"] ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SupercarsTiming"));
        Directory.CreateDirectory(data);
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { Args = args, ContentRootPath = data });
        var hostUrls = builder.Configuration[WebHostDefaults.ServerUrlsKey];
        // Never read configuration from the directory the user happened to launch the executable from.
        builder.Configuration.Sources.Clear();
        builder.Configuration.AddJsonStream(Assembly.GetExecutingAssembly().GetManifestResourceStream("Standalone.appsettings.json")!)
            .AddInMemoryCollection(new Dictionary<string, string?> { ["Feed:ScheduleFile"] = "schedule/supercars.json" })
            .AddJsonFile(Path.Combine(data, "settings.json"), optional: true)
            .AddEnvironmentVariables().AddCommandLine(args);
        var urls = builder.Configuration[WebHostDefaults.ServerUrlsKey] ?? hostUrls;
        if (string.IsNullOrWhiteSpace(urls))
        {
            builder.Configuration["AllowedHosts"] = "127.0.0.1;localhost";
            urls = Url(builder.Configuration);
        }
        builder.WebHost.UseUrls(urls);
        builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 1_048_576);
        return builder;
    }

    public static string Url(IConfiguration config)
    {
        var firstUrl = config[WebHostDefaults.ServerUrlsKey]?.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
        if (firstUrl is not null)
        {
            var address = BindingAddress.Parse(firstUrl);
            // Wildcard listeners accept network connections, but the local browser needs a destination address.
            var host = address.Host is "0.0.0.0" or "[::]" or "*" or "+" ? "127.0.0.1" : address.Host;
            return $"{address.Scheme}://{host}:{address.Port}{address.PathBase}";
        }
        var port = config.GetValue("Standalone:Port", 5085);
        if (port is < 1 or > 65535) throw new ArgumentException("Standalone:Port must be between 1 and 65535.");
        return $"http://127.0.0.1:{port}";
    }

    public static Mutex SingleInstance(string dataDirectory, out bool first)
    {
        dataDirectory = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dataDirectory));
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(dataDirectory.ToUpperInvariant())));
        return new Mutex(initiallyOwned: true, $"SupercarsTiming-{key}", out first);
    }

    public static void OpenBrowser(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            Console.WriteLine($"Open {url} in your browser. The browser could not be opened automatically.");
        }
    }
}

using System.Text.Json;

namespace OrderRestro.Launcher;

/// <summary>
/// Per-user configuration: which LAN/local OrderRestro server this client
/// points at. Stored under %LOCALAPPDATA%\OrderRestro, NOT inside the MSIX
/// install directory (which is read-only after install and not guaranteed
/// writable/stable across updates — see hardening brief section 19).
/// </summary>
internal sealed class AppConfig
{
    public string? ServerUrl { get; set; }

    private static string ConfigDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OrderRestro");

    private static string ConfigPath => Path.Combine(ConfigDir, "config.json");

    public static string WebView2UserDataFolder => Path.Combine(ConfigDir, "WebView2");

    public static string LogDir => Path.Combine(ConfigDir, "logs");

    public static AppConfig Load()
    {
        try
        {
            if (File.Exists(ConfigPath))
            {
                var json = File.ReadAllText(ConfigPath);
                var cfg = JsonSerializer.Deserialize<AppConfig>(json);
                if (cfg is not null) return cfg;
            }
        }
        catch
        {
            // Corrupt/unreadable config — fall through to first-run defaults
            // rather than crashing the app on launch.
        }
        return new AppConfig();
    }

    public void Save()
    {
        Directory.CreateDirectory(ConfigDir);
        var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(ConfigPath, json);
    }

    /// <summary>
    /// Only accepts http/https URLs pointing at a host — this app is a thin
    /// client for a restaurant's own OrderRestro server (LAN IP, hostname,
    /// or a Tailscale/VPN address), never a place for arbitrary local file
    /// or other-scheme URLs to end up wired into WebView2 navigation.
    /// </summary>
    public static bool IsValidServerUrl(string value, out Uri? uri)
    {
        uri = null;
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var parsed)) return false;
        if (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps) return false;
        uri = parsed;
        return true;
    }
}

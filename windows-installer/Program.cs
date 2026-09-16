using System.Diagnostics;
using System.Net.Http;
using Microsoft.Win32;

namespace PROFEA.Windows;

internal static class Program
{
    private const string ProductName = "PROFEA";
    private const string ProductionUrl = "https://gestionprofea.vercel.app";
    private const string PreviewFallbackUrl = "https://gestionprofea-git-codex-pwa-icon-v4-main-davidhinojogarcia.vercel.app";

    private static readonly string InstallDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Programs", ProductName);

    private static readonly string InstalledExe = Path.Combine(InstallDir, "PROFEA.exe");

    [STAThread]
    public static async Task Main(string[] args)
    {
        try
        {
            if (args.Any(a => string.Equals(a, "--uninstall", StringComparison.OrdinalIgnoreCase)))
            {
                Uninstall();
                return;
            }

            var currentExe = Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrWhiteSpace(currentExe))
            {
                ShowError("No se ha podido localizar el ejecutable de PROFEA.");
                return;
            }

            if (!PathsEqual(currentExe, InstalledExe))
            {
                Install(currentExe);
                StartInstalledApp();
                return;
            }

            await OpenProfeaAsync();
        }
        catch (Exception ex)
        {
            ShowError("No se ha podido completar la instalación o apertura de PROFEA.\n\n" + ex.Message);
        }
    }

    private static void Install(string sourceExe)
    {
        Directory.CreateDirectory(InstallDir);
        File.Copy(sourceExe, InstalledExe, true);

        CreateShortcut(
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "PROFEA.lnk"),
            InstalledExe);

        var startMenuDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
            "Programs", ProductName);
        Directory.CreateDirectory(startMenuDir);
        CreateShortcut(Path.Combine(startMenuDir, "PROFEA.lnk"), InstalledExe);

        using var key = Registry.CurrentUser.CreateSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Uninstall\PROFEA");
        key?.SetValue("DisplayName", "PROFEA");
        key?.SetValue("DisplayVersion", "1.0.1");
        key?.SetValue("Publisher", "PROFEA");
        key?.SetValue("InstallLocation", InstallDir);
        key?.SetValue("DisplayIcon", InstalledExe);
        key?.SetValue("UninstallString", $"\"{InstalledExe}\" --uninstall");
        key?.SetValue("NoModify", 1, RegistryValueKind.DWord);
        key?.SetValue("NoRepair", 1, RegistryValueKind.DWord);
    }

    private static void StartInstalledApp()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = InstalledExe,
            UseShellExecute = true,
            WorkingDirectory = InstallDir
        });
    }

    private static async Task OpenProfeaAsync()
    {
        var url = await ResolveUrlAsync();
        var edge = FindEdge();

        if (edge is not null)
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = edge,
                Arguments = $"--app=\"{url}\" --start-maximized",
                UseShellExecute = true
            });
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true
        });
    }

    private static async Task<string> ResolveUrlAsync()
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("PROFEA-Windows/1.0.1");

        foreach (var url in new[] { ProductionUrl, PreviewFallbackUrl })
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
                if ((int)response.StatusCode < 500)
                    return url;
            }
            catch
            {
                // Try the next known deployment.
            }
        }

        return ProductionUrl;
    }

    private static string? FindEdge()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Microsoft", "Edge", "Application", "msedge.exe")
        };

        return candidates.FirstOrDefault(File.Exists);
    }

    private static void CreateShortcut(string shortcutPath, string targetPath)
    {
        var escapedShortcut = PsQuote(shortcutPath);
        var escapedTarget = PsQuote(targetPath);
        var escapedWorking = PsQuote(Path.GetDirectoryName(targetPath) ?? InstallDir);
        var escapedDescription = PsQuote("Sistema de Gestión PROFEA");

        var command =
            "$w=New-Object -ComObject WScript.Shell;" +
            $"$s=$w.CreateShortcut('{escapedShortcut}');" +
            $"$s.TargetPath='{escapedTarget}';" +
            $"$s.WorkingDirectory='{escapedWorking}';" +
            $"$s.IconLocation='{escapedTarget},0';" +
            $"$s.Description='{escapedDescription}';" +
            "$s.Save()";

        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"" + command.Replace("\"", "`\"") + "\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        });
        process?.WaitForExit(10000);

        if (!File.Exists(shortcutPath))
            throw new IOException("No se ha podido crear el acceso directo de PROFEA.");
    }

    private static void Uninstall()
    {
        TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "PROFEA.lnk"));
        var startMenuDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
            "Programs", ProductName);
        TryDelete(Path.Combine(startMenuDir, "PROFEA.lnk"));
        TryDeleteDirectory(startMenuDir);

        try
        {
            Registry.CurrentUser.DeleteSubKeyTree(
                @"Software\Microsoft\Windows\CurrentVersion\Uninstall\PROFEA", false);
        }
        catch { }

        var cmd = $"timeout /t 2 /nobreak >nul & rmdir /s /q \"{InstallDir}\"";
        Process.Start(new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/c " + cmd,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        });
    }

    private static bool PathsEqual(string a, string b) =>
        string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'),
            StringComparison.OrdinalIgnoreCase);

    private static string PsQuote(string value) => value.Replace("'", "''");

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    private static void TryDeleteDirectory(string path)
    {
        try { if (Directory.Exists(path) && !Directory.EnumerateFileSystemEntries(path).Any()) Directory.Delete(path); } catch { }
    }

    private static void ShowError(string message)
    {
        var escaped = PsQuote(message);
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -NonInteractive -Command \"Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('{escaped}','PROFEA','OK','Error')\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });
        }
        catch { }
    }
}

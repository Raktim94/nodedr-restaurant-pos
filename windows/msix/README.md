# OrderRestro — Windows MSIX client

A thin native shell (WinForms + WebView2) around the same web UI the
Linux/Docker deployment already serves. It ships no server, no database, no
Node.js/Docker/pnpm, and no bundled Chromium — this is not Electron.

## What this is / isn't

- **Is:** a client. On first launch it asks for the restaurant's own
  OrderRestro server address (LAN IP, hostname, VPN address) and connects
  to it — same as typing that address into a browser, but packaged as a
  normal Windows app with a Start Menu entry, no URL bar, no browser tab
  habits.
- **Isn't:** a copy of the server. Backend/Postgres/Docker stay exactly
  where they already run (a restaurant's own machine or VPS).
- **Printing:** unchanged. The web app already prints receipts via
  `window.print()` (`apps/web/lib/print.ts`), which opens the standard OS
  print dialog. Inside WebView2 on Windows, that dialog IS the Windows
  print dialog — it goes through the normal Print Spooler and whatever
  driver is installed for the till's printer (USB, Bluetooth, or
  network). The Linux-only direct-USB ESC/POS path
  (`apps/backend/src/modules/orders/escpos-usb.ts`) lives entirely on the
  backend and is never reachable from or required by this client — the
  Settings page in the web app already labels it "Linux hosts only."

## Why WinForms, and why `runFullTrust`

Any native Win32-model desktop app that hosts WebView2 (WinForms, WPF, or
WinUI 3 alike) packaged via MSIX/Desktop Bridge requires
`EntryPoint="Windows.FullTrustApplication"` and the `rescap:runFullTrust`
capability in the manifest (see `AppxManifest.xml`). This is unavoidable
for this class of app — the only way to avoid it is a true
AppContainer-sandboxed UWP app, a legacy/deprecated model Microsoft has
been steering developers away from for years, and one with materially
worse WebView2 support.

**`runFullTrust` is not elevation.** It does not request UAC, does not
grant admin rights, and is unrelated to genuinely dangerous restricted
capabilities like `broadFileSystemAccess` or any device-class capability
— none of which are declared here (see `AppxManifest.xml`'s own comment).
The app still runs strictly as the current standard user
(`app.manifest` → `requestedExecutionLevel="asInvoker"`), with no
elevation possible from inside a packaged MSIX identity regardless of this
capability. WinForms (rather than WPF or WinUI 3) was chosen simply as the
smallest, most predictable dependency footprint for a single-window
WebView2 shell — it needs no separate Windows App SDK/WinUI runtime
dependency at all.

## Layout

```
windows/msix/
  README.md                   # this file
  AppxManifest.xml             # MSIX identity/capabilities/tiles (hand-authored)
  build-windows-msix.ps1       # publish → stage → makeappx pack → (sign) → (install)
  validate-msix.ps1            # structural checks on a built .msix
  Assets/                      # tile icons, splash screen, app.ico
  Launcher/
    Launcher.csproj             # plain self-contained WinForms publish
    app.manifest                 # asInvoker execution level, per-monitor DPI
    Program.cs                   # entry point
    MainForm.cs                  # WebView2 host + menu (change server / reload)
    ServerSettingsForm.cs        # first-run / change-server dialog
    AppConfig.cs                 # per-user server URL, %LOCALAPPDATA%\OrderRestro
```

## Building

Requires a Windows machine (or the CI runner below) with the .NET 8 SDK
and the Windows 10/11 SDK (for `makeappx.exe`/`signtool.exe` — normally on
PATH from a "Developer PowerShell for VS" prompt).

```powershell
cd windows/msix
./build-windows-msix.ps1                              # unsigned build, for CI/inspection
./build-windows-msix.ps1 -SelfSignedTest -InstallLocally  # local test install round-trip
./validate-msix.ps1                                    # structural sanity checks
```

Or from the repo root: `npm run build-windows-msix` (runs both scripts —
see root `package.json`).

`.github/workflows/windows-msix.yml` runs the same scripts on a real
`windows-latest` GitHub Actions runner on every push/PR touching
`windows/` — this is the actual, verified build/install signal for this
project (see "What has and hasn't been tested" below), since no Windows
machine exists in the environment this app was developed in.

## Capabilities (why each one is declared)

| Capability | Why |
|---|---|
| `internetClient` | Reaching the restaurant's OrderRestro server (LAN IP, hostname, or a VPN/Tailscale address). |
| `runFullTrust` (restricted) | Required for any Win32-model desktop app packaged via Desktop Bridge — see "Why WinForms, and why runFullTrust" above. Not elevation, not admin, not broad filesystem/registry/device access. |

**No device/USB/Bluetooth capability of any kind**, no
`broadFileSystemAccess`, no `documentsLibrary` — `validate-msix.ps1`
fails the build if any of these ever get added, so this stays enforced
rather than just documented.

## Before you submit to the Microsoft Store

The following placeholders **must** be replaced with real values from
Partner Center before this package will install anywhere except a
self-signed local test:

1. **`AppxManifest.xml` → `Identity/@Publisher`** — currently
   `CN=REPLACE-WITH-YOUR-PARTNER-CENTER-PUBLISHER-ID`. Partner Center
   assigns this string when you reserve the app name; it must match your
   account's publisher identity exactly, or Store validation rejects the
   package. `validate-msix.ps1` fails loudly if this placeholder is still
   present.
2. **`Identity/@Name`** — `NodedrInfotech.OrderRestro` is a placeholder
   package identity name; confirm/reserve the actual name in Partner
   Center (Store apps often require a Store-generated identity name
   instead of a hand-picked one).
3. **Signing** — real Store submissions are signed automatically by the
   Store on ingestion; you do not need your own certificate for Store
   distribution. For direct/enterprise sideloading (outside the Store),
   you'll need a real code-signing certificate from a CA trusted by the
   target machines (or an internal PKI) — the `-SelfSignedTest` cert in
   `build-windows-msix.ps1` is dev/CI-only and must never be used for
   that.
4. **App icons/splash** — currently generated from the web app's existing
   logo (`apps/web/public/logo.png` → `windows/msix/Assets/*.png`).
   Regenerate at higher fidelity if a dedicated Windows-tile-optimized
   icon set is desired later.
5. **Version bump policy** — `AppxManifest.xml`'s `Identity/@Version` and
   `Launcher.csproj`'s `<Version>` must both increment together for every
   Store update (Store rejects a re-upload at the same version).
6. **Run the Windows App Certification Kit (WACK)** before final
   submission — `validate-msix.ps1` covers structural/capability checks
   but is not a substitute for WACK.

## What has and hasn't been tested

Per this project's own "don't fake test results" rule:

- **MSIX build (CI, windows-latest): see the latest run of
  `windows-msix.yml`** — this actually publishes the WinForms project,
  packs a real `.msix` via `makeappx`, runs `validate-msix.ps1`'s
  structural checks, installs it via `Add-AppxPackage` with a self-signed
  test cert, verifies the package registers (`Get-AppxPackage`), then
  uninstalls. This is real, automated, machine-verified — not a manual
  claim.
- **NOT TESTED — physical Windows hardware.** No actual Windows desktop
  was available to click through: Start Menu tile appearance, taskbar
  icon, window chrome at various DPI scales, a real UAC-prompt-absence
  visual check, sleep/reboot/relaunch behavior, or upgrade-in-place data
  survival beyond what the code implies (`AppConfig` lives outside the
  install directory, so it should survive — not empirically verified on
  hardware).
- **NOT TESTED — physical thermal printer.** No hardware in this
  environment. The printing path itself is unchanged browser
  `window.print()` behavior already used by the Linux/browser deployment;
  what's specifically unverified is a real Windows-installed printer
  driver + a real thermal printer physically producing a correctly
  formatted 58mm/80mm receipt.
- **NOT TESTED — Microsoft Store submission/certification.** Requires a
  real Partner Center account, the real publisher identity, and the
  Store's own certification pipeline (which includes WACK) — none of
  which can be exercised without that account. The manifest and
  capabilities above were hand-audited against current MSIX/Store
  requirements, not run through WACK.
- **NOT TESTED — WebView2 Runtime absence path.** `MainForm.cs` assumes
  the evergreen runtime is present (true on Windows 11 and most Windows
  10 systems); the failure path if it's genuinely absent was not
  exercised against real hardware missing it.

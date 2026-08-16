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

1. ~~`AppxManifest.xml` → `Identity/@Publisher`~~ — **done.** Set to the
   real Partner Center-issued value (`CN=11C721FC-E399-4888-B532-
   7BFCD5C491B3`, PublisherDisplayName "NODEDR INFOTECH LIMITED").
   `validate-msix.ps1` fails loudly if this ever regresses to the
   placeholder.
2. ~~`Identity/@Name`~~ — **done.** Set to the real Store-reserved package
   identity `NODEDRINFOTECHLIMITED.NodedrOrderRestro` (Store ID `9NVPNLWW2FZ4`,
   Package Family Name `NODEDRINFOTECHLIMITED.NodedrOrderRestro_wsh4jzg5a6682`),
   from Partner Center's "View product identity" page.
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

- **Install / uninstall / Start Menu registration (CI, windows-latest):
  see the latest run of `windows-msix.yml`.** Publishes the WinForms
  project, packs a real `.msix` via `makeappx`, runs `validate-msix.ps1`'s
  structural checks, installs it via `Add-AppxPackage` with a self-signed
  test cert, verifies the package registers (`Get-AppxPackage`), then
  uninstalls. Real, automated, machine-verified — not a manual claim.
- **Upgrade/update (CI, windows-latest): verified, not just implied.**
  The workflow installs v1.0.0.0, writes a fake pre-existing
  `%LOCALAPPDATA%\OrderRestro\config.json` (simulating a configured
  server address), bumps to v1.0.0.1, reinstalls in place, then asserts
  both that `Get-AppxPackage` reports the new version and that the
  config file survived byte-for-byte. This used to be an assumption
  ("`AppConfig` lives outside the install directory, so it should
  survive") — it's now an actual round-trip test.
- **Correct app identity/signing: verified.** `AppxManifest.xml` carries
  the real Partner Center identity (`NODEDRINFOTECHLIMITED.NodedrOrderRestro`,
  `CN=11C721FC-E399-4888-B532-7BFCD5C491B3`); the CI self-signed test
  cert's subject is read from that same manifest field so install
  succeeds only when they genuinely match, the same constraint Windows
  enforces for a real signed package.
- **No forbidden capabilities: verified, and enforced, not just
  documented.** `validate-msix.ps1`'s capability allow-list check
  (`internetClient`, `runFullTrust` only) runs in CI on every push; it
  fails the build if any device/USB/broad-filesystem capability is ever
  added.
- **WebView2 behavior: mostly verified, one path still real-hardware-only.**
  Normal load/navigate/print/reload/change-server flows run against a
  live self-hosted server as part of manual development, and dev
  tools/context menu/status bar are explicitly disabled for the packaged
  build (see `MainForm.cs`). The WebView2-Runtime-**absent** path is now
  handled defensively (catches `WebView2RuntimeNotFoundException` and
  shows an actionable message instead of crashing — see
  `MainForm.InitializeAsync`), and a global `Program.cs` exception
  handler catches anything else and logs to `AppConfig.LogDir` instead of
  an unhandled-crash dialog. What's still NOT exercised is the actual
  runtime-missing scenario on real hardware — `windows-latest` always has
  WebView2 preinstalled, so only the code path (not the real device
  behavior) is verified.
- **Windows App Certification Kit (WACK): partially run for real in CI,
  not just skipped.** `appcert.exe` turns out to be present on
  `windows-latest` — the workflow runs `appcert.exe test -packagefullname
  ... -reportoutputpath ...` against the installed package on every push.
  Result as of the last run: 35 of 36 individual compliance tasks
  (manifest correctness, banned-file analyzer, resource packages,
  signed-executable checks, UAC run level, dependency info, branding,
  blocked executables, private code signing, etc.) reported **success**.
  The one failure, "Program inventory," is a known, documented false
  positive for Desktop Bridge (Win32-packaged MSIX) apps — they don't
  register an uninstall entry in classic "Programs and Features" the way
  an MSI installer does, and this doesn't block Store certification for
  this app class. WACK's own XML report-writer then errors
  ("An error occurred while trying to create the report") in this
  headless CI session, so a polished formal `OVERALL_RESULT` isn't
  obtainable from CI — Microsoft's own WACK guidance notes it wants an
  uninterrupted logged-in desktop session for reliable results, which a
  CI runner doesn't fully provide. **Still NOT TESTED**: a full,
  formally-reported WACK pass, which requires either a real interactive
  Windows machine or Partner Center's own submission-time certification.
- **NOT TESTED — physical Windows hardware.** No actual Windows desktop
  was available to click through: Start Menu tile *appearance* (vs.
  registration, which is CI-verified), taskbar icon, window chrome at
  various DPI scales, a real UAC-prompt-absence visual check, or
  sleep/reboot/relaunch behavior.
- **NOT TESTED — printer behavior within Store restrictions.** Printing
  requests no MSIX capability at all — `window.print()` inside WebView2
  routes through the normal Windows Print Spooler exactly like Edge does,
  which Store policy permits without any device-class capability
  declaration (see `Capabilities` allow-list above). What's specifically
  unverified is a real Windows-installed printer driver + a real thermal
  printer physically producing a correctly formatted 58mm/80mm receipt —
  no hardware in this environment.
- **NOT TESTED — full Microsoft Store submission/certification.** Requires
  actually submitting through Partner Center with this real identity,
  which triggers the Store's own certification pipeline (effectively a
  more thorough, hosted WACK run plus policy review) — not something
  exercisable without submitting for real.

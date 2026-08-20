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
    TrayIcon.cs                   # embedded-mode system tray (minimize-to-tray, stop/exit, remove data)
    ServerSupervisor.cs           # embedded-mode server lifecycle (Postgres/backend/web child processes)
    ServerPaths.cs                # embedded-mode writable state layout, under AppConfig.ConfigDir
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

## Single-instance protection

Embedded-mode installs minimize to the tray on window close instead of
exiting (`MainForm.OnFormClosing`/`TrayIcon.cs`) — the server keeps running
for other LAN devices even when the till window isn't visible. That means a
user who thinks they "closed" the app and reopens it (Start Menu, desktop
tile) is really launching a **second** process against an already-running
first one.

`Program.cs` guards against this with a named per-user `Mutex`
(`Local\NodedrOrderRestro_SingleInstance_...`): a second launch never
reaches `ServerSupervisor.StartAsync` at all — it signals the first
instance (a named `EventWaitHandle`) to come to the foreground, then exits
immediately. Without this guard, the second process's own
`ServerSupervisor` would collide with the first instance's still-open,
exclusively-held `backend.log`/`web.log` file handles
(`ServerSupervisor.StartLongRunning` opens them with `FileShare.Read`,
allowing readers but not a second writer), producing exactly:

> Could not start the embedded server.
> The process cannot access the file '...\backend.log' because it is being
> used by another process.

## Uninstalling OrderRestro

MSIX/Desktop Bridge has no uninstall-hook mechanism — unlike a classic MSI
installer's uninstall custom actions, Windows runs no app code when a
package is removed. It only auto-deletes the package's own sandboxed
`%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalState` folder, which this
app deliberately does **not** use: writable state (`AppConfig.ConfigDir` =
`%LOCALAPPDATA%\OrderRestro`, covering config, the WebView2 profile, logs,
and — in embedded mode — `ServerPaths.DataDir`'s Postgres data directory,
uploads, and the ~2.8GB server runtime copy) must survive an MSIX
upgrade-in-place, which requires a real, stable, non-sandboxed path (see
`AppConfig.cs`/`ServerPaths.cs`). The tradeoff: that data would otherwise
survive a normal uninstall as residue — a restaurant's live database left
behind on disk indefinitely.

To get a genuinely clean removal, the app provides its own equivalent of an
uninstaller's cleanup step: **File → "Remove All Local Data & Uninstall…"**
(also in the tray menu for embedded-mode installs). This stops the embedded
server (Postgres/backend/web) if running, deletes `AppConfig.ConfigDir`
entirely after a confirmation prompt, then opens Windows Settings →
Apps so the user can click Uninstall on "Nodedr OrderRestro" to remove the
package itself. Doing both steps — this menu action, then the actual
package uninstall — leaves no residue on disk.

## Capabilities (why each one is declared)

| Capability | Why |
|---|---|
| `internetClient` | Reaching the restaurant's OrderRestro server (LAN IP, hostname, or a VPN/Tailscale address). |
| `runFullTrust` (restricted) | Required for any Win32-model desktop app packaged via Desktop Bridge — see "Why WinForms, and why runFullTrust" above. Not elevation, not admin, not broad filesystem/registry/device access. |

**No device/USB/Bluetooth capability of any kind**, no
`broadFileSystemAccess`, no `documentsLibrary` — `validate-msix.ps1`
fails the build if any of these ever get added, so this stays enforced
rather than just documented.

### Partner Center: "restricted capabilities require approval" warning

On upload, Partner Center's package acceptance validation flags:

> The following restricted capabilities require approval before you can
> use them in your app: runFullTrust.

This is expected and not a rejection — `runFullTrust` is one of the
"restricted" capability tier (alongside things like `broadFileSystemAccess`
or device-class capabilities) that Microsoft gates behind a manual/automated
review step before the submission can go live, regardless of how minimal
or justified the actual usage is. Every Desktop Bridge (Win32-model) app
packaged as MSIX declares it — see "Why WinForms, and why `runFullTrust`"
above — so this warning surfaces on essentially all such submissions, not
just this one.

What to do about it:

- It's a **warning**, not a validation error — it doesn't block uploading
  the package itself (unlike the earlier package-identity-name error).
- Continue through submission; Partner Center's certification pipeline
  evaluates the `runFullTrust` request as part of the normal review that
  already runs on every submission. It is commonly auto-approved for
  ordinary desktop-shell apps like this one (no elevation, no UWP sandbox
  escape, no other restricted capability alongside it).
- If Partner Center's submission flow presents a **"Notes for
  certification"** field, it's worth adding a short note there stating the
  app is a WebView2-hosted desktop client that requires `runFullTrust`
  solely because it's a Win32/WinForms app under the Desktop Bridge model,
  and that it requests no elevation and no other restricted capability —
  this mirrors the justification already in `AppxManifest.xml`'s own
  capabilities comment.
- If a submission is ever rejected specifically over this capability,
  that's a signal to revisit here — it would mean the reviewer wants more
  justification than the above, not that the capability itself is wrong to
  declare (there is no non-restricted alternative for this app class).

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

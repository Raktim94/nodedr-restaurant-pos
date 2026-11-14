Installing OrderRestro on Windows
=================================

You need: Windows 10 (version 1809 or newer) or Windows 11, about 4 GB of free disk space,
and an internet connection for the first install (it may need to add a small Microsoft component).

1. Keep these three files together in one folder (for example Downloads):
      OrderRestro.msix
      Install-OrderRestro.ps1
      Install-OrderRestro.cmd
   If you downloaded a .zip, right-click it and choose "Extract All" first. Do not run the files from inside the zip.

2. Double-click  Install-OrderRestro.cmd
   Windows will ask for permission once ("Do you want to allow this app to make changes?"). Choose Yes.
   This is needed only to tell Windows that the OrderRestro package is trusted.

3. Wait for "Installed". OrderRestro opens by itself.

4. On the welcome screen choose:
      "Start on this computer"            for a new restaurant (nothing else to set up), or
      "Connect to my existing server"     if your restaurant already runs OrderRestro elsewhere.
   The very first start prepares the database. It takes about 2 to 5 minutes, only once. Leave the window open.

Updating: run Install-OrderRestro.cmd again with the newer OrderRestro.msix. Your data is kept.
Uninstalling: Settings > Apps > OrderRestro > Uninstall.

If something goes wrong
-----------------------
"Not enough free disk space"   Free some space and run the installer again.
"Windows does not trust ..."   Right-click Install-OrderRestro.cmd and choose "Run as administrator".
"A different version is installed"   Uninstall OrderRestro from Settings > Apps, then run the installer again.
"OrderRestro is running"       Close it, also from the system tray (near the clock), then run the installer again.
A blank window                 Install the Microsoft Edge WebView2 Runtime: https://go.microsoft.com/fwlink/p/?LinkId=2124703
Anything else                  Send the red error text and the "Error code" line shown in the installer window to support.

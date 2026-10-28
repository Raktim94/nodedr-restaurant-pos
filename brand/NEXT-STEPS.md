# Follow-ups

## Receipts
escpos/receiptLogo.ts — call receiptLogoEscPos() and write the bytes before the header text (after ESC @ if you init). Replace the plain "Restrovia" text line with it; keep the address/GST lines as text.
escpos/receipt-logo.escpos.bin — standalone test print (includes ESC @). e.g. `copy /b receipt-logo.escpos.bin \\.\COM3` or send raw to the printer.
escpos/receipt-logo-384-preview.png — exactly what the printer will put on paper.
If a printer ignores GS v 0 (some cheap clones), fall back to text.

## Windows MSIX
windows-msix-Assets/ — drop-in replacement for windows/msix/Assets. Same standard file names (Square44x44Logo, Square150x150Logo, Wide310x150Logo, SmallTile, LargeTile, StoreLogo, SplashScreen) at scale-100/125/150/200/400, plus targetsize-16…256 incl. _altform-unplated and _altform-lightunplated.
Delete any old asset files not in this set, so the old logo doesn't hide behind a resource fallback. Check that Package.appxmanifest references these base names, then rebuild the package.

## Dark mode sidebar
Yes, switch it. In dark theme use svg/restrovia-icon-dark.svg (or restrovia-lockup-dark.svg); in light use the -light files. Simplest: render both and toggle with the theme class (e.g. `dark:hidden` / `hidden dark:block`). Don't use a CSS filter on the light file.

## Docs
PDF manuals + marketing images need a manual pass: swap the cover/header logo with svg/restrovia-lockup-light.svg (print: restrovia-lockup-black.svg). Send me any marketing image that needs a redesign and I'll rebuild it.

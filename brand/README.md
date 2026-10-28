# Restrovia logo — 1d "Plate rim r"

Wordmark is outlined Geist SemiBold (no font needed). Colors: brand #9F1239, dark-mode #FB7185, ink #111827, off-white #FBF9F8, accent dot #F59E0B.

## svg/
- restrovia-lockup-{light,dark,black,white}.svg — horizontal
- restrovia-stacked-{light,dark,black,white}.svg
- restrovia-icon-{light,dark,black,white}.svg
- restrovia-wordmark-{light,dark,black,white}.svg
- favicon.svg — auto light/dark

## png/
- brand-lockup.png (light @2x); lockup + stacked @2x/@4x in all four variants
- favicon.ico (16/32/48), favicon-16/32/48.png
- apple-touch-icon.png (180)
- pwa-192.png, pwa-512.png, pwa-maskable-192.png, pwa-maskable-512.png
- restrovia-icon-light-64…1024.png, icon dark/black/white 512
- receipt-logo-1bit.png — pure black/white, 300px wide for 58mm thermal

## manifest.json
"icons": [
  { "src": "/pwa-192.png", "sizes": "192x192", "type": "image/png" },
  { "src": "/pwa-512.png", "sizes": "512x512", "type": "image/png" },
  { "src": "/pwa-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]

## <head>
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">

## Where these are used in the app
- `apps/web/public/logo.png` ← restrovia-icon-light-512.png (sidebar/login Logo component, README footer)
- `apps/web/public/brand-lockup.png` ← restrovia-lockup-light-4x.png (README header)
- `apps/web/public/icons/*` ← pwa-192/512, pwa-maskable-512, favicon-32, apple-touch-icon (manifest + metadata)
- `apps/web/public/favicon.svg`, `apps/web/app/favicon.ico`, `apps/web/app/icon.png`
- `apps/web/public/logo-dark.png` ← restrovia-icon-dark-512.png (dark theme, toggled in components/layout/logo.tsx)
- Not wired: escpos/ (receipt logo raster) and windows-msix-Assets (see NEXT-STEPS.md; the MSIX manifest/validate script expect unscaled names, so don't drop it in as-is).

# OrderRestro mobile app (Android and iOS)

A Capacitor app that wraps the restaurant's own OrderRestro web app with native features. See `../docs/MOBILE-APP-PLAN.md` for the plan and `store/` for the store material.

## How it works

1. First launch shows `www/index.html`: type or scan the server address. It checks `/api/v1/auth/setup-status`.
2. The native `ServerLink` plugin saves the address and restarts the screen, which now loads that server (`server.url`). The Capacitor bridge is injected for that address, so push, location, haptics and the camera work inside the web app.
3. `apps/web/components/native/native-bridge.tsx` registers push, shows the offline banner and sends queued updates (`apps/web/lib/outbox.ts`). In a normal browser all of it is a no-op.
4. If the server cannot be reached, `www/offline.html` appears with Try again and Change server.

## Local and online address (like Immich)

The connect screen takes two addresses for the same restaurant server: a **local** one (the computer on the restaurant WiFi, no internet needed) and an optional **online** one (a public https address). At launch the app asks the local address for `/api/v1/auth/setup-status`; if it answers within about 1.5 seconds it uses it, otherwise it uses the online address. On mobile data it skips the local probe. When the phone changes network the app picks again and reopens on the better address. Everything still goes to the restaurant's own server; there is no NodeDR cloud in between.

Sign-in is stored per address, so a person signs in once on each address.

## Printing from the phone

Bills and kitchen tickets no longer depend on a printer plugged into the restaurant computer.

- **Bluetooth thermal printers** (58 mm and 80 mm "mobile printers"): pair the printer in the phone's Bluetooth settings, then Settings > Bluetooth printer (this phone) > Choose printer. The server builds the ESC/POS data (`?via=device` on the print endpoints) and the app sends it over Bluetooth serial (`NativePrinterPlugin`, Android). Needs the "Nearby devices" permission on Android 12+.
- **Print / Save PDF**: opens Android's print dialog (or AirPrint on iPhone) for the bill, receipt or kitchen ticket, so you can save a PDF or use any print service installed on the phone.
- **UPI QR on the bill**: when a UPI id is set under Settings, an unpaid bill prints a "Scan to pay by UPI" QR with the exact amount due (thermal and PDF). It is left off paid receipts.

iPhones cannot talk to Bluetooth thermal printers, so there it is AirPrint / PDF only.

## Standalone POS on the phone (tables, KOT, kitchen)

Without a server the phone keeps its own account, menu and sales (`www/pos/`). It now also has:

- **Tables**: sections and tables (add/remove), free/occupied tiles with running total and minutes, open and held orders, one open order per table (a second order on a taken table is refused, never merged).
- **Orders saved as you go**: the cart is an order saved to the phone after every change; a crash or restart brings it back. Hold, resume, per-dish notes, cancel with a reason (kept as a record).
- **KOT**: "Send to kitchen" prints only what is new since the last ticket, and a CANCEL ticket if a sent dish was removed. The ticket and the order's "sent" state are saved in one transaction. Print failure is shown honestly and the ticket stays on the Kitchen screen for a retry; reprints are marked REPRINT.
- **Kitchen screen** for this phone: New, Preparing, Ready, Served, with minutes waiting.
- **Today** report on the Sales tab (sales, cash/UPI/card, tax, discounts, top dishes, cancelled orders).

Open orders, tables and kitchen tickets are on that phone only. A shared kitchen display and shared tables across phones need the server: run it on a restaurant computer (the Windows app's "main computer" mode, or Docker) and point every phone at its local address. That works with no internet, only the restaurant WiFi.

### Selling (1.38)

- **Half portions and add-ons**: dishes with a half price or option groups open an options sheet (required groups, min/max). Each dish + portion + add-ons combination is its own line, priced from the menu, and reaches the server as the same modifiers and portion (`apps/backend/src/standalone/offline-lines.ts`). Only combos still need the full app.
- **Barcodes**: type or scan a barcode/SKU in the search box and press Enter (USB and Bluetooth scanners work as keyboards), or tap Scan to use the camera.
- **Customer and pay later**: name and phone on the bill; with a phone number the rest can be left owed. Sales > Money owed lists who owes what; Collect payment records it (part or all, change for cash). On the server the order stays open with its balance until paid.
- **Voluntary service charge**: set a % under Sync > Shop settings. It is never added by itself: the cashier ticks it only when the guest agrees (India's CCPA guidelines do not allow a compulsory one). It is not taxed and reaches the server as a tip.
- **Staff PINs**: Sync > Shop settings > Staff & PINs. Each person switches in with a 4-8 digit PIN (salted PBKDF2 hash, never leaves the phone; 5 wrong tries lock the pad, doubling). Every bill records who took it (the server books it to that person). Discounts, refunds, pay later, cancelling dishes the kitchen has, expenses deleted, closing the day, menu changes and restoring a backup need a manager's PIN. Optional idle lock. Server-linked phones list the server's staff; a phone account adds its own people.

**Older servers.** The phone reads `GET /api/v1/mobile/server-info` capabilities on every menu refresh (`serverCaps`). Without `offlineOptions` (servers before 1.38, which strip unknown sale fields) it hides pay later and the service charge; without `phoneBooksSync` refunds, expenses, collections and cash counts stay pending on the phone (not refused) until the server is updated. The Sync tab says so.

Tests: `node --test www/pos/lib/*.test.mjs`.

## Standalone POS on the phone

With no server the app opens its own POS (`www/pos/`): menu, selling, tables and held orders, kitchen tickets and the kitchen screen, Bluetooth and PDF printing, and sync to a server later. Everything is kept in the phone's IndexedDB (`lib/store.js`).

Books (`lib/books.js`, unit tested in `lib/books.test.mjs`). On a phone account they stay on the phone. On a server-linked phone, refunds (money only), expenses, money collected on owed bills and the phone's own day-end cash count are also sent to the server through the event queue (`lib/journal.js`, each with its own id so a resend is harmless; a refund or collection waits until its sale is on the server). The cash counts appear in the web app under Accounting > Cash close > Phone tills.

- **Refunds** on a sale, by dish and quantity. The sale total (after any discount) is shared across lines by tax-inclusive price; the last refund takes exactly what is left, so the total refunded never exceeds what was paid.
- **Expenses**, from the cash drawer or other.
- **Close the day**: opening cash + cash sales - cash refunds - cash expenses = expected cash, compared with the cash counted.
- **Reports** for today, 7 and 30 days.
- **Stock**: an optional count per dish; counted dishes count down with each sale and switch off at 0. "Sold out" can also be set by hand.
- **Automatic backup**: once a day (and after closing the day) the whole phone is saved to `Download/OrderRestro` on the phone (MediaStore, no permission; it survives clearing or uninstalling the app; the newest 7 are kept). Android 7-9 keep it in the app's own folder instead. It never contains the password or staff PINs.
- **Export and backup**: sales and expenses as CSV (formula characters are neutralised), the whole phone as one JSON backup that restores all-or-nothing and never contains the password. Files go out through Android's share sheet (`NativePrinter.shareFile`, via the FileProvider, no storage permission).

Tests: `node --test www/pos/lib/*.test.mjs`.

## Build (Android)

Needs JDK 21 and the Android SDK (platform 35, build-tools 35).

```bash
cd mobile
npm ci
npx cap sync android
cd android
./gradlew assembleDebug                         # app/build/outputs/apk/debug
ORDERRESTRO_KEYSTORE_PROPERTIES=/path/keystore.properties ./gradlew bundleRelease   # signed .aab for Play
```

`keystore.properties` holds `storeFile`, `storePassword`, `keyAlias`, `keyPassword`. Keep the keystore and that file out of git and back them up: losing the upload key means asking Google to reset it. Use Play App Signing.

## Push notifications (Firebase)

Create a Firebase project, add the Android app `com.nodedr.orderrestro` and the iOS app with the same id, then:

- Android: put `google-services.json` in `android/app/` (it is git-ignored; a copy is kept in `~/orderrestro-signing/`). The OrderRestro Firebase project is `orderrestro-c0a12` with the Android app `com.nodedr.orderrestro` already registered. Without it the app still works and just does not register for push (it checks `ServerLink.pushReady` first).
- iOS: not finished. The Capacitor push plugin returns an APNs device token on iPhone, but the server sends through Firebase (FCM), which needs an FCM token. Before iOS push works, either add the Firebase iOS SDK (`GoogleService-Info.plist`, an APNs key uploaded to Firebase and a Firebase Messaging plugin) or have the server send to APNs directly.
- Server: set `FCM_SERVICE_ACCOUNT_JSON` (or `FCM_SERVICE_ACCOUNT_FILE`) from Firebase > Project settings > Service accounts. Without it push stays off.

## Build (iOS)

Needs a Mac with Xcode 16+, CocoaPods and an Apple Developer account.

```bash
cd mobile && npm ci && npx cap sync ios
cd ios/App && pod install
open App.xcworkspace   # set the Team, archive, upload to App Store Connect
```

The iOS code (`AppDelegate.swift` holds `ServerLinkPlugin` and `MainViewController`) has not been compiled on the machine that wrote it. Expect to fix small things on the first build.

## Versions

`versionName` and `MARKETING_VERSION` follow the server (1.14.x); `versionCode` and `CURRENT_PROJECT_VERSION` are `major*100000 + minor*1000 + patch*100 + build`.

## Tested

Android debug and signed release builds run on an Android 14 emulator against a local server: connect screen, sign-in by phone, rider screen with live location from the native plugin, notification and location permission prompts, offline screen, release (minified) build. Not tested on a physical phone, on iOS, with real Firebase push, or QR scanning with a real camera.

## Icons and splash screens

Source images are in `resources/`. To regenerate every size (the tool is not a project dependency, so it is fetched on demand):

```bash
npx @capacitor/assets generate --android --ios --iconBackgroundColor '#9f1239' --splashBackgroundColor '#9f1239' --splashBackgroundColorDark '#141110'
```


## Stock journal on the phone (1.40)

Kitchen tab > **Stock journal: record production**: product-first voucher with saved recipes (and "No saved recipes for this product yet"), fill from recipe,
stock on hand per ingredient, separate **Add inventory item** / **Add menu item**, review, post (kept on the phone and sent once if offline), save draft,
save as recipe, and **Drafts and posted vouchers**. All rules stay on the server; see `../docs/STOCK-JOURNAL.md`. Code: `www/pos/lib/stockjournal.js`
(tested in `stockjournal.test.mjs`) and the "stock journal" section of `www/pos/pos.js`.

Release prep: `versionName 1.40.0` / `versionCode 140000`. `npm run android:release` builds the bundle; signing uses `keystore.properties` or
`ORDERRESTRO_KEYSTORE_PROPERTIES` as before. Nothing is submitted by the build.

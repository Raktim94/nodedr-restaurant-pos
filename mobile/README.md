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

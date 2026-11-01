# OrderRestro mobile app (Android and iOS)

A Capacitor app that wraps the restaurant's own OrderRestro web app with native features. See `../docs/MOBILE-APP-PLAN.md` for the plan and `store/` for the store material.

## How it works

1. First launch shows `www/index.html`: type or scan the server address. It checks `/api/v1/auth/setup-status`.
2. The native `ServerLink` plugin saves the address and restarts the screen, which now loads that server (`server.url`). The Capacitor bridge is injected for that address, so push, location, haptics and the camera work inside the web app.
3. `apps/web/components/native/native-bridge.tsx` registers push, shows the offline banner and sends queued updates (`apps/web/lib/outbox.ts`). In a normal browser all of it is a no-op.
4. If the server cannot be reached, `www/offline.html` appears with Try again and Change server.

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

- Android: put `google-services.json` in `android/app/`. Without it the app still works and just does not register for push (it checks `ServerLink.pushReady` first).
- iOS: add `GoogleService-Info.plist` is not needed (the Capacitor plugin uses APNs); upload an APNs key to Firebase if you send through FCM.
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

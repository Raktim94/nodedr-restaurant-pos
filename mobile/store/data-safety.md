# Data safety answers

The app talks only to the restaurant server the user connects it to (and to Google/Apple for push delivery). There are no ads, no analytics and no third-party SDK that collects data.

## Google Play: Data safety form

| Question | Answer |
|---|---|
| Does the app collect or share user data? | Collects. Does not share with third parties |
| Is all data encrypted in transit? | Yes when the restaurant server uses https. A server on a private network may use http; the app says so in its listing |
| Can users request data deletion? | Yes: in the app (user menu > Delete my account) and at https://orderrestro.nodedr.com/delete-account |

Data types collected (all "collected", none "shared", all optional = no except account info, purpose = App functionality / Account management):

| Data | Why | Required |
|---|---|---|
| Name | The signed-in staff or rider's name on orders | Yes |
| Email address or phone number | Sign-in ID | Yes |
| Precise location | Delivery riders share where they are while on duty | Only for riders, only while online, and the person can refuse |
| Device or other IDs (push token) | Send order and delivery notifications | Optional (notifications can be refused) |

Not collected: contacts, photos, files, calendar, health, financial info (the app records no payments), browsing history, advertising ID.

Security practices: data is encrypted in transit when the server uses https; the person can request deletion; no data is sold.

## Apple: App Privacy ("nutrition label")

Data linked to the user, not used for tracking: Name, Phone Number (and Email Address), Precise Location (riders), Device ID (push token). Purpose for all: App Functionality. Tracking: No.

Permissions texts are in `ios/App/App/Info.plist`. The privacy manifest is `ios/App/App/PrivacyInfo.xcprivacy`.

## Permissions the app asks for

| Permission | When |
|---|---|
| Notifications | After sign-in, so new orders and deliveries can alert the phone |
| Location (while using the app) | When a rider goes online |
| Camera | Only if the user taps Scan QR code to connect to a server |
| Network / local network | To reach the restaurant server (iOS asks once) |

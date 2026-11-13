# Custom TPV, customer display, table ordering and paging

Status of this document: written against the software only. **Nothing here has been tested on the real TPV, tablet,
buzzers or NFC cards.** Where the hardware matters it says so. Use the Simulator (Settings > Simulator) until the
hardware arrives.

## What exists now

| Need | Where | Notes |
|---|---|---|
| Staff screen | existing POS (`/pos`) | unchanged; now also reports the order to the customer screen |
| Customer screen | `/customer-display?t=TOKEN` | own device, reads the server by token; `/customer-display` with no token still follows a POS window in the same browser |
| Adverts while idle | Settings > Customer screen | pictures and short videos, per screen or for all |
| Table QR + NFC link | Tables > Table cards | QR and NFC card open the same link |
| Guest web menu + payment choice | `/order/<token>` | pay at register, or pay on the phone when a gateway is on |
| Kitchen tablet | existing Kitchen Display (`/kds`) | new **Call buzzer** button on a ready ticket |
| Buzzers | Settings > Buzzers | one per table; polling device or signed webhook to a base station |
| Test without hardware | Settings > Simulator | till, customer display in device sizes, guest phone, kitchen, pretend buzzer |

## Customer screen: how the states work

* **Idle** (nothing in progress): adverts full screen; a welcome message if there are none.
* **Order started**: the first item added on the till shows the live order (quantity, price, running total) immediately.
  The advert layer is removed from the page, not covered, so an advert can never sit on top of an order or hold it up
  (measured 0.5 s from the till's change to the screen with the browser polling once a second; no advert on screen).
* **Payment QR** stays up at least 3 minutes. **Paid**: "Thank you" for the configured seconds (default 8).
* **Order left alone**: back to adverts after the idle time (default 45 s, per screen).
* **Connection lost**: the screen keeps its last picture and shows a small "Reconnecting" note; the till keeps working.
  The till pushes each change; if it cannot reach the server it carries on and the customer screen catches up later.
* The customer screen has no login. It holds a private token that can only read what is on that screen. "New link"
  makes a fresh token and the old URL stops at once. The display uses the server's clock to age an order, so a wrong
  tablet clock cannot confuse it.

### Advert formats and sizes

* Pictures: JPG, PNG, WebP, GIF, up to 5 MB. Videos: MP4 (H.264) or WebM, up to 60 MB, played muted.
* Best sizes: 1920×1080 (landscape), 1080×1920 (portrait). Other sizes are fitted: *Show whole picture* (letterbox) or
  *Fill screen* (crops). Pictures show for the advert time (default 10 s, per advert override); a video plays to its end.
* The file is checked by its contents, not its name. A broken picture or video is skipped after a moment.
* Keep video short and compressed. A 4K video on a small tablet may stutter: **hardware dependent, test on the real
  tablet.**

## The table journey and its states

1. Each table has a QR code and an NFC card with the same link (Tables > Table cards; the page explains how to write the NFC card).
2. The guest opens the web menu, enters a name, chooses items.
3. **Payment choice** (only if a gateway such as Stripe is switched on in Settings > Payments; otherwise cash only):
   * **Pay at the register**: the order goes to the kitchen **immediately** and stays **unpaid** ("Cash due at register" badge in Orders)
     until staff record the cash at the till.
   * **Pay now on my phone**: the order is created but **held**: the kitchen sees nothing until the payment is confirmed
     (by the gateway, checked server-side; a test-mode payment never settles an order). Then it goes to the kitchen once.
4. Kitchen prepares, marks the ticket **Ready**, and presses **Call buzzer**: the table's buzzer is paged.
5. The buzzer rings; pressing it (or staff) acknowledges the call.

| Situation | What happens |
|---|---|
| Same basket sent twice (double tap, dropped connection) | one order; the phone's key makes the second request return the first |
| Guest adds a round while the order is waiting for payment | added to the same order; still nothing goes to the kitchen until paid |
| Online payment fails or expires | order stays held and unpaid; the guest sees "did not go through", with **Try again** or **Pay at the register instead** |
| Guest switches to the register | order is released to the kitchen, marked cash, unpaid |
| Money taken but the order could not be matched | flagged *needs review* (existing gateway safeguard); never silently dropped |
| Staff want to cook before the money arrives | **Send to kitchen anyway** on the order (audited) |
| Buzzer offline (device not heard for 45 s) | the call is queued and the kitchen is told "offline: call the guest by name" |
| Webhook base station unreachable | call recorded as FAILED with the reason; the kitchen is told |
| Pressing Call twice within 20 s | the same call, not a second buzz |
| A call nobody collects | expires after 10 minutes |
| Order cancelled | cannot be paged |

An order is **never marked paid** unless the gateway confirms it, or staff record the cash at the till.

## Assumptions (please correct any that are wrong)

1. The TPV runs a browser (Chrome/Edge/Chromium) and can open `/pos` and a second window or device for `/customer-display`.
   If the TPV software is not browser-based, tell me what it runs.
2. "Dual screen" is either two monitors on one computer (second window; works with no setup) or a separate tablet/PC on the
   same network (use the screen link and "Drive it from this till").
3. The tablet that will be the customer screen can open a web page full screen and stay awake (kiosk mode).
4. The shop has network access to the OrderRestro server (local network is enough; no internet is needed for ordering at the till).
5. Buzzers are one per table, fixed to the table, and are *either* able to make HTTP requests *or* are driven by a base
   station that can receive an HTTP POST. If they are plain radio pagers with their own transmitter box, a small adapter is needed.
6. Stripe is used through the existing gateway integration (Settings > Payments); the currency is the restaurant's currency (EUR for Spain).
7. Table NFC cards hold an NDEF URL record (any common NTAG215/216 type does) and guests' phones read NFC.
8. Cash orders may go to the kitchen before the cash is paid (a decision, see below).

## What I need from you

**Hardware**
* TPV: exact model, screen size/resolution/touch, operating system, browser, printer/cash drawer/scanner connections.
* Customer-facing screen: is it a second display on the TPV or the separate tablet? Size, resolution, portrait or landscape.
* Tablet(s): model, Android/iOS version, and which one is the kitchen tablet vs the customer screen.
* Buzzers: brand/model, how they receive a call (radio base station? Bluetooth? Wi-Fi?), whether there is any API, SDK, protocol document or only a button panel; battery/range figures.
* NFC cards: chip type (NTAG213/215/216), capacity, whether they are write-protected, how many.

**Integrations and credentials** (enter them yourself in the app; never send them in chat)
* Stripe account and **test** keys first (Settings > Payments), then live keys; the webhook URL the app shows must be added in Stripe.
* The public web address of the server (`PUBLIC_BASE_URL`) so payment return links and QR/NFC links point at the right place.
* Country/tax details if receipts must follow Spanish rules (VERI*FACTU is implemented but not certified; see docs).

**Decisions**
* Should *cash* orders reach the kitchen before the cash is collected (current default), or only once staff mark them paid?
* Should unpaid *online-payment* orders that nobody finishes expire automatically (after how long)? Today staff cancel them.
* Auto-call the buzzer when every ticket is Ready, or only when the kitchen presses the button (today: button).
* Customer-screen currency/language and whether it should show product images and the shop's name/logo.
* Ad content ownership/licence (music in videos, etc.): that is yours to confirm.

## Test steps (all on the simulator, then repeat on the real hardware)

Open the app, sign in as the owner. Use the demo link you were given.

1. **Set up**: Settings > Customer screen > add "Counter 1"; add one advert (a picture). Settings > Buzzers > add "Buzzer 1", polling type, assign to a table. Tables > Table cards shows the table's QR and link.
2. **Staff screen + customer display**: Settings > Simulator; choose the customer screen and a size. In frame 1 (till) add items.
   Expected: frame 2 swaps from the advert to the order within about a second; quantities, prices and the total follow every change; Pay/Paid shows Thank you, then adverts return. Stop touching the till for the idle time: adverts return.
3. **Web menu**: choose the table in the Simulator (frame 3) or open the table link on your phone. Enter a name, add items, choose *Pay at the register*, place the order. Expected: "Not paid yet: please pay at the register", "The kitchen has your order". Orders shows "Cash due at register". Press the order twice quickly: only one order.
4. **Kitchen**: frame 4 (or `/kds` on the kitchen tablet): the ticket appears; Accept, Start, **Ready**; then **Call buzzer**.
5. **Buzzer**: in the Simulator pick the buzzer: it rings (red). The guest's phone shows "Your food is ready. Please collect it now." Press "Guest presses to collect": the call is acknowledged. Try "Take out of range" then Call buzzer: the kitchen is told it is offline.
6. **Online payment** (needs a Stripe test key): choose *Pay now on my phone*. Expected: the kitchen sees nothing until the Stripe test checkout is completed with a test card; a failed card shows "did not go through" with the two choices. (A test-mode payment does not mark the order paid; use live mode on a real small order to see it close.)
7. **Disconnection**: switch the customer screen's device to airplane mode: it keeps the last picture and shows "Reconnecting".

## What the simulator cannot tell you

Touch feel, screen brightness and colour, real Wi-Fi range, battery, NFC read distance and phone compatibility, how
a particular buzzer's radio behaves, printing, and any vendor SDK. **No hardware compatibility is claimed.**

## Buzzer integration contract (for whoever builds the device or base station)

* Polling device: `GET /api/v1/public/buzzer/<token>/poll` about every 1.5 s returns `{call:{id,...}|null}`; the first poll that returns a call marks it delivered. `POST /api/v1/public/buzzer/<token>/ack` with `{callId}` acknowledges it.
* Webhook base station: the server POSTs JSON `{event:"page", callId, buzzerId, buzzerNumber, tableId, label, sentAt}` with header `X-OrderRestro-Signature` = hex HMAC-SHA256 of the raw body with the secret set on the buzzer. Reply 2xx to accept; anything else is recorded as FAILED.

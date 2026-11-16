# Mobile app: failure modes and recovery

How the OrderRestro app behaves when things go wrong, what staff see, and how they recover.
Two modes are covered: **server-linked** (the app shows the restaurant server's web app) and the
**phone POS** (`mobile/www/pos`, works with no server; sales sync later through `lib/journal.js`).

Rules that hold everywhere:

- Nothing is shown as done on the server until the server has answered.
- Money is never queued in server-linked mode; on the phone POS a sale is recorded on the phone and marked
  "Waiting to sync" until the server confirms it.
- An update the server refuses is shown, never dropped silently.

| Case | Safe behaviour | What the user sees | How to recover |
|---|---|---|---|
| Internet/WiFi drops **before** a kitchen or delivery status change | The change is saved in the phone's queue (`apps/web/lib/outbox.ts`). The screen shows it as done locally. | Banner: "No WiFi or mobile data … N updates saved on this phone, not yet on the server." | Automatic once the network is back; "Retry now" is also offered. |
| Drops **during** or **just after** a request (no answer) | The send times out after 15 s and is treated as "no answer": kept, retried. Every queued update is "set to state X", so a second send of one the server already applied is harmless. | Same banner, with "Trying again in Ns". | Automatic. Retries back off 2 s → 60 s with ±30% jitter, and only while something is waiting. |
| WiFi up, **server down or restarting** | The live socket drops; after 4 s the app says so. Server errors (5xx, 408, 429) keep the update queued; before 1.39 they deleted it. | "Can't reach the restaurant server … check the restaurant computer is on." The dashboard says "Not updating" instead of "Live". | "Retry now", or start the server. Updates are sent in their original order. |
| Server **refuses** a queued update (e.g. the ticket was already moved on another screen) | Dropped from the queue, kept in a visible list. | Red alert: "The server did not accept … Another screen probably changed it first." | Check the item and repeat the action if it is still needed. |
| **Two devices** change the same ticket or delivery | The server decides (409 on stale moves); the screen refreshes to the server's state. | The refusal alert above; the board shows where the item really is. | None needed. |
| Phone POS: **sale while offline** | The sale is stored in IndexedDB with its own id and sent once; resends are matched by id on the server. | Sales list: "Waiting to sync" / "Synced" / "Refused". | Sync tab → sync now. Refused items show the reason. |
| **App suspended or force-closed** during sync | The queue lives in storage (localStorage / IndexedDB) and survives restarts; an item is removed only after the server answers. | On return, the banner shows what is still waiting. | Automatic on resume; "Retry now". |
| **Signed out** (session expired, 401) while updates wait | Kept; no retries while signed out. Queued updates belong to the person who made them. | After sign-in they are sent. | Sign in again. |
| **Another account** signs in on the same phone | The other person's queued updates are not sent under the new sign-in. | "N updates from another account on this phone will be sent when that person signs in again." | That person signs in. |
| **Storage full** when queueing | The action fails visibly instead of pretending to be saved. | "This phone could not save the update (storage full)…" | Free space and repeat. |
| **Storage corrupted / unreadable** | Read as empty, so nothing half-read is sent. | No queued items shown. | Repeat the action. Server data is unaffected. |
| **Uncertain payment** (gateway) | Server-side: a bill closes only after the gateway confirms. Refund ambiguity is marked NEEDS_REVIEW. | Order stays open / "needs review". | Check the gateway dashboard, then settle. |
| **Notification permission denied** | No push. Every alert is still in the bell (the in-app inbox), on the Orders and Kitchen screens, and rings in-app while the live socket is up. | Nothing breaks; the bell badge still counts. | Allow notifications in Android settings to get alerts while the app is closed. |
| Notification **delayed** or app **force-stopped** | FCM delivery is not guaranteed: Android can delay it in Doze, and a force-stopped app gets nothing until opened. The Orders and Kitchen screens remain the source of truth. | Nothing, or a late notification. | Open the app; the bell and screens are always current. |
| Notification **tapped while signed out or app closed** | The tap is held until the app has a listener after sign-in, then opens the path (in-app paths only) and the exact order/booking when the alert carries one. | Sign-in screen first, then the order. | — |

## Alerts

| Event | Channel | Who | Notes |
|---|---|---|---|
| New online/QR order, order needs accepting, kitchen events | Push (FCM) + bell + in-app sound | People whose role has the permission (`orders.accept`, `kds.manage`, …) | Tap opens the order. In the foreground the app does not double-ring when the live socket already did. |
| Reservation created | Push + bell | `reservations.manage` | Opens the booking. |
| **Low stock** (new in 1.39) | Push + bell | `inventory.manage` | Sent when an ingredient's stock drops from above its reorder level to at or below it, at most once per ingredient per 6 hours. Checked after the transaction commits, so a rolled-back sale never alerts. Tap opens Inventory. |
| Connection lost / server unreachable / back online / updates waiting | In-app banner only | The person on the phone | A server cannot push "you can't reach me", and background polling to detect it would drain the battery, so this is shown in the app, not as an OS notification. |

Not built: quiet hours and per-person notification preferences (the app has a mute switch on the bell for in-app sound only). Low-stock alerts need the ingredient's reorder level set above 0.

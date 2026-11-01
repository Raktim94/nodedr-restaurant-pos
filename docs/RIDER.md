# Delivery riders

Riders use the same app as everyone else. There is no separate rider site.

## Setting a rider up

1. **Team → Add staff**: name, **phone number**, a password (their PIN), role **Delivery staff**, and the location they work at.
2. They open the normal sign-in page and enter **their phone number as the login ID** plus the password. (Email addresses still work for office staff.)
3. A delivery rider lands on **My deliveries**. Existing installs: the first start after upgrading gives every *Delivery staff* role the new **Use the Rider App** permission once; an admin can remove it afterwards.

## What the rider sees (My deliveries)

- A **You are online / offline** switch. Going online shares the phone's live position about every 20 seconds; it stops when they go offline. They cannot go offline with a delivery in progress.
- Deliveries assigned to **them only**, refreshed every few seconds, with a sound and vibration when a new one arrives: pickup place, customer name and address, the landmark and exact position the customer shared (**Navigate** opens maps), **Call customer**, the items, whether the food is ready, and **how much cash to collect** (nothing if already paid).
- **Picked up → Delivered**, or **couldn't deliver** with a reason. Counts for today.

## What staff see

Delivery page: a Riders panel (online / offline, active deliveries, last position with a map link), riders marked online when assigning, the customer's shared location and landmark on each delivery, and why a delivery failed.

## Customer location and website prices

- The website checkout can send the customer's current position (only when they tap the button) and a landmark. The Integration API accepts `delivery.lat`, `delivery.lng`, `delivery.place`.
- **Settings → Website food prices**: make website prices cheaper or costlier by a percentage or a flat amount per dish. It applies to the menu a website shows *and* to the orders it places, never to POS, QR-table or marketplace orders. The online minimum order is measured on the adjusted price.

## Limits

Cash collected is shown to the rider but is settled by staff at the till; riders do not record payments. Location uses the phone's browser location: it needs the page open (the browser pauses background location on some phones).

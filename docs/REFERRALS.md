# Referral rewards and points

Customers can share a dish or their personal link. When a **new** customer
orders through it and the first purchase is **paid**, both people earn points.
Points are the same loyalty points used at checkout, so they can be redeemed
for a discount straight away.

## Settings (Settings → General → Referral rewards)

| Setting | Default | Meaning |
|---|---|---|
| Referral rewards | Off | Master switch. Off = no codes are issued, nothing is attributed, nothing is paid. |
| Points for the customer who shares | 15 | Paid to the original customer. |
| Points for the new customer | 10 | Paid to the person who was referred. |
| Minimum food value of the first order | 200 | The referred customer's first paid order must have items worth at least this (before discounts); smaller orders pay nothing and the referral stays pending for a later, bigger order. |
| Smallest online order accepted | 0 | Website / API orders below this are refused (0 = no minimum). Zomato / Swiggy and table-QR orders are not affected. |
| 1 point redeems for | 1.00 | Value of a point in the shop's currency. For **100 points = ₹10** enter `0.10`. |

## Rules (all enforced on the server)

- **Attribution** is recorded when a new customer places an order (or signs up
  and orders) with a referral code. One referral per customer, ever
  (`referrals.referredId` is unique).
- **No self-referral**: the code's owner and the new customer must be different
  people; phone numbers are compared on their last 10 digits, so `+91…`,
  `0…` and spaced formats do not get around it.
- **New customers only**: someone who already has a paid order (also checked
  across the restaurant's other branches by phone) cannot be referred.
- **Nothing is paid early.** Both rewards are paid together when the referred
  customer's first purchase is fully **paid**, never when it is placed,
  accepted or cancelled.
- **Exactly once.** The payout claims the referral with an atomic
  `PENDING → REWARDED` update inside the payment transaction, so a retried or
  concurrent checkout cannot pay twice. Every change to a points balance is also
  written to `points_ledger` with a unique idempotency key (`referral:<id>:referrer`,
  `referral:<id>:referred`, `earn:<order>`, `redeem:<order>`).
- If referrals are switched off at the moment of payment the referral stays
  pending and is paid if it is switched back on.
- **Redeeming**: a customer asks to use points when ordering online; the request
  is capped at their balance and at the bill's value, applied to the bill at
  checkout at the configured point value, and deducted in the payment
  transaction with a guarded atomic decrement.

## Where staff see it

- **Customers → a customer**: points balance and what it is worth, available
  rewards, referral code, friends invited / ordered, and the point history.
- **Checkout** applies the points the customer asked for online unless the
  cashier chooses a different amount.

## For websites (Integration API)

- `POST /api/v1/integrations/locations/:branchId/rewards` `{ "customerPhone", "customerName"? }`
  returns the points balance, value, rewards, referral code and counts. Call it
  only for a customer your own site has signed in.
- `POST …/orders` accepts `referralCode`, `sharedItemId` and `redeemPoints`.
  The response carries `rewards.referral` and `rewards.redeem`.
- Both need the `orders:write` scope. Honour `redeemPoints` only for the
  logged-in customer whose phone is on the order (the PKUSS proxy does).

Share links look like `https://your-site/menu?ref=CODE&item=ITEM_ID`; the site
stores the code until the visitor orders.

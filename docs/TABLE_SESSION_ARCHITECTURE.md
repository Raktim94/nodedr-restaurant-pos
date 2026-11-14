# Table sessions and the table lifecycle

## Two ways in (the restaurant picks; default is the simple one)
| | Basic (default) | Advanced |
|---|---|---|
| Guest proves they are at the table by | scanning the table QR and entering a 6-character code staff give them | tapping a secure NFC tag |
| Who opens the table | staff, by creating the code | the first valid guest order (automatic) |
| Settings | nothing to switch on | **Secure NFC tags** and **Open and close tables automatically** (Tables > Ordering mode & NFC tags) |

Both are always available as a fallback for each other: switching Advanced off never deletes anything, and the QR + code flow
keeps working while it is on.

## Objects
- `TableSession`: one active session per table (opened by staff or automatically). Has no code when opened automatically.
- `TableSessionGrant`: what a phone holds after joining; stored as a hash; bound to one session.
- `TableAccess`: what a phone holds after a verified tap; 30 minutes; one table; stored as a hash. It does **not** open the table.
- `NfcTag` / `NfcTap`: see NFC_SECURITY_ARCHITECTURE.md.

## Opening
A tap alone never opens a table. The **first valid order** does: the server takes a per-table advisory lock, opens the session
if none is live (so ten guests ordering at once open exactly one), creates the order, and gives that phone a session grant.
Later guests tap, order, and join the same session with their own grant.

## States (derived, not stored)
`CLOSED, ACCESS_VERIFIED, OPEN, ORDER_PROCESSING, PAYMENT_PENDING, SETTLED, ATTENTION_REQUIRED`. The server derives the state
from sessions, taps, open orders, kitchen tickets, payments and guest calls (`packages/types/src/table-lifecycle.ts`), so it
cannot drift from the orders. Priority: attention > payment pending > with the kitchen > open > guest tapped in > paid >
available. `TABLE_TRANSITIONS` lists the legal moves; tests check the whole machine is reachable and the impossible ones are
refused. `GET /tables/overview` serves the live board (Tables > Live board).

## Closing
A session closes when **every order is settled** (the last payment in `OrdersService`), or when staff close or reset it. A
timer alone never closes a session that still owes money: an expired session stays usable while an order is open, and only an
expired session with nothing owed stops working. Failed or unclear payments (`FAILED`, `NEEDS_REVIEW`) put the table in
ATTENTION_REQUIRED instead of closing it. Split and partial payments keep the order open until the balance is cleared.

## Staff overrides
Staff can still open, reset or close a table by hand (permission `table.session`), and clear guest calls. These are for
exceptions; the normal flow needs no staff step.

## Guarantees tested (apps/backend/test/nfc-tables.e2e-spec.ts, table-session.e2e-spec.ts)
Replay, forged and cloned taps refused; counters not burnable by forgery; one session under concurrent first orders; tokens
scoped to their table; expiry only when nothing is owed; settlement closes and clears; rotation, disable and replace;
simultaneous orders get distinct numbers.

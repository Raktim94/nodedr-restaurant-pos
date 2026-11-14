# Security audit report: OrderRestro (nodedr-restaurant-pos)

**Reviewed commit:** `b9a47cdaca9c3982207755acf9c7ad9d3afaf94a`. **Profile:** quick, scoped, two hunting waves (8 + 6 units, 7 hunters, 1 critic). **Method:** source review by isolated read-only hunters; the parent validated each candidate with a regression test that fails on the old code. **Partial coverage, not a clean bill of health.**

## Status of this run

**Complete.** Both validators pass. All nine confirmed findings were independently re-verified by three fresh read-only agents (8 verified, 1 verified with corrections), and the SSRF finding was reproduced inside an isolated sandbox.

- Independent verification: see `verification.json`. Verifiers also found three residual gaps in the first fixes (direct permission grants ignored by the privilege ceiling, price cut plus typed discount exceeding the cap, discount reason auto-filled); all fixed.
- Evidence: one finding (SSRF) was reproduced under a real sandbox (no network, read-only filesystem, empty environment, resource limits); the rest rely on source review and the repository's own test suites on a throwaway database.
- No deployed system was probed.
- All confirmed findings are fixed on `master` with regression tests that fail on the old code.

## Confirmed findings (all fixed)

| Severity | Finding | Fingerprint |
|---|---|---|
| high | Backup, update and sync settings act on the whole server but were open to any restaurant's owner | `server-wide-operations-authorised-by-per-restaurant-permission` |
| medium | Offline-sale sync let a waiter sell at any price or apply discounts without discount permission or the discount cap | `offline-sale-phone-price-and-discount-bypass` |
| medium | Staff and role managers can grant, edit or take over more access than they hold, including OWNER | `role-and-account-management-without-privilege-ceiling` |
| low | Email login picks one arbitrary account when the same email exists in two restaurants | `email-login-first-match-across-restaurants` |
| low | Guest pay-online and pay-cash act on a table's order with only the static table QR | `guest-pay-routes-without-table-session-grant` |
| low | A website integration key could read any reservation in its branch, including staff bookings, with contact details | `integration-key-reservation-read-unscoped-and-unfiltered` |
| low | Refund service accepted zero or negative amounts when reached through the MCP tool | `refund-amount-not-positive-on-non-rest-paths` |
| low | Webhook SSRF guard misses IPv4 addresses embedded in IPv6 literals | `ssrf-webhook-netguard-embedded-ipv4-in-ipv6` |
| low | Wrong-code lockout was per table session, so anyone with the static QR could block new guests from joining | `table-session-join-lock-denial-by-static-qr` |

## Needs validation

None open.

## Coverage

All 14 units were reviewed. Areas covered in the second wave with no further finding: the downloads redirect (fixed hard-coded map), uploads and static serving (allow-listed extensions, magic bytes, nosniff, no SVG), VERI*FACTU certificate handling (AES-GCM sealed, branch-bound), push, printer device access, the integration API key surface (scopes, tenant binding, idempotency, server-side pricing) apart from the reservation read, and the realtime gateway (authenticated, restaurant-scoped).

## Hardening notes

Done after the run (commit `85b32a2` and earlier): restore vets the uploads archive before touching the database and extracts without ownership or permissions; the updater refuses downgrades unless `UPDATER_ALLOW_DOWNGRADE=true`; MCP tools use whole-number quantities, non-negative two-decimal prices and positive refunds; `SECURITY.md` explains `TRUST_PROXY` and carries an operator checklist (change default updater token and database password, `VERIFACTU_KEY`, private backup bucket); backend lint is clean and CI lints.

Not changed, by decision (each needs a product or deployment choice, or could not be built and tested here):
- Backups are unencrypted and hold password hashes and the stored storage secret (needs a key-management design).
- Sync peer key is stored in plaintext and cannot be revoked by unsetting the environment variable.
- The backend image installs a Docker CLI it does not use and runs as root (an image rebuild could not be tested here, no Docker access).
- Compose files still ship a default updater token and database password (install scripts and CasaOS manifests depend on them; the checklist tells operators to change them).
- Realtime: any staff user of the restaurant can join any branch room (same restaurant-level model as REST); websocket Origin is not checked (could break the mobile app); `kot.updated` and `table.updated` send full rows.
- Guest `GET status` shows the table's open tab to any holder of the static QR.
- Network printer host and port are tenant-set TCP targets with no guard (LAN targets are the point).
- Integration `rewards` can read or redeem points by phone number with an `orders:write` key; key rotation breaks idempotent replay across the rotation.
- Login has no per-account lockout, and the 2FA failure counter is in memory per process.
- Offline-sale phone UI changes (the reason field) were checked for syntax and through the server tests, not exercised in the running app.

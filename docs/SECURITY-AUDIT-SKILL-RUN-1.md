# Security audit report: OrderRestro (nodedr-restaurant-pos)

**Reviewed commit:** `b9a47cdaca9c3982207755acf9c7ad9d3afaf94a`. **Profile:** quick, scoped, two hunting waves (8 + 6 units, 7 hunters, 1 critic). **Method:** source review by isolated read-only hunters; the parent validated each candidate with a regression test that fails on the old code. **Partial coverage, not a clean bill of health.**

## Status of this run

- Candidate validation was done by the parent, not by fresh independent verifier agents; Phase 5 independent record verification was not performed, so `run_status` is `incomplete` (`independent_record_verification_not_performed`).
- Target code ran only as the repository's own unit and e2e tests on a throwaway local database; the skill's full OS sandbox was not available. No deployed system was probed.
- All confirmed findings are fixed on `master` with regression tests.

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

## Hardening notes (not findings; not changed)

- Default `UPDATER_TOKEN` and database password in the shipped compose files; the updater can install any semver tag, including a downgrade.
- Backups are unencrypted and include password hashes and the stored S3 secret; restore extracts `uploads.tar.gz` without symlink or traversal filtering.
- Sync peer key is stored in plaintext and cannot be revoked by unsetting the environment variable.
- MCP write tools bypass the REST Zod schemas (fractional quantities, negative menu prices).
- Guest `GET status` shows the table's open tab to any holder of the static QR.
- Realtime: any staff user of the restaurant can join any branch room (same restaurant-level model as REST); the websocket Origin is not checked (changing it risks the mobile app); `kot.updated` and `table.updated` send full rows.
- Offline sale discounts: the auto-filled discount reason still satisfies `requireDiscountReason`; the phone app has no reason field yet.
- Network printer host/port are tenant-set raw TCP targets with no guard; the diagnostics result is a port-scan oracle on shared servers.
- VERI*FACTU certificates fall back to a key derived from `JWT_SECRET` when `VERIFACTU_KEY` is unset.
- Integration `rewards` can read or redeem points by phone number with an `orders:write` key; key rotation breaks idempotent replay across the rotation.
- Login has no per-account lockout; the 2FA failure counter is in memory per process.
- The backend image installs the Docker CLI it does not use and runs as root.

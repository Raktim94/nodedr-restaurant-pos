# Security audit report: OrderRestro (nodedr-restaurant-pos)

**Reviewed commit:** `b9a47cdaca9c3982207755acf9c7ad9d3afaf94a` (master before this run's fixes). **Profile:** quick, scoped. **Method:** source review by four isolated hunters, one post-wave coverage critic, local regression tests written by the parent. **This is partial coverage, not a clean bill of health.**

## Status of this run

- Candidate validation: done by the parent with failing regression tests (not by fresh independent verifier agents). Phase 5 independent record verification was **not performed**; `run_status` is therefore `incomplete` (`independent_record_verification_not_performed`).
- Target code was executed only as the repository's own unit/e2e tests on a throwaway local database; the skill's full OS sandbox was not available. No deployed system was probed.
- No compatible prior ledger existed.
- All confirmed findings below were fixed on `master` (commit `77beb2b`) with regression tests.

## Confirmed findings (fixed)

| Severity | Finding | Fingerprint |
|---|---|---|
| high | Backup, update and sync settings act on the whole server but were open to any restaurant's owner | `server-wide-operations-authorised-by-per-restaurant-permission` |
| medium | Staff and role managers can grant, edit or take over more access than they hold, including OWNER | `role-and-account-management-without-privilege-ceiling` |
| low | Email login picks one arbitrary account when the same email exists in two restaurants | `email-login-first-match-across-restaurants` |
| low | Guest pay-online and pay-cash act on a table's order with only the static table QR | `guest-pay-routes-without-table-session-grant` |
| low | Refund service accepted zero or negative amounts when reached through the MCP tool | `refund-amount-not-positive-on-non-rest-paths` |
| low | Webhook SSRF guard misses IPv4 addresses embedded in IPv6 literals | `ssrf-webhook-netguard-embedded-ipv4-in-ipv6` |

## Needs validation (not fixed)

- **Wrong-code lockout is per table session, so anyone with the static QR can block new guests from joining** (`table-session-join-lock-denial-by-static-qr`): Whether a recurring block on new guests joining a table counts as meaningful impact is a product decision; the lock exists to stop code brute force.

## Coverage

2 units covered with no finding, 6 units produced findings, 6 units deferred by the critic under the quick profile:

- apps/backend/src/integrations/integrations.controller.ts#website integration API: Website integration API-key surface not covered by any unit.
- apps/backend/src/modules/downloads/downloads.controller.ts#unauthenticated redirect and public uploads: Unauthenticated redirect target source and public static uploads content-type handling not covered.
- apps/backend/src/modules/paging/paging.service.ts#buzzer webhook outbound fetch: Buzzer webhookUrl fetched with redirects and no private/link-local check; link-local and redirects were hardened in this run, the rest (LAN targets are by design) is deferred.
- apps/backend/src/modules/verifactu/verifactu.aeat.ts#tax authority client: Residual outbound calls and certificate/secret handling not covered.
- apps/backend/src/realtime/realtime.gateway.ts#Socket.IO connection: Gateway joins any authenticated staff to the branch room regardless of permission; Origin of the websocket upgrade unchecked.
- apps/backend/src/standalone/standalone.controller.ts#offline sale sync: Offline sale intake trust and idempotency scoping, and execFileSync('mknod') inputs, not covered (offline-sale time bounds were fixed in the earlier audit).

## Hardening notes from the hunters (not findings)
- Default `UPDATER_TOKEN` and database password in the shipped compose files; the updater (root, docker socket) can install any semver tag, including a downgrade.
- Backups are unencrypted and include password hashes and the stored S3 secret; restore extracts `uploads.tar.gz` without symlink or traversal filtering.
- Sync peer key is stored in plaintext and cannot be revoked by unsetting the environment variable.
- MCP write tools bypass the REST Zod schemas (fractional quantities, negative menu prices).
- Guest `GET status` shows the table's open tab to any holder of the static QR.
- Offline login has no per-account lockout; the 2FA failure counter is in memory per process.
- The backend image installs the Docker CLI it does not use and runs as root.

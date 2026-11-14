# Security policy

## Reporting a vulnerability
Please do **not** open a public issue. Email **mail@raktimranjit.com** with a
description, affected version, and steps to reproduce, or use GitHub's private
vulnerability reporting on this repository. Do not include real customer data.

You should get an acknowledgement within a few days. Please allow reasonable
time to fix before public disclosure; we will credit you if you wish.

## Supported versions
Security fixes go to the latest release. Self-hosters should stay on it
(Settings shows the version; the in-app Update button upgrades in place).

## Scope
Authentication and sessions, role-based access, tenant isolation between
restaurants, payments and bill adjustments, the Integration API and webhooks,
and the Docker/CasaOS/Windows packaging. Out of scope: denial of service by
volume, social engineering, and issues requiring an already-compromised server.

## Hardening defaults
- Sign-up is closed once a restaurant exists. `ALLOW_PUBLIC_SIGNUP=true` puts several restaurants on one server. Backup,
  update and sync settings act on the whole server, so with more than one restaurant only the restaurant that set the
  server up may use them; every other restaurant is refused. Even so, treat a shared server as a hosted service you
  operate: the database is shared, and one operator can read all of it.
- The API sends helmet headers (CSP, HSTS, nosniff), restricts CORS to
  `CORS_ORIGIN`, and rate-limits (300 req/min, 5/min on login and sign-up).
- The web server adds nosniff, frame, referrer, permissions and HSTS headers.
  A Content-Security-Policy for the web pages is not set yet (needs a nonce
  middleware).
- Dependencies: `pnpm audit --prod` reports no known vulnerabilities and CI fails on a moderate or higher advisory.

## Operator checklist (things the software cannot decide for you)

- Set `TRUST_PROXY` to the number of reverse proxies in front of the backend. Without it every guest behind a proxy
  looks like one address, so the per-source limits (table-code guessing, login, ordering) are shared by everyone.
- Change `UPDATER_TOKEN` and `POSTGRES_PASSWORD` from the defaults in the compose files before exposing anything.
  The updater runs as root with the Docker socket; it refuses to install an older release unless you set
  `UPDATER_ALLOW_DOWNGRADE=true`.
- Backups are not encrypted: they hold password hashes and the storage secret. Keep the bucket private, and set
  `VERIFACTU_KEY` (otherwise stored VERI*FACTU certificates are keyed from `JWT_SECRET`, so rotating it breaks them).
- Network printer addresses are connections the server makes from inside your network: only users who can edit
  settings can set them, and the printer test result shows whether the address answered.

## Past audits
See [`SECURITY-AUDIT-REPORT.md`](./SECURITY-AUDIT-REPORT.md) (August 2026), [`docs/AUDIT-2026-11.md`](./docs/AUDIT-2026-11.md) and
[`docs/SECURITY-AUDIT-SKILL-RUN-1.md`](./docs/SECURITY-AUDIT-SKILL-RUN-1.md) (November 2026) for findings and fixes.

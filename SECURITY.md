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
- **Sign-up is closed after first run.** `POST /auth/register` only works while
  the server has no restaurant. Set `ALLOW_PUBLIC_SIGNUP=true` only if you host
  several restaurants on one server; every owner then holds instance-level
  permissions (backup, update, sync), so do not do this on an install that has
  its own data you care about.
- The API sends helmet headers (CSP, HSTS, nosniff), restricts CORS to
  `CORS_ORIGIN`, and rate-limits (300 req/min, 5/min on login and sign-up).
- The web server adds nosniff, frame, referrer, permissions and HSTS headers.
  A Content-Security-Policy for the web pages is not set yet (needs a nonce
  middleware).
- Known dependency advisories (moderate, transitive, fix needs a major bump we
  do not control): `glob`/`minimatch` via `archiver`; `@hono/node-server` via
  the MCP SDK. Re-run `pnpm audit --prod` before each release.

## Past audits
See [`SECURITY-AUDIT-REPORT.md`](./SECURITY-AUDIT-REPORT.md) for findings and
fixes.

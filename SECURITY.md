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

## Past audits
See [`SECURITY-AUDIT-REPORT.md`](./SECURITY-AUDIT-REPORT.md) for findings and
fixes.

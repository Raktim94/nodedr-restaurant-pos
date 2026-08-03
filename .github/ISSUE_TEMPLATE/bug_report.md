---
name: Bug report
about: Something isn't working the way it should
title: ""
labels: bug
assignees: ""
---

**Describe the bug**
A clear, concise description of what's wrong.

**To reproduce**
Exact steps, not "sometimes happens":
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
What you expected to happen instead.

**Screenshots / logs**
If applicable — especially for anything visual, or a server-side error
(include the relevant backend log lines, not just the frontend toast).

**Environment**
- Setup: Docker / local dev (see `CONTRIBUTING.md`)
- Node version:
- pnpm version:
- Postgres version (if not using the bundled Docker service):
- Browser (if a frontend bug):

**Is this a money-correctness or RBAC bug?**
(e.g. a total that doesn't match line items, a permission that doesn't
actually gate an action) — flag it here, these are treated as high
priority per `CONTRIBUTING.md`.

**Additional context**
Anything else relevant.

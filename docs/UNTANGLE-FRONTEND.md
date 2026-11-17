# Frontend untangling decision log

## Make offline writes belong explicitly to a signed-in session

Problems found:
- `apps/web/lib/outbox.ts`: an absent current user treats all queued writes as owned, including legacy writes without an owner.
- The flush loop captures ownership once and can continue sending the old user's queue after a login/logout changes the session cookie.
- KDS optimistic state overlays all saved changes, including another account’s writes.
- Coalescing by group can replace a different user's waiting change on a shared terminal.
- `use-auth.ts` clears display caches on logout but does not stop scheduled offline sends before ending the session.

Fix: fail closed on unowned writes; scope coalescing to the owner; stop retries on identity changes and check the identity generation before every send. Authentication transitions set the outbox identity explicitly. Preserve other users' saved changes for their next sign-in.

## Treat branch persistence as optional

Problem: `use-branch.tsx` reads/writes localStorage without a storage-error boundary, although browser policy or quota can block it. A branch selector should still work in memory.

Fix: isolate the persisted preference in small storage helpers, with regression coverage for unavailable storage. Keep branch choice and validation in the provider.

## Validation scope

Regression tests cover unauthenticated/legacy queue isolation, cross-account group coalescing, identity changes during a flush, and blocked branch storage. No UI appearance or server-authoritative billing behavior is intentionally changed.

Validation: targeted regression tests passed (2/2). `ApiError` now uses explicit fields instead of TypeScript parameter properties so the existing Node TypeScript test runner can exercise the real HTTP/outbox path. This preserves the public error shape.

Full web library test command passed: `node --test --no-warnings apps/web/lib/*.test.ts` (13 files). KDS pending overlays now use only the current owner’s queue.

## Couple a pending display update to its actual destination

Problem: the customer-display debounce captured the first terminal while reading the newest cart. Changing terminals in the debounce window could publish the new cart to the old customer screen.

Fix: keep destination and state together in the pending update, and cancel the pending send when the selected terminal changes. Regression test switches terminals before the debounce fires and verifies the exact terminal and total delivered.

Latest full web library run: 14/14 test files passed, including real customer-display publish/debounce behavior.

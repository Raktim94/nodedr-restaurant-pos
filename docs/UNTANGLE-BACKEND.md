# Backend untangle decision log

Scope: current master source, without unmerged PR #30.

## Apply one lock-before-read operation to stock mutations

- `StockService.consumeStock` read the ingredient balance before acquiring the row lock. A waiting checkout could overwrite a newer committed balance with stale stock.
- `StockService.adjustStock` read and set the balance without a lock.
- `restoreStock` already used the correct ordering, but duplicated the convention.
- Fix: one private ingredient lock/read method shared by all three paths. Regression tests simulate a committed deduction while the caller waits for the lock and check the resulting stock.

## Share money rounding in the stable common layer

- Accounting, payroll, discounts, and pricing each implemented identical two-decimal rounding while `common/money.ts` already provided it.
- Fix: import and re-export the existing helper to preserve module APIs and behavior while keeping the rounding rule in one place.

## Unresolved findings requiring further review

- `StockService.scheduleLowStockAlert` assumes a two-second timer means a caller transaction has committed. Longer transactions or process restart can miss alerts; a committed outbox/event boundary would remove this timing convention.
- MCP tool definitions remain in a large registry coupled to multiple domain services; extracting domain registries should retain the centralized execution authorization gate.

Verification results are recorded by the main work report. This log is not a claim of complete backend verification.

## Follow-up review and limits

- Applied deterministic ingredient-ID ordering to checkout consumption and refund restoration, reducing deadlocks between two bills with the same ingredients listed in different order. Production/journal workflows already pre-lock sorted IDs in several paths; a real PostgreSQL concurrency suite is still needed to establish ordering across every mixed workflow.
- Centralized the remaining identical report and standalone-books rounding implementations. Existing exports in domain calculation files remain for compatibility and delegate to `common/money.ts`.
- Preserved the low-stock notification timer: moving it to a transaction-completion boundary requires an explicit post-commit contract or durable outbox. The current two-second delay cannot prove commit completion for long transactions and can lose alerts on process exit.
- MCP's tool registry imports many domains directly. Permission checks and invocation now share a single executor used by the MCP transport and available to internal callers; raw handlers remain private. PR #30 remains outside this master-branch refactor and must still use that boundary if integrated.
- Goods-receipt snapshot and numbering races were coordinated with the inventory reviewer; see `UNTANGLE-RECEIPTS.md` and corresponding regression tests for their resolution.
- The repository deliberately scopes branch access to restaurant ownership rather than individual staff-branch assignments (`common/services/branch-access.service.ts`). This documented product behavior has not been silently changed by the refactor.

## Validation

Targeted stock-locking, low-stock alert, and calculation regression tests passed (initial focused run: 5 suites, 45 tests). New locking tests reproduce a committed stock change while a transaction waits for a lock and check the resulting balance and over-consumption rejection. These mocked transaction tests do not replace a real PostgreSQL race test. Full repository checks are being run by the coordinating agent.

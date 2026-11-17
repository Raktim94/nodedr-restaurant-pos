# Transfer consistency

The transfer workflow previously locked the source ingredient first and the destination second. Transfers in opposite directions could acquire these locks in opposite order, and concurrent transfers could both attempt to create the same destination ingredient.

Transfers now lock both branch rows in a stable order before consuming stock and resolving the destination ingredient. This serializes cross-branch transfers that share a branch and protects first-time destination creation. A focused test checks that branch locks are acquired in the same order before stock is consumed. A real PostgreSQL concurrency test is still needed to validate interactions with all other inventory operations.

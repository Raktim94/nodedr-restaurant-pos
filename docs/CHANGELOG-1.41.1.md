# OrderRestro 1.41.1

- **Fix: server would not start in 1.41.0.** 1.41.0 listed no `express` package for the backend, so the server image stopped at start with "Cannot find module 'express'". Use 1.41.1 (1.41.0 images were never kept on any server). CI now builds the backend and fails if the compiled code needs a package the backend does not declare.
- Everything else is as in 1.41.0 (start chooser, add several tables, credit-sale screen, money-owed summary, Android file downloads in server mode, barcode scanner anywhere on the Sell screen).
- **Database:** no migration.

# Spain VERI\*FACTU

**Status: implemented, not certified.** OrderRestro now keeps the records Spain's anti-fraud rules require and can report them to the tax agency (AEAT). It has **not** been run against the live AEAT portal, and NODEDR INFOTECH PRIVATE LIMITED has **not** issued the *Declaración Responsable* that the law requires from the software producer. Do not tell a customer it is "compliant" until both are done.

Background: Real Decreto 1007/2023 and Orden HAC/1177/2024. AEAT's note (updated 13 October 2026) gives 1 January 2027 for corporate-income-tax payers and 1 July 2027 for everyone else; check AEAT for the current position.

## What it does

When VERI\*FACTU is switched on for a branch (**Settings → VERI\*FACTU**):

| Event | Record |
|---|---|
| A bill is fully paid | A simplified invoice (`F2`) is added to the chain, in the same database transaction as the payment. If the record cannot be produced, the payment is rolled back. |
| A refund is issued | A corrective simplified invoice (`R5`, by difference, negative amounts) pointing at the original invoice. |
| A bill is cancelled before payment | Nothing: no invoice was ever issued. |

- **Chained, non-alterable log.** Each record carries the SHA-256 fingerprint (*huella*) of its own fields and of the previous record. PostgreSQL triggers refuse `DELETE`, `TRUNCATE`, any change to a record's amounts, XML or hash, and any record that does not continue the chain. Only the submission outcome (status, CSV, errors, attempts) can change. Sales that have an invoice cannot be bulk-deleted.
- **Separate chains** per tax ID and per environment (test and production never mix). Numbers are gap-free per branch (`T1-000001`; refunds `RT1-000001`).
- **80 mm receipt.** A paid receipt prints "Factura simplificada <number>", "QR tributario:", the QR code (ISO 18004, error correction M, module size 6 ≈ 33 mm on 203 dpi paper, inside AEAT's 30–40 mm range) and "Factura verificable en la sede electrónica de la AEAT / VERI\*FACTU". The HTML print uses a 35 mm inline SVG. A bill printed before payment carries no QR.
- **Reporting.** A background job sends pending records to AEAT in chain order over mutual TLS with the branch's own certificate (a `.p12`/`.pfx`, stored AES-256-GCM encrypted), respects AEAT's waiting interval, retries transport errors every 5 minutes and records each answer (accepted, accepted with errors, rejected, CSV). *Send now* triggers a run. *Export XML* downloads every record as one AEAT request body. *Check chain* recomputes every hash.

## Setting up a branch

1. Branch settings: country **Spain**, tax regime **Spain – IVA**, a 9-character **NIF/CIF**; restaurant currency **EUR** and a legal name. Menu items must use real IVA rates (0, 2, 4, 5, 7.5, 10 or 21). Anything else is refused rather than guessed.
2. The server operator sets `VERIFACTU_PRODUCER_ID` (the software producer's identifier, at most 20 characters), and optionally `VERIFACTU_PRODUCER_NAME`, `VERIFACTU_PRODUCER_COUNTRY` (default `IN`), `VERIFACTU_PRODUCER_ID_TYPE` (default `04`), `VERIFACTU_SYSTEM_ID` (2 characters, default `OR`) and `VERIFACTU_KEY` (encryption key for certificates; defaults to the app secret, so keep that stable).
3. Settings → VERI\*FACTU: choose **Test**, pick an invoice series, switch it on, upload the certificate.
4. Run sales in **Test** and confirm AEAT accepts them in its pre-production portal before switching to **Production** (a new chain).

## How the amounts are worked out

Menu prices are tax-inclusive. The invoice total is what the guest paid for the food, after discounts and including delivery, **excluding the tip** (a voluntary gratuity is outside the taxable operation). The total is shared across IVA rates in proportion to each rate's gross, rounded to the cent so the pieces always add up, then IVA is backed out of each share.

## What has and has not been verified

Verified in this repository:
- The three worked hash examples in AEAT's hash specification v0.1.2 and the QR URL encoding example in the QR specification v0.5.0 (unit tests).
- The XML of `F2` and `R5` records validates against AEAT's published schemas (`SuministroLR.xsd`, tikeV1.0) using a Java schema validator.
- Append-only triggers, chain continuity, gap-free numbering under concurrency, rollback of a sale when a record cannot be produced, the AEAT answer parser, encryption of the certificate and the submission cycle (against a fake sender) run against PostgreSQL.
- The mutual-TLS client presents the `.p12` certificate to a local HTTPS server that requires one.
- A full sale, receipt, refund and chain check through the HTTP API.

**Not verified:**
- Any exchange with AEAT's real servers (pre-production or production). The field-level rules AEAT applies beyond the XSD (for example its error catalogue) are only learned that way.
- Printing on a physical thermal printer: the QR is sent as native ESC/POS `GS ( k` commands and its bytes are tested, but the printed size and scannability have not been checked on hardware.
- Complete invoices (`F1`) for customers who ask for one with their NIF, cancellation records (`ANULACION`) and corrective records for a *rejected* submission (*subsanación*) are not implemented. Simplified invoices are allowed in hospitality up to EUR 3,000; larger sales need an `F1`.
- The *Declaración Responsable*. It is a legal statement by the producer and cannot be generated by the software.

See also the Rechvix implementation of the same specification, which this module follows.

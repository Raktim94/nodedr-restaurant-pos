# Secure NFC table tags: security architecture

Status: implemented and tested against NXP's published example and a simulated chip. **Not yet tested with real NTAG 424
DNA tags or real phones** (see "What has not been verified").

## What it is for
A guest taps the card on a table with their own phone, sees the menu and orders. No OTP, no staff opening the table, no
restaurant Wi-Fi (the phone uses its own mobile data). The card must not be usable from a copied or replayed link.

## Mechanism (NXP NTAG 424 DNA, Secure Unique NFC, AN12196)
Each tap makes the tag write a fresh URL: `https://<host>/t/<publicRef>?e=<32 hex>&c=<16 hex>`.
- `e` is the tag's UID and its read counter, encrypted with AES-128-CBC (zero IV) under the tag's **SDMMetaRead key**.
- `c` is an 8-byte MAC: AES-CMAC under a per-tap session key derived from the **SDMFileRead key**, the UID and the counter,
  truncated to the even-numbered bytes.
- The read counter increases on every tap.

The server uses only these documented constructions, built from AES-128 (AES-CMAC is RFC 4493, implemented in
`apps/backend/src/modules/nfc/nfc-sdm.ts` because Node has none). They are tested against the four RFC 4493 vectors and
NXP's published example (zero keys, `e=EF963FF7…`, `c=94EED9EE65337086` → UID 04DE5F1EACC040, counter 61).

## Verification order (`NfcService.tap`)
1. Find the tag by its public reference (not secret; it tells the server which tag's keys to use).
2. Refuse unless secure NFC is switched on for the restaurant, the tag is `ACTIVE` and is a secure tag.
3. Decrypt `e`, then check `c` in constant time. **Nothing changes until the MAC is good**, so a forged request cannot burn a
   real tag's counter.
4. The UID inside the data must equal the UID bound to the tag (set by the first staff test tap): a different chip with the
   same keys is refused.
5. The counter must be **strictly higher** than any accepted: one atomic `UPDATE ... WHERE lastCounter < counter`. Two requests
   carrying the same tap cannot both win; an old URL carries an old counter.
6. Issue a **table-access** token: 32 random bytes, stored only as a SHA-256 hash, valid 30 minutes, for that one table.

Every failure returns the same generic message (replay is told "tap again"); nothing falls back to ordinary access. Every
tap, good or bad, is logged (`nfc_taps`).

## Keys
- Per tag: SDMMetaRead and SDMFileRead keys, random, sealed with the server secret box (AES-256-GCM, bound to the tag and key
  version). Never returned after provisioning, never in a URL, never in front-end code.
- The application master key is generated for the provisioning tool and **not stored** (the server never needs it).
- Rotation bumps the key version and resets the counter; old keys stop working immediately. A disabled tag can only come back
  by rotating keys and passing a new test tap.

## What the proof is, and is not
A verified tap proves *a freshly authenticated tag was read by this phone*. It makes copying a photographed link, replaying an
old URL, forging a link and cloning a card far harder. **It does not prove the phone is physically at the table at that
moment**: someone can relay a live, freshly generated URL to a remote phone. Use the table-code flow (below) if that matters.
Ordinary NFC cards (`BASIC`) hold the static table QR link and have exactly the trust of the printed QR.

## Concurrency
Taps are strictly ordered by counter: if two phones tap in quick succession and the later tap's request arrives first, the
earlier one is refused as a replay and that guest taps again. Several guests at one table each tap and share one session.

## Abuse limits
Public tap endpoint: 30 requests/minute per source plus the global limit. Forged taps are cheap to refuse (one AES block and a
CMAC) and change no state.

## What has not been verified
- Real NTAG 424 DNA chips and the tools that configure SDM (offsets, mirroring) were not available; the provisioning guide
  follows NXP's documented layout but has not been run against hardware.
- Android and iPhone behaviour with real tags (URL launch, background reading, browser choice) is documented from platform
  documentation, not measured. The design uses ordinary NDEF URL handling and not Web NFC.

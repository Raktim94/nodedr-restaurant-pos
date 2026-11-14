# Provisioning secure NFC tags (NTAG 424 DNA)

You need: NTAG 424 DNA tags, a phone or reader with an NTAG 424 DNA tool (for example NXP's TagWriter / TapLinx based apps),
and a manager account (permission `nfc.manage`). **Writing and testing with real hardware has not been done by the authors;
follow NXP's tool documentation for the exact screens.**

## One-time setup
1. Tables > **Ordering mode & NFC tags**. Switch on **Secure NFC tags**. (Optionally switch on **Open and close tables
   automatically**.) The restaurant also requires a table code or tap for ordering: this is kept on.
2. Each table needs an ordering link (QR token). Creating a tag makes one if the table has none.

## For each tag
1. Choose the table, add an optional label (for example "Window side"), type **Secure (NTAG 424)**, press **Add tag**.
2. The dialog shows, **once**: the link template, the SDM meta-read key, the SDM file-read key and an application master key.
   Copy them into your provisioning tool. The server keeps only sealed copies of the first two and does not keep the third.
3. In the tool configure the tag:
   - Write the NDEF URL exactly as the template: `https://<host>/t/<ref>?e=00000000000000000000000000000000&c=0000000000000000`.
   - Enable SDM with **UID mirroring** and **read-counter mirroring**, encrypted PICC data mirrored at the `e=` placeholder
     (32 hex characters) and the SDM MAC at the `c=` placeholder (16 hex characters).
   - Set the **SDMMACInputOffset equal to the SDMMAC offset** (the MAC covers only the UID and counter).
   - Set the SDM meta-read key and SDM file-read key to the values shown; set the application master key.
   - Lock the configuration as your tool recommends.
4. Tap the tag with any phone. It opens a link ending `?e=…&c=…`. Copy that address.
5. Back on the tag row press **Test tap** and paste it. A good test binds the chip's UID to the tag and makes it **Active**.
   If it fails, check the keys and the offsets, then tap again for a fresh link (a link can only be tested once).
6. Fix the tag to the table (a sticker or the card holder). Tap it with a second phone: it should open the menu.

## Lost, copied or damaged tags
- **Disable** (needs a reason): taps stop working immediately. Use for a lost, copied or photographed tag.
- **Rotate keys**: new keys, old ones die at once; rewrite the tag and test again. Use after a suspected leak.
- **Replace tag**: disables the old record for good and creates a new tag record for the same table.
- **Tap log** shows every tap with its result (`ok`, `replay`, `bad mac`, `uid mismatch`, ...).

## Ordinary NFC cards
Choose type **Ordinary card** to record a plain card. Write the table's QR link (Tables > Table cards) as an ordinary URL. These
have no cryptography: they behave exactly like the printed QR, and guests still need the table code.

## If NFC fails for a guest
They see "We could not verify this tag" and are told to scan the table QR and enter the table code the staff give them. The
tap never silently becomes ordinary access.

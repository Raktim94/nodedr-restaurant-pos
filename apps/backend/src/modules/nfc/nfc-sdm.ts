import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * NXP NTAG 424 DNA "Secure Unique NFC" (SUN / SDM) message verification, per NXP AN12196. Only the documented
 * constructions are used, built from AES-128 (no home-made cryptography):
 *  - the tag mirrors PICCData = tag byte || UID || read counter, encrypted with AES-128-CBC, zero IV, under the
 *    SDMMetaRead key;
 *  - the MAC key for that tap is AES-CMAC(SDMFileRead key, SV2) with SV2 = 3CC3 0001 0080 || UID || counter (LE);
 *  - the transmitted MAC is AES-CMAC(session key, MAC input) truncated to the 8 even-numbered bytes.
 * AES-CMAC is RFC 4493 (Node has no AES-CMAC), checked against the RFC and NXP's published example in nfc-sdm.spec.ts.
 */

export class NfcError extends Error {
  constructor(
    readonly code: 'BAD_FORMAT' | 'BAD_MAC' | 'UID_MISMATCH',
    message: string,
  ) {
    super(message);
  }
}

const ZERO_IV = Buffer.alloc(16);
const BLOCK = 16;

function aesEcbBlock(key: Buffer, block: Buffer): Buffer {
  const c = createCipheriv('aes-128-ecb', key, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(block), c.final()]);
}

const xor = (a: Buffer, b: Buffer): Buffer =>
  Buffer.from(Uint8Array.from(a, (x, i) => x ^ b[i]));

function doubleBlock(b: Buffer): Buffer {
  const out = Buffer.alloc(BLOCK);
  let carry = 0;
  for (let i = BLOCK - 1; i >= 0; i--) {
    out[i] = ((b[i] << 1) | carry) & 0xff;
    carry = b[i] >> 7;
  }
  if (b[0] & 0x80) out[BLOCK - 1] ^= 0x87;
  return out;
}

/** AES-128-CMAC (RFC 4493). */
export function aesCmac(key: Buffer, message: Buffer): Buffer {
  if (key.length !== 16) throw new Error('AES-128 key must be 16 bytes');
  const k1 = doubleBlock(aesEcbBlock(key, Buffer.alloc(BLOCK)));
  const k2 = doubleBlock(k1);
  const blocks = Math.max(1, Math.ceil(message.length / BLOCK));
  const complete = message.length > 0 && message.length % BLOCK === 0;
  const tail = message.subarray((blocks - 1) * BLOCK);
  let last: Buffer;
  if (complete) last = xor(tail, k1);
  else {
    const padded = Buffer.alloc(BLOCK);
    tail.copy(padded);
    padded[tail.length] = 0x80;
    last = xor(padded, k2);
  }
  let x: Buffer = Buffer.alloc(BLOCK);
  for (let i = 0; i < blocks - 1; i++)
    x = aesEcbBlock(key, xor(x, message.subarray(i * BLOCK, (i + 1) * BLOCK)));
  return aesEcbBlock(key, xor(x, last));
}

const hexToKey = (hex: string): Buffer => {
  if (!/^[0-9a-fA-F]{32}$/.test(hex))
    throw new Error('key must be 32 hex characters');
  return Buffer.from(hex, 'hex');
};

export interface PiccData {
  uid: Buffer;
  counter: number;
}

/** Decrypts the mirrored PICCData. Throws BAD_FORMAT unless it has the shape a real tag produces. */
export function decryptPiccData(metaKeyHex: string, encHex: string): PiccData {
  if (!/^[0-9a-fA-F]{32}$/.test(encHex))
    throw new NfcError('BAD_FORMAT', 'e must be 32 hex characters');
  const d = createDecipheriv('aes-128-cbc', hexToKey(metaKeyHex), ZERO_IV);
  d.setAutoPadding(false);
  const plain = Buffer.concat([
    d.update(Buffer.from(encHex, 'hex')),
    d.final(),
  ]);
  const tag = plain[0];
  const uidMirrored = (tag & 0x80) !== 0;
  const ctrMirrored = (tag & 0x40) !== 0;
  const uidLen = tag & 0x0f;
  if (!uidMirrored || !ctrMirrored || uidLen !== 7)
    throw new NfcError('BAD_FORMAT', 'unexpected PICCData layout');
  return { uid: plain.subarray(1, 8), counter: plain.readUIntLE(8, 3) };
}

/** The 8-byte SDM MAC for one tap. `macInput` is the mirrored text the tag MACs (empty when it MACs nothing but the counter and UID). */
export function sdmMac(
  fileKeyHex: string,
  uid: Buffer,
  counter: number,
  macInput = '',
): Buffer {
  const ctr = Buffer.alloc(3);
  ctr.writeUIntLE(counter, 0, 3);
  const sv2 = Buffer.concat([Buffer.from('3CC300010080', 'hex'), uid, ctr]);
  const session = aesCmac(hexToKey(fileKeyHex), sv2);
  const full = aesCmac(session, Buffer.from(macInput, 'utf8'));
  return Buffer.from([1, 3, 5, 7, 9, 11, 13, 15].map((i) => full[i]));
}

export interface VerifiedTap extends PiccData {
  uidHex: string;
}

/**
 * Full verification of one tap: decrypt, then check the MAC in constant time. The caller still has to compare the UID
 * with the registered tag and apply the replay counter; nothing here changes state.
 */
export function verifyTap(
  keys: { metaKeyHex: string; fileKeyHex: string },
  encHex: string,
  macHex: string,
  macInput = '',
): VerifiedTap {
  if (!/^[0-9a-fA-F]{16}$/.test(macHex))
    throw new NfcError('BAD_FORMAT', 'c must be 16 hex characters');
  const picc = decryptPiccData(keys.metaKeyHex, encHex);
  const expected = sdmMac(keys.fileKeyHex, picc.uid, picc.counter, macInput);
  const given = Buffer.from(macHex, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new NfcError('BAD_MAC', 'MAC does not match');
  return { ...picc, uidHex: picc.uid.toString('hex').toUpperCase() };
}

/** What a genuine tag would send. Used by tests and the provisioning self-test; never by the verification path. */
export function simulateTap(
  keys: { metaKeyHex: string; fileKeyHex: string },
  uidHex: string,
  counter: number,
): { e: string; c: string } {
  const uid = Buffer.from(uidHex, 'hex');
  if (uid.length !== 7) throw new Error('UID must be 7 bytes');
  const ctr = Buffer.alloc(3);
  ctr.writeUIntLE(counter, 0, 3);
  const plain = Buffer.concat([Buffer.from([0xc7]), uid, ctr, randomBytes(5)]);
  const c = createCipheriv('aes-128-cbc', hexToKey(keys.metaKeyHex), ZERO_IV);
  c.setAutoPadding(false);
  const e = Buffer.concat([c.update(plain), c.final()])
    .toString('hex')
    .toUpperCase();
  return {
    e,
    c: sdmMac(keys.fileKeyHex, uid, counter).toString('hex').toUpperCase(),
  };
}

export const newAesKeyHex = (): string => randomBytes(16).toString('hex');

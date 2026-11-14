import {
  aesCmac,
  decryptPiccData,
  NfcError,
  sdmMac,
  simulateTap,
  verifyTap,
} from './nfc-sdm';

const hex = (s: string) => Buffer.from(s, 'hex');

describe('AES-CMAC (RFC 4493 test vectors)', () => {
  const key = hex('2b7e151628aed2a6abf7158809cf4f3c');
  it.each([
    ['', 'bb1d6929e95937287fa37d129b756746'],
    ['6bc1bee22e409f96e93d7e117393172a', '070a16b46b4d4144f79bdd9dd04a287c'],
    [
      '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411',
      'dfa66747de9ae63030ca32611497c827',
    ],
    [
      '6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e5130c81c46a35ce411e5fbc1191a0a52eff69f2445df4f9b17ad2b417be66c3710',
      '51f0bebf7e3b9d92fc49741779363cfe',
    ],
  ])('message %s', (msg, mac) =>
    expect(aesCmac(key, hex(msg)).toString('hex')).toBe(mac),
  );
});

describe('NXP AN12196 example (all-zero keys)', () => {
  const zero = '00000000000000000000000000000000';
  const e = 'EF963FF7828658A599F3041510671E88';
  const c = '94EED9EE65337086';
  it('decrypts the mirrored UID and read counter', () => {
    const p = decryptPiccData(zero, e);
    expect(p.uid.toString('hex').toUpperCase()).toBe('04DE5F1EACC040');
    expect(p.counter).toBe(61);
  });
  it('computes the published SDM MAC', () => {
    expect(
      sdmMac(zero, hex('04DE5F1EACC040'), 61).toString('hex').toUpperCase(),
    ).toBe(c);
  });
  it('verifies the published tap, and rejects a one-bit change anywhere', () => {
    const keys = { metaKeyHex: zero, fileKeyHex: zero };
    expect(verifyTap(keys, e, c).counter).toBe(61);
    expect(() => verifyTap(keys, e, '94EED9EE65337087')).toThrow(NfcError);
    expect(() =>
      verifyTap(keys, 'EF963FF7828658A599F3041510671E89', c),
    ).toThrow(NfcError);
  });
});

describe('verification with real keys', () => {
  const keys = {
    metaKeyHex: '00112233445566778899aabbccddeeff',
    fileKeyHex: 'ffeeddccbbaa99887766554433221100',
  };
  const uid = '04A1B2C3D4E5F6';

  it('accepts what a genuine tag would send, with the counter it carries', () => {
    const { e, c } = simulateTap(keys, uid, 7);
    const v = verifyTap(keys, e, c);
    expect(v.uidHex).toBe(uid);
    expect(v.counter).toBe(7);
  });
  it('rejects a forged MAC, a MAC from other keys, and a swapped encrypted block', () => {
    const { e, c } = simulateTap(keys, uid, 8);
    expect(() => verifyTap(keys, e, '0000000000000000')).toThrow(/MAC/);
    const other = simulateTap(
      { ...keys, fileKeyHex: '11111111111111111111111111111111' },
      uid,
      8,
    );
    expect(() => verifyTap(keys, e, other.c)).toThrow(/MAC/);
    const second = simulateTap(keys, uid, 9);
    expect(() => verifyTap(keys, e, second.c)).toThrow(/MAC/); // MAC of tap 9 on the data of tap 8
    expect(verifyTap(keys, e, c).counter).toBe(8);
  });
  it('a different chip cannot answer as this one: the UID is inside both the data and the MAC', () => {
    const a = simulateTap(keys, uid, 3);
    const b = simulateTap(keys, '04FFFFFFFFFFFF', 3);
    expect(verifyTap(keys, a.e, a.c).uidHex).toBe(uid);
    expect(() => verifyTap(keys, a.e, b.c)).toThrow(/MAC/);
  });
  it('rejects malformed input without throwing anything but NfcError', () => {
    for (const [e, c] of [
      ['', ''],
      ['zz', 'zz'],
      ['00'.repeat(15), '00'.repeat(8)],
      ['00'.repeat(16), 'xyz'],
    ]) {
      expect(() => verifyTap(keys, e, c)).toThrow(NfcError);
    }
  });
  it('random data that decrypts to the wrong layout is BAD_FORMAT, not accepted', () => {
    expect(() => decryptPiccData(keys.metaKeyHex, '00'.repeat(16))).toThrow(
      /layout/,
    );
  });
});

import { decryptSecret, encryptSecret } from './secret-box';

describe('secret-box', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-with-enough-length';
    delete process.env.INTEGRATION_SECRET_KEY;
  });
  afterEach(() => {
    process.env = { ...OLD };
  });

  it('round-trips and never stores the plaintext', () => {
    const stored = encryptSecret('{"apiKey":"sk_live_abc123"}', 'r1:zomato');
    expect(stored).not.toContain('sk_live_abc123');
    expect(stored.startsWith('v1.')).toBe(true);
    expect(decryptSecret(stored, 'r1:zomato')).toBe(
      '{"apiKey":"sk_live_abc123"}',
    );
  });

  it('uses a fresh IV, so the same secret encrypts differently each time', () => {
    expect(encryptSecret('same', 'c')).not.toBe(encryptSecret('same', 'c'));
  });

  it('refuses a ciphertext moved to another restaurant or provider', () => {
    const stored = encryptSecret('secret', 'restaurantA:zomato');
    expect(() => decryptSecret(stored, 'restaurantB:zomato')).toThrow();
    expect(() => decryptSecret(stored, 'restaurantA:swiggy')).toThrow();
  });

  it('detects tampering', () => {
    const [v, iv, tag, ct] = encryptSecret('secret', 'c').split('.');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 0xff;
    expect(() =>
      decryptSecret([v, iv, tag, flipped.toString('base64')].join('.'), 'c'),
    ).toThrow();
    expect(() => decryptSecret('garbage', 'c')).toThrow(/format/);
  });

  it('cannot be read after the key changes', () => {
    const stored = encryptSecret('secret', 'c');
    process.env.INTEGRATION_SECRET_KEY = 'a-different-dedicated-key-123456';
    expect(() => decryptSecret(stored, 'c')).toThrow();
  });

  it('refuses to run with no usable key rather than using a weak one', () => {
    delete process.env.JWT_SECRET;
    expect(() => encryptSecret('x', 'c')).toThrow(/INTEGRATION_SECRET_KEY/);
    process.env.JWT_SECRET = 'short';
    expect(() => encryptSecret('x', 'c')).toThrow(/INTEGRATION_SECRET_KEY/);
  });
});

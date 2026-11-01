// Encryption at rest for third-party credentials (AES-256-GCM).
//
// Key: INTEGRATION_SECRET_KEY if set (recommended - it can then outlive a
// JWT_SECRET rotation), otherwise derived from JWT_SECRET. Either way the key
// goes through HKDF so the raw secret is never used as the cipher key.
//
// Each value is bound to a context string (restaurant + provider) as GCM
// additional authenticated data, so a ciphertext copied into another tenant's
// row, or another provider's, fails to decrypt instead of leaking.
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'crypto';

const VERSION = 'v1';

function key(): Buffer {
  const material =
    process.env.INTEGRATION_SECRET_KEY || process.env.JWT_SECRET || '';
  if (material.length < 16) {
    throw new Error(
      'Set INTEGRATION_SECRET_KEY (or a JWT_SECRET of 16+ characters) before storing integration credentials',
    );
  }
  return Buffer.from(
    hkdfSync(
      'sha256',
      material,
      'orderrestro-integration-secrets',
      process.env.INTEGRATION_SECRET_KEY ? 'dedicated-key' : 'jwt-derived-key',
      32,
    ),
  );
}

export function encryptSecret(plain: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ct.toString('base64'),
  ].join('.');
}

/** Throws if the value was tampered with, belongs to another context, or the key changed. */
export function decryptSecret(stored: string, context: string): string {
  const [v, iv, tag, ct] = stored.split('.');
  if (v !== VERSION || !iv || !tag || !ct) {
    throw new Error('Unrecognised credential format');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ct, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

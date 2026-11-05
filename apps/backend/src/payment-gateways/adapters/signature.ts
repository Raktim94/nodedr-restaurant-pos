import { createHmac, timingSafeEqual } from 'crypto';

export function hmacHex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest('hex');
}

export function hmacBase64(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data, 'utf8').digest('base64');
}

/** Constant-time string comparison that tolerates different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

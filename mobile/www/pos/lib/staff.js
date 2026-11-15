// Staff on a shared phone: each person switches in with their own PIN, so every sale says who took it and only a
// manager can approve discounts, refunds, cash and menu changes. PINs never leave the phone and are kept only as a
// salted PBKDF2 hash. Pure functions + Web Crypto, unit tested.

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array((s.match(/../g) || []).map((h) => parseInt(h, 16)));
const ITERATIONS = 150000;

export const validPin = (pin) => /^\d{4,8}$/.test(String(pin || ''));

/** Weak PINs everyone guesses first. */
export function weakPin(pin) {
  const p = String(pin);
  return /^(\d)\1+$/.test(p) || '0123456789'.includes(p) || '9876543210'.includes(p);
}

export async function hashPin(pin, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(salt), iterations: ITERATIONS }, key, 256);
  return { salt, hash: hex(bits) };
}

export async function checkPin(person, pin) {
  if (!person || !person.pin || !validPin(pin)) return false;
  const { hash } = await hashPin(pin, person.pin.salt);
  // Constant-time compare of two equal-length hex strings.
  let d = hash.length ^ person.pin.hash.length;
  for (let i = 0; i < hash.length; i++) d |= hash.charCodeAt(i) ^ person.pin.hash.charCodeAt(i % person.pin.hash.length);
  return d === 0;
}

/** A PIN nobody else on this phone already uses (two people with one PIN cannot be told apart). */
export async function pinTaken(staff, pin, exceptId) {
  for (const s of staff) if (s.id !== exceptId && (await checkPin(s, pin))) return s;
  return null;
}

/** Who this PIN belongs to, or null. */
export async function whoHasPin(staff, pin) {
  for (const s of staff) if (s.active !== false && (await checkPin(s, pin))) return s;
  return null;
}

// --------------------------------------------------------------- lockout ---
// After 5 wrong PINs in a row the pad waits 30 s, doubling each further miss (max 15 min).

export function lockState(tries, now = Date.now()) {
  const t = tries || { count: 0, until: 0 };
  return { locked: t.until > now, waitSeconds: Math.max(0, Math.ceil((t.until - now) / 1000)), count: t.count };
}

export function afterWrong(tries, now = Date.now()) {
  const count = ((tries && tries.count) || 0) + 1;
  const until = count >= 5 ? now + Math.min(30000 * 2 ** (count - 5), 15 * 60000) : 0;
  return { count, until };
}

export const afterRight = () => ({ count: 0, until: 0 });

/** Is a manager needed for this, given who is on the phone? No staff set up = the owner's phone, no PINs asked. */
export const needsManager = (staff, current) => staff.some((s) => s.active !== false) && !(current && current.manager);

// A USB/Bluetooth "keyboard wedge" scanner types the code as a fast burst of keystrokes and ends with Enter (some
// models end with Tab). It only works in a text box if that box has focus, so the sell screen also listens page-wide:
// a fast burst that ends in Enter/Tab is a scan, wherever focus happens to be. Slow human typing never qualifies.

export const SCAN_MAX_GAP_MS = 80;
export const SCAN_MIN_LENGTH = 3;

/** Feed one key event. Returns the new buffer and, when a burst just finished, the scanned code. */
export function pushKey(buf, key, now) {
  if (key === 'Enter' || key === 'Tab') {
    const code = buf.text.length >= SCAN_MIN_LENGTH ? buf.text : undefined;
    return { buf: { text: '', last: 0 }, code };
  }
  if (key.length !== 1) return { buf };
  const fresh = !buf.last || now - buf.last > SCAN_MAX_GAP_MS;
  return { buf: { text: (fresh ? '' : buf.text) + key, last: now } };
}

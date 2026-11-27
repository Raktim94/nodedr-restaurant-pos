// Books and receipts use the restaurant calendar. Older snapshots without a zone use the device.
const clocks = new Map();
function clock(timeZone) {
  if (!clocks.has(timeZone)) {
    const options = { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
    try { clocks.set(timeZone, new Intl.DateTimeFormat('en-GB', options)); }
    catch (error) {
      if (!(error instanceof RangeError)) throw error;
      clocks.set(timeZone, new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }));
    }
  }
  return clocks.get(timeZone);
}

export const storedZone = (timeZone) => clock(timeZone).resolvedOptions().timeZone;

export function localMinute(instant, timeZone) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(clock(timeZone).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export const dayOf = (instant, timeZone) => localMinute(instant, timeZone).slice(0, 10);
export const today = (now = new Date(), timeZone) => dayOf(now, timeZone);

export function daysAgo(days, now = new Date(), timeZone) {
  const midnight = Date.parse(today(now, timeZone) + 'T00:00:00Z');
  return new Date(midnight - days * 86400000).toISOString().slice(0, 10);
}

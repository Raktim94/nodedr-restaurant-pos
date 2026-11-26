// Timezone-aware day boundaries. A "day" in a report means the restaurant's
// local calendar day, not UTC — for an IST restaurant UTC midnight lands at
// 05:30 local, which would split an evening's sales across two report days.

import { BadRequestException } from '@nestjs/common';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Query dates arrive as raw strings. Without this check an omitted or malformed
 * `from`/`to` becomes NaN, and Intl.formatToParts throws RangeError: Invalid
 * time value — a 500 with a stack trace instead of a client error. Reports
 * validate their own input, but accounting and HR call zonedRange directly.
 */
function assertDay(value: string, field: string): void {
  if (typeof value !== 'string' || !DAY.test(value)) {
    throw new BadRequestException(
      `${field} must be a date in YYYY-MM-DD format`,
    );
  }
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new BadRequestException(`${field} must be a real calendar date`);
  }
}

/** Offset (ms) of `tz` from UTC at the given instant: local wall time - UTC. */
function offsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The instant a local calendar date (YYYY-MM-DD) begins in `tz`. */
export function zonedDayStart(date: string, tz: string): Date {
  assertDay(date, 'date');
  const wall = Date.parse(`${date}T00:00:00Z`);
  // Two passes settle the offset correctly across DST transitions.
  const first = wall - offsetMs(wall, tz);
  return new Date(wall - offsetMs(first, tz));
}

export function addDaysToDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Half-open [from, to) range covering local dates from..to inclusive. */
export function zonedRange(from: string, to: string, tz: string) {
  assertDay(from, 'from');
  assertDay(to, 'to');
  if (to < from) {
    throw new BadRequestException('"to" cannot be before "from"');
  }
  return {
    gte: zonedDayStart(from, tz),
    lt: zonedDayStart(addDaysToDate(to, 1), tz),
  };
}

/** The local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDate(instant: Date, tz: string): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return p; // en-CA formats as YYYY-MM-DD
}

/** Minutes since local midnight and ISO weekday-agnostic day index (0=Sun). */
export function localMinuteAndDay(instant: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    minute: Number(get('hour')) * 60 + Number(get('minute')),
    day: days.indexOf(get('weekday')),
  };
}

/** First instant strictly after now whose restaurant clock reads the requested HH:mm. */
export function nextLocalTime(now: Date, tz: string, time: string): Date {
  let clock: Intl.DateTimeFormat;
  try {
    clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new BadRequestException(
      'Set a valid restaurant time zone in Settings, or pause for a duration.',
    );
  }
  // Walk real minutes so a backward clock change offers both occurrences and a
  // nonexistent spring-forward time resolves to its next actual occurrence.
  const minute = 60_000;
  const first = Math.floor(now.getTime() / minute) * minute + minute;
  const limit = first + 48 * 60 * minute;
  for (let instant = first; instant <= limit; instant += minute) {
    if (clock.format(instant) === time) return new Date(instant);
  }
  throw new BadRequestException('Invalid local time');
}

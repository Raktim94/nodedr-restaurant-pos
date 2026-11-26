import { BadRequestException } from '@nestjs/common';
import {
  addDaysToDate,
  localDate,
  localMinuteAndDay,
  nextLocalTime,
  zonedDayStart,
  zonedRange,
} from './time';

describe('timezone day boundaries', () => {
  it('starts an IST day at 18:30 UTC the evening before', () => {
    expect(zonedDayStart('2026-10-04', 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-03T18:30:00.000Z',
    );
  });

  it('puts a late-evening IST sale on its own local day', () => {
    const sale = new Date('2026-10-04T17:00:00Z'); // 22:30 IST on the 4th
    const r = zonedRange('2026-10-04', '2026-10-04', 'Asia/Kolkata');
    expect(sale >= r.gte && sale < r.lt).toBe(true);
    const lateNight = new Date('2026-10-04T19:00:00Z'); // 00:30 IST on the 5th
    expect(lateNight >= r.gte && lateNight < r.lt).toBe(false);
  });

  it('handles daylight saving (New York spring-forward day is 23h)', () => {
    const r = zonedRange('2026-03-08', '2026-03-08', 'America/New_York');
    expect((r.lt.getTime() - r.gte.getTime()) / 3_600_000).toBe(23);
  });

  it('works for UTC and adds days across month ends', () => {
    expect(zonedDayStart('2026-10-04', 'UTC').toISOString()).toBe(
      '2026-10-04T00:00:00.000Z',
    );
    expect(addDaysToDate('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('rejects missing and malformed dates with a 400 instead of a RangeError', () => {
    // Raw query params reach these helpers unvalidated on several report
    // routes; an omitted value used to become NaN and throw "Invalid time
    // value" from Intl, which surfaced as HTTP 500.
    expect(() => zonedDayStart(undefined as never, 'UTC')).toThrow(
      /YYYY-MM-DD/,
    );
    expect(() => zonedRange(undefined as never, '2026-10-04', 'UTC')).toThrow(
      /YYYY-MM-DD/,
    );
    expect(() => zonedRange('not-a-date', '2026-10-04', 'UTC')).toThrow(
      /YYYY-MM-DD/,
    );
    expect(() => zonedRange('2026-02-30', '2026-03-01', 'UTC')).toThrow(
      /real calendar date/,
    );
    expect(() => zonedRange('2026-10-05', '2026-10-04', 'UTC')).toThrow(
      /cannot be before/,
    );
  });

  it('reports the local date and minute-of-day', () => {
    const t = new Date('2026-10-04T17:00:00Z'); // Sunday 22:30 IST
    expect(localDate(t, 'Asia/Kolkata')).toBe('2026-10-04');
    expect(localMinuteAndDay(t, 'Asia/Kolkata')).toEqual({
      minute: 22 * 60 + 30,
      day: 0,
    });
  });
});

describe('the next occurrence of a restaurant wall time', () => {
  it('reports a bad configured timezone as an actionable request error', () => {
    expect(() => nextLocalTime(new Date(), 'unknown/zone', '13:10')).toThrow(
      BadRequestException,
    );
    expect(() => nextLocalTime(new Date(), 'unknown/zone', '13:10')).toThrow(
      /restaurant time zone/i,
    );
  });

  it.each([
    [
      '2026-10-04T15:00:00Z',
      'America/Sao_Paulo',
      '13:10',
      '2026-10-04T16:10:00.000Z',
    ],
    [
      '2026-10-04T19:00:00Z',
      'Asia/Kolkata',
      '00:10',
      '2026-10-05T18:40:00.000Z',
    ],
    // The clocks repeat 01:30 on this day. The second occurrence is still ahead.
    [
      '2026-11-01T05:45:00Z',
      'America/New_York',
      '01:30',
      '2026-11-01T06:30:00.000Z',
    ],
    // 02:30 does not exist on the spring-forward date.
    [
      '2026-03-08T06:00:00Z',
      'America/New_York',
      '02:30',
      '2026-03-09T06:30:00.000Z',
    ],
  ])('%s in %s until %s', (now, zone, time, expected) => {
    expect(nextLocalTime(new Date(now), zone, time).toISOString()).toBe(
      expected,
    );
  });
});

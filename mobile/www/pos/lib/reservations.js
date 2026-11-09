// Table bookings for the standalone POS. Pure functions (no page, no database).
// A booking made here gets an id starting "ph_": the server lets the phone edit
// the details of those; bookings made on the server only change status here.

export const ACTIVE = ['RESERVED', 'CONFIRMED', 'ARRIVED'];
export const STATUS_LABEL = { RESERVED: 'Booked', CONFIRMED: 'Confirmed', ARRIVED: 'Seated', COMPLETED: 'Done', CANCELLED: 'Cancelled', NO_SHOW: 'No-show' };

export function newBooking({ id, name, phone = '', guests, at, duration = 90, tableLabel = '', notes = '', now = new Date() }) {
  name = String(name || '').trim();
  phone = String(phone || '').trim();
  notes = String(notes || '').trim();
  guests = Number(guests);
  duration = Number(duration);
  const when = new Date(at);
  if (!name) throw new Error('Enter the guest name.');
  if (!Number.isInteger(guests) || guests < 1 || guests > 500) throw new Error('How many guests? Enter a whole number.');
  if (Number.isNaN(when.getTime())) throw new Error('Choose the date and time.');
  if (!Number.isFinite(duration) || duration < 15 || duration > 600) throw new Error('Stay length must be between 15 and 600 minutes.');
  if (phone && !/^[0-9+()\-\s]{5,20}$/.test(phone)) throw new Error('That phone number does not look right.');
  return {
    id: `ph_${id}`,
    mine: true,
    customerName: name.slice(0, 100),
    phone: phone || null,
    guestCount: guests,
    reservedAt: when.toISOString(),
    durationMinutes: duration,
    tableLabel: tableLabel || '',
    specialRequests: notes.slice(0, 300) || null,
    status: 'RESERVED',
    updatedAt: now.toISOString(),
    dirty: true, // not on the server yet
  };
}

/** Two bookings clash when they hold the same table at overlapping times. */
export function clashes(list, candidate) {
  if (!candidate.tableLabel) return null;
  const s = new Date(candidate.reservedAt).getTime();
  const e = s + candidate.durationMinutes * 60000;
  return (
    list.find((b) => {
      if (b.id === candidate.id || b.tableLabel !== candidate.tableLabel || !ACTIVE.includes(b.status)) return false;
      const bs = new Date(b.reservedAt).getTime();
      return s < bs + b.durationMinutes * 60000 && bs < e;
    }) || null
  );
}

export function setStatus(b, status, now = new Date()) {
  return { ...b, status, updatedAt: now.toISOString(), dirty: true };
}

/** Today's and later bookings, soonest first, then the recent past. */
export function grouped(list, now = new Date()) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const t0 = startOfToday.getTime();
  const sorted = [...list].sort((a, b) => (a.reservedAt < b.reservedAt ? -1 : 1));
  const upcoming = sorted.filter((b) => new Date(b.reservedAt).getTime() >= t0 && ACTIVE.includes(b.status));
  const past = sorted.filter((b) => !upcoming.includes(b)).reverse().slice(0, 30);
  return { upcoming, past };
}

/** Is this booking close enough that the table should show as held? */
export function heldSoon(b, now = new Date(), minutes = 60) {
  if (!ACTIVE.includes(b.status)) return false;
  const d = new Date(b.reservedAt).getTime() - now.getTime();
  return b.status === 'ARRIVED' || (d <= minutes * 60000 && d > -b.durationMinutes * 60000);
}

/**
 * Merge what the server sent into what the phone has. A booking with unsent
 * edits stays as it is until it has been sent; otherwise the server copy wins.
 * Bookings the server no longer lists are kept (history) unless unsent.
 */
export function mergeFromServer(local, fromServer, tableLabelOf) {
  const byId = new Map(local.map((b) => [b.id, b]));
  for (const s of fromServer) {
    const mine = byId.get(s.id);
    if (mine && mine.dirty) continue;
    byId.set(s.id, { ...s, tableLabel: s.tableId ? tableLabelOf(s.tableId) || '' : '', dirty: false });
  }
  return [...byId.values()];
}

/** What to send for one booking. The table is matched by name so it survives moving to a server. */
export function toPayload(b, tableIdOf) {
  const base = {
    customerName: b.customerName,
    phone: b.phone || undefined,
    guestCount: b.guestCount,
    reservedAt: b.reservedAt,
    durationMinutes: b.durationMinutes,
    tableId: b.tableLabel ? tableIdOf(b.tableLabel) || undefined : undefined,
    specialRequests: b.specialRequests || undefined,
    status: b.status,
    updatedAt: b.updatedAt,
  };
  return b.mine ? { id: b.id, ...base } : { serverId: b.id, ...base };
}

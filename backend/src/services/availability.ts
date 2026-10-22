import { many, type Q } from "../config/db.js";
import { addDays, todayEAT } from "../utils/kenya.js";

// What can still be booked. A booking holds its dates or time from the moment it is created:
// for 30 minutes while it waits for payment, and for good once it is paid.

export const HOLD_MINUTES = 30;
export const ACTIVE_BOOKING = `(status in ('CONFIRMED','COMPLETED') or (status = 'PENDING_PAYMENT' and created_at > now() - interval '${HOLD_MINUTES} minutes'))`;

/** Nights between from (inclusive) and to (exclusive) that cannot be booked. */
export async function unavailableNights(q: Q, listingId: string, from: string, to: string, ignoreBookingId?: string): Promise<string[]> {
  const out = new Set<string>();
  const blocks = await many<{ day: string }>(q, `select day from listing_blocks where listing_id = $1 and day >= $2 and day < $3`, [listingId, from, to]);
  for (const b of blocks) out.add(b.day);
  const bookings = await many<{ check_in: string; check_out: string }>(
    q,
    `select check_in, check_out from bookings where listing_id = $1 and ${ACTIVE_BOOKING} and check_in < $3 and check_out > $2 and ($4::uuid is null or id <> $4)`,
    [listingId, from, to, ignoreBookingId ?? null],
  );
  for (const b of bookings) for (let d = b.check_in; d < b.check_out; d = addDays(d, 1)) if (d >= from && d < to) out.add(d);
  return [...out].sort();
}

export type Hours = Record<string, [string, string]>;

const isoWeekday = (day: string) => {
  const w = new Date(`${day}T12:00:00Z`).getUTCDay();
  return String(w === 0 ? 7 : w);
};
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+03:00`);

/** Start times a practitioner can still take on a day, every 30 minutes within their hours. */
export async function openSlots(q: Q, l: { host_id: string; duration_min: number; hours: Hours | null }, day: string): Promise<string[]> {
  const h = l.hours?.[isoWeekday(day)];
  if (!h || day < todayEAT()) return [];
  const [open, close] = h;
  const dur = (l.duration_min || 60) * 60_000;
  const busy = await many<{ starts_at: Date; ends_at: Date }>(
    q,
    `select starts_at, ends_at from bookings where host_id = $1 and kind = 'WELLNESS' and ${ACTIVE_BOOKING} and starts_at < $3 and ends_at > $2`,
    [l.host_id, at(day, "00:00"), at(addDays(day, 1), "00:00")],
  );
  const earliest = Date.now() + 60 * 60_000; // an hour's notice
  const out: string[] = [];
  for (let t = at(day, open).getTime(); t + dur <= at(day, close).getTime(); t += 30 * 60_000) {
    if (t < earliest) continue;
    const clash = busy.some((b) => new Date(b.starts_at).getTime() < t + dur && new Date(b.ends_at).getTime() > t);
    if (!clash) out.push(new Date(t).toISOString());
  }
  return out;
}

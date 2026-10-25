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
  const l = await many<{ occupancy: string; occupied_until: Date | null; check_in_time: string | null }>(q, `select occupancy, occupied_until, check_in_time from listings where id = $1`, [listingId]);
  if (l[0]) for (const d of occupiedNights(l[0])) if (d >= from && d < to) out.add(d);
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

// ——— Occupancy: what a guest sees on a stay right now ———

const TODAY_EAT = `(now() at time zone 'Africa/Nairobi')::date`;

/** SQL column for a listing aliased l: the check-out date of a paid stay in progress today. */
export const BOOKED_UNTIL = `(select max(k.check_out) from bookings k where k.listing_id = l.id and k.status in ('CONFIRMED','COMPLETED')
   and k.check_in <= ${TODAY_EAT} and k.check_out > ${TODAY_EAT}) as booked_until`;

/** SQL condition: the stay is free right now (no host-set occupancy, no stay in progress). */
export const AVAILABLE_NOW = `not (l.occupancy = 'occupied' and l.occupied_until > now())
  and not exists (select 1 from bookings k where k.listing_id = l.id and k.status in ('CONFIRMED','COMPLETED') and k.check_in <= ${TODAY_EAT} and k.check_out > ${TODAY_EAT})`;

export type Occupancy = { status: "available" | "occupied"; until: string | null };

/** Occupied until the later of the host's own check-out time and a Konnect stay in progress. */
export function occupancyOf(l: { occupancy?: string; occupied_until?: Date | string | null; booked_until?: string | null; check_out_time?: string | null }): Occupancy {
  const now = Date.now();
  const times: number[] = [];
  if (l.occupancy === "occupied" && l.occupied_until && new Date(l.occupied_until).getTime() > now) times.push(new Date(l.occupied_until).getTime());
  if (l.booked_until) times.push(new Date(`${l.booked_until}T${l.check_out_time ?? "10:00"}:00+03:00`).getTime());
  const until = times.filter((t) => t > now).sort((a, b) => b - a)[0];
  return until ? { status: "occupied", until: new Date(until).toISOString() } : { status: "available", until: null };
}

/** Nights a host has marked as taken by someone already staying, from tonight up to their check-out. */
export function occupiedNights(l: { occupancy?: string; occupied_until?: Date | string | null; check_in_time?: string | null }): string[] {
  if (l.occupancy !== "occupied" || !l.occupied_until) return [];
  const until = new Date(l.occupied_until);
  if (until.getTime() <= Date.now()) return [];
  const eat = new Date(until.getTime() + 3 * 3_600_000).toISOString();
  const day = eat.slice(0, 10);
  // A new guest can arrive on the check-out day unless the current one leaves after check-in time.
  const last = eat.slice(11, 16) > (l.check_in_time ?? "14:00") ? day : addDays(day, -1);
  const out: string[] = [];
  for (let d = todayEAT(); d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

import { Router } from "express";
import { z } from "zod";
import { db, many, one, type Q } from "../config/db.js";
import { requireAuth, requireVerifiedPhone } from "../middleware/auth.js";
import { openSlots, unavailableNights, type Hours } from "../services/availability.js";
import { notify } from "../services/notify.js";
import { paymentDriver } from "../services/payments.js";
import { getSettings, splitPayment } from "../services/settings.js";
import { firstName } from "../services/views.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/http.js";
import { daysBetween, todayEAT } from "../utils/kenya.js";
import { shortRef } from "../utils/security.js";

export const bookingsRouter = Router();

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Req = z.object({
  listingId: z.uuid(),
  checkIn: ymd.optional(),
  checkOut: ymd.optional(),
  guests: z.coerce.number().int().min(1).max(30).default(1),
  startsAt: z.iso.datetime({ offset: true }).optional(),
  serviceMode: z.enum(["home", "studio"]).optional(),
  visitAddress: z.string().trim().max(200).optional(),
  payMode: z.enum(["full", "deposit"]).default("full"),
  notes: z.string().trim().max(500).default(""),
});
type BookingReq = z.infer<typeof Req>;

export type Quote = {
  kind: "STAY" | "WELLNESS";
  checkIn: string | null; checkOut: string | null; nights: number | null;
  startsAt: string | null; endsAt: string | null;
  unitPrice: number; subtotal: number; total: number;
  payMode: "full" | "deposit"; dueNow: number; payLater: number;
  /** Konnect's share of what's paid now; the host gets dueNow - commission. */
  commission: number; hostReceives: number;
};

/** Prices a request and checks it can be booked. Throws a 400/409 explaining what's wrong. */
async function quote(q: Q, l: Record<string, any>, r: BookingReq, commissionPct: number): Promise<Quote> {
  if (l.type === "STAY") {
    if (!r.checkIn || !r.checkOut) throw badRequest("Choose check-in and check-out dates");
    if (r.checkIn < todayEAT()) throw badRequest("Check-in can't be in the past");
    const nights = daysBetween(r.checkIn, r.checkOut);
    if (nights < 1) throw badRequest("Check-out must be after check-in");
    if (nights < l.min_nights) throw badRequest(`This stay has a ${l.min_nights}-night minimum`);
    if (nights > 60) throw badRequest("Book at most 60 nights at a time");
    if (r.guests > l.max_guests) throw badRequest(`This stay sleeps up to ${l.max_guests}`);
    const taken = await unavailableNights(q, l.id, r.checkIn, r.checkOut);
    if (taken.length) throw conflict("Some of those nights are no longer available", "dates_unavailable");
    const subtotal = l.price_kes * nights;
    const split = splitPayment(subtotal, commissionPct);
    return {
      kind: "STAY", checkIn: r.checkIn, checkOut: r.checkOut, nights, startsAt: null, endsAt: null, unitPrice: l.price_kes, subtotal, total: subtotal,
      payMode: "full", dueNow: subtotal, payLater: 0, commission: split.commission, hostReceives: split.host,
    };
  }
  if (!r.startsAt) throw badRequest("Choose a time");
  const mode = r.serviceMode ?? (l.service_modes.length === 1 ? l.service_modes[0] : undefined);
  if (!mode || !l.service_modes.includes(mode)) throw badRequest("Choose a home visit or a studio session");
  if (mode === "home" && !(r.visitAddress && r.visitAddress.length >= 6)) throw badRequest("Add the address for the home visit");
  const start = new Date(r.startsAt);
  const day = new Date(start.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
  const slots = await openSlots(q, { host_id: l.host_id, duration_min: l.duration_min, hours: l.hours as Hours }, day);
  if (!slots.includes(start.toISOString())) throw conflict("That time is no longer available", "slot_unavailable");
  const subtotal = l.price_kes;
  const deposit = r.payMode === "deposit" && l.deposit_pct > 0 && l.deposit_pct < 100 ? Math.ceil((subtotal * l.deposit_pct) / 100) : subtotal;
  const split = splitPayment(deposit, commissionPct);
  return {
    kind: "WELLNESS", checkIn: null, checkOut: null, nights: null,
    startsAt: start.toISOString(), endsAt: new Date(start.getTime() + l.duration_min * 60_000).toISOString(),
    unitPrice: subtotal, subtotal, total: subtotal,
    payMode: deposit < subtotal ? "deposit" : "full", dueNow: deposit, payLater: subtotal - deposit, commission: split.commission, hostReceives: split.host,
  };
}

async function bookable(id: string, userId: string) {
  const l = await one<Record<string, any>>(db(), `select l.*, u.status as host_status from listings l join users u on u.id = l.host_id where l.id = $1`, [id]);
  if (!l || l.status !== "APPROVED" || l.host_status !== "active") throw notFound("This listing is not taking bookings");
  if (l.host_id === userId) throw badRequest("You can't book your own listing");
  if (l.is_sample && paymentDriver() !== "simulated") throw conflict("This is a sample listing", "sample_listing");
  return l;
}

bookingsRouter.post("/quote", requireAuth, async (req, res) => {
  const r = Req.parse(req.body);
  const l = await bookable(r.listingId, req.user!.id);
  res.json({ quote: await quote(db(), l, r, (await getSettings()).commission_pct) });
});

bookingsRouter.post("/", requireAuth, requireVerifiedPhone, async (req, res) => {
  const r = Req.parse(req.body);
  const l = await bookable(r.listingId, req.user!.id);
  const pct = (await getSettings()).commission_pct; // outside the transaction: PGlite runs one at a time
  const booking = await db().tx(async (q) => {
    // One booking at a time per host, so two people can't take the same nights or hour.
    await q.query(`select 1 from users where id = $1 for update`, [l.host_id]);
    const qt = await quote(q, l, r, pct);
    return one<{ id: string; ref: string }>(
      q,
      `insert into bookings (ref, listing_id, user_id, host_id, kind, check_in, check_out, starts_at, ends_at, guests, service_mode, visit_address,
                             nights, unit_price_kes, subtotal_kes, platform_fee_kes, total_kes, pay_mode, due_now_kes, notes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) returning id, ref`,
      [
        shortRef("KB", 5), l.id, req.user!.id, l.host_id, qt.kind, qt.checkIn, qt.checkOut, qt.startsAt, qt.endsAt, r.guests,
        qt.kind === "WELLNESS" ? (r.serviceMode ?? l.service_modes[0]) : null, r.serviceMode === "home" ? r.visitAddress : null,
        qt.nights, qt.unitPrice, qt.subtotal, qt.commission, qt.total, qt.payMode, qt.dueNow, r.notes,
      ],
    );
  });
  res.status(201).json({ booking: await bookingView(booking!.id, req.user!.id) });
});

export async function bookingView(id: string, viewerId: string) {
  const b = await one<Record<string, any>>(
    db(),
    `select b.*, l.title, l.photos, l.neighbourhood, l.city, l.type, l.check_in_time, l.check_out_time, l.duration_min, l.category, l.deposit_pct,
            g.full_name as guest_name, g.phone as guest_phone, h.full_name as host_name, h.phone as host_phone, h.photo_url as host_photo,
            p.status as payment_status, p.mpesa_receipt,
            po.status as payout_status, po.amount_kes as payout_kes, po.reference as payout_reference, po.phone as payout_phone,
            exists (select 1 from reviews r where r.booking_id = b.id) as reviewed
       from bookings b join listings l on l.id = b.listing_id join users g on g.id = b.user_id join users h on h.id = b.host_id
       left join payments p on p.id = b.payment_id
       left join payouts po on po.booking_id = b.id
      where b.id = $1`,
    [id],
  );
  if (!b || (b.user_id !== viewerId && b.host_id !== viewerId)) throw notFound("Booking not found");
  const asHost = b.host_id === viewerId;
  const confirmed = ["CONFIRMED", "COMPLETED"].includes(b.status);
  const holdUntil = b.status === "PENDING_PAYMENT" ? new Date(new Date(b.created_at).getTime() + 30 * 60_000) : null;
  return {
    id: b.id, ref: b.ref, kind: b.kind, status: holdUntil && holdUntil < new Date() ? "EXPIRED" : b.status, role: asHost ? "host" : "guest",
    listing: { id: b.listing_id, title: b.title, photo: b.photos?.[0] ?? null, neighbourhood: b.neighbourhood, city: b.city, category: b.category, durationMin: b.duration_min },
    checkIn: b.check_in, checkOut: b.check_out, nights: b.nights, checkInTime: b.check_in_time, checkOutTime: b.check_out_time,
    startsAt: b.starts_at, endsAt: b.ends_at, guests: b.guests, serviceMode: b.service_mode,
    visitAddress: asHost && !confirmed ? null : b.visit_address,
    price: {
      unit: b.unit_price_kes, subtotal: b.subtotal_kes, total: b.total_kes, dueNow: b.due_now_kes, payLater: b.total_kes - b.due_now_kes, payMode: b.pay_mode,
      // The split is the host's business, not the guest's.
      ...(asHost ? { commission: b.platform_fee_kes, hostReceives: b.due_now_kes - b.platform_fee_kes } : {}),
    },
    payout: asHost && b.payout_status ? { status: b.payout_status, amount: b.payout_kes, reference: b.payout_reference, phone: b.payout_phone } : null,
    notes: b.notes,
    holdUntil,
    receipt: b.mpesa_receipt,
    reviewed: b.reviewed,
    canReview: !asHost && b.status === "COMPLETED" && !b.reviewed,
    // Contact details are shared only once the booking is paid.
    counterpart: asHost
      ? { name: firstName(b.guest_name), phone: confirmed ? b.guest_phone : null }
      : { name: firstName(b.host_name), photoUrl: b.host_photo, phone: confirmed ? b.host_phone : null },
    createdAt: b.created_at, confirmedAt: b.confirmed_at, cancelledAt: b.cancelled_at, cancelReason: b.cancel_reason,
  };
}

bookingsRouter.get("/", requireAuth, async (req, res) => {
  const rows = await many<{ id: string }>(db(), `select id from bookings where user_id = $1 order by coalesce(starts_at, check_in::timestamptz) desc limit 100`, [req.user!.id]);
  res.json({ items: await Promise.all(rows.map((r) => bookingView(r.id, req.user!.id))) });
});

bookingsRouter.get("/:id", requireAuth, async (req, res) => {
  if (!z.uuid().safeParse(req.params.id).success) throw notFound("Booking not found");
  res.json({ booking: await bookingView(String(req.params.id), req.user!.id) });
});

/**
 * Guests can drop an unpaid booking at any time, and cancel a paid one up to 48 hours before
 * it starts; the refund is then queued for the finance team. Hosts can cancel a paid booking,
 * which always refunds the guest. The host's share has usually been sent already, so the
 * finance team recovers it from the host; an unsent share is held.
 */
bookingsRouter.post("/:id/cancel", requireAuth, async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(300).default("") }).parse(req.body ?? {});
  const b = await one<Record<string, any>>(db(), `select b.*, l.title from bookings b join listings l on l.id = b.listing_id where b.id = $1`, [req.params.id]);
  if (!b || (b.user_id !== req.user!.id && b.host_id !== req.user!.id)) throw notFound("Booking not found");
  const asHost = b.host_id === req.user!.id;
  if (!["PENDING_PAYMENT", "CONFIRMED"].includes(b.status)) throw conflict("This booking can't be cancelled");
  if (b.status === "CONFIRMED" && !asHost) {
    const start = b.kind === "STAY" ? new Date(`${b.check_in}T14:00:00+03:00`) : new Date(b.starts_at);
    if (start.getTime() - Date.now() < 48 * 3_600_000) throw conflict("Paid bookings can be cancelled up to 48 hours before they start", "too_late");
  }
  await db().tx(async (q) => {
    await q.query(`update bookings set status = 'CANCELLED', cancelled_at = now(), cancel_reason = $2 where id = $1`, [b.id, `${asHost ? "Host" : "Guest"}: ${reason}`.trim()]);
    if (b.status === "CONFIRMED") {
      await q.query(`update payouts set status = 'HELD' where booking_id = $1 and status in ('QUEUED','FAILED')`, [b.id]);
      if (b.payment_id) await q.query(`update payments set meta = meta || '{"refund_needed": true}'::jsonb where id = $1`, [b.payment_id]);
    }
  });
  if (b.status === "CONFIRMED") {
    const other = asHost ? b.user_id : b.host_id;
    await notify(other, { kind: "booking", title: "Booking cancelled", body: `${b.title} · ${b.ref}${asHost ? ". Your payment will be refunded." : ""}`, link: asHost ? `/trips/${b.id}` : "/host/bookings", sms: `Konnect: booking ${b.ref} for ${b.title} was cancelled.` });
  }
  res.json({ booking: await bookingView(b.id, req.user!.id) });
});

bookingsRouter.post("/:id/review", requireAuth, async (req, res) => {
  const r = z.object({ rating: z.coerce.number().int().min(1).max(5), body: z.string().trim().max(1500).default("") }).parse(req.body);
  const b = await one<Record<string, any>>(db(), `select * from bookings where id = $1`, [req.params.id]);
  if (!b || b.user_id !== req.user!.id) throw notFound("Booking not found");
  if (b.status !== "COMPLETED") throw conflict("You can review once the booking is complete");
  await db().tx(async (q) => {
    const exists = await one(q, `select 1 from reviews where booking_id = $1`, [b.id]);
    if (exists) throw conflict("You have already reviewed this booking");
    await q.query(`insert into reviews (booking_id, listing_id, author_id, rating, body) values ($1, $2, $3, $4, $5)`, [b.id, b.listing_id, req.user!.id, r.rating, r.body]);
    await q.query(
      `update listings set rating_avg = (select avg(rating) from reviews where listing_id = $1 and not flagged), rating_count = (select count(*) from reviews where listing_id = $1 and not flagged) where id = $1`,
      [b.listing_id],
    );
  });
  await notify(b.host_id, { kind: "review", title: `New ${r.rating}-star review`, body: r.body.slice(0, 120), link: "/host/listings" });
  res.status(201).json({ ok: true });
});

/** Hosts can answer a review once. */
bookingsRouter.post("/reviews/:reviewId/reply", requireAuth, async (req, res) => {
  const { reply } = z.object({ reply: z.string().trim().min(2).max(1000) }).parse(req.body);
  const r = await one<{ id: string; host_id: string; host_reply: string | null }>(db(), `select r.id, l.host_id, r.host_reply from reviews r join listings l on l.id = r.listing_id where r.id = $1`, [req.params.reviewId]);
  if (!r || r.host_id !== req.user!.id) throw forbidden("Only the host can reply");
  if (r.host_reply) throw conflict("You have already replied");
  await db().query(`update reviews set host_reply = $2 where id = $1`, [r.id, reply]);
  res.json({ ok: true });
});

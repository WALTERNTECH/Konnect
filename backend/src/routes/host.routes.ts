import { Router } from "express";
import { z } from "zod";
import { db, many, one } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { ACTIVE_BOOKING } from "../services/availability.js";
import { listingCard } from "../services/views.js";
import { notFound } from "../utils/http.js";
import { addDays } from "../utils/kenya.js";
import { bookingView } from "./bookings.routes.js";

// The provider dashboard: listings, bookings received, calendar, earnings and payouts.

export const hostRouter = Router();
hostRouter.use(requireAuth);

hostRouter.get("/overview", async (req, res) => {
  const id = req.user!.id;
  const totals = await one<Record<string, number>>(
    db(),
    `select
       (select coalesce(sum(amount_kes), 0) from payouts where host_id = $1 and status = 'PAID')::int as paid,
       (select coalesce(sum(amount_kes), 0) from payouts where host_id = $1 and status = 'SCHEDULED')::int as scheduled,
       (select coalesce(sum(amount_kes), 0) from payouts where host_id = $1 and status = 'HELD')::int as held,
       (select count(*) from bookings where host_id = $1 and status = 'CONFIRMED')::int as upcoming,
       (select count(*) from bookings where host_id = $1 and status = 'COMPLETED')::int as completed,
       (select count(*) from listings where host_id = $1 and status = 'APPROVED')::int as live,
       (select count(*) from listings where host_id = $1 and status = 'PENDING')::int as in_review,
       (select coalesce(avg(r.rating), 0) from reviews r join listings l on l.id = r.listing_id where l.host_id = $1)::float as rating`,
    [id],
  );
  const months = await many(
    db(),
    `select to_char(date_trunc('month', b.confirmed_at at time zone 'Africa/Nairobi'), 'YYYY-MM') as month, sum(b.due_now_kes - b.platform_fee_kes)::int as earned, count(*)::int as bookings
       from bookings b where b.host_id = $1 and b.status in ('CONFIRMED','COMPLETED') and b.confirmed_at > now() - interval '12 months'
      group by 1 order by 1`,
    [id],
  );
  const next = await many<{ id: string }>(
    db(),
    `select id from bookings where host_id = $1 and status = 'CONFIRMED' order by coalesce(starts_at, check_in::timestamptz) asc limit 5`,
    [id],
  );
  res.json({ totals, months, upcoming: await Promise.all(next.map((b) => bookingView(b.id, id))) });
});

hostRouter.get("/listings", async (req, res) => {
  const rows = await many(
    db(),
    `select l.*, (select count(*) from bookings b where b.listing_id = l.id and b.status in ('CONFIRMED','COMPLETED'))::int as booking_count
       from listings l where l.host_id = $1 order by l.created_at desc`,
    [req.user!.id],
  );
  res.json({ items: rows.map((l: any) => ({ ...listingCard(l), bookings: l.booking_count, rejectionReason: l.rejection_reason, featuredUntil: l.featured_until, updatedAt: l.updated_at })) });
});

hostRouter.get("/bookings", async (req, res) => {
  const status = z.enum(["upcoming", "past", "cancelled", "all"]).default("upcoming").parse(req.query.status);
  const where = {
    upcoming: `status = 'CONFIRMED'`,
    past: `status = 'COMPLETED'`,
    cancelled: `status in ('CANCELLED','EXPIRED')`,
    all: `true`,
  }[status];
  const rows = await many<{ id: string }>(
    db(),
    `select id from bookings where host_id = $1 and ${where} and status <> 'PENDING_PAYMENT' order by coalesce(starts_at, check_in::timestamptz) ${status === "upcoming" ? "asc" : "desc"} limit 100`,
    [req.user!.id],
  );
  res.json({ items: await Promise.all(rows.map((r) => bookingView(r.id, req.user!.id))) });
});

hostRouter.get("/payouts", async (req, res) => {
  const rows = await many(
    db(),
    `select p.id, p.amount_kes, p.status, p.due_at, p.paid_at, p.reference, p.phone, b.ref as booking_ref, l.title
       from payouts p join bookings b on b.id = p.booking_id join listings l on l.id = b.listing_id where p.host_id = $1 order by p.due_at desc limit 200`,
    [req.user!.id],
  );
  res.json({ items: rows });
});

/** A month of a stay's calendar: which nights are closed by the host and which are booked. */
hostRouter.get("/calendar/:listingId", async (req, res) => {
  const l = await one<{ id: string; host_id: string; type: string }>(db(), `select id, host_id, type from listings where id = $1`, [req.params.listingId]);
  if (!l || l.host_id !== req.user!.id) throw notFound("Listing not found");
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);
  const from = `${month}-01`;
  const to = addDays(addDays(from, 31).slice(0, 7) + "-01", 0);
  const blocks = await many<{ day: string }>(db(), `select day from listing_blocks where listing_id = $1 and day >= $2 and day < $3`, [l.id, from, to]);
  const bookings = await many(
    db(),
    `select b.id, b.ref, b.check_in, b.check_out, b.starts_at, b.ends_at, b.status, split_part(u.full_name, ' ', 1) as guest
       from bookings b join users u on u.id = b.user_id
      where b.listing_id = $1 and ${ACTIVE_BOOKING.replace(/status/g, "b.status").replace(/created_at/g, "b.created_at")}
        and ((b.check_in < $3 and b.check_out > $2) or (b.starts_at >= $2::date and b.starts_at < $3::date))
      order by coalesce(b.check_in, b.starts_at::date)`,
    [l.id, from, to],
  );
  res.json({ month, blocked: blocks.map((b) => b.day), bookings });
});

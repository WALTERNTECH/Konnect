import { timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import QRCode from "qrcode";
import { z } from "zod";
import { db, many, one } from "../config/db.js";
import { env } from "../config/env.js";
import { requireAdmin, type AuthAdmin } from "../middleware/auth.js";
import { notify } from "../services/notify.js";
import { extendPremium, paymentDriver, reconcile } from "../services/payments.js";
import { getSettings, setSettings, DEFAULTS } from "../services/settings.js";

import { badRequest, conflict, forbidden, notFound, unauthorized } from "../utils/http.js";
import { ageFrom, normalizePhone } from "../utils/kenya.js";
import { storeImage } from "../utils/media.js";
import { smsConfigured, sendSms } from "../utils/sms.js";
import { decrypt, encrypt, hashPassword, newTotpSecret, signAdmin, totpUri, verifyPassword, verifyToken, verifyTotp, type AdminClaims } from "../utils/security.js";
import { upload } from "./users.routes.js";

export const adminRouter = Router();

const strict = rateLimit({ windowMs: 15 * 60_000, limit: env.nodeEnv === "test" ? 1000 : 15, standardHeaders: "draft-8", legacyHeaders: false, message: { error: { code: "rate_limited", message: "Too many attempts. Wait a few minutes." } } });

async function audit(req: Request, action: string, targetType: string | null, targetId: string | null, detail: Record<string, unknown> = {}) {
  await db().query(`insert into audit_log (admin_id, action, target_type, target_id, detail) values ($1, $2, $3, $4, $5)`, [req.admin?.id ?? null, action, targetType, targetId, JSON.stringify(detail)]);
}

// ——— Sign-in: password, then an authenticator code ———

/** The token handed out after the password step, good only for the authenticator step. */
async function preMfa(req: Request) {
  const h = req.headers.authorization;
  const claims = h?.startsWith("Bearer ") ? verifyToken<AdminClaims>(h.slice(7), "admin") : null;
  if (!claims) throw unauthorized("Start again from the sign-in page");
  const a = await one<{ id: string; email: string; token_version: number; totp_secret: string | null; totp_enabled: boolean }>(
    db(),
    `select id, email, token_version, totp_secret, totp_enabled from admin_users where id = $1`,
    [claims.sub],
  );
  if (!a || a.token_version !== claims.tv) throw unauthorized("Start again from the sign-in page");
  return a;
}

async function enrolment(adminId: string, email: string) {
  const secret = newTotpSecret();
  await db().query(`update admin_users set totp_secret = $2, totp_enabled = false where id = $1`, [adminId, encrypt(secret)]);
  const uri = totpUri(secret, email);
  return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220, color: { dark: "#16130F", light: "#FFFFFF" } }) };
}

adminRouter.get("/setup", async (_req, res) => {
  const n = await one<{ n: number }>(db(), `select count(*)::int as n from admin_users`);
  res.json({ needed: n!.n === 0, available: Boolean(env.adminSetupToken) });
});

adminRouter.post("/setup", strict, async (req, res) => {
  const b = z
    .object({ token: z.string().min(1), name: z.string().trim().min(2).max(60), email: z.string().trim().toLowerCase().pipe(z.email()), password: z.string().min(12, "Use at least 12 characters") })
    .parse(req.body);
  const want = Buffer.from(env.adminSetupToken ?? "");
  const got = Buffer.from(b.token);
  if (!env.adminSetupToken || want.length !== got.length || !timingSafeEqual(want, got)) throw forbidden("The setup token is not right");
  const a = await db().tx(async (q) => {
    const n = await one<{ n: number }>(q, `select count(*)::int as n from admin_users`);
    if (n!.n > 0) throw conflict("Setup is already complete");
    return one<{ id: string; token_version: number }>(q, `insert into admin_users (email, name, role, password_hash) values ($1, $2, 'owner', $3) returning id, token_version`, [
      b.email, b.name, await hashPassword(b.password),
    ]);
  });
  res.status(201).json({ token: signAdmin(a!.id, a!.token_version, false), enrol: await enrolment(a!.id, b.email) });
});

adminRouter.post("/login", strict, async (req, res) => {
  const b = z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1) }).parse(req.body);
  const a = await one<{ id: string; email: string; password_hash: string; token_version: number; totp_enabled: boolean }>(
    db(),
    `select id, email, password_hash, token_version, totp_enabled from admin_users where email = $1`,
    [b.email],
  );
  if (!a || !(await verifyPassword(b.password, a.password_hash))) throw unauthorized("Those details don't match an admin account");
  res.json({ token: signAdmin(a.id, a.token_version, false), enrol: a.totp_enabled ? null : await enrolment(a.id, a.email) });
});

adminRouter.post("/totp", strict, async (req, res) => {
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }).parse(req.body);
  const a = await preMfa(req);
  if (!a.totp_secret || !verifyTotp(decrypt(a.totp_secret), code)) throw badRequest("That code is not right", [{ path: "code", message: "Not right" }]);
  await db().query(`update admin_users set totp_enabled = true, last_login_at = now() where id = $1`, [a.id]);
  await db().query(`insert into audit_log (admin_id, action) values ($1, 'admin.sign_in')`, [a.id]);
  res.json({ token: signAdmin(a.id, a.token_version, true) });
});

adminRouter.get("/me", requireAdmin(), (req, res) => res.json({ admin: req.admin }));

// Everything below needs a full admin session.
const any = requireAdmin();
const moderation = requireAdmin("admin", "moderator");
const finance = requireAdmin("admin", "finance");

// ——— Overview ———

adminRouter.get("/overview", any, async (_req, res) => {
  const revenue = await one<Record<string, number>>(
    db(),
    `select
      coalesce(sum(amount_kes) filter (where purpose = 'SUBSCRIPTION'), 0)::int as subscriptions,
      coalesce(sum(amount_kes) filter (where purpose = 'AD_CAMPAIGN'), 0)::int as ads,
      coalesce(sum(amount_kes) filter (where purpose = 'PROMOTION'), 0)::int as promotions,
      coalesce(sum(amount_kes) filter (where created_at > now() - interval '1 day'), 0)::int as today,
      coalesce(sum(amount_kes) filter (where created_at > now() - interval '7 days'), 0)::int as week,
      coalesce(sum(amount_kes), 0)::int as month
     from payments where status = 'SUCCESS' and created_at > now() - interval '30 days'`,
  );
  const fees = await one<{ fees: number; gmv: number }>(
    db(),
    `select coalesce(sum(platform_fee_kes), 0)::int as fees, coalesce(sum(due_now_kes), 0)::int as gmv from bookings where status in ('CONFIRMED','COMPLETED') and confirmed_at > now() - interval '30 days'`,
  );
  const counts = await one<Record<string, number>>(
    db(),
    `select
      (select count(*) from users where status = 'active' and not is_sample)::int as users,
      (select count(*) from users where created_at > now() - interval '7 days' and not is_sample)::int as signups_week,
      (select count(distinct user_id) from subscriptions where status = 'ACTIVE' and expires_at > now())::int as members,
      (select count(*) from bookings where status in ('CONFIRMED','COMPLETED') and confirmed_at > now() - interval '30 days')::int as bookings_month,
      (select count(*) from listings where status = 'APPROVED')::int as live_listings,
      (select count(*) from ad_events where kind = 'impression' and created_at > now() - interval '7 days')::int as impressions_week,
      (select count(*) from listings where status = 'PENDING')::int as q_listings,
      (select count(*) from verifications where status = 'PENDING')::int as q_verifications,
      (select count(*) from reports where status = 'OPEN')::int as q_reports,
      (select count(*) from payouts where status = 'SCHEDULED' and due_at <= now())::int as q_payouts,
      (select count(*) from safety_events where kind = 'sos' and status = 'OPEN')::int as q_sos,
      (select count(*) from ads where status = 'PENDING_REVIEW')::int as q_ads,
      (select count(*) from payments where status = 'SUCCESS' and (meta->>'refund_needed')::boolean)::int as q_refunds`,
  );
  const series = await many(
    db(),
    `with days as (select generate_series((now() at time zone 'Africa/Nairobi')::date - 29, (now() at time zone 'Africa/Nairobi')::date, interval '1 day')::date as day)
     select to_char(d.day, 'YYYY-MM-DD') as day,
            (select count(*) from users u where (u.created_at at time zone 'Africa/Nairobi')::date = d.day and not u.is_sample)::int as signups,
            (select coalesce(sum(p.amount_kes), 0) from payments p where p.status = 'SUCCESS' and (p.created_at at time zone 'Africa/Nairobi')::date = d.day)::int as revenue,
            (select count(*) from bookings b where b.status in ('CONFIRMED','COMPLETED') and (b.confirmed_at at time zone 'Africa/Nairobi')::date = d.day)::int as bookings
       from days d order by d.day`,
  );
  const hoods = await many(
    db(),
    `select l.neighbourhood, l.city, count(*)::int as bookings from bookings b join listings l on l.id = b.listing_id
      where b.status in ('CONFIRMED','COMPLETED') and b.confirmed_at > now() - interval '90 days' group by 1, 2 order by 3 desc limit 10`,
  );
  const recent = await many(
    db(),
    `select p.id, p.purpose, p.amount_kes, p.status, p.mpesa_receipt, p.created_at, u.full_name from payments p left join users u on u.id = p.user_id order by p.created_at desc limit 8`,
  );
  res.json({ revenue: { ...revenue, bookingFees: fees!.fees, bookingVolume: fees!.gmv }, counts, series, neighbourhoods: hoods, recent, driver: paymentDriver() });
});

// ——— Users ———

adminRouter.get("/users", any, async (req, res) => {
  const f = z.object({ q: z.string().trim().max(80).optional(), status: z.enum(["active", "suspended", "deleted"]).optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
  const vals: unknown[] = [];
  const where = [`not u.is_sample`];
  if (f.q) {
    vals.push(`%${f.q}%`);
    where.push(`(u.full_name ilike $1 or u.email ilike $1 or u.phone ilike $1 or u.referral_code ilike $1)`);
  }
  if (f.status) {
    vals.push(f.status);
    where.push(`u.status = $${vals.length}`);
  }
  const rows = await many(
    db(),
    `select u.id, u.full_name, u.email, u.phone, u.gender, u.date_of_birth, u.city, u.status, u.created_at, u.last_seen_at, u.phone_verified_at, u.id_verified_at,
            u.income_verified_at, u.background_checked_at, count(*) over () as total,
            (select max(expires_at) from subscriptions s where s.user_id = u.id and s.status = 'ACTIVE' and s.expires_at > now()) as premium_until,
            exists (select 1 from listings l where l.host_id = u.id) as is_host
       from users u where ${where.join(" and ")} order by u.created_at desc limit 50 offset ${(f.page - 1) * 50}`,
    vals,
  );
  res.json({ items: rows.map((r: any) => ({ ...r, age: ageFrom(r.date_of_birth) })), total: Number(rows[0]?.total ?? 0) });
});

adminRouter.get("/users/:id", any, async (req, res) => {
  const u = await one<Record<string, any>>(
    db(),
    `select u.*, (select max(expires_at) from subscriptions s where s.user_id = u.id and s.status = 'ACTIVE' and s.expires_at > now()) as premium_until from users u where u.id = $1`,
    [req.params.id],
  );
  if (!u) throw notFound("User not found");
  delete u.password_hash;
  const [bookings, payments, reports, verifications, listings, subs] = await Promise.all([
    many(db(), `select b.id, b.ref, b.status, b.total_kes, b.created_at, l.title from bookings b join listings l on l.id = b.listing_id where b.user_id = $1 order by b.created_at desc limit 20`, [u.id]),
    many(db(), `select id, purpose, amount_kes, status, mpesa_receipt, created_at from payments where user_id = $1 order by created_at desc limit 20`, [u.id]),
    many(db(), `select r.id, r.reason, r.details, r.status, r.created_at, split_part(x.full_name, ' ', 1) as reporter from reports r join users x on x.id = r.reporter_id where r.target_user_id = $1 order by r.created_at desc`, [u.id]),
    many(db(), `select id, kind, status, created_at, reviewed_at from verifications where user_id = $1 order by created_at desc`, [u.id]),
    many(db(), `select id, title, type, status from listings where host_id = $1 order by created_at desc`, [u.id]),
    many(db(), `select id, period, status, starts_at, expires_at, amount_kes, source from subscriptions where user_id = $1 order by created_at desc limit 20`, [u.id]),
  ]);
  res.json({ user: { ...u, age: ageFrom(u.date_of_birth) }, bookings, payments, reports, verifications, listings, subscriptions: subs });
});

adminRouter.post("/users/:id/action", moderation, async (req, res) => {
  const b = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("suspend"), reason: z.string().trim().min(3).max(300) }),
      z.object({ action: z.literal("reactivate") }),
      z.object({ action: z.literal("verify_phone") }),
      z.object({ action: z.literal("grant_premium"), days: z.coerce.number().int().min(1).max(365) }),
      z.object({ action: z.literal("revoke_badge"), badge: z.enum(["id", "income", "background"]) }),
      z.object({ action: z.literal("sign_out") }),
    ])
    .parse(req.body);
  const u = await one<{ id: string; status: string }>(db(), `select id, status from users where id = $1`, [req.params.id]);
  if (!u) throw notFound("User not found");
  switch (b.action) {
    case "suspend":
      await db().query(`update users set status = 'suspended', suspended_reason = $2, token_version = token_version + 1 where id = $1`, [u.id, b.reason]);
      await db().query(`update listings set status = 'PAUSED' where host_id = $1 and status = 'APPROVED'`, [u.id]);
      break;
    case "reactivate":
      await db().query(`update users set status = 'active', suspended_reason = null where id = $1 and status = 'suspended'`, [u.id]);
      break;
    case "verify_phone":
      await db().query(`update users set phone_verified_at = coalesce(phone_verified_at, now()) where id = $1`, [u.id]);
      break;
    case "grant_premium":
      await db().tx((q) => extendPremium(q, u.id, b.days, { period: "gift", source: "admin", amount: 0, paymentId: null }));
      await notify(u.id, { kind: "membership", title: `${b.days} days of membership added`, link: "/membership" });
      break;
    case "revoke_badge":
      await db().query(`update users set ${{ id: "id_verified_at", income: "income_verified_at", background: "background_checked_at" }[b.badge]} = null where id = $1`, [u.id]);
      break;
    case "sign_out":
      await db().query(`update users set token_version = token_version + 1 where id = $1`, [u.id]);
      break;
  }
  await audit(req, `user.${b.action}`, "user", u.id, b);
  res.json({ ok: true });
});

// ——— Listings ———

adminRouter.get("/listings", any, async (req, res) => {
  const status = z.enum(["PENDING", "APPROVED", "REJECTED", "PAUSED", "DRAFT", "ALL"]).default("PENDING").parse(req.query.status);
  const rows = await many(
    db(),
    `select l.*, u.full_name as host_name, u.phone as host_phone, u.id_verified_at as host_id_verified
       from listings l join users u on u.id = l.host_id where ($1 = 'ALL' or l.status = $1) order by l.updated_at desc limit 200`,
    [status],
  );
  res.json({ items: rows });
});

adminRouter.post("/listings/:id/action", moderation, async (req, res) => {
  const b = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("approve") }),
      z.object({ action: z.literal("reject"), reason: z.string().trim().min(3).max(400) }),
      z.object({ action: z.literal("pause") }),
      z.object({ action: z.literal("feature"), days: z.coerce.number().int().min(1).max(90) }),
      z.object({ action: z.literal("unfeature") }),
    ])
    .parse(req.body);
  const l = await one<{ id: string; host_id: string; title: string; status: string }>(db(), `select id, host_id, title, status from listings where id = $1`, [req.params.id]);
  if (!l) throw notFound("Listing not found");
  if (b.action === "approve") {
    await db().query(`update listings set status = 'APPROVED', rejection_reason = null, updated_at = now() where id = $1`, [l.id]);
    await notify(l.host_id, { kind: "listing", title: "Your listing is live", body: l.title, link: `/listings/${l.id}`, sms: `Konnect: ${l.title} is approved and live.` });
  } else if (b.action === "reject") {
    await db().query(`update listings set status = 'REJECTED', rejection_reason = $2, updated_at = now() where id = $1`, [l.id, b.reason]);
    await notify(l.host_id, { kind: "listing", title: "Your listing needs changes", body: b.reason, link: `/host/listings/${l.id}` });
  } else if (b.action === "pause") {
    await db().query(`update listings set status = 'PAUSED' where id = $1`, [l.id]);
  } else if (b.action === "feature") {
    await db().query(`update listings set featured_until = greatest(coalesce(featured_until, now()), now()) + make_interval(days => $2) where id = $1`, [l.id, b.days]);
  } else {
    await db().query(`update listings set featured_until = null where id = $1`, [l.id]);
  }
  await audit(req, `listing.${b.action}`, "listing", l.id, b);
  res.json({ ok: true });
});

// ——— Bookings, payments, payouts ———

adminRouter.get("/bookings", any, async (req, res) => {
  const status = z.enum(["ALL", "PENDING_PAYMENT", "CONFIRMED", "COMPLETED", "CANCELLED", "EXPIRED"]).default("ALL").parse(req.query.status);
  const rows = await many(
    db(),
    `select b.id, b.ref, b.kind, b.status, b.check_in, b.check_out, b.starts_at, b.total_kes, b.due_now_kes, b.platform_fee_kes, b.created_at,
            l.title, g.full_name as guest, h.full_name as host
       from bookings b join listings l on l.id = b.listing_id join users g on g.id = b.user_id join users h on h.id = b.host_id
      where ($1 = 'ALL' or b.status = $1) order by b.created_at desc limit 300`,
    [status],
  );
  res.json({ items: rows });
});

adminRouter.post("/bookings/:id/cancel", moderation, async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
  const b = await one<Record<string, any>>(db(), `select * from bookings where id = $1`, [req.params.id]);
  if (!b) throw notFound("Booking not found");
  if (!["PENDING_PAYMENT", "CONFIRMED"].includes(b.status)) throw conflict("This booking can't be cancelled");
  await db().tx(async (q) => {
    await q.query(`update bookings set status = 'CANCELLED', cancelled_at = now(), cancel_reason = $2 where id = $1`, [b.id, `Konnect: ${reason}`]);
    await q.query(`update payouts set status = 'HELD' where booking_id = $1 and status = 'SCHEDULED'`, [b.id]);
    if (b.payment_id) await q.query(`update payments set meta = meta || '{"refund_needed": true}'::jsonb where id = $1 and status = 'SUCCESS'`, [b.payment_id]);
  });
  for (const id of [b.user_id, b.host_id]) await notify(id, { kind: "booking", title: "Booking cancelled by Konnect", body: `${b.ref}: ${reason}` });
  await audit(req, "booking.cancel", "booking", b.id, { reason });
  res.json({ ok: true });
});

const PaymentFilter = z.object({
  status: z.enum(["ALL", "PENDING", "SUCCESS", "FAILED"]).default("ALL"),
  purpose: z.enum(["ALL", "BOOKING", "SUBSCRIPTION", "AD_CAMPAIGN", "PROMOTION"]).default("ALL"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  refunds: z.coerce.boolean().optional(),
});
async function payments(query: unknown, limit: number) {
  const f = PaymentFilter.parse(query);
  return many<Record<string, any>>(
    db(),
    `select p.id, p.created_at, p.completed_at, p.purpose, p.amount_kes, p.status, p.phone, p.mpesa_receipt, p.mpesa_checkout_id, p.result_code, p.result_desc,
            p.driver, coalesce((p.meta->>'refund_needed')::boolean, false) as refund_needed, u.full_name, u.email
       from payments p left join users u on u.id = p.user_id
      where ($1 = 'ALL' or p.status = $1) and ($2 = 'ALL' or p.purpose = $2)
        and ($3::date is null or p.created_at >= $3::date) and ($4::date is null or p.created_at < $4::date + 1)
        and (not $5 or coalesce((p.meta->>'refund_needed')::boolean, false))
      order by p.created_at desc limit ${limit}`,
    [f.status, f.purpose, f.from ?? null, f.to ?? null, Boolean(f.refunds)],
  );
}

adminRouter.get("/payments", finance, async (req, res) => res.json({ items: await payments(req.query, 500) }));

adminRouter.get("/payments.csv", finance, async (req, res) => {
  const rows = await payments(req.query, 50_000);
  const cols = ["created_at", "completed_at", "purpose", "amount_kes", "status", "phone", "mpesa_receipt", "mpesa_checkout_id", "result_code", "result_desc", "full_name", "email", "refund_needed"];
  const cell = (v: unknown) => {
    const s = v instanceof Date ? v.toISOString() : v == null ? "" : String(v);
    // Quote, and defuse spreadsheet formulas.
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="konnect-payments-${new Date().toISOString().slice(0, 10)}.csv"` });
  res.send([cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n"));
  await audit(req, "payments.export", null, null, { rows: rows.length });
});

adminRouter.post("/payments/:id/refunded", finance, async (req, res) => {
  const { reference } = z.object({ reference: z.string().trim().min(3).max(40) }).parse(req.body);
  const r = await one(db(), `update payments set meta = meta || jsonb_build_object('refund_needed', false, 'refund_reference', $2::text, 'refunded_at', now()) where id = $1 returning id`, [req.params.id, reference]);
  if (!r) throw notFound("Payment not found");
  await audit(req, "payment.refunded", "payment", String(req.params.id), { reference });
  res.json({ ok: true });
});

adminRouter.post("/payments/reconcile", finance, async (_req, res) => {
  await reconcile();
  res.json({ ok: true });
});

adminRouter.get("/payouts", finance, async (req, res) => {
  const status = z.enum(["DUE", "SCHEDULED", "PAID", "HELD", "ALL"]).default("DUE").parse(req.query.status);
  const where = { DUE: `p.status = 'SCHEDULED' and p.due_at <= now()`, SCHEDULED: `p.status = 'SCHEDULED'`, PAID: `p.status = 'PAID'`, HELD: `p.status = 'HELD'`, ALL: "true" }[status];
  const rows = await many(
    db(),
    `select p.*, b.ref as booking_ref, b.status as booking_status, l.title, u.full_name as host_name
       from payouts p join bookings b on b.id = p.booking_id join listings l on l.id = b.listing_id join users u on u.id = p.host_id
      where ${where} order by p.due_at asc limit 300`,
  );
  res.json({ items: rows });
});

adminRouter.post("/payouts/:id/action", finance, async (req, res) => {
  const b = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("paid"), reference: z.string().trim().min(3).max(40) }),
      z.object({ action: z.literal("hold") }),
      z.object({ action: z.literal("release") }),
    ])
    .parse(req.body);
  const p = await one<{ id: string; host_id: string; amount_kes: number; status: string }>(db(), `select id, host_id, amount_kes, status from payouts where id = $1`, [req.params.id]);
  if (!p) throw notFound("Payout not found");
  if (b.action === "paid") {
    if (p.status === "PAID") throw conflict("Already paid");
    await db().query(`update payouts set status = 'PAID', paid_at = now(), reference = $2 where id = $1`, [p.id, b.reference]);
    await notify(p.host_id, { kind: "payout", title: `Payout sent: KES ${p.amount_kes.toLocaleString("en-KE")}`, body: `M-Pesa ${b.reference}`, link: "/host/payouts", sms: `Konnect: KES ${p.amount_kes.toLocaleString("en-KE")} sent to your M-Pesa. Ref ${b.reference}.` });
  } else {
    await db().query(`update payouts set status = $2 where id = $1 and status <> 'PAID'`, [p.id, b.action === "hold" ? "HELD" : "SCHEDULED"]);
  }
  await audit(req, `payout.${b.action}`, "payout", p.id, b);
  res.json({ ok: true });
});

// ——— Ads ———

adminRouter.get("/ads", any, async (_req, res) => {
  const rows = await many(db(), `select a.*, u.full_name as owner_name from ads a left join users u on u.id = a.owner_id order by (a.status = 'PENDING_REVIEW') desc, a.created_at desc limit 300`);
  res.json({ items: rows.map((a: any) => ({ ...a, spent_kes: Number(a.spent_mkes) / 1000 })) });
});

const TeamAd = z.object({
  advertiser: z.string().trim().min(2).max(60),
  headline: z.string().trim().min(4).max(60),
  text: z.string().trim().max(140).default(""),
  cta: z.string().trim().min(2).max(20).default("Learn more"),
  url: z.string().trim().min(1).max(400),
  billing: z.enum(["CPM", "CPC"]).default("CPM"),
  budgetKes: z.coerce.number().int().min(0).default(0),
  house: z.boolean().default(false),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

adminRouter.post("/ads", moderation, async (req, res) => {
  const b = TeamAd.parse(req.body);
  const row = await one(
    db(),
    `insert into ads (advertiser, headline, ad_text, cta_label, target_url, billing, budget_kes, is_house, ends_at, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE') returning *`,
    [b.advertiser, b.headline, b.text, b.cta, b.url, b.billing, b.budgetKes, b.house, b.endsAt ?? null],
  );
  await audit(req, "ad.create", "ad", String(row!.id), b);
  res.status(201).json({ ad: row });
});

adminRouter.post("/ads/:id/image", moderation, upload.single("image"), async (req, res) => {
  if (!req.file) throw badRequest("Choose an image");
  const url = await storeImage(db(), null as never, req.file, { maxEdge: 1400 });
  await db().query(`update ads set image_url = $2 where id = $1`, [req.params.id, url]);
  res.json({ imageUrl: url });
});

adminRouter.post("/ads/:id/action", moderation, async (req, res) => {
  const b = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("approve") }),
      z.object({ action: z.literal("reject"), note: z.string().trim().min(3).max(300) }),
      z.object({ action: z.literal("pause") }),
      z.object({ action: z.literal("resume") }),
      z.object({ action: z.literal("end") }),
    ])
    .parse(req.body);
  const a = await one<{ id: string; owner_id: string | null; headline: string }>(db(), `select id, owner_id, headline from ads where id = $1`, [req.params.id]);
  if (!a) throw notFound("Campaign not found");
  const next = { approve: "ACTIVE", reject: "REJECTED", pause: "PAUSED", resume: "ACTIVE", end: "ENDED" }[b.action];
  await db().query(`update ads set status = $2, review_note = $3 where id = $1`, [a.id, next, b.action === "reject" ? b.note : null]);
  if (a.owner_id && (b.action === "approve" || b.action === "reject"))
    await notify(a.owner_id, { kind: "ads", title: b.action === "approve" ? "Campaign approved and running" : "Campaign needs changes", body: b.action === "reject" ? b.note : a.headline, link: "/advertise" });
  await audit(req, `ad.${b.action}`, "ad", a.id, b);
  res.json({ ok: true });
});

// ——— Verification ———

adminRouter.get("/verifications", moderation, async (req, res) => {
  const status = z.enum(["PENDING", "APPROVED", "REJECTED"]).default("PENDING").parse(req.query.status);
  const rows = await many(
    db(),
    `select v.*, u.full_name, u.date_of_birth, u.gender, u.phone, u.photo_url from verifications v join users u on u.id = v.user_id where v.status = $1 order by v.created_at asc limit 200`,
    [status],
  );
  res.json({ items: rows.map((r: any) => ({ ...r, age: ageFrom(r.date_of_birth) })) });
});

/** Private documents, readable only here. */
adminRouter.get("/media/:id", moderation, async (req, res) => {
  if (!z.uuid().safeParse(req.params.id).success) throw notFound();
  const m = await one<{ mime: string; bytes: Buffer }>(db(), `select mime, bytes from media where id = $1`, [req.params.id]);
  if (!m) throw notFound();
  res.set({ "Content-Type": m.mime, "Cache-Control": "private, no-store" });
  res.send(Buffer.from(m.bytes));
});

adminRouter.post("/verifications/:id/action", moderation, async (req, res) => {
  const b = z.discriminatedUnion("action", [z.object({ action: z.literal("approve") }), z.object({ action: z.literal("reject"), note: z.string().trim().min(3).max(300) })]).parse(req.body);
  const v = await one<{ id: string; user_id: string; kind: string; status: string }>(db(), `select id, user_id, kind, status from verifications where id = $1`, [req.params.id]);
  if (!v) throw notFound("Not found");
  if (v.status !== "PENDING") throw conflict("Already reviewed");
  const col = { ID: "id_verified_at", INCOME: "income_verified_at", BACKGROUND: "background_checked_at" }[v.kind]!;
  await db().tx(async (q) => {
    await q.query(`update verifications set status = $2, reviewer_note = $3, reviewed_by = $4, reviewed_at = now() where id = $1`, [v.id, b.action === "approve" ? "APPROVED" : "REJECTED", b.action === "reject" ? b.note : null, req.admin!.id]);
    if (b.action === "approve") await q.query(`update users set ${col} = now() where id = $1`, [v.user_id]);
  });
  const label = { ID: "ID", INCOME: "Income", BACKGROUND: "Background check" }[v.kind];
  await notify(v.user_id, { kind: "verification", title: b.action === "approve" ? `${label} verified` : `${label} verification not approved`, body: b.action === "reject" ? b.note : "The badge now shows on your profile", link: "/account/verification" });
  await audit(req, `verification.${b.action}`, "verification", v.id, { kind: v.kind });
  res.json({ ok: true });
});

// ——— Reports and safety ———

adminRouter.get("/reports", moderation, async (req, res) => {
  const status = z.enum(["OPEN", "ACTIONED", "DISMISSED"]).default("OPEN").parse(req.query.status);
  const rows = await many(
    db(),
    `select r.*, rp.full_name as reporter_name, t.full_name as target_name, t.status as target_status, l.title as listing_title,
            (select count(distinct x.reporter_id) from reports x where x.target_user_id = r.target_user_id and x.status = 'OPEN')::int as open_reports
       from reports r join users rp on rp.id = r.reporter_id left join users t on t.id = r.target_user_id left join listings l on l.id = r.target_listing_id
      where r.status = $1 order by r.created_at asc limit 300`,
    [status],
  );
  res.json({ items: rows });
});

adminRouter.post("/reports/:id/resolve", moderation, async (req, res) => {
  const b = z.object({ action: z.enum(["dismiss", "suspend_user", "hide_profile", "pause_listing", "restore_profile"]), note: z.string().trim().max(400).default("") }).parse(req.body);
  const r = await one<{ id: string; target_user_id: string | null; target_listing_id: string | null }>(db(), `select id, target_user_id, target_listing_id from reports where id = $1`, [req.params.id]);
  if (!r) throw notFound("Report not found");
  await db().tx(async (q) => {
    if (b.action === "suspend_user" && r.target_user_id) {
      await q.query(`update users set status = 'suspended', suspended_reason = $2, token_version = token_version + 1 where id = $1`, [r.target_user_id, b.note || "Report upheld"]);
      await q.query(`update listings set status = 'PAUSED' where host_id = $1 and status = 'APPROVED'`, [r.target_user_id]);
    }
    if (b.action === "hide_profile" && r.target_user_id) await q.query(`update connect_profiles set visible = false where user_id = $1`, [r.target_user_id]);
    if (b.action === "restore_profile" && r.target_user_id) await q.query(`update connect_profiles set visible = true where user_id = $1`, [r.target_user_id]);
    if (b.action === "pause_listing" && r.target_listing_id) await q.query(`update listings set status = 'PAUSED' where id = $1`, [r.target_listing_id]);
    // One decision closes every open report about the same person or listing.
    await q.query(
      `update reports set status = $2, resolution = $3, resolved_by = $4, resolved_at = now()
        where status = 'OPEN' and (id = $1 or ($5::uuid is not null and target_user_id = $5) or ($6::uuid is not null and target_listing_id = $6))`,
      [r.id, b.action === "dismiss" || b.action === "restore_profile" ? "DISMISSED" : "ACTIONED", `${b.action}${b.note ? `: ${b.note}` : ""}`, req.admin!.id, r.target_user_id, r.target_listing_id],
    );
  });
  await audit(req, `report.${b.action}`, "report", r.id, b);
  res.json({ ok: true });
});

adminRouter.get("/safety", moderation, async (_req, res) => {
  const rows = await many(
    db(),
    `select e.*, u.full_name, u.phone, u.trusted_contact_name, u.trusted_contact_phone, w.full_name as with_name
       from safety_events e join users u on u.id = e.user_id left join users w on w.id = e.with_user_id order by (e.status = 'OPEN' and e.kind = 'sos') desc, e.created_at desc limit 200`,
  );
  res.json({ items: rows });
});

adminRouter.post("/safety/:id/handled", moderation, async (req, res) => {
  await db().query(`update safety_events set status = 'HANDLED' where id = $1`, [req.params.id]);
  await audit(req, "safety.handled", "safety_event", String(req.params.id));
  res.json({ ok: true });
});

// ——— Settings, team, audit ———

adminRouter.get("/settings", any, async (_req, res) => {
  res.json({
    settings: await getSettings(),
    defaults: DEFAULTS,
    integrations: {
      mpesa: { driver: paymentDriver(), env: env.mpesa.env, shortcode: env.mpesa.driver === "daraja" ? env.mpesa.shortcode : null, till: env.mpesa.till || null, callbackUrl: `${env.publicUrl}/api/mpesa/callback/••••` },
      sms: { configured: smsConfigured(), senderId: env.sms.senderId || null },
      cloudinary: { configured: Boolean(env.cloudinaryUrl) },
      phoneVerification: env.phoneVerification,
      sampleContent: env.sampleContent,
    },
  });
});

adminRouter.put("/settings", requireAdmin("admin"), async (req, res) => {
  const int = z.coerce.number().int().min(0).max(10_000_000);
  const b = z
    .object({
      premium_monthly_kes: int, premium_annual_kes: int, booking_fee_kes: int, ad_cpm_kes: int, ad_cpc_kes: int, ad_min_budget_kes: int,
      promotion_week_kes: int, payout_delay_hours: z.coerce.number().int().min(0).max(720), referral_days: z.coerce.number().int().min(0).max(365),
      support_phone: z.string().trim().max(20), safety_phone: z.string().trim().max(20),
    })
    .partial()
    .parse(req.body);
  for (const k of ["support_phone", "safety_phone"] as const) {
    if (b[k]) {
      const p = normalizePhone(b[k]!);
      if (!p) throw badRequest("Enter a Kenyan mobile number", [{ path: k, message: "Enter a Kenyan mobile number" }]);
      b[k] = p;
    }
  }
  await setSettings(b);
  await audit(req, "settings.update", null, null, b);
  res.json({ settings: await getSettings() });
});

adminRouter.post("/sms/test", requireAdmin("admin"), async (req, res) => {
  const { phone } = z.object({ phone: z.string() }).parse(req.body);
  const p = normalizePhone(phone);
  if (!p) throw badRequest("Enter a Kenyan mobile number");
  res.json({ sent: await sendSms(p, "Konnect: this is a test message from the admin console.") });
});

adminRouter.get("/team", any, async (_req, res) => {
  res.json({ items: await many(db(), `select id, email, name, role, totp_enabled, created_at, last_login_at from admin_users order by created_at`) });
});

adminRouter.post("/team", requireAdmin("owner" as AuthAdmin["role"]), async (req, res) => {
  if (req.admin!.role !== "owner") throw forbidden("Only the owner can add admins");
  const b = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()), name: z.string().trim().min(2).max(60), role: z.enum(["admin", "moderator", "finance"]) }).parse(req.body);
  const temp = `${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 6)}`;
  const row = await one(db(), `insert into admin_users (email, name, role, password_hash) values ($1, $2, $3, $4) on conflict (email) do nothing returning id`, [b.email, b.name, b.role, await hashPassword(temp)]);
  if (!row) throw conflict("That email already has an admin account");
  await audit(req, "team.add", "admin", String(row.id), { email: b.email, role: b.role });
  res.status(201).json({ temporaryPassword: temp });
});

adminRouter.delete("/team/:id", requireAdmin("owner" as AuthAdmin["role"]), async (req, res) => {
  if (req.admin!.role !== "owner") throw forbidden("Only the owner can remove admins");
  if (req.params.id === req.admin!.id) throw badRequest("You can't remove yourself");
  await db().query(`delete from admin_users where id = $1 and role <> 'owner'`, [req.params.id]);
  await audit(req, "team.remove", "admin", String(req.params.id));
  res.json({ ok: true });
});

adminRouter.post("/password", any, async (req, res) => {
  const b = z.object({ current: z.string().min(1), next: z.string().min(12, "Use at least 12 characters") }).parse(req.body);
  const a = await one<{ password_hash: string }>(db(), `select password_hash from admin_users where id = $1`, [req.admin!.id]);
  if (!(await verifyPassword(b.current, a!.password_hash))) throw badRequest("Your current password is not right");
  await db().query(`update admin_users set password_hash = $2, token_version = token_version + 1 where id = $1`, [req.admin!.id, await hashPassword(b.next)]);
  await audit(req, "admin.password", "admin", req.admin!.id);
  res.json({ ok: true });
});

adminRouter.get("/audit", any, async (_req, res) => {
  res.json({ items: await many(db(), `select a.*, x.name as admin_name from audit_log a left join admin_users x on x.id = a.admin_id order by a.created_at desc limit 300`) });
});

adminRouter.post("/samples/remove", requireAdmin("admin"), async (req, res) => {
  const r = await db().tx(async (q) => {
    const booked = await many<{ id: string }>(q, `select distinct l.id from listings l join bookings b on b.listing_id = l.id where l.is_sample`);
    await q.query(`update listings set status = 'PAUSED' where is_sample and id = any($1::uuid[])`, [booked.map((b) => b.id)]);
    const del = await many(q, `delete from listings where is_sample and not (id = any($1::uuid[])) returning id`, [booked.map((b) => b.id)]);
    await q.query(`delete from ads where is_house and advertiser = 'Konnect' and impressions = 0`);
    return { removed: del.length, paused: booked.length };
  });
  await db().query(`insert into settings (key, value) values ('samples_removed', 'true') on conflict (key) do update set value = 'true'`);
  await audit(req, "samples.remove", null, null, r);
  res.json(r);
});


import { Router } from "express";
import { z } from "zod";
import { db, many, one } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { emit } from "../services/events.js";
import { getSettings } from "../services/settings.js";
import { firstName } from "../services/views.js";
import { badRequest, conflict, notFound } from "../utils/http.js";
import { sendSms } from "../utils/sms.js";

export const safetyRouter = Router();
safetyRouter.use(requireAuth);

safetyRouter.get("/blocks", async (req, res) => {
  const rows = await many(db(), `select b.blocked_id as id, u.full_name, b.created_at from blocks b join users u on u.id = b.blocked_id where b.blocker_id = $1 order by b.created_at desc`, [req.user!.id]);
  res.json({ items: rows.map((r: any) => ({ id: r.id, name: firstName(r.full_name), since: r.created_at })) });
});

safetyRouter.post("/block/:userId", async (req, res) => {
  const them = String(req.params.userId);
  if (!z.uuid().safeParse(them).success || them === req.user!.id) throw badRequest("Choose someone else");
  await db().tx(async (q) => {
    await q.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing`, [req.user!.id, them]);
    const [a, b] = req.user!.id < them ? [req.user!.id, them] : [them, req.user!.id];
    await q.query(`update matches set status = 'ended' where user_a = $1 and user_b = $2`, [a, b]);
  });
  emit(them, "unmatch", { userId: req.user!.id });
  res.json({ ok: true });
});

safetyRouter.delete("/block/:userId", async (req, res) => {
  await db().query(`delete from blocks where blocker_id = $1 and blocked_id = $2`, [req.user!.id, req.params.userId]);
  res.json({ ok: true });
});

const Report = z
  .object({
    targetUserId: z.uuid().optional(),
    targetListingId: z.uuid().optional(),
    reason: z.enum(["fake_profile", "harassment", "scam", "inappropriate", "underage", "safety", "misleading_listing", "other"]),
    details: z.string().trim().max(2000).default(""),
  })
  .refine((v) => v.targetUserId || v.targetListingId, { message: "Choose who or what you are reporting" });

/**
 * Anyone reported by three different people, or reported as possibly under 18, is hidden from
 * Connect straight away until the safety team has looked.
 */
safetyRouter.post("/report", async (req, res) => {
  const b = Report.parse(req.body);
  if (b.targetUserId === req.user!.id) throw badRequest("You can't report yourself");
  const recent = await one(db(), `select 1 from reports where reporter_id = $1 and coalesce(target_user_id::text, target_listing_id::text) = $2 and created_at > now() - interval '1 day'`, [
    req.user!.id,
    b.targetUserId ?? b.targetListingId,
  ]);
  if (recent) throw conflict("You reported this already today. The team is looking at it.");
  await db().query(`insert into reports (reporter_id, target_user_id, target_listing_id, reason, details) values ($1, $2, $3, $4, $5)`, [
    req.user!.id, b.targetUserId ?? null, b.targetListingId ?? null, b.reason, b.details,
  ]);
  if (b.targetUserId) {
    const n = await one<{ n: number }>(db(), `select count(distinct reporter_id)::int as n from reports where target_user_id = $1 and status = 'OPEN'`, [b.targetUserId]);
    if ((n?.n ?? 0) >= 3 || b.reason === "underage") await db().query(`update connect_profiles set visible = false where user_id = $1`, [b.targetUserId]);
  }
  res.status(201).json({ ok: true });
});

async function meetingWith(userId: string, withUserId: string | undefined) {
  if (!withUserId) return null;
  const u = await one<{ full_name: string }>(db(), `select full_name from users where id = $1`, [withUserId]);
  return u ? firstName(u.full_name) : null;
}

safetyRouter.post("/checkin", async (req, res) => {
  const b = z.object({ withUserId: z.uuid().optional(), place: z.string().trim().min(2).max(160), meetAt: z.iso.datetime({ offset: true }) }).parse(req.body);
  const me = await one<{ full_name: string; trusted_contact_phone: string | null }>(db(), `select full_name, trusted_contact_phone from users where id = $1`, [req.user!.id]);
  if (!me?.trusted_contact_phone) throw badRequest("Add a trusted contact first", [{ path: "trustedContact", message: "Add a trusted contact" }]);
  const other = await meetingWith(req.user!.id, b.withUserId);
  const when = new Date(b.meetAt).toLocaleString("en-KE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" });
  const sent = await sendSms(me.trusted_contact_phone, `Konnect: ${firstName(me.full_name)} is meeting ${other ?? "someone"} at ${b.place}, ${when}. They shared this with you for safety.`);
  const row = await one(db(), `insert into safety_events (user_id, kind, with_user_id, place, meet_at, notified_contact) values ($1, 'checkin', $2, $3, $4, $5) returning id`, [
    req.user!.id, b.withUserId ?? null, b.place, b.meetAt, sent,
  ]);
  res.status(201).json({ id: row!.id, notifiedContact: sent });
});

safetyRouter.post("/sos", async (req, res) => {
  const b = z.object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), withUserId: z.uuid().optional() }).parse(req.body ?? {});
  const me = await one<{ full_name: string; phone: string; trusted_contact_phone: string | null }>(db(), `select full_name, phone, trusted_contact_phone from users where id = $1`, [req.user!.id]);
  const map = b.lat != null && b.lng != null ? ` Location: https://maps.google.com/?q=${b.lat.toFixed(5)},${b.lng.toFixed(5)}` : "";
  const other = await meetingWith(req.user!.id, b.withUserId);
  const text = `Konnect SOS: ${firstName(me!.full_name)} (${me!.phone}) asked for help${other ? ` while meeting ${other}` : ""}.${map}`;
  let sent = false;
  if (me!.trusted_contact_phone) sent = await sendSms(me!.trusted_contact_phone, text);
  const s = await getSettings();
  if (s.safety_phone) await sendSms(s.safety_phone, text);
  const row = await one(db(), `insert into safety_events (user_id, kind, with_user_id, lat, lng, notified_contact) values ($1, 'sos', $2, $3, $4, $5) returning id`, [
    req.user!.id, b.withUserId ?? null, b.lat ?? null, b.lng ?? null, sent,
  ]);
  console.warn(`[safety] SOS ${row!.id} from ${req.user!.id}`);
  res.status(201).json({ id: row!.id, notifiedContact: sent, safetyPhone: s.safety_phone || null });
});

safetyRouter.post("/events/:id/safe", async (req, res) => {
  const r = await one(db(), `update safety_events set status = 'SAFE' where id = $1 and user_id = $2 returning id`, [req.params.id, req.user!.id]);
  if (!r) throw notFound("Not found");
  res.json({ ok: true });
});

import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { db, many, one } from "../config/db.js";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { badgesOf, firstName } from "../services/views.js";
import { badRequest, notFound } from "../utils/http.js";
import { ageFrom, normalizePhone } from "../utils/kenya.js";
import { MAX_UPLOAD_BYTES, storeImage } from "../utils/media.js";
import { hashPassword, verifyPassword } from "../utils/security.js";
import { sendSms } from "../utils/sms.js";

export const usersRouter = Router();
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 } });

/** Everything the signed-in person sees about themselves. */
export async function meView(id: string) {
  const u = await one<Record<string, any>>(
    db(),
    `select u.*,
            exists (select 1 from listings l where l.host_id = u.id) as is_host,
            exists (select 1 from connect_profiles c where c.user_id = u.id) as has_connect,
            (select count(*) from notifications n where n.user_id = u.id and n.read_at is null) as unread_notifications,
            (select count(*) from messages m join matches x on x.id = m.match_id and x.status = 'active' where m.receiver_id = u.id and not m.is_read) as unread_messages
       from users u where u.id = $1`,
    [id],
  );
  if (!u) throw notFound("Account not found");
  const ver = await many<{ kind: string; status: string }>(db(), `select distinct on (kind) kind, status from verifications where user_id = $1 order by kind, created_at desc`, [id]);
  return {
    id: u.id,
    fullName: u.full_name,
    firstName: firstName(u.full_name),
    email: u.email,
    phone: u.phone,
    gender: u.gender,
    dateOfBirth: u.date_of_birth,
    age: ageFrom(u.date_of_birth),
    bio: u.bio,
    photoUrl: u.photo_url,
    city: u.city,
    neighbourhood: u.neighbourhood,
    phoneVerified: Boolean(u.phone_verified_at),
    phoneVerificationRequired: env.phoneVerification,
    badges: badgesOf(u),
    payoutPhone: u.payout_phone ?? u.phone,
    trustedContact: u.trusted_contact_phone ? { name: u.trusted_contact_name, phone: u.trusted_contact_phone } : null,
    prefs: { sms: u.prefs?.sms !== false, matches: u.prefs?.matches !== false, messages: u.prefs?.messages !== false, reminders: u.prefs?.reminders !== false, ...u.prefs },
    isHost: u.is_host,
    hasConnectProfile: u.has_connect,
    verification: Object.fromEntries(ver.map((v) => [v.kind, v.status])),
    unread: { notifications: Number(u.unread_notifications), messages: Number(u.unread_messages) },
    createdAt: u.created_at,
  };
}

usersRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ user: await meView(req.user!.id) });
});

const Patch = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  bio: z.string().trim().max(600).optional(),
  gender: z.enum(["woman", "man", "nonbinary"]).optional(),
  city: z.string().trim().min(2).max(40).optional(),
  neighbourhood: z.string().trim().max(60).nullable().optional(),
  prefs: z.object({ sms: z.boolean(), matches: z.boolean(), messages: z.boolean(), reminders: z.boolean() }).partial().optional(),
  trustedContact: z
    .object({ name: z.string().trim().min(2).max(60), phone: z.string() })
    .nullable()
    .optional(),
});

usersRouter.patch("/me", requireAuth, async (req, res) => {
  const b = Patch.parse(req.body);
  const sets: string[] = [];
  const vals: unknown[] = [req.user!.id];
  const set = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length}`);
  };
  if (b.fullName !== undefined) set("full_name", b.fullName);
  if (b.bio !== undefined) set("bio", b.bio);
  if (b.gender !== undefined) set("gender", b.gender);
  if (b.city !== undefined) set("city", b.city);
  if (b.neighbourhood !== undefined) set("neighbourhood", b.neighbourhood || null);
  if (b.prefs) {
    vals.push(JSON.stringify(b.prefs));
    sets.push(`prefs = prefs || $${vals.length}::jsonb`);
  }
  if (b.trustedContact !== undefined) {
    if (b.trustedContact === null) {
      set("trusted_contact_name", null);
      set("trusted_contact_phone", null);
    } else {
      const p = normalizePhone(b.trustedContact.phone);
      if (!p) throw badRequest("Enter a Kenyan mobile number for your trusted contact", [{ path: "trustedContact.phone", message: "Enter a Kenyan mobile number" }]);
      set("trusted_contact_name", b.trustedContact.name);
      set("trusted_contact_phone", p);
    }
  }
  if (sets.length) await db().query(`update users set ${sets.join(", ")} where id = $1`, vals);
  res.json({ user: await meView(req.user!.id) });
});

usersRouter.post("/me/photo", requireAuth, upload.single("photo"), async (req, res) => {
  if (!req.file) throw badRequest("Choose a photo to upload");
  const url = await storeImage(db(), req.user!.id, req.file, { maxEdge: 1200 });
  await db().query(`update users set photo_url = $2 where id = $1`, [req.user!.id, url]);
  res.json({ user: await meView(req.user!.id) });
});

/**
 * Where a host's 85% is sent. A wrong number here sends real money to a stranger, so it needs
 * the password, and the account's phone is told.
 */
usersRouter.post("/me/payout-phone", requireAuth, async (req, res) => {
  const b = z.object({ phone: z.string(), password: z.string().min(1, "Enter your password") }).parse(req.body);
  const phone = normalizePhone(b.phone);
  if (!phone) throw badRequest("Enter a Kenyan M-Pesa number", [{ path: "phone", message: "Enter a Kenyan M-Pesa number" }]);
  const u = await one<{ password_hash: string; phone: string }>(db(), `select password_hash, phone from users where id = $1`, [req.user!.id]);
  if (!(await verifyPassword(b.password, u!.password_hash))) throw badRequest("Your password is not right", [{ path: "password", message: "Not right" }]);
  await db().query(`update users set payout_phone = $2 where id = $1`, [req.user!.id, phone]);
  await sendSms(u!.phone, `Konnect: your payout number was changed to ${phone.replace(/^\+254/, "0")}. If this wasn't you, contact support now.`);
  res.json({ user: await meView(req.user!.id) });
});

usersRouter.post("/me/password", requireAuth, async (req, res) => {
  const b = z.object({ current: z.string().min(1), next: z.string().min(8, "Use at least 8 characters").max(200) }).parse(req.body);
  const u = await one<{ password_hash: string }>(db(), `select password_hash from users where id = $1`, [req.user!.id]);
  if (!(await verifyPassword(b.current, u!.password_hash))) throw badRequest("Your current password is not right", [{ path: "current", message: "Not right" }]);
  await db().query(`update users set password_hash = $2 where id = $1`, [req.user!.id, await hashPassword(b.next)]);
  res.json({ ok: true });
});

/**
 * Closes the account. Bookings and payments are financial records and stay; the person's
 * identifying details are cleared so the email and number can be used again.
 */
usersRouter.delete("/me", requireAuth, async (req, res) => {
  const { password } = z.object({ password: z.string().min(1) }).parse(req.body ?? {});
  const u = await one<{ password_hash: string }>(db(), `select password_hash from users where id = $1`, [req.user!.id]);
  if (!(await verifyPassword(password, u!.password_hash))) throw badRequest("Your password is not right", [{ path: "password", message: "Not right" }]);
  await db().tx(async (q) => {
    const id = req.user!.id;
    await q.query(
      `update users set status = 'deleted', email = 'deleted+' || id || '@konnect.invalid', phone = 'deleted:' || id, full_name = 'Former member',
              bio = '', photo_url = null, trusted_contact_name = null, trusted_contact_phone = null, token_version = token_version + 1 where id = $1`,
      [id],
    );
    await q.query(`delete from connect_profiles where user_id = $1`, [id]);
    await q.query(`update listings set status = 'PAUSED' where host_id = $1 and status in ('APPROVED','PENDING')`, [id]);
    await q.query(`update matches set status = 'ended' where user_a = $1 or user_b = $1`, [id]);
  });
  res.json({ ok: true });
});

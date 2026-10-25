import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db, one } from "../config/db.js";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { checkCode, sendCode } from "../services/otp.js";
import { requireSwitch } from "../services/settings.js";
import { badRequest, conflict, HttpError, unauthorized } from "../utils/http.js";
import { ageFrom, normalizePhone } from "../utils/kenya.js";
import { hashPassword, shortRef, signUser, verifyPassword } from "../utils/security.js";
import { meView } from "./users.routes.js";

export const authRouter = Router();

const strict = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.nodeEnv === "test" ? 1000 : 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many attempts. Try again in a few minutes." } },
});

export const phoneField = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) ctx.addIssue({ code: "custom", message: "Enter a Kenyan mobile number, like 0712 345 678" });
  return p ?? "";
});
const password = z.string().min(8, "Use at least 8 characters").max(200);

const Signup = z.object({
  fullName: z.string().trim().min(2, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  phone: phoneField,
  password,
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter your date of birth"),
  gender: z.enum(["woman", "man", "nonbinary"]),
  /** Where a host's share of each booking is sent. Defaults to the phone above. */
  payoutPhone: z.string().optional().or(z.literal("").transform(() => undefined)),
});

authRouter.post("/signup", strict, requireSwitch("signups_open", "New accounts are closed for now"), async (req, res) => {
  const b = Signup.parse(req.body);
  const age = ageFrom(b.dateOfBirth);
  if (!(age >= 18)) throw badRequest("Konnect is for adults aged 18 and over", [{ path: "dateOfBirth", message: "You must be 18 or older" }]);
  if (age > 100) throw badRequest("Check your date of birth", [{ path: "dateOfBirth", message: "Check your date of birth" }]);
  const taken = await one<{ email: string; phone: string }>(db(), `select email, phone from users where email = $1 or phone = $2`, [b.email, b.phone]);
  if (taken) throw conflict(taken.email === b.email ? "An account already uses this email" : "An account already uses this phone number", "account_exists");
  const payoutPhone = b.payoutPhone ? normalizePhone(b.payoutPhone) : b.phone;
  if (!payoutPhone) throw badRequest("Enter a Kenyan M-Pesa number for payouts", [{ path: "payoutPhone", message: "Enter a Kenyan M-Pesa number" }]);

  const user = await one<{ id: string; token_version: number }>(
    db(),
    `insert into users (email, phone, password_hash, full_name, date_of_birth, gender, referral_code, payout_phone)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, token_version`,
    [b.email, b.phone, await hashPassword(b.password), b.fullName, b.dateOfBirth, b.gender, shortRef("K", 6), payoutPhone],
  );
  if (env.phoneVerification) await sendCode(b.phone, "verify").catch(() => {});
  res.status(201).json({ token: signUser(user!.id, user!.token_version), user: await meView(user!.id) });
});

const Login = z.object({ identifier: z.string().trim().min(3, "Enter your email or phone"), password: z.string().min(1, "Enter your password") });

authRouter.post("/login", strict, async (req, res) => {
  const b = Login.parse(req.body);
  const asPhone = normalizePhone(b.identifier);
  const u = await one<{ id: string; password_hash: string; status: string; token_version: number }>(
    db(),
    `select id, password_hash, status, token_version from users where email = $1 or phone = $2`,
    [b.identifier.toLowerCase(), asPhone ?? "-"],
  );
  if (!u || !(await verifyPassword(b.password, u.password_hash))) throw unauthorized("That email or phone and password don't match");
  if (u.status === "suspended") throw new HttpError(403, "suspended", "This account is suspended. Contact support.");
  if (u.status !== "active") throw unauthorized("That email or phone and password don't match");
  res.json({ token: signUser(u.id, u.token_version), user: await meView(u.id) });
});

authRouter.post("/phone/send", requireAuth, async (req, res) => {
  if (req.user!.phone_verified_at) return res.json({ sent: false, verified: true });
  await sendCode(req.user!.phone, "verify");
  res.json({ sent: true });
});

authRouter.post("/phone/verify", strict, requireAuth, async (req, res) => {
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") }).parse(req.body);
  if (!(await checkCode(req.user!.phone, "verify", code))) throw badRequest("That code is wrong or has expired", [{ path: "code", message: "Wrong or expired code" }]);
  await db().query(`update users set phone_verified_at = now() where id = $1`, [req.user!.id]);
  res.json({ user: await meView(req.user!.id) });
});

authRouter.post("/password/forgot", strict, async (req, res) => {
  const { phone } = z.object({ phone: phoneField }).parse(req.body);
  const u = await one(db(), `select 1 from users where phone = $1 and status = 'active'`, [phone]);
  if (u) await sendCode(phone, "reset").catch(() => {});
  res.json({ sent: true }); // the same answer either way, so numbers can't be probed
});

authRouter.post("/password/reset", strict, async (req, res) => {
  const b = z.object({ phone: phoneField, code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"), password }).parse(req.body);
  if (!(await checkCode(b.phone, "reset", b.code))) throw badRequest("That code is wrong or has expired", [{ path: "code", message: "Wrong or expired code" }]);
  const u = await one<{ id: string; token_version: number }>(
    db(),
    `update users set password_hash = $2, token_version = token_version + 1, phone_verified_at = coalesce(phone_verified_at, now())
      where phone = $1 and status = 'active' returning id, token_version`,
    [b.phone, await hashPassword(b.password)],
  );
  if (!u) throw badRequest("No active account uses that number");
  res.json({ token: signUser(u.id, u.token_version), user: await meView(u.id) });
});

/** Signs out every device by invalidating all tokens issued so far. */
authRouter.post("/logout-all", requireAuth, async (req, res) => {
  const u = await one<{ token_version: number }>(db(), `update users set token_version = token_version + 1 where id = $1 returning token_version`, [req.user!.id]);
  res.json({ token: signUser(req.user!.id, u!.token_version) });
});

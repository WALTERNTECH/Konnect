import type { NextFunction, Request, Response } from "express";
import { db, one } from "../config/db.js";
import { env } from "../config/env.js";
import { verifyToken, type AdminClaims, type UserClaims } from "../utils/security.js";
import { forbidden, unauthorized } from "../utils/http.js";

export type AuthUser = {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  gender: string;
  date_of_birth: string;
  status: string;
  token_version: number;
  phone_verified_at: Date | null;
  premium_until: Date | null;
  last_seen_at: Date;
};
export type AuthAdmin = { id: string; email: string; name: string; role: "owner" | "admin" | "moderator" | "finance" };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      admin?: AuthAdmin;
    }
  }
}

const bearer = (req: Request) => {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
};

// Plan state is read from the database on every request rather than trusted from the token,
// so an expired or revoked subscription takes effect immediately.
export async function loadUser(id: string): Promise<AuthUser | null> {
  return one<AuthUser>(
    db(),
    `select u.id, u.full_name, u.email, u.phone, u.gender, u.date_of_birth, u.status, u.token_version, u.phone_verified_at, u.last_seen_at,
            (select max(s.expires_at) from subscriptions s where s.user_id = u.id and s.status = 'ACTIVE' and s.expires_at > now()) as premium_until
       from users u where u.id = $1`,
    [id],
  );
}

async function resolve(req: Request): Promise<AuthUser | null> {
  const token = bearer(req);
  if (!token) return null;
  const claims = verifyToken<UserClaims>(token, "user");
  if (!claims) return null;
  const u = await loadUser(claims.sub);
  if (!u || u.status !== "active" || u.token_version !== claims.tv) return null;
  if (Date.now() - new Date(u.last_seen_at).getTime() > 5 * 60_000) {
    db().query(`update users set last_seen_at = now() where id = $1`, [u.id]).catch(() => {});
  }
  return u;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const u = await resolve(req);
  if (!u) throw unauthorized();
  req.user = u;
  next();
}

/** Attaches the user when a valid token is present; never rejects. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  req.user = (await resolve(req)) ?? undefined;
  next();
}

export const isPremium = (u?: AuthUser | null) => Boolean(u?.premium_until && new Date(u.premium_until) > new Date());

export function requirePremium(req: Request, _res: Response, next: NextFunction) {
  if (!isPremium(req.user)) throw forbidden("Connect is part of Konnect Membership", "premium_required");
  next();
}

export function requireVerifiedPhone(req: Request, _res: Response, next: NextFunction) {
  if (env.phoneVerification && !req.user?.phone_verified_at) throw forbidden("Confirm your phone number first", "phone_unverified");
  next();
}

/** Admin routes need a token that has passed the authenticator step, and optionally a role. */
export function requireAdmin(...roles: AuthAdmin["role"][]) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token = bearer(req);
    const claims = token ? verifyToken<AdminClaims>(token, "admin") : null;
    if (!claims || !claims.mfa) throw unauthorized("Admin sign-in required");
    const a = await one<AuthAdmin & { token_version: number }>(db(), `select id, email, name, role, token_version from admin_users where id = $1`, [claims.sub]);
    if (!a || a.token_version !== claims.tv) throw unauthorized("Admin sign-in required");
    if (roles.length && a.role !== "owner" && !roles.includes(a.role)) throw forbidden("Your admin role cannot do this");
    req.admin = { id: a.id, email: a.email, name: a.name, role: a.role };
    next();
  };
}

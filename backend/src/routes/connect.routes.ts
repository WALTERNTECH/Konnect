import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db, many, one } from "../config/db.js";
import { requireAuth, requirePremium, requireVerifiedPhone } from "../middleware/auth.js";
import { emit, isOnline } from "../services/events.js";
import { notify } from "../services/notify.js";
import { connectCard, firstName } from "../services/views.js";
import { badRequest, conflict, notFound } from "../utils/http.js";
import { storeImage } from "../utils/media.js";
import { upload } from "./users.routes.js";

export const connectRouter = Router();

const INTERESTS = [
  "Travel", "Fine dining", "Fitness", "Art", "Music", "Live jazz", "Wine", "Coffee", "Books", "Film", "Fashion", "Business",
  "Tech", "Golf", "Hiking", "Road trips", "Cooking", "Faith", "Football", "Rugby", "Safari", "Beach", "Nightlife", "Wellness",
];

connectRouter.get("/options", (_req, res) => res.json({ interests: INTERESTS }));

const ProfileBody = z
  .object({
    headline: z.string().trim().max(120).default(""),
    intent: z.enum(["relationship", "dating", "friendship", "arrangement"]),
    arrangementRole: z.enum(["benefactor", "seeking"]).nullable().optional(),
    interestedIn: z.array(z.enum(["woman", "man", "nonbinary"])).min(1, "Choose who you'd like to meet"),
    ageMin: z.coerce.number().int().min(18).max(99),
    ageMax: z.coerce.number().int().min(18).max(99),
    interests: z.array(z.string().max(30)).max(12).default([]),
    occupation: z.string().trim().max(60).default(""),
    visible: z.boolean().default(true),
  })
  .refine((v) => v.ageMax >= v.ageMin, { message: "The upper age must be at least the lower age", path: ["ageMax"] })
  .refine((v) => v.intent !== "arrangement" || v.arrangementRole, { message: "Choose your side of the arrangement", path: ["arrangementRole"] });

async function myProfile(userId: string) {
  return one<Record<string, any>>(db(), `select c.*, u.photo_url from connect_profiles c join users u on u.id = c.user_id where c.user_id = $1`, [userId]);
}
const profileView = (c: Record<string, any> | null) =>
  c && {
    headline: c.headline, intent: c.intent, arrangementRole: c.arrangement_role, interestedIn: c.interested_in, ageMin: c.age_min, ageMax: c.age_max,
    interests: c.interests, occupation: c.occupation, visible: c.visible, photos: c.photos,
  };

connectRouter.get("/profile", requireAuth, async (req, res) => {
  res.json({ profile: profileView(await myProfile(req.user!.id)) });
});

connectRouter.put("/profile", requireAuth, requireVerifiedPhone, async (req, res) => {
  const b = ProfileBody.parse(req.body);
  await db().query(
    `insert into connect_profiles (user_id, headline, intent, arrangement_role, interested_in, age_min, age_max, interests, occupation, visible)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (user_id) do update set headline = excluded.headline, intent = excluded.intent, arrangement_role = excluded.arrangement_role,
       interested_in = excluded.interested_in, age_min = excluded.age_min, age_max = excluded.age_max, interests = excluded.interests,
       occupation = excluded.occupation, visible = excluded.visible, updated_at = now()`,
    [req.user!.id, b.headline, b.intent, b.intent === "arrangement" ? b.arrangementRole : null, b.interestedIn, b.ageMin, b.ageMax, b.interests, b.occupation, b.visible],
  );
  res.json({ profile: profileView(await myProfile(req.user!.id)) });
});

connectRouter.post("/profile/photos", requireAuth, upload.array("photos", 6), async (req, res) => {
  const c = await myProfile(req.user!.id);
  if (!c) throw badRequest("Set up your Connect profile first");
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw badRequest("Choose a photo");
  if (c.photos.length + files.length > 6) throw badRequest("Up to 6 photos");
  const urls: string[] = [];
  for (const f of files) urls.push(await storeImage(db(), req.user!.id, f, { maxEdge: 1400 }));
  const row = await one<{ photos: string[] }>(db(), `update connect_profiles set photos = photos || $2::text[], updated_at = now() where user_id = $1 returning photos`, [req.user!.id, urls]);
  res.json({ photos: row!.photos });
});

connectRouter.put("/profile/photos", requireAuth, async (req, res) => {
  const c = await myProfile(req.user!.id);
  const { photos } = z.object({ photos: z.array(z.string()) }).parse(req.body);
  if (!c || photos.some((p) => !c.photos.includes(p))) throw badRequest("Photos can be reordered or removed here");
  await db().query(`update connect_profiles set photos = $2, updated_at = now() where user_id = $1`, [req.user!.id, photos]);
  res.json({ photos });
});

// Who can be seen: members with a visible profile, an active plan, an active account, and no
// block in either direction.
const VISIBLE = `
  c.visible and u.status = 'active' and u.id <> $1
  and exists (select 1 from subscriptions s where s.user_id = u.id and s.status = 'ACTIVE' and s.expires_at > now())
  and not exists (select 1 from blocks b where (b.blocker_id = $1 and b.blocked_id = u.id) or (b.blocker_id = u.id and b.blocked_id = $1))`;

const Browse = z.object({
  intent: z.enum(["relationship", "dating", "friendship", "arrangement"]).optional(),
  role: z.enum(["benefactor", "seeking"]).optional(),
  gender: z.enum(["woman", "man", "nonbinary"]).optional(),
  ageMin: z.coerce.number().int().min(18).max(99).optional(),
  ageMax: z.coerce.number().int().min(18).max(99).optional(),
  city: z.string().max(40).optional(),
  interest: z.string().max(30).optional(),
  verified: z.coerce.boolean().optional(),
  mode: z.enum(["browse", "swipe"]).default("browse"),
  page: z.coerce.number().int().min(1).max(100).default(1),
});

const CARD_COLS = `c.*, u.full_name, u.date_of_birth, u.gender, u.city, u.neighbourhood, u.photo_url, u.last_seen_at, u.phone_verified_at, u.id_verified_at,
  u.income_verified_at, u.background_checked_at,
  (select max(s.expires_at) from subscriptions s where s.user_id = u.id and s.status = 'ACTIVE') as premium_until,
  exists (select 1 from likes k where k.from_user = $1 and k.to_user = u.id and k.kind = 'like') as liked,
  exists (select 1 from likes k where k.from_user = u.id and k.to_user = $1 and k.kind = 'like') as liked_you`;

async function browse(userId: string, query: unknown) {
  const f = Browse.parse(query);
  const vals: unknown[] = [userId];
  const p = (v: unknown) => (vals.push(v), `$${vals.length}`);
  const where = [VISIBLE];
  if (f.intent) where.push(`c.intent = ${p(f.intent)}`);
  if (f.role) where.push(`c.arrangement_role = ${p(f.role)}`);
  if (f.gender) where.push(`u.gender = ${p(f.gender)}`);
  if (f.ageMin) where.push(`u.date_of_birth <= (current_date - make_interval(years => ${p(f.ageMin)}))`);
  if (f.ageMax) where.push(`u.date_of_birth > (current_date - make_interval(years => ${p(f.ageMax + 1)}))`);
  if (f.city) where.push(`u.city = ${p(f.city)}`);
  if (f.interest) where.push(`${p(f.interest)} = any(c.interests)`);
  if (f.verified) where.push(`u.id_verified_at is not null`);
  // Swipe mode shows each person once; browse mode shows everyone, liked or not.
  if (f.mode === "swipe") where.push(`not exists (select 1 from likes k where k.from_user = $1 and k.to_user = u.id)`);
  const limit = f.mode === "swipe" ? 20 : 24;
  const rows = await many(
    db(),
    `select ${CARD_COLS} from connect_profiles c join users u on u.id = c.user_id
      where ${where.join(" and ")}
      order by (u.id_verified_at is not null) desc, u.last_seen_at desc
      limit ${limit} offset ${(f.page - 1) * limit}`,
    vals,
  );
  return rows.map(connectCard);
}

connectRouter.get("/browse", requireAuth, requirePremium, async (req, res) => {
  res.json({ items: await browse(req.user!.id, req.query), hasProfile: Boolean(await myProfile(req.user!.id)) });
});

/** The architecture document's name for the same thing. */
export const usersConnectHandler = [requireAuth, requirePremium, async (req: any, res: any) => res.json({ items: await browse(req.user!.id, req.query) })];

connectRouter.get("/profiles/:userId", requireAuth, requirePremium, async (req, res) => {
  if (!z.uuid().safeParse(req.params.userId).success) throw notFound("Profile not found");
  const row = await one(
    db(),
    `select ${CARD_COLS}, u.bio,
            (select id from matches m where m.status = 'active' and ((m.user_a = $1 and m.user_b = u.id) or (m.user_b = $1 and m.user_a = u.id))) as match_id
       from connect_profiles c join users u on u.id = c.user_id where u.id = $2 and ${VISIBLE}`,
    [req.user!.id, req.params.userId],
  );
  if (!row) throw notFound("This profile is not available");
  res.json({ profile: { ...connectCard(row), bio: row.bio, matchId: row.match_id ?? null, online: isOnline(String(row.user_id)) } });
});

connectRouter.get("/likes", requireAuth, requirePremium, async (req, res) => {
  const rows = await many(
    db(),
    `select ${CARD_COLS} from connect_profiles c join users u on u.id = c.user_id
      where ${VISIBLE} and exists (select 1 from likes k where k.from_user = u.id and k.to_user = $1 and k.kind = 'like')
        and not exists (select 1 from likes k where k.from_user = $1 and k.to_user = u.id)
      order by u.last_seen_at desc limit 60`,
    [req.user!.id],
  );
  res.json({ items: rows.map(connectCard) });
});

const react = (kind: "like" | "pass") => async (req: Request, res: Response) => {
  const me = req.user!.id;
  const them = String(req.params.userId);
  if (!z.uuid().safeParse(them).success || them === me) throw badRequest("Choose someone else");
  const target = await one(db(), `select 1 from connect_profiles c join users u on u.id = c.user_id where u.id = $2 and ${VISIBLE}`, [me, them]);
  if (!target) throw notFound("This profile is not available");
  const mine = await one(db(), `select 1 from connect_profiles where user_id = $1`, [me]);
  if (!mine && kind === "like") throw conflict("Set up your Connect profile first", "no_profile");

  const result = await db().tx(async (q) => {
    await q.query(`insert into likes (from_user, to_user, kind) values ($1, $2, $3) on conflict (from_user, to_user) do update set kind = excluded.kind, created_at = now()`, [me, them, kind]);
    if (kind === "pass") return { matched: false, matchId: null as string | null };
    const back = await one(q, `select 1 from likes where from_user = $1 and to_user = $2 and kind = 'like'`, [them, me]);
    if (!back) return { matched: false, matchId: null };
    const [a, b] = me < them ? [me, them] : [them, me];
    const m = await one<{ id: string; fresh: boolean }>(
      q,
      `insert into matches (user_a, user_b) values ($1, $2) on conflict (user_a, user_b) do update set status = 'active' returning id, (xmax = 0) as fresh`,
      [a, b],
    );
    return { matched: true, matchId: m!.id, fresh: m!.fresh };
  });
  if (result.matched && (result as { fresh?: boolean }).fresh !== false) {
    const names = await many<{ id: string; full_name: string }>(db(), `select id, full_name from users where id = any($1::uuid[])`, [[me, them]]);
    const nameOf = (id: string) => firstName(names.find((n) => n.id === id)?.full_name ?? "");
    for (const [who, other] of [[me, them], [them, me]] as const) {
      emit(who, "match", { matchId: result.matchId, userId: other, name: nameOf(other) });
      if (who === them) await notify(who, { kind: "match", title: `You and ${nameOf(other)} like each other`, body: "Say hello", link: `/messages/${result.matchId}` });
    }
  }
  res.json(result);
};
connectRouter.post("/profiles/:userId/like", requireAuth, requirePremium, requireVerifiedPhone, react("like"));
connectRouter.post("/profiles/:userId/pass", requireAuth, requirePremium, react("pass"));

connectRouter.get("/matches", requireAuth, requirePremium, async (req, res) => {
  res.json({ items: await threads(req.user!.id) });
});

export async function threads(userId: string) {
  const rows = await many<Record<string, any>>(
    db(),
    `select m.id, m.created_at, m.last_message_at, u.id as user_id, u.full_name, u.photo_url, u.last_seen_at, u.id_verified_at,
            cp.photos,
            (select json_build_object('content', x.content, 'senderId', x.sender_id, 'createdAt', x.created_at) from messages x where x.match_id = m.id order by x.created_at desc limit 1) as last,
            (select count(*) from messages x where x.match_id = m.id and x.receiver_id = $1 and not x.is_read) as unread
       from matches m
       join users u on u.id = case when m.user_a = $1 then m.user_b else m.user_a end
       left join connect_profiles cp on cp.user_id = u.id
      where (m.user_a = $1 or m.user_b = $1) and m.status = 'active' and u.status = 'active'
        and not exists (select 1 from blocks b where (b.blocker_id = $1 and b.blocked_id = u.id) or (b.blocker_id = u.id and b.blocked_id = $1))
      order by coalesce(m.last_message_at, m.created_at) desc`,
    [userId],
  );
  return rows.map((r) => ({
    matchId: r.id,
    user: { id: r.user_id, name: firstName(r.full_name), photoUrl: r.photos?.[0] ?? r.photo_url, verified: Boolean(r.id_verified_at), online: isOnline(r.user_id), lastSeen: r.last_seen_at },
    last: r.last,
    unread: Number(r.unread),
    createdAt: r.created_at,
  }));
}

connectRouter.delete("/matches/:id", requireAuth, async (req, res) => {
  const m = await one<{ id: string; user_a: string; user_b: string }>(db(), `select id, user_a, user_b from matches where id = $1 and (user_a = $2 or user_b = $2)`, [req.params.id, req.user!.id]);
  if (!m) throw notFound("Match not found");
  const other = m.user_a === req.user!.id ? m.user_b : m.user_a;
  await db().tx(async (q) => {
    await q.query(`update matches set status = 'ended' where id = $1`, [m.id]);
    await q.query(`update likes set kind = 'pass' where from_user = $1 and to_user = $2`, [req.user!.id, other]);
  });
  emit(other, "unmatch", { matchId: m.id });
  res.json({ ok: true });
});

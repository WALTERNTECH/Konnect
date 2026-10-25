import { Router } from "express";
import { z } from "zod";
import { db, many, one } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { emit, isOnline } from "../services/events.js";
import { notify } from "../services/notify.js";
import { firstName } from "../services/views.js";
import { forbidden, notFound } from "../utils/http.js";
import { threads } from "./connect.routes.js";

// Chat between two members who like each other.

export const messagesRouter = Router();
messagesRouter.use(requireAuth);

async function matchFor(matchId: string, userId: string) {
  if (!z.uuid().safeParse(matchId).success) throw notFound("Conversation not found");
  const m = await one<{ id: string; user_a: string; user_b: string; status: string }>(db(), `select id, user_a, user_b, status from matches where id = $1 and (user_a = $2 or user_b = $2)`, [matchId, userId]);
  if (!m) throw notFound("Conversation not found");
  const other = m.user_a === userId ? m.user_b : m.user_a;
  const blocked = await one(db(), `select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)`, [userId, other]);
  return { ...m, other, blocked: Boolean(blocked) };
}

const msgView = (m: Record<string, any>) => ({ id: m.id, senderId: m.sender_id, content: m.content, isRead: m.is_read, createdAt: m.created_at });

messagesRouter.get("/threads", async (req, res) => {
  res.json({ items: await threads(req.user!.id) });
});

messagesRouter.get("/:matchId", async (req, res) => {
  const m = await matchFor(String(req.params.matchId), req.user!.id);
  const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before) : null;
  const rows = await many(
    db(),
    `select * from (select * from messages where match_id = $1 and ($2::timestamptz is null or created_at < $2) order by created_at desc limit 60) x order by created_at asc`,
    [m.id, before],
  );
  const read = await many<{ id: string }>(db(), `update messages set is_read = true where match_id = $1 and receiver_id = $2 and not is_read returning id`, [m.id, req.user!.id]);
  if (read.length) emit(m.other, "read", { matchId: m.id, ids: read.map((r) => r.id) });
  const other = await one<Record<string, any>>(
    db(),
    `select u.id, u.full_name, u.photo_url, u.last_seen_at, u.id_verified_at, c.photos from users u left join connect_profiles c on c.user_id = u.id where u.id = $1`,
    [m.other],
  );
  res.json({
    matchId: m.id,
    active: m.status === "active" && !m.blocked,
    user: { id: other!.id, name: firstName(other!.full_name), photoUrl: other!.photos?.[0] ?? other!.photo_url, verified: Boolean(other!.id_verified_at), online: isOnline(other!.id), lastSeen: other!.last_seen_at },
    items: rows.map(msgView),
  });
});

messagesRouter.post("/:matchId", async (req, res) => {
  const { content } = z.object({ content: z.string().trim().min(1, "Write a message").max(4000) }).parse(req.body);
  const m = await matchFor(String(req.params.matchId), req.user!.id);
  if (m.status !== "active" || m.blocked) throw forbidden("This conversation has ended");
  const row = await one(db(), `insert into messages (match_id, sender_id, receiver_id, content) values ($1, $2, $3, $4) returning *`, [m.id, req.user!.id, m.other, content]);
  await db().query(`update matches set last_message_at = now() where id = $1`, [m.id]);
  const view = msgView(row!);
  emit(m.other, "message", { matchId: m.id, message: view });
  if (!isOnline(m.other)) {
    const prefs = await one<{ prefs: { messages?: boolean } }>(db(), `select prefs from users where id = $1`, [m.other]);
    if (prefs?.prefs?.messages !== false)
      await notify(m.other, { kind: "message", title: `New message from ${firstName(req.user!.full_name)}`, body: content.slice(0, 80), link: `/messages/${m.id}` });
  }
  res.status(201).json({ message: view });
});

messagesRouter.post("/:matchId/read", async (req, res) => {
  const m = await matchFor(String(req.params.matchId), req.user!.id);
  const read = await many<{ id: string }>(db(), `update messages set is_read = true where match_id = $1 and receiver_id = $2 and not is_read returning id`, [m.id, req.user!.id]);
  if (read.length) emit(m.other, "read", { matchId: m.id, ids: read.map((r) => r.id) });
  res.json({ ok: true });
});

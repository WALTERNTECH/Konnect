import { Router } from "express";
import { z } from "zod";
import { db, many } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { attach, issueTicket, redeemTicket } from "../services/events.js";
import { unauthorized } from "../utils/http.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", requireAuth, async (req, res) => {
  const items = await many(db(), `select id, kind, title, body, link, read_at, created_at from notifications where user_id = $1 order by created_at desc limit 60`, [req.user!.id]);
  res.json({ items, unread: items.filter((n: any) => !n.read_at).length });
});

notificationsRouter.post("/read", requireAuth, async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.uuid()).optional() }).parse(req.body ?? {});
  if (ids?.length) await db().query(`update notifications set read_at = now() where user_id = $1 and id = any($2::uuid[]) and read_at is null`, [req.user!.id, ids]);
  else await db().query(`update notifications set read_at = now() where user_id = $1 and read_at is null`, [req.user!.id]);
  res.json({ ok: true });
});

notificationsRouter.post("/stream-ticket", requireAuth, (req, res) => {
  res.json({ ticket: issueTicket(req.user!.id) });
});

notificationsRouter.get("/stream", (req, res) => {
  const userId = redeemTicket(String(req.query.ticket ?? ""));
  if (!userId) throw unauthorized("Stream ticket expired");
  attach(userId, res);
});

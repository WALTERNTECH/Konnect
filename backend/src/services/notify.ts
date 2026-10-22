import { db, one } from "../config/db.js";
import { sendSms } from "../utils/sms.js";
import { emit } from "./events.js";

export type Notice = { kind: string; title: string; body?: string; link?: string; sms?: string };

/** Stores an in-app notification, pushes it to open tabs, and optionally texts the person. */
export async function notify(userId: string, n: Notice) {
  const row = await one(db(), `insert into notifications (user_id, kind, title, body, link) values ($1, $2, $3, $4, $5) returning id, kind, title, body, link, created_at, read_at`, [
    userId,
    n.kind,
    n.title,
    n.body ?? "",
    n.link ?? null,
  ]);
  emit(userId, "notification", row);
  if (n.sms) {
    const u = await one<{ phone: string; prefs: { sms?: boolean } }>(db(), `select phone, prefs from users where id = $1`, [userId]);
    if (u && u.prefs?.sms !== false) await sendSms(u.phone, n.sms);
  }
}

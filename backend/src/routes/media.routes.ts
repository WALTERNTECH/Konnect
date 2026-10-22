import { Router } from "express";
import { z } from "zod";
import { db, one } from "../config/db.js";
import { notFound } from "../utils/http.js";

// Public photos stored in the database. Private documents are served only through the admin API.

export const mediaRouter = Router();

mediaRouter.get("/:id", async (req, res) => {
  if (!z.uuid().safeParse(req.params.id).success) throw notFound();
  const m = await one<{ mime: string; bytes: Buffer; private: boolean }>(db(), `select mime, bytes, private from media where id = $1`, [req.params.id]);
  if (!m || m.private) throw notFound();
  res.set({ "Content-Type": m.mime, "Cache-Control": "public, max-age=31536000, immutable", "Cross-Origin-Resource-Policy": "same-site" });
  res.send(Buffer.from(m.bytes));
});

import { Router } from "express";
import { z } from "zod";
import { db, many, one } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { badRequest, conflict } from "../utils/http.js";
import { storeImage } from "../utils/media.js";
import { upload } from "./users.routes.js";

// ID (national ID or passport + a selfie holding it), income (payslip or bank statement) and
// background (DCI certificate of good conduct). Documents are private: owner and admins only.

export const verificationRouter = Router();
verificationRouter.use(requireAuth);

verificationRouter.get("/", async (req, res) => {
  const rows = await many(
    db(),
    `select distinct on (kind) id, kind, status, reviewer_note, created_at, reviewed_at from verifications where user_id = $1 order by kind, created_at desc`,
    [req.user!.id],
  );
  res.json({ items: rows });
});

verificationRouter.post("/:kind", upload.array("documents", 4), async (req, res) => {
  const kind = z.enum(["ID", "INCOME", "BACKGROUND"]).parse(String(req.params.kind).toUpperCase());
  const { note } = z.object({ note: z.string().trim().max(500).default("") }).parse(req.body ?? {});
  const files = (req.files as Express.Multer.File[]) ?? [];
  const need = kind === "ID" ? 2 : 1;
  if (files.length < need) throw badRequest(kind === "ID" ? "Add a photo of your ID and a selfie holding it" : "Add the document");
  const pending = await one(db(), `select 1 from verifications where user_id = $1 and kind = $2 and status = 'PENDING'`, [req.user!.id, kind]);
  if (pending) throw conflict("This is already being reviewed");
  const ids: string[] = [];
  for (const f of files) ids.push(await storeImage(db(), req.user!.id, f, { private: true, maxEdge: 2000 }));
  await db().query(`insert into verifications (user_id, kind, documents, note) values ($1, $2, $3, $4)`, [req.user!.id, kind, ids, note]);
  res.status(201).json({ status: "PENDING" });
});

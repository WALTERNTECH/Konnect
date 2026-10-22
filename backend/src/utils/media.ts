import { createHash } from "node:crypto";
import sharp from "sharp";
import { env } from "../config/env.js";
import { one, type Q } from "../config/db.js";
import { badRequest } from "./http.js";

// Photos go through sharp (orientation fixed, metadata stripped, resized, WebP) and are kept
// in Cloudinary when CLOUDINARY_URL is set, otherwise in the database. Verification
// documents are always kept in the database and served only to their owner and admins.

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"]);
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export async function storeImage(q: Q, ownerId: string, file: { buffer: Buffer; mimetype: string }, opts: { private?: boolean; maxEdge?: number } = {}): Promise<string> {
  if (!ACCEPTED.has(file.mimetype)) throw badRequest("Upload a JPEG, PNG, WebP or HEIC photo");
  let out: { data: Buffer; info: { width: number; height: number } };
  try {
    out = await sharp(file.buffer, { failOn: "error" })
      .rotate()
      .resize({ width: opts.maxEdge ?? 1600, height: opts.maxEdge ?? 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw badRequest("That file could not be read as an image");
  }
  if (!opts.private && env.cloudinaryUrl) return uploadToCloudinary(out.data);
  const row = await one<{ id: string }>(
    q,
    `insert into media (owner_id, mime, bytes, width, height, private) values ($1, 'image/webp', $2, $3, $4, $5) returning id`,
    [ownerId, out.data, out.info.width, out.info.height, Boolean(opts.private)],
  );
  return opts.private ? row!.id : `/api/media/${row!.id}`;
}

async function uploadToCloudinary(data: Buffer): Promise<string> {
  // cloudinary://<api_key>:<api_secret>@<cloud_name>
  const u = new URL(env.cloudinaryUrl!);
  const [key, secret, cloud] = [decodeURIComponent(u.username), decodeURIComponent(u.password), u.hostname];
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "konnect";
  const signature = createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${secret}`).digest("hex");
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(data)], { type: "image/webp" }), "upload.webp");
  form.set("api_key", key);
  form.set("timestamp", String(timestamp));
  form.set("folder", folder);
  form.set("signature", signature);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`Cloudinary upload failed (${r.status})`);
  return ((await r.json()) as { secure_url: string }).secure_url;
}

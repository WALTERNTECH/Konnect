import { Router } from "express";
import { z } from "zod";
import { db, many, one } from "../config/db.js";
import { optionalAuth, requireAuth, requireVerifiedPhone } from "../middleware/auth.js";
import { openSlots, unavailableNights, type Hours } from "../services/availability.js";
import { startPayment } from "../services/payments.js";
import { getSettings } from "../services/settings.js";
import { listingCard, publicHost } from "../services/views.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/http.js";
import { addDays, daysBetween, normalizePhone, todayEAT } from "../utils/kenya.js";
import { storeImage } from "../utils/media.js";
import { phoneField } from "./auth.routes.js";
import { upload } from "./users.routes.js";

export const listingsRouter = Router();

export const NEIGHBOURHOODS: Record<string, string[]> = {
  Nairobi: ["Kilimani", "Westlands", "Karen", "Lavington", "Kileleshwa", "Riverside", "Runda", "Gigiri", "Parklands", "Upper Hill", "Muthaiga", "Spring Valley", "South B", "Langata", "CBD"],
  Mombasa: ["Nyali", "Diani", "Shanzu", "Bamburi", "Tudor"],
  Kisumu: ["Milimani", "Riat Hills", "Tom Mboya"],
  Nakuru: ["Milimani", "Section 58", "Naka"],
  Naivasha: ["Lake Road", "Kongoni"],
  Nanyuki: ["Likii", "Town"],
};
export const AMENITIES = ["Wi-Fi", "Workspace", "Kitchen", "Parking", "Pool", "Gym", "Backup power", "Hot shower", "Washer", "Air conditioning", "Balcony", "Garden", "Security", "Smart TV", "Ocean view", "City view"];
export const CATEGORIES = ["massage", "physiotherapy", "beauty", "spa", "fitness"] as const;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Browse = z.object({
  type: z.enum(["STAY", "WELLNESS"]).optional(),
  city: z.string().optional(),
  neighbourhood: z.string().optional(),
  q: z.string().trim().max(80).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  guests: z.coerce.number().int().min(1).max(30).optional(),
  bedrooms: z.coerce.number().int().min(0).max(20).optional(),
  checkIn: ymd.optional(),
  checkOut: ymd.optional(),
  category: z.enum(CATEGORIES).optional(),
  mode: z.enum(["home", "studio"]).optional(),
  amenity: z.union([z.string(), z.array(z.string())]).optional(),
  sort: z.enum(["recommended", "price_asc", "price_desc", "rating", "newest"]).default("recommended"),
  page: z.coerce.number().int().min(1).max(200).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});

// Featured listings first, then listings whose host is a member, then rating.
const ORDER: Record<string, string> = {
  recommended: `(l.featured_until > now()) desc nulls last, host_premium desc, l.is_sample asc, l.rating_avg desc, l.created_at desc`,
  price_asc: `l.price_kes asc`,
  price_desc: `l.price_kes desc`,
  rating: `l.rating_avg desc, l.rating_count desc`,
  newest: `l.created_at desc`,
};

listingsRouter.get("/", optionalAuth, async (req, res) => {
  const f = Browse.parse(req.query);
  const where = [`l.status = 'APPROVED'`, `u.status = 'active'`];
  const vals: unknown[] = [];
  const p = (v: unknown) => (vals.push(v), `$${vals.length}`);
  if (f.type) where.push(`l.type = ${p(f.type)}`);
  if (f.city) where.push(`l.city = ${p(f.city)}`);
  if (f.neighbourhood) where.push(`l.neighbourhood = ${p(f.neighbourhood)}`);
  if (f.q) where.push(`(l.title ilike ${p(`%${f.q}%`)} or l.neighbourhood ilike $${vals.length} or l.summary ilike $${vals.length})`);
  if (f.minPrice != null) where.push(`l.price_kes >= ${p(f.minPrice)}`);
  if (f.maxPrice != null) where.push(`l.price_kes <= ${p(f.maxPrice)}`);
  if (f.guests) where.push(`(l.type <> 'STAY' or l.max_guests >= ${p(f.guests)})`);
  if (f.bedrooms) where.push(`(l.type <> 'STAY' or l.bedrooms >= ${p(f.bedrooms)})`);
  if (f.category) where.push(`l.category = ${p(f.category)}`);
  if (f.mode) where.push(`${p(f.mode)} = any(l.service_modes)`);
  const amenities = f.amenity ? ([] as string[]).concat(f.amenity) : [];
  if (amenities.length) where.push(`l.amenities @> ${p(amenities)}::text[]`);
  if (f.checkIn && f.checkOut && f.checkOut > f.checkIn) {
    const a = p(f.checkIn), b = p(f.checkOut);
    where.push(`not exists (select 1 from listing_blocks k where k.listing_id = l.id and k.day >= ${a}::date and k.day < ${b}::date)`);
    where.push(`not exists (select 1 from bookings k where k.listing_id = l.id and k.check_in < ${b}::date and k.check_out > ${a}::date
                and (k.status in ('CONFIRMED','COMPLETED') or (k.status = 'PENDING_PAYMENT' and k.created_at > now() - interval '30 minutes')))`);
    where.push(`l.min_nights <= ${p(daysBetween(f.checkIn, f.checkOut))}`);
  }
  const offset = (f.page - 1) * f.limit;
  const rows = await many(
    db(),
    `select l.*, count(*) over () as total,
            exists (select 1 from subscriptions s where s.user_id = l.host_id and s.status = 'ACTIVE' and s.expires_at > now()) as host_premium
       from listings l join users u on u.id = l.host_id
      where ${where.join(" and ")}
      order by ${ORDER[f.sort]}
      limit ${f.limit} offset ${offset}`,
    vals,
  );
  res.json({ items: rows.map(listingCard), total: Number(rows[0]?.total ?? 0), page: f.page, limit: f.limit });
});

listingsRouter.get("/meta", async (_req, res) => {
  const counts = await many<{ type: string; city: string; neighbourhood: string; n: number; min: number; max: number }>(
    db(),
    `select type, city, neighbourhood, count(*)::int as n, min(price_kes) as min, max(price_kes) as max from listings where status = 'APPROVED' group by 1, 2, 3 order by n desc`,
  );
  const s = await getSettings();
  res.json({ neighbourhoods: NEIGHBOURHOODS, amenities: AMENITIES, categories: CATEGORIES, counts, bookingFeeKes: s.booking_fee_kes, promotionWeekKes: s.promotion_week_kes });
});

async function loadListing(id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Listing not found");
  return one<Record<string, any>>(db(), `select * from listings where id = $1`, [id]);
}

/** Owner or nobody: used by every edit route. */
async function ownListing(id: string, userId: string) {
  const l = await loadListing(id);
  if (!l) throw notFound("Listing not found");
  if (l.host_id !== userId) throw forbidden("This is not your listing");
  return l;
}

listingsRouter.get("/:id", optionalAuth, async (req, res) => {
  const l = await loadListing(String(req.params.id));
  const mine = l && req.user?.id === l.host_id;
  if (!l || (l.status !== "APPROVED" && !mine)) throw notFound("Listing not found");
  const host = await one<Record<string, unknown>>(
    db(),
    `select u.id, u.full_name, u.photo_url, u.bio, u.created_at, u.phone_verified_at, u.id_verified_at, u.background_checked_at,
            (select count(*) from bookings b where b.host_id = u.id and b.status = 'COMPLETED') as completed,
            (select coalesce(avg(r.rating), 0) from reviews r join listings x on x.id = r.listing_id where x.host_id = u.id) as rating_avg,
            (select count(*) from listings x where x.host_id = u.id and x.status = 'APPROVED') as listing_count
       from users u where u.id = $1`,
    [l.host_id],
  );
  const reviews = await many(
    db(),
    `select r.id, r.rating, r.body, r.host_reply, r.created_at, split_part(u.full_name, ' ', 1) as author, u.photo_url as author_photo
       from reviews r join users u on u.id = r.author_id where r.listing_id = $1 and not r.flagged order by r.created_at desc limit 12`,
    [l.id],
  );
  res.json({
    listing: {
      ...listingCard(l),
      description: l.description,
      bathrooms: l.bathrooms,
      minNights: l.min_nights,
      checkInTime: l.check_in_time,
      checkOutTime: l.check_out_time,
      houseRules: l.house_rules,
      depositPct: l.deposit_pct,
      hours: l.hours,
      amenities: l.amenities,
      rejectionReason: mine ? l.rejection_reason : undefined,
      featuredUntil: mine ? l.featured_until : undefined,
      mine: Boolean(mine),
    },
    host: { ...publicHost(host!), listings: Number(host!.listing_count) },
    reviews,
  });
});

listingsRouter.get("/:id/availability", async (req, res) => {
  const l = await loadListing(String(req.params.id));
  if (!l || l.type !== "STAY") throw notFound("Listing not found");
  const from = ymd.safeParse(req.query.from).success ? String(req.query.from) : todayEAT();
  const to = ymd.safeParse(req.query.to).success ? String(req.query.to) : addDays(from, 120);
  if (daysBetween(from, to) > 400) throw badRequest("Ask for at most 400 days");
  res.json({ unavailable: await unavailableNights(db(), l.id, from, to), minNights: l.min_nights });
});

listingsRouter.get("/:id/slots", async (req, res) => {
  const l = await loadListing(String(req.params.id));
  if (!l || l.type !== "WELLNESS") throw notFound("Listing not found");
  const day = ymd.parse(req.query.date);
  res.json({ date: day, slots: await openSlots(db(), { host_id: l.host_id, duration_min: l.duration_min, hours: l.hours as Hours }, day) });
});

listingsRouter.get("/:id/reviews", async (req, res) => {
  const rows = await many(
    db(),
    `select r.id, r.rating, r.body, r.host_reply, r.created_at, split_part(u.full_name, ' ', 1) as author, u.photo_url as author_photo
       from reviews r join users u on u.id = r.author_id where r.listing_id = $1 and not r.flagged order by r.created_at desc limit 100`,
    [req.params.id],
  );
  res.json({ items: rows });
});

// ——— Hosting ———

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ListingBody = z.object({
  type: z.enum(["STAY", "WELLNESS"]),
  title: z.string().trim().min(6, "Give it a title of at least 6 characters").max(80),
  summary: z.string().trim().max(160).default(""),
  description: z.string().trim().max(4000).default(""),
  city: z.string().trim().min(2).max(40),
  neighbourhood: z.string().trim().min(2).max(60),
  priceKes: z.coerce.number().int().min(100, "Set a price of at least KES 100").max(1_000_000),
  bedrooms: z.coerce.number().int().min(0).max(20).optional(),
  bathrooms: z.coerce.number().int().min(0).max(20).optional(),
  maxGuests: z.coerce.number().int().min(1).max(30).optional(),
  minNights: z.coerce.number().int().min(1).max(60).default(1),
  checkInTime: hhmm.optional(),
  checkOutTime: hhmm.optional(),
  houseRules: z.string().trim().max(2000).default(""),
  category: z.enum(CATEGORIES).optional(),
  durationMin: z.coerce.number().int().min(15).max(480).optional(),
  serviceModes: z.array(z.enum(["home", "studio"])).default([]),
  depositPct: z.coerce.number().int().min(0).max(100).optional(),
  hours: z.partialRecord(z.enum(["1", "2", "3", "4", "5", "6", "7"]), z.tuple([hhmm, hhmm])).optional(),
  amenities: z.array(z.string().max(40)).max(30).default([]),
});

function checkKind(b: Partial<z.infer<typeof ListingBody>>, type: string) {
  if (type === "STAY") {
    if (b.bedrooms == null || b.maxGuests == null) throw badRequest("Add bedrooms and the number of guests");
  } else {
    if (!b.category || !b.durationMin) throw badRequest("Choose a category and session length");
    if (!b.serviceModes?.length) throw badRequest("Choose home visits, studio sessions or both");
    if (!b.hours || !Object.keys(b.hours).length) throw badRequest("Set the hours you take bookings");
  }
}

const columns = (b: Partial<z.infer<typeof ListingBody>>) => ({
  title: b.title, summary: b.summary, description: b.description, city: b.city, neighbourhood: b.neighbourhood, price_kes: b.priceKes,
  bedrooms: b.bedrooms, bathrooms: b.bathrooms, max_guests: b.maxGuests, min_nights: b.minNights, check_in_time: b.checkInTime,
  check_out_time: b.checkOutTime, house_rules: b.houseRules, category: b.category, duration_min: b.durationMin,
  service_modes: b.serviceModes, deposit_pct: b.depositPct, hours: b.hours ? JSON.stringify(b.hours) : undefined, amenities: b.amenities,
});

listingsRouter.post("/", requireAuth, requireVerifiedPhone, async (req, res) => {
  const b = ListingBody.parse(req.body);
  checkKind(b, b.type);
  const cols = Object.entries(columns(b)).filter(([, v]) => v !== undefined);
  const row = await one<{ id: string }>(
    db(),
    `insert into listings (host_id, type, ${cols.map(([k]) => k).join(", ")}) values ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(", ")}) returning id`,
    [req.user!.id, b.type, ...cols.map(([, v]) => v)],
  );
  res.status(201).json({ id: row!.id });
});

listingsRouter.patch("/:id", requireAuth, async (req, res) => {
  const l = await ownListing(String(req.params.id), req.user!.id);
  const b = ListingBody.partial().omit({ type: true }).parse(req.body);
  const merged = { bedrooms: l.bedrooms, maxGuests: l.max_guests, category: l.category, durationMin: l.duration_min, serviceModes: l.service_modes, hours: l.hours, ...b };
  checkKind(merged, l.type);
  const cols = Object.entries(columns(b)).filter(([, v]) => v !== undefined);
  if (cols.length)
    await db().query(`update listings set ${cols.map(([k], i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`, [l.id, ...cols.map(([, v]) => v)]);
  res.json({ ok: true });
});

listingsRouter.post("/:id/photos", requireAuth, upload.array("photos", 10), async (req, res) => {
  const l = await ownListing(String(req.params.id), req.user!.id);
  const files = (req.files as Express.Multer.File[]) ?? [];
  if (!files.length) throw badRequest("Choose at least one photo");
  if (l.photos.length + files.length > 16) throw badRequest("A listing can have up to 16 photos");
  const urls: string[] = [];
  for (const f of files) urls.push(await storeImage(db(), req.user!.id, f));
  const row = await one<{ photos: string[] }>(db(), `update listings set photos = photos || $2::text[], updated_at = now() where id = $1 returning photos`, [l.id, urls]);
  res.json({ photos: row!.photos });
});

listingsRouter.put("/:id/photos", requireAuth, async (req, res) => {
  const l = await ownListing(String(req.params.id), req.user!.id);
  const { photos } = z.object({ photos: z.array(z.string()) }).parse(req.body);
  if (photos.some((p) => !l.photos.includes(p))) throw badRequest("Photos can be reordered or removed here, not added");
  await db().query(`update listings set photos = $2, updated_at = now() where id = $1`, [l.id, photos]);
  res.json({ photos });
});

listingsRouter.post("/:id/submit", requireAuth, requireVerifiedPhone, async (req, res) => {
  const l = await ownListing(String(req.params.id), req.user!.id);
  if (!["DRAFT", "REJECTED"].includes(l.status)) throw conflict("This listing is already submitted");
  const need = l.type === "STAY" ? 3 : 1;
  if (l.photos.length < need) throw badRequest(`Add at least ${need} photo${need > 1 ? "s" : ""} before submitting`);
  if (l.description.length < 40) throw badRequest("Write a description of at least 40 characters");
  await db().query(`update listings set status = 'PENDING', rejection_reason = null, updated_at = now() where id = $1`, [l.id]);
  res.json({ status: "PENDING" });
});

listingsRouter.post("/:id/pause", requireAuth, async (req, res) => {
  const l = await ownListing(String(req.params.id), req.user!.id);
  if (l.status !== "APPROVED") throw conflict("Only a live listing can be paused");
  await db().query(`update listings set status = 'PAUSED', updated_at = now() where id = $1`, [l.id]);
  res.json({ status: "PAUSED" });
});

listingsRouter.post("/:id/resume", requireAuth, async (req, res) => {
  const l = await ownListing(String(req.params.id), req.user!.id);
  if (l.status !== "PAUSED") throw conflict("This listing is not paused");
  await db().query(`update listings set status = 'APPROVED', updated_at = now() where id = $1`, [l.id]);
  res.json({ status: "APPROVED" });
});

listingsRouter.delete("/:id", requireAuth, async (req, res) => {
  const l = await ownListing(String(req.params.id), req.user!.id);
  const used = await one(db(), `select 1 from bookings where listing_id = $1 limit 1`, [l.id]);
  if (used) await db().query(`update listings set status = 'PAUSED' where id = $1`, [l.id]);
  else await db().query(`delete from listings where id = $1`, [l.id]);
  res.json({ removed: !used, paused: Boolean(used) });
});

listingsRouter.put("/:id/blocks", requireAuth, async (req, res) => {
  const l = await ownListing(String(req.params.id), req.user!.id);
  if (l.type !== "STAY") throw badRequest("Only stays have a date calendar");
  const b = z.object({ add: z.array(ymd).max(366).default([]), remove: z.array(ymd).max(366).default([]) }).parse(req.body);
  await db().tx(async (q) => {
    if (b.add.length) await q.query(`insert into listing_blocks (listing_id, day) select $1, unnest($2::date[]) on conflict do nothing`, [l.id, b.add]);
    if (b.remove.length) await q.query(`delete from listing_blocks where listing_id = $1 and day = any($2::date[])`, [l.id, b.remove]);
  });
  res.json({ ok: true });
});

listingsRouter.post("/:id/promote", requireAuth, async (req, res) => {
  const l = await ownListing(String(req.params.id), req.user!.id);
  if (l.status !== "APPROVED") throw conflict("Only a live listing can be featured");
  const b = z.object({ weeks: z.coerce.number().int().min(1).max(8), phone: phoneField.optional() }).parse(req.body);
  const s = await getSettings();
  const phone = b.phone ?? normalizePhone(req.user!.phone)!;
  const started = await startPayment({
    userId: req.user!.id, purpose: "PROMOTION", refId: l.id, phone, amount: s.promotion_week_kes * b.weeks,
    accountRef: "KNFEATURE", description: "Featured list", meta: { weeks: b.weeks },
  });
  res.status(202).json(started);
});

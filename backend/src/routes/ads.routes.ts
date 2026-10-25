import { Router } from "express";
import { z } from "zod";
import { db, many, one } from "../config/db.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { getSettings } from "../services/settings.js";
import { badRequest, conflict, notFound } from "../utils/http.js";
import { storeImage } from "../utils/media.js";
import { upload } from "./users.routes.js";

// Partner placements between listings, and the self-serve advertiser portal.
// Spend is counted in thousandths of a shilling: a CPM impression at KES 320 costs 320 mKES.

export const adsRouter = Router();

const adView = (a: Record<string, any>) => ({
  id: a.id, advertiser: a.advertiser, headline: a.headline, text: a.ad_text, imageUrl: a.image_url, cta: a.cta_label, url: a.target_url, house: a.is_house,
});

adsRouter.get("/serve", optionalAuth, async (req, res) => {
  const s = await getSettings();
  // Round-robin by fewest impressions among campaigns with budget left.
  const ad = await one<Record<string, any>>(
    db(),
    `select * from ads where status = 'ACTIVE' and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
        and (is_house or spent_mkes < budget_kes::bigint * 1000)
      order by is_house asc, impressions asc, random() limit 1`,
  );
  if (!ad) return res.json({ ad: null });
  const cost = ad.is_house || ad.billing !== "CPM" ? 0 : s.ad_cpm_kes; // KES per 1000 = mKES per impression
  await db().tx(async (q) => {
    await q.query(`update ads set impressions = impressions + 1, spent_mkes = spent_mkes + $2 where id = $1`, [ad.id, cost]);
    await q.query(`insert into ad_events (ad_id, user_id, kind, cost_mkes) values ($1, $2, 'impression', $3)`, [ad.id, req.user?.id ?? null, cost]);
    await q.query(`update ads set status = 'ENDED' where id = $1 and not is_house and spent_mkes >= budget_kes::bigint * 1000`, [ad.id]);
  });
  res.json({ ad: adView(ad) });
});

adsRouter.post("/:id/click", optionalAuth, async (req, res) => {
  const ad = await one<Record<string, any>>(db(), `select * from ads where id = $1`, [req.params.id]);
  if (!ad) throw notFound("Not found");
  const s = await getSettings();
  const cost = !ad.is_house && ad.billing === "CPC" ? s.ad_cpc_kes * 1000 : 0;
  await db().tx(async (q) => {
    await q.query(`update ads set clicks = clicks + 1, spent_mkes = spent_mkes + $2 where id = $1`, [ad.id, cost]);
    await q.query(`insert into ad_events (ad_id, user_id, kind, cost_mkes) values ($1, $2, 'click', $3)`, [ad.id, req.user?.id ?? null, cost]);
    await q.query(`update ads set status = 'ENDED' where id = $1 and not is_house and spent_mkes >= budget_kes::bigint * 1000`, [ad.id]);
  });
  res.json({ url: ad.target_url });
});

// ——— Advertiser portal ———

const campaignView = (a: Record<string, any>) => ({
  ...adView(a),
  billing: a.billing,
  status: a.status,
  budgetKes: a.budget_kes,
  spentKes: Math.round(Number(a.spent_mkes) / 10) / 100,
  impressions: a.impressions,
  clicks: a.clicks,
  ctr: a.impressions ? a.clicks / a.impressions : 0,
  reviewNote: a.review_note,
  startsAt: a.starts_at,
  endsAt: a.ends_at,
  createdAt: a.created_at,
});

const Campaign = z.object({
  advertiser: z.string().trim().min(2).max(60),
  headline: z.string().trim().min(4).max(60),
  text: z.string().trim().max(140).default(""),
  cta: z.string().trim().min(2).max(20).default("Learn more"),
  url: z.url({ protocol: /^https?$/ }),
  billing: z.enum(["CPM", "CPC"]).default("CPM"),
  startsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

adsRouter.get("/mine", requireAuth, async (req, res) => {
  const rows = await many(db(), `select * from ads where owner_id = $1 order by created_at desc`, [req.user!.id]);
  const s = await getSettings();
  res.json({ items: rows.map(campaignView), pricing: { cpmKes: s.ad_cpm_kes, cpcKes: s.ad_cpc_kes, minBudgetKes: s.ad_min_budget_kes } });
});

adsRouter.post("/", requireAuth, async (req, res) => {
  const b = Campaign.parse(req.body);
  const row = await one(
    db(),
    `insert into ads (owner_id, advertiser, headline, ad_text, cta_label, target_url, billing, starts_at, ends_at, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING_PAYMENT') returning *`,
    [req.user!.id, b.advertiser, b.headline, b.text, b.cta, b.url, b.billing, b.startsAt ?? null, b.endsAt ?? null],
  );
  res.status(201).json({ campaign: campaignView(row!) });
});

async function ownCampaign(id: string, userId: string) {
  if (!z.uuid().safeParse(id).success) throw notFound("Campaign not found");
  const a = await one<Record<string, any>>(db(), `select * from ads where id = $1 and owner_id = $2`, [id, userId]);
  if (!a) throw notFound("Campaign not found");
  return a;
}

adsRouter.get("/:id/stats", requireAuth, async (req, res) => {
  const a = await ownCampaign(String(req.params.id), req.user!.id);
  const days = await many(
    db(),
    `select to_char(date_trunc('day', created_at at time zone 'Africa/Nairobi'), 'YYYY-MM-DD') as day,
            count(*) filter (where kind = 'impression')::int as impressions, count(*) filter (where kind = 'click')::int as clicks,
            sum(cost_mkes)::bigint as cost_mkes
       from ad_events where ad_id = $1 and created_at > now() - interval '30 days' group by 1 order by 1`,
    [a.id],
  );
  res.json({ campaign: campaignView(a), days: days.map((d: any) => ({ day: d.day, impressions: d.impressions, clicks: d.clicks, spentKes: Number(d.cost_mkes) / 1000 })) });
});

adsRouter.patch("/:id", requireAuth, async (req, res) => {
  const a = await ownCampaign(String(req.params.id), req.user!.id);
  const b = Campaign.partial().parse(req.body);
  const map: Record<string, unknown> = { advertiser: b.advertiser, headline: b.headline, ad_text: b.text, cta_label: b.cta, target_url: b.url, billing: b.billing, starts_at: b.startsAt, ends_at: b.endsAt };
  const cols = Object.entries(map).filter(([, v]) => v !== undefined);
  // Changing what people see sends an approved campaign back for review.
  const content = ["advertiser", "headline", "ad_text", "target_url"].some((k) => map[k] !== undefined);
  const nextStatus = content && ["ACTIVE", "PAUSED", "REJECTED"].includes(a.status) ? "PENDING_REVIEW" : a.status;
  const row = await one(
    db(),
    `update ads set ${[...cols.map(([k], i) => `${k} = $${i + 2}`), `status = $${cols.length + 2}`].join(", ")} where id = $1 returning *`,
    [a.id, ...cols.map(([, v]) => v), nextStatus],
  );
  res.json({ campaign: campaignView(row!) });
});

adsRouter.post("/:id/image", requireAuth, upload.single("image"), async (req, res) => {
  const a = await ownCampaign(String(req.params.id), req.user!.id);
  if (!req.file) throw badRequest("Choose an image");
  const url = await storeImage(db(), req.user!.id, req.file, { maxEdge: 1400 });
  const row = await one(db(), `update ads set image_url = $2, status = case when status in ('ACTIVE','PAUSED','REJECTED') then 'PENDING_REVIEW' else status end where id = $1 returning *`, [a.id, url]);
  res.json({ campaign: campaignView(row!) });
});

adsRouter.post("/:id/pause", requireAuth, async (req, res) => {
  const a = await ownCampaign(String(req.params.id), req.user!.id);
  if (a.status !== "ACTIVE") throw conflict("Only a running campaign can be paused");
  const row = await one(db(), `update ads set status = 'PAUSED' where id = $1 returning *`, [a.id]);
  res.json({ campaign: campaignView(row!) });
});

adsRouter.post("/:id/resume", requireAuth, async (req, res) => {
  const a = await ownCampaign(String(req.params.id), req.user!.id);
  if (a.status !== "PAUSED") throw conflict("This campaign is not paused");
  const row = await one(db(), `update ads set status = 'ACTIVE' where id = $1 returning *`, [a.id]);
  res.json({ campaign: campaignView(row!) });
});

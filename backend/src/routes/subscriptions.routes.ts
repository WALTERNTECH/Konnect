import { Router } from "express";
import { z } from "zod";
import { db, many } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { startPayment } from "../services/payments.js";
import { getSettings } from "../services/settings.js";
import { phoneField } from "./auth.routes.js";

export const subscriptionsRouter = Router();

subscriptionsRouter.get("/plans", async (_req, res) => {
  const s = await getSettings();
  res.json({
    plans: [
      { id: "monthly", name: "Monthly", priceKes: s.premium_monthly_kes, days: 30 },
      { id: "annual", name: "Annual", priceKes: s.premium_annual_kes, days: 365, saving: Math.max(0, s.premium_monthly_kes * 12 - s.premium_annual_kes) },
    ],
    includes: ["Connect: browse, match and message members", "Konnect without partner placements", "Priority placement for your listings", "Members-only profile visibility"],
    referralDays: s.referral_days,
  });
});

subscriptionsRouter.get("/me", requireAuth, async (req, res) => {
  const history = await many(
    db(),
    `select s.id, s.period, s.status, s.starts_at, s.expires_at, s.amount_kes, s.source, p.mpesa_receipt
       from subscriptions s left join payments p on p.id = s.payment_id where s.user_id = $1 order by s.created_at desc limit 50`,
    [req.user!.id],
  );
  res.json({ active: Boolean(req.user!.premium_until), until: req.user!.premium_until, history });
});

subscriptionsRouter.post("/initiate", requireAuth, async (req, res) => {
  const b = z.object({ period: z.enum(["monthly", "annual"]), phone: phoneField }).parse(req.body);
  const s = await getSettings();
  const amount = b.period === "annual" ? s.premium_annual_kes : s.premium_monthly_kes;
  res.status(202).json(await startPayment({ userId: req.user!.id, purpose: "SUBSCRIPTION", refId: null, phone: b.phone, amount, accountRef: "KNMEMBER", description: "Membership", meta: { period: b.period } }));
});

import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db, one } from "../config/db.js";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import { paymentDriver, publicPayment, settle, startPayment, type PaymentRow } from "../services/payments.js";
import { getSettings } from "../services/settings.js";
import { badRequest, conflict, notFound } from "../utils/http.js";
import { daraja, parseB2cResult, parseCallback } from "../utils/mpesa.js";
import { handleB2cResult } from "../services/payouts.js";
import { phoneField } from "./auth.routes.js";

export const mpesaRouter = Router();

// The amount is always worked out here from what is being paid for, never taken from the browser.
const Push = z.discriminatedUnion("purpose", [
  z.object({ purpose: z.literal("BOOKING"), refId: z.uuid(), phone: phoneField }),
  z.object({ purpose: z.literal("AD_CAMPAIGN"), refId: z.uuid(), amount: z.coerce.number().int().min(100), phone: phoneField }),
]);

mpesaRouter.post("/stk-push", requireAuth, async (req, res) => {
  const b = Push.parse(req.body);
  const userId = req.user!.id;
  const s = await getSettings();
  if (b.purpose === "BOOKING") {
    const bk = await one<{ id: string; ref: string; user_id: string; status: string; due_now_kes: number; created_at: Date }>(
      db(),
      `select id, ref, user_id, status, due_now_kes, created_at from bookings where id = $1`,
      [b.refId],
    );
    if (!bk || bk.user_id !== userId) throw notFound("Booking not found");
    if (bk.status !== "PENDING_PAYMENT" || Date.now() - new Date(bk.created_at).getTime() > 30 * 60_000) throw conflict("This booking is no longer waiting for payment", "not_payable");
    const inFlight = await one(db(), `select 1 from payments where purpose = 'BOOKING' and ref_id = $1 and status = 'PENDING' and created_at > now() - interval '90 seconds'`, [bk.id]);
    if (inFlight) throw conflict("A prompt was just sent. Check your phone.", "in_flight");
    return res.status(202).json(await startPayment({ userId, purpose: "BOOKING", refId: bk.id, phone: b.phone, amount: bk.due_now_kes, accountRef: bk.ref, description: "Booking" }));
  }
  const ad = await one<{ id: string; owner_id: string; budget_kes: number; status: string }>(db(), `select id, owner_id, budget_kes, status from ads where id = $1`, [b.refId]);
  if (!ad || ad.owner_id !== userId) throw notFound("Campaign not found");
  if (["REJECTED"].includes(ad.status)) throw conflict("This campaign was not approved");
  if (ad.budget_kes === 0 && b.amount < s.ad_min_budget_kes) throw badRequest(`The first payment for a campaign is at least KES ${s.ad_min_budget_kes.toLocaleString("en-KE")}`);
  return res.status(202).json(await startPayment({ userId, purpose: "AD_CAMPAIGN", refId: ad.id, phone: b.phone, amount: b.amount, accountRef: "KNADS", description: "Ad campaign" }));
});

mpesaRouter.get("/payments/:id", requireAuth, async (req, res) => {
  if (!z.uuid().safeParse(req.params.id).success) throw notFound("Payment not found");
  const p = await one<PaymentRow>(db(), `select * from payments where id = $1`, [req.params.id]);
  if (!p || p.user_id !== req.user!.id) throw notFound("Payment not found");
  res.json({ payment: publicPayment(p) });
});

const tokenOk = (got: string) => {
  const a = Buffer.from(got), b = Buffer.from(env.mpesa.callbackToken);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Safaricom's result webhook. Daraja signs nothing, so the URL carries a secret, and a
 * reported success is confirmed with our own status query before anything is released.
 * Always answers 200, as Daraja requires.
 */
mpesaRouter.post("/callback/:token", async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  if (!tokenOk(String(req.params.token))) {
    console.warn(`[mpesa] callback with a wrong token from ${req.ip}`);
    return;
  }
  const r = parseCallback(req.body);
  if (!r) {
    console.warn("[mpesa] unreadable callback body");
    return;
  }
  try {
    if (r.resultCode === "0" && paymentDriver() === "daraja") {
      const check = await daraja.query(r.checkoutRequestId).catch(() => null);
      // Not confirmed yet: leave it pending; the reconciler asks again shortly.
      if (!check || check.resultCode !== "0") {
        console.warn(`[mpesa] success callback for ${r.checkoutRequestId} not confirmed by query (${check?.resultCode ?? "no answer"})`);
        if (check) await settle({ ...r, resultCode: check.resultCode, resultDesc: check.resultDesc }, "query", req.body);
        return;
      }
    }
    await settle(r, "callback", req.body);
  } catch (e) {
    console.error("[mpesa] settle failed", e);
  }
});

/** Safaricom's answer to a payout (B2C). Same secret path as the STK callback. */
mpesaRouter.post("/b2c/result/:token", async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  if (!tokenOk(String(req.params.token))) return console.warn(`[mpesa] b2c result with a wrong token from ${req.ip}`);
  const r = parseB2cResult(req.body);
  if (!r) return console.warn("[mpesa] unreadable b2c result");
  await handleB2cResult(r).catch((e) => console.error("[mpesa] b2c result", e));
});

/** The payout sat in Safaricom's queue too long and wasn't processed; it will be retried. */
mpesaRouter.post("/b2c/timeout/:token", async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  if (!tokenOk(String(req.params.token))) return;
  const r = parseB2cResult(req.body);
  if (r) await handleB2cResult({ ...r, resultCode: r.resultCode && r.resultCode !== "0" ? r.resultCode : "timeout", resultDesc: r.resultDesc || "Timed out in the M-Pesa queue" }).catch(() => {});
});

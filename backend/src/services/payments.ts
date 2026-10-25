import { db, many, one, type Q } from "../config/db.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http.js";
import { daraja, describeResult, simulatedDriver, type MpesaDriver, type StkResult } from "../utils/mpesa.js";
import { emit } from "./events.js";
import { notify, type Notice } from "./notify.js";
import { sendPayout } from "./payouts.js";
import { getSettings, type Settings } from "./settings.js";

// Payments are confirmed only by Safaricom's server-to-server result (or, with Daraja, our
// own status query of the same prompt) — never by anything the browser says.

export type Purpose = "BOOKING" | "AD_CAMPAIGN" | "PROMOTION";
export type PaymentRow = {
  id: string;
  user_id: string;
  purpose: Purpose;
  ref_id: string | null;
  phone: string;
  amount_kes: number;
  status: "PENDING" | "SUCCESS" | "FAILED" | "CANCELLED";
  driver: string;
  mpesa_checkout_id: string | null;
  mpesa_receipt: string | null;
  result_code: string | null;
  result_desc: string | null;
  meta: Record<string, unknown>;
  created_at: Date;
};

let driver: MpesaDriver = daraja;
export function initPayments() {
  driver = env.mpesa.driver === "daraja" ? daraja : simulatedDriver((r) => void settle(r, "simulated").catch((e) => console.error("[pay] settle", e)), Number(process.env.MPESA_SIM_DELAY_MS ?? 4500));
  console.log(`[pay] M-Pesa driver: ${driver.name}${driver.name === "daraja" ? ` (${env.mpesa.env})` : ""}`);
}
export const paymentDriver = () => driver.name;
const callbackUrl = () => `${env.publicUrl}/api/mpesa/callback/${env.mpesa.callbackToken}`;

export async function startPayment(p: {
  userId: string;
  purpose: Purpose;
  refId: string | null;
  phone: string;
  amount: number;
  accountRef: string;
  description: string;
  meta?: Record<string, unknown>;
}): Promise<{ paymentId: string; status: "PENDING"; message: string; simulated: boolean }> {
  const row = await one<{ id: string }>(
    db(),
    `insert into payments (user_id, purpose, ref_id, phone, amount_kes, account_ref, description, driver, meta)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [p.userId, p.purpose, p.refId, p.phone, p.amount, p.accountRef, p.description, driver.name, JSON.stringify(p.meta ?? {})],
  );
  try {
    const s = await driver.stkPush({ phone: p.phone, amount: p.amount, accountRef: p.accountRef, description: p.description }, callbackUrl());
    await db().query(`update payments set mpesa_checkout_id = $2, merchant_request_id = $3 where id = $1`, [row!.id, s.checkoutRequestId, s.merchantRequestId]);
    return { paymentId: row!.id, status: "PENDING", message: "Check your phone and enter your M-Pesa PIN", simulated: driver.name === "simulated" };
  } catch (e) {
    console.error("[pay] stk push failed", (e as Error).message);
    await db().query(`update payments set status = 'FAILED', result_desc = $2, completed_at = now() where id = $1`, [row!.id, (e as Error).message.slice(0, 300)]);
    throw new HttpError(502, "mpesa_unavailable", "M-Pesa did not accept the request. Check the number and try again.");
  }
}

/** Applies a result from Safaricom. Idempotent: a payment settles once, whatever arrives later. */
export async function settle(r: StkResult, source: "callback" | "query" | "simulated" | "timeout", raw?: unknown) {
  const after: { userId: string; n: Notice }[] = [];
  let settled: PaymentRow | null = null;
  const settings = await getSettings(); // read before the transaction: PGlite runs one at a time
  await db().tx(async (q) => {
    const p = await one<PaymentRow>(q, `select * from payments where mpesa_checkout_id = $1 for update`, [r.checkoutRequestId]);
    if (!p) {
      console.warn(`[pay] result for unknown checkout ${r.checkoutRequestId} (${source})`);
      return;
    }
    if (p.status !== "PENDING") {
      // A status query can settle a payment before the callback brings the receipt number.
      if (p.status === "SUCCESS" && !p.mpesa_receipt && r.receipt) {
        await q.query(`update payments set mpesa_receipt = $2, raw_callback = coalesce($3::jsonb, raw_callback) where id = $1`, [p.id, r.receipt, raw ? JSON.stringify(raw) : null]);
      }
      return;
    }
    let ok = r.resultCode === "0";
    let desc = r.resultDesc;
    if (ok && r.amount != null && Math.round(r.amount) < p.amount_kes) {
      ok = false;
      desc = `Amount ${r.amount} is less than ${p.amount_kes}`;
      console.error(`[pay] short payment on ${p.id}: ${desc}`);
    }
    await q.query(
      `update payments set status = $2, mpesa_receipt = $3, result_code = $4, result_desc = $5, raw_callback = coalesce($6::jsonb, raw_callback), completed_at = now() where id = $1`,
      [p.id, ok ? "SUCCESS" : "FAILED", r.receipt ?? null, r.resultCode, desc, raw ? JSON.stringify(raw) : null],
    );
    settled = { ...p, status: ok ? "SUCCESS" : "FAILED", mpesa_receipt: r.receipt ?? null, result_code: r.resultCode, result_desc: desc };
    if (ok) after.push(...(await applySuccess(q, settled, settings)));
  });
  if (!settled) return;
  const s = settled as PaymentRow;
  emit(s.user_id, "payment", publicPayment(s));
  for (const a of after) await notify(a.userId, a.n).catch((e) => console.error("[pay] notify", e));
  // The host's share leaves as soon as the guest's payment is confirmed.
  if (s.status === "SUCCESS" && s.purpose === "BOOKING") {
    const payout = await one<{ id: string }>(db(), `select id from payouts where booking_id = $1 and status = 'QUEUED'`, [s.ref_id]);
    if (payout) await sendPayout(payout.id).catch((e) => console.error("[pay] payout", e));
  }
}

export function publicPayment(p: PaymentRow) {
  return {
    id: p.id,
    purpose: p.purpose,
    refId: p.ref_id,
    amount: p.amount_kes,
    status: p.status,
    receipt: p.mpesa_receipt,
    message: p.status === "PENDING" ? "Waiting for your M-Pesa PIN" : describeResult(p.result_code ?? "", p.result_desc ?? ""),
    simulated: p.driver === "simulated",
  };
}

async function applySuccess(q: Q, p: PaymentRow, _s: Settings): Promise<{ userId: string; n: Notice }[]> {
  switch (p.purpose) {
    case "BOOKING": {
      const b = await one<{
        id: string; ref: string; status: string; kind: string; listing_id: string; host_id: string; user_id: string;
        check_in: string | null; check_out: string | null; starts_at: Date | null; due_now_kes: number; platform_fee_kes: number; title: string;
      }>(q, `select b.*, l.title from bookings b join listings l on l.id = b.listing_id where b.id = $1 for update of b`, [p.ref_id]);
      if (!b) return [];
      if (b.status === "EXPIRED" && b.kind === "STAY") {
        const clash = await one(q, `select 1 from bookings where listing_id = $1 and id <> $2 and status in ('CONFIRMED','COMPLETED') and check_in < $4 and check_out > $3 limit 1`, [
          b.listing_id, b.id, b.check_in, b.check_out,
        ]);
        if (clash) {
          await q.query(`update payments set meta = meta || '{"refund_needed": true}'::jsonb where id = $1`, [p.id]);
          return [{ userId: b.user_id, n: { kind: "booking", title: "Those dates were taken", body: `Your payment for ${b.ref} arrived after the hold ended. The team will refund it to your M-Pesa.`, link: `/trips/${b.id}` } }];
        }
      }
      if (b.status !== "PENDING_PAYMENT" && b.status !== "EXPIRED") return [];
      await q.query(`update bookings set status = 'CONFIRMED', confirmed_at = now(), payment_id = $2 where id = $1`, [b.id, p.id]);
      // Split what the guest paid: Konnect's commission was fixed when the booking was made.
      const host = await one<{ phone: string; payout_phone: string | null }>(q, `select phone, payout_phone from users where id = $1`, [b.host_id]);
      const share = b.due_now_kes - b.platform_fee_kes;
      await q.query(
        `insert into payouts (host_id, booking_id, gross_kes, commission_kes, amount_kes, phone) values ($1, $2, $3, $4, $5, $6) on conflict (booking_id) do nothing`,
        [b.host_id, b.id, b.due_now_kes, b.platform_fee_kes, share, host!.payout_phone ?? host!.phone],
      );
      return [
        { userId: b.user_id, n: { kind: "booking", title: "Booking confirmed", body: `${b.title} · ${b.ref}`, link: `/trips/${b.id}`, sms: `Konnect: ${b.title} is confirmed. Reference ${b.ref}. Receipt ${p.mpesa_receipt ?? ""}.` } },
        { userId: b.host_id, n: { kind: "booking", title: `New booking · KES ${share.toLocaleString("en-KE")} to your M-Pesa`, body: `${b.title} · ${b.ref}`, link: `/host/bookings`, sms: `Konnect: new booking ${b.ref} for ${b.title}. KES ${share.toLocaleString("en-KE")} is being sent to your M-Pesa.` } },
      ];
    }
    case "AD_CAMPAIGN": {
      await q.query(
        `update ads set budget_kes = budget_kes + $2,
                status = case when status in ('DRAFT','PENDING_PAYMENT') then 'PENDING_REVIEW' when status = 'ENDED' then 'ACTIVE' else status end
          where id = $1`,
        [p.ref_id, p.amount_kes],
      );
      return [{ userId: p.user_id, n: { kind: "ads", title: "Campaign budget added", body: `KES ${p.amount_kes.toLocaleString("en-KE")}`, link: "/advertise" } }];
    }
    case "PROMOTION": {
      const weeks = Number(p.meta.weeks ?? 1);
      await q.query(`update listings set featured_until = greatest(coalesce(featured_until, now()), now()) + make_interval(days => $2) where id = $1`, [p.ref_id, weeks * 7]);
      return [{ userId: p.user_id, n: { kind: "listing", title: "Listing featured", body: `For ${weeks} week${weeks > 1 ? "s" : ""}`, link: "/host/listings" } }];
    }
  }
}

/** Asks Daraja about prompts that have gone quiet, and gives up on ones nobody answered. */
export async function reconcile() {
  const stale = await many<PaymentRow>(db(), `select * from payments where status = 'PENDING' and created_at < now() - interval '45 seconds' order by created_at limit 50`);
  for (const p of stale) {
    if (!p.mpesa_checkout_id) continue;
    const age = Date.now() - new Date(p.created_at).getTime();
    try {
      const r = await driver.query(p.mpesa_checkout_id);
      if (r) {
        await settle({ checkoutRequestId: p.mpesa_checkout_id, resultCode: r.resultCode, resultDesc: r.resultDesc }, "query");
        continue;
      }
    } catch (e) {
      console.warn("[pay] status query failed", (e as Error).message);
    }
    if (age > 10 * 60_000) await settle({ checkoutRequestId: p.mpesa_checkout_id, resultCode: "1019", resultDesc: "No response from M-Pesa" }, "timeout");
  }
}

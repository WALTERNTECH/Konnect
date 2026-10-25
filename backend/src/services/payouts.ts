import { db, many, one } from "../config/db.js";
import { env } from "../config/env.js";
import { b2cConfigured, darajaB2c, simulatedB2c, type B2cDriver, type B2cResult } from "../utils/mpesa.js";
import { notify } from "./notify.js";

// The host's share of a booking goes to their payout number by M-Pesa B2C as soon as the
// guest's payment is confirmed. QUEUED → SENDING (Safaricom accepted it) → PAID or FAILED.
// Failed sends are retried a few times; anything that can't be sent stays queued for the
// finance team, who can send it by hand and record the reference.

const MAX_AUTO_ATTEMPTS = 3;
const B2C_MAX_KES = 250_000; // Safaricom's per-transaction ceiling

let driver: B2cDriver | null = null;
export function initPayouts() {
  if (env.mpesa.driver === "simulated") driver = simulatedB2c((r) => void handleB2cResult(r).catch((e) => console.error("[payout] result", e)), Number(process.env.MPESA_SIM_DELAY_MS ?? 3000));
  else driver = b2cConfigured() ? darajaB2c : null;
  console.log(`[payout] B2C: ${driver ? driver.name : "not configured (payouts wait for the finance team)"}`);
}
export const payoutDriver = () => driver?.name ?? null;

const urls = () => ({
  result: `${env.publicUrl}/api/mpesa/b2c/result/${env.mpesa.callbackToken}`,
  timeout: `${env.publicUrl}/api/mpesa/b2c/timeout/${env.mpesa.callbackToken}`,
});

type PayoutRow = { id: string; host_id: string; booking_id: string; amount_kes: number; phone: string; status: string; attempts: number; conversation_id: string | null; ref: string; title: string };

/** Sends one payout if it's waiting. Safe to call twice: only one call can claim it. */
export async function sendPayout(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!driver) {
    await db().query(`update payouts set last_error = 'M-Pesa payouts are not set up' where id = $1 and status = 'QUEUED'`, [id]);
    return { ok: false, error: "M-Pesa payouts are not set up" };
  }
  const p = await one<PayoutRow>(
    db(),
    `update payouts p set status = 'SENDING', attempts = attempts + 1, sent_at = now(), last_error = null
       from bookings b join listings l on l.id = b.listing_id
      where p.id = $1 and b.id = p.booking_id and p.status in ('QUEUED','FAILED')
      returning p.*, b.ref, l.title`,
    [id],
  );
  if (!p) return { ok: false, error: "This payout isn't waiting to be sent" };
  if (p.amount_kes < 10 || p.amount_kes > B2C_MAX_KES) {
    await db().query(`update payouts set status = 'QUEUED', last_error = $2 where id = $1`, [p.id, `KES ${p.amount_kes} is outside M-Pesa's B2C limits; send it by hand`]);
    return { ok: false, error: "Amount outside M-Pesa B2C limits" };
  }
  try {
    const sent = await driver.send(
      { originatorId: `${p.id}-${p.attempts}`, phone: p.phone, amount: p.amount_kes, remarks: `Konnect payout ${p.ref}`, occasion: p.title },
      urls(),
    );
    await db().query(`update payouts set conversation_id = $2 where id = $1`, [p.id, sent.conversationId]);
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    console.error(`[payout] send ${p.id} failed: ${msg}`);
    await db().query(`update payouts set status = 'FAILED', last_error = $2 where id = $1 and status = 'SENDING'`, [p.id, msg]);
    return { ok: false, error: msg };
  }
}

/** Applies Safaricom's B2C result. Matches on the conversation id we stored, or our own originator id. */
export async function handleB2cResult(r: B2cResult) {
  const byOriginator = r.originatorId?.match(/^([0-9a-f-]{36})-\d+$/)?.[1];
  const p = await one<PayoutRow & { host_name: string }>(
    db(),
    `select p.*, b.ref, l.title from payouts p join bookings b on b.id = p.booking_id join listings l on l.id = b.listing_id
      where ($1::text is not null and p.conversation_id = $1) or ($2::uuid is not null and p.id = $2) limit 1`,
    [r.conversationId ?? null, byOriginator ?? null],
  );
  if (!p) {
    console.warn(`[payout] result for unknown payout ${r.conversationId ?? r.originatorId}`);
    return;
  }
  if (p.status !== "SENDING") return;
  if (r.resultCode === "0") {
    const updated = await one(db(), `update payouts set status = 'PAID', paid_at = now(), reference = $2, last_error = null where id = $1 and status = 'SENDING' returning id`, [p.id, r.receipt ?? null]);
    if (updated)
      await notify(p.host_id, {
        kind: "payout",
        title: `KES ${p.amount_kes.toLocaleString("en-KE")} sent to your M-Pesa`,
        body: `${p.title} · ${p.ref}${r.receipt ? ` · ${r.receipt}` : ""}`,
        link: "/host/payouts",
        sms: `Konnect: KES ${p.amount_kes.toLocaleString("en-KE")} for booking ${p.ref} has been sent to your M-Pesa${r.receipt ? `, ref ${r.receipt}` : ""}.`,
      }).catch(() => {});
  } else {
    await db().query(`update payouts set status = 'FAILED', last_error = $2 where id = $1 and status = 'SENDING'`, [p.id, `${r.resultCode}: ${r.resultDesc}`.slice(0, 300)]);
    console.warn(`[payout] ${p.id} failed: ${r.resultCode} ${r.resultDesc}`);
  }
}

/** Runs every minute: sends queued payouts and retries failed ones a few times. */
export async function sendDuePayouts() {
  if (!driver) return;
  const due = await many<{ id: string }>(
    db(),
    `select id from payouts
      where (status = 'QUEUED' and (last_error is null or last_error = 'M-Pesa payouts are not set up'))
         or (status = 'FAILED' and attempts < ${MAX_AUTO_ATTEMPTS} and coalesce(sent_at, created_at) < now() - interval '5 minutes')
      order by created_at limit 20`,
  );
  for (const p of due) await sendPayout(p.id);
}

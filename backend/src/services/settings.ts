import { db, many } from "../config/db.js";

// Prices and platform switches the admin console can change. A row in konnect.settings
// overrides a default.

export const DEFAULTS = {
  /** Konnect's share of every booking payment; the host receives the rest. */
  commission_pct: 15,
  ad_cpm_kes: 320,
  ad_cpc_kes: 25,
  ad_min_budget_kes: 5000,
  promotion_week_kes: 1000,
  support_phone: "",
  safety_phone: "",
};

/** Konnect's commission and the host's share of an amount paid by M-Pesa. */
export function splitPayment(amount: number, pct: number) {
  const commission = Math.round((amount * pct) / 100);
  return { commission, host: amount - commission };
}
export type Settings = typeof DEFAULTS;

let cache: { at: number; value: Settings } | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const rows = await many<{ key: string; value: unknown }>(db(), `select key, value from settings`);
  const value = { ...DEFAULTS } as Record<string, unknown>;
  for (const r of rows) if (r.key in DEFAULTS) value[r.key] = r.value;
  cache = { at: Date.now(), value: value as Settings };
  return cache.value;
}

export async function setSettings(patch: Partial<Settings>) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS)) continue;
    await db().query(`insert into settings (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()`, [k, JSON.stringify(v)]);
  }
  cache = null;
}

import { db, many } from "../config/db.js";

// Prices and platform switches the admin console can change. Defaults are the figures in
// the product requirements; a row in konnect.settings overrides one.

export const DEFAULTS = {
  premium_monthly_kes: 999,
  premium_annual_kes: 8999,
  booking_fee_kes: 200,
  ad_cpm_kes: 320,
  ad_cpc_kes: 25,
  ad_min_budget_kes: 5000,
  promotion_week_kes: 1000,
  payout_delay_hours: 24,
  referral_days: 30,
  support_phone: "",
  safety_phone: "",
};
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

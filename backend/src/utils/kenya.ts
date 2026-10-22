// Kenyan phone numbers, money formatting and dates.

/** Accepts 07XX, 01XX, 7XX, 254…, +254… and returns +2547XXXXXXXX / +2541XXXXXXXX, or null. */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/[\s()-]/g, "").replace(/^\+/, "");
  let m = d.match(/^254([17]\d{8})$/) ?? d.match(/^0([17]\d{8})$/) ?? d.match(/^([17]\d{8})$/);
  return m ? `+254${m[1]}` : null;
}

/** The 2547XXXXXXXX form Daraja wants. */
export const darajaPhone = (e164: string) => e164.replace(/^\+/, "");

export const maskPhone = (e164: string) => e164.replace(/^(\+254\d{2})\d{4}(\d{3})$/, "$1 •••• $2");

export const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

export function ageFrom(dob: string, now = new Date()): number {
  const [y, m, d] = dob.split("-").map(Number);
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age--;
  return age;
}

/** Calendar arithmetic on YYYY-MM-DD strings, in UTC so no zone can shift a day. */
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** Today's date in Nairobi (UTC+3, no daylight saving). */
export const todayEAT = (now = Date.now()) => new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);

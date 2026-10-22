// Money, dates and small words, all in Kenyan conventions (Nairobi time, KES, en-KE).

const TZ = "Africa/Nairobi";

export const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
export const num = (n: number) => Math.round(n).toLocaleString("en-KE");

export const ymd = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
export const todayYmd = () => ymd(new Date());
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const asDate = (day: string) => new Date(`${day}T12:00:00Z`);

export const fmtDay = (day: string, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => asDate(day).toLocaleDateString("en-KE", { ...o, timeZone: "UTC" });
export const fmtDayLong = (day: string) => fmtDay(day, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
export function fmtRange(a: string, b: string) {
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  return sameMonth ? `${fmtDay(a, { day: "numeric" })} – ${fmtDay(b)}` : `${fmtDay(a)} – ${fmtDay(b)}`;
}
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
export const fmtMonthYear = (iso: string) => new Date(iso).toLocaleDateString("en-KE", { month: "long", year: "numeric", timeZone: TZ });

export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return fmtDate(iso);
}
export function activeLabel(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 15 * 60) return "Active now";
  if (s < 86_400) return "Active today";
  if (s < 7 * 86_400) return "Active this week";
  return "Active recently";
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** Sample photos ship in two sizes; cards use the smaller one. */
export const thumb = (url: string | null | undefined) => (url ? url.replace(/-1600\.webp$/, "-720.webp") : "");

export const CATEGORY: Record<string, string> = { massage: "Massage", physiotherapy: "Physiotherapy", beauty: "Beauty", spa: "Spa", fitness: "Fitness" };
export const INTENT: Record<string, string> = { relationship: "A relationship", dating: "Dating", friendship: "Friendship", arrangement: "An arrangement" };
export const ROLE: Record<string, string> = { benefactor: "Benefactor", seeking: "Seeking a benefactor" };
export const GENDER: Record<string, string> = { woman: "Woman", man: "Man", nonbinary: "Non-binary" };
export const GENDER_PLURAL: Record<string, string> = { woman: "Women", man: "Men", nonbinary: "Non-binary people" };

export const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
  DRAFT: "Draft",
  PENDING: "In review",
  APPROVED: "Live",
  REJECTED: "Changes needed",
  PAUSED: "Paused",
};
export const STATUS_TONE: Record<string, string> = {
  PENDING_PAYMENT: "warn",
  CONFIRMED: "ok",
  COMPLETED: "",
  CANCELLED: "danger",
  EXPIRED: "",
  DRAFT: "",
  PENDING: "warn",
  APPROVED: "ok",
  REJECTED: "danger",
  PAUSED: "",
};

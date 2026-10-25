import { ageFrom } from "../utils/kenya.js";
import { occupancyOf } from "./availability.js";

// How rows are shown to other people. Phone numbers and emails never leave through these.

export type Badges = { phone: boolean; id: boolean; income: boolean; background: boolean };

export function badgesOf(u: {
  phone_verified_at?: Date | null;
  id_verified_at?: Date | null;
  income_verified_at?: Date | null;
  background_checked_at?: Date | null;
}): Badges {
  return {
    phone: Boolean(u.phone_verified_at),
    id: Boolean(u.id_verified_at),
    income: Boolean(u.income_verified_at),
    background: Boolean(u.background_checked_at),
  };
}

export const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

export function publicHost(u: Record<string, unknown>) {
  return {
    id: u.id,
    name: firstName(String(u.full_name)),
    photoUrl: u.photo_url ?? null,
    bio: u.bio ?? "",
    since: u.created_at,
    badges: badgesOf(u as never),
    level: providerLevel(Number(u.completed ?? 0), Number(u.rating_avg ?? 0)),
  };
}

/** New → Trusted → Top Rated, from completed bookings and rating. */
export function providerLevel(completed: number, rating: number): "New" | "Trusted" | "Top Rated" {
  if (completed >= 10 && rating >= 4.5) return "Top Rated";
  if (completed >= 3 && rating >= 4.0) return "Trusted";
  return "New";
}

export function listingCard(l: Record<string, unknown>) {
  return {
    id: l.id,
    type: l.type,
    title: l.title,
    summary: l.summary,
    city: l.city,
    neighbourhood: l.neighbourhood,
    priceKes: l.price_kes,
    unit: l.type === "STAY" ? "night" : "session",
    bedrooms: l.bedrooms,
    maxGuests: l.max_guests,
    category: l.category,
    durationMin: l.duration_min,
    serviceModes: l.service_modes,
    photos: l.photos,
    rating: Number(l.rating_avg ?? 0),
    reviews: Number(l.rating_count ?? 0),
    featured: Boolean(l.featured_until && new Date(l.featured_until as string) > new Date()),
    sample: Boolean(l.is_sample),
    status: l.status,
    availability: l.type === "STAY" ? occupancyOf(l as never) : null,
  };
}

export function connectCard(r: Record<string, unknown>) {
  return {
    userId: r.user_id,
    name: firstName(String(r.full_name)),
    age: ageFrom(String(r.date_of_birth)),
    gender: r.gender,
    city: r.city,
    neighbourhood: r.neighbourhood,
    headline: r.headline,
    intent: r.intent,
    arrangementRole: r.arrangement_role,
    interests: r.interests,
    occupation: r.occupation,
    photos: (r.photos as string[])?.length ? r.photos : r.photo_url ? [r.photo_url] : [],
    badges: badgesOf(r as never),
    lastSeen: r.last_seen_at,
    liked: Boolean(r.liked),
    likedYou: Boolean(r.liked_you),
  };
}

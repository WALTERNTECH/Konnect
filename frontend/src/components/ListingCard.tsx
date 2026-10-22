import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, useApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { CATEGORY, kes, plural, thumb } from "../lib/format";
import type { Ad, ListingCard as L } from "../types";
import { Mark } from "./brand/Logo";

export function ListingCard({ l, eager }: { l: L; eager?: boolean }) {
  const [i, setI] = useState(0);
  const photos = l.photos.length ? l.photos : [""];
  const step = (d: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setI((x) => (x + d + photos.length) % photos.length);
  };
  const meta =
    l.type === "STAY"
      ? [l.bedrooms === 0 ? "Studio" : l.bedrooms != null ? plural(l.bedrooms, "bedroom") : null, l.maxGuests ? plural(l.maxGuests, "guest") : null].filter(Boolean).join(" · ")
      : [CATEGORY[l.category ?? ""] ?? l.category, l.durationMin ? `${l.durationMin} min` : null, l.serviceModes.includes("home") ? (l.serviceModes.includes("studio") ? "Studio or home" : "Home visits") : "Studio"].filter(Boolean).join(" · ");
  return (
    <Link to={`/listings/${l.id}`} className="lcard">
      <div className="lcard-media">
        {photos[i] ? <img src={thumb(photos[i])} alt="" loading={eager ? "eager" : "lazy"} decoding="async" /> : null}
        <div className="lcard-tags">
          {l.featured && <span className="badge badge-glass">Featured</span>}
          {l.sample && <span className="badge badge-glass">Sample</span>}
        </div>
        {photos.length > 1 && (
          <>
            <button className="lcard-nav prev" onClick={step(-1)} aria-label="Previous photo">
              <ChevronLeft />
            </button>
            <button className="lcard-nav next" onClick={step(1)} aria-label="Next photo">
              <ChevronRight />
            </button>
            <div className="lcard-dots">
              {photos.slice(0, 5).map((_, k) => (
                <span key={k} className={k === i ? "on" : ""} />
              ))}
            </div>
          </>
        )}
      </div>
      <div className="lcard-body">
        <div className="lcard-top">
          <span className="lcard-place">
            {l.neighbourhood}, {l.city}
          </span>
          {l.reviews > 0 ? (
            <span className="rating">
              <Star /> {l.rating.toFixed(2)}
            </span>
          ) : (
            <span className="tiny muted">New</span>
          )}
        </div>
        <div className="lcard-title">{l.title}</div>
        <div className="lcard-meta">{meta}</div>
        <div className="lcard-price">
          <b>{kes(l.priceKes)}</b> <span className="muted">/ {l.unit}</span>
        </div>
      </div>
    </Link>
  );
}

/** Fetches one partner placement for people without a membership. Members never see one. */
export function usePartnerAd(slot: string) {
  const { me } = useAuth();
  const member = me?.premium.active;
  const { data } = useApi<{ ad: Ad | null }>(member ? null : `/ads/serve?slot=${slot}`, { staleMs: 5 * 60_000 });
  return member ? null : (data?.ad ?? null);
}

function openAd(ad: Ad) {
  void api.post(`/ads/${ad.id}/click`).catch(() => {});
}

export function PartnerCard({ ad }: { ad: Ad }) {
  const internal = ad.url.startsWith("/");
  const body = (
    <>
      <div className="lcard-media">
        {ad.house || !ad.imageUrl ? (
          <div className="partner-house">
            <Mark size={34} className="mark" node="var(--accent)" />
            <div>
              <div className="serif">{ad.headline}</div>
              <p className="small mt-8" style={{ color: "rgba(243, 239, 232, 0.7)" }}>
                {ad.text}
              </p>
            </div>
          </div>
        ) : (
          <img src={ad.imageUrl} alt="" loading="lazy" />
        )}
        <div className="lcard-tags">
          <span className="badge badge-glass">{ad.house ? "Konnect" : "Partner"}</span>
        </div>
      </div>
      <div className="lcard-body">
        <span className="lcard-place">{ad.advertiser}</span>
        <div className="lcard-title">{ad.house ? ad.cta : ad.headline}</div>
        {!ad.house && <div className="lcard-meta clamp-2">{ad.text}</div>}
      </div>
    </>
  );
  return internal ? (
    <Link to={ad.url} className="partner lcard" onClick={() => openAd(ad)}>
      {body}
    </Link>
  ) : (
    <a href={ad.url} target="_blank" rel="noopener noreferrer sponsored" className="partner lcard" onClick={() => openAd(ad)}>
      {body}
    </a>
  );
}

/** A grid of listing cards with one partner placement after the eighth card. */
export function ListingGrid({ items, slot = "grid" }: { items: L[]; slot?: string }) {
  const ad = usePartnerAd(slot);
  const out: React.ReactNode[] = [];
  items.forEach((l, k) => {
    out.push(<ListingCard key={l.id} l={l} eager={k < 4} />);
    if (k === 7 && ad) out.push(<PartnerCard key="ad" ad={ad} />);
  });
  if (items.length <= 7 && items.length > 2 && ad) out.push(<PartnerCard key="ad" ad={ad} />);
  return <div className="grid-cards">{out}</div>;
}

/** Fades content in once it's on screen. */
export function FadeIn({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setOn(true), io.disconnect()), { rootMargin: "0px 0px -6% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${on ? "in" : ""}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

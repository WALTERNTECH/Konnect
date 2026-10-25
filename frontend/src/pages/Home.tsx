import { ArrowRight, BadgeCheck, Lock, MessageCircle, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useApi } from "../api/client";
import { ListingCard, PartnerCard, usePartnerAd } from "../components/ListingCard";
import { SearchPanel, useMeta } from "../components/SearchPanel";
import { LinkButton, Skeleton, useReveal } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import type { ListingCard as L } from "../types";

function Rail({ items, loading }: { items?: L[]; loading: boolean }) {
  if (loading)
    return (
      <div className="rail">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="lcard">
            <Skeleton h={0} className="lcard-media" />
            <Skeleton h={14} w="70%" />
          </div>
        ))}
      </div>
    );
  return (
    <div className="rail">
      {items?.map((l, i) => (
        <ListingCard key={l.id} l={l} eager={i < 4} />
      ))}
    </div>
  );
}

export default function Home() {
  const { me } = useAuth();
  const stays = useApi<{ items: L[] }>("/listings?type=STAY&limit=10");
  const wellness = useApi<{ items: L[] }>("/listings?type=WELLNESS&limit=10");
  const { data: meta } = useMeta();
  const ad = usePartnerAd("home");
  useReveal([stays.data, wellness.data]);

  const hoods = (meta?.counts ?? [])
    .filter((c) => c.type === "STAY")
    .reduce<Record<string, { name: string; city: string; n: number }>>((acc, c) => {
      const k = `${c.neighbourhood}|${c.city}`;
      acc[k] = { name: c.neighbourhood, city: c.city, n: (acc[k]?.n ?? 0) + c.n };
      return acc;
    }, {});

  return (
    <>
      <section className="hero">
        <div className="hero-media">
          <img src="/samples/city-night-1600.webp" alt="" fetchPriority="high" />
        </div>
        <div className="page hero-inner">
          <div className="eyebrow" style={{ marginBottom: 18 }}>
            Stays · Wellness · Connect
          </div>
          <h1 className="display d-1">Book a stay, a session, or an introduction.</h1>
          <div className="hero-cities mt-24">
            <span>Nairobi</span>
            <span>Mombasa</span>
            <span>Kisumu</span>
            <span>Nakuru</span>
          </div>
          <SearchPanel />
        </div>
      </section>

      <section className="page section">
        <div className="sec-head reveal">
          <div>
            <div className="eyebrow">Stays</div>
            <h2 className="display d-3 mt-8">Apartments, cottages and villas</h2>
          </div>
          <Link to="/stays" className="more">
            All stays <ArrowRight />
          </Link>
        </div>
        <Rail items={stays.data?.items} loading={stays.loading} />
      </section>

      {Object.keys(hoods).length > 0 && (
        <section className="page section-tight">
          <div className="sec-head reveal">
            <h2 className="h-1">By neighbourhood</h2>
          </div>
          <div className="hoods reveal">
            {Object.values(hoods)
              .sort((a, b) => b.n - a.n)
              .slice(0, 10)
              .map((h) => (
                <Link key={`${h.name}${h.city}`} to={`/stays?neighbourhood=${encodeURIComponent(h.name)}&city=${encodeURIComponent(h.city)}`} className="hood">
                  <span className="stack g-4">
                    <span className="name">{h.name}</span>
                    <span className="tiny muted">{h.city}</span>
                  </span>
                  <span className="n">{h.n}</span>
                </Link>
              ))}
          </div>
        </section>
      )}

      <section className="page section">
        <div className="sec-head reveal">
          <div>
            <div className="eyebrow">Wellness</div>
            <h2 className="display d-3 mt-8">Massage, physiotherapy and beauty</h2>
          </div>
          <Link to="/wellness" className="more">
            All treatments <ArrowRight />
          </Link>
        </div>
        <Rail items={wellness.data?.items} loading={wellness.loading} />
      </section>

      <section className="page section-tight">
        <div className="feature reveal">
          <div className="feature-media">
            <img src="/samples/connect-hero-1600.webp" alt="" loading="lazy" />
          </div>
          <div className="feature-body">
            <div className="eyebrow">Connect</div>
            <h2 className="display d-2">Introductions between members</h2>
            <p>Members see one another, like, match and talk inside Konnect. Profiles carry phone, ID and income verification where members have completed it.</p>
            <div className="feature-points">
              <div>
                <BadgeCheck /> Verified profiles
              </div>
              <div>
                <MessageCircle /> Messaging opens only after a mutual like
              </div>
              <div>
                <ShieldCheck /> Block, report, meetup sharing and SOS in every conversation
              </div>
              <div>
                <Lock /> Phone numbers and emails are never shown
              </div>
            </div>
            <div className="row g-12 wrap">
              <LinkButton to="/connect" variant="primary" size="lg">
                Open Connect
              </LinkButton>
            </div>
          </div>
        </div>
      </section>

      {ad && (
        <section className="page section-tight">
          <div style={{ maxWidth: 360 }}>
            <PartnerCard ad={ad} />
          </div>
        </section>
      )}

      <section className="page section">
        <div className="row between wrap g-24 reveal" style={{ alignItems: "flex-end" }}>
          <div style={{ maxWidth: 620 }}>
            <div className="eyebrow">Hosting</div>
            <h2 className="display d-3 mt-8">List a stay or a practice</h2>
            <p className="lede mt-12">Guests pay by M-Pesa when they book. As soon as the payment clears, 85% goes to your M-Pesa number; Konnect keeps 15%.</p>
          </div>
          <LinkButton to="/host" variant="ink" size="lg">
            Start hosting
          </LinkButton>
        </div>
      </section>
    </>
  );
}

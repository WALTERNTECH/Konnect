import { BadgeCheck, Ellipsis, Flag, Heart, HeartHandshake, MapPin, MessageCircle, ShieldBan, SlidersHorizontal, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorCode, errorMessage, invalidate, useApi } from "../api/client";
import { ConnectProfileEditor } from "../components/ConnectProfileEditor";
import { Avatar, BackLink, Button, Empty, LinkButton, Menu, Modal, PageHead, Skeleton, Verified } from "../components/ui";
import { onLive, useAuth } from "../context/AuthContext";
import { useToast } from "../context/ui";
import { activeLabel, GENDER, INTENT, ROLE } from "../lib/format";
import type { ConnectCard, ConnectProfile } from "../types";
import { ReportModal } from "./ListingDetail";
import { MEMBERSHIP_INCLUDES, PlanPicker, useJoin } from "./Membership";

// ——— Gate ———

function Paywall() {
  const { me } = useAuth();
  const join = useJoin();
  return (
    <div className="page page-mid section-tight">
      <div className="paywall">
        <div className="paywall-media">
          <img src="/samples/connect-2-1600.webp" alt="" />
        </div>
        <div className="paywall-body">
          <div className="eyebrow">Connect</div>
          <h1 className="display d-2">Introductions between members</h1>
          <p className="soft">Connect is part of Konnect Membership. Members browse one another, like, match and message. Only members can see or be seen.</p>
          <div className="stack g-10">
            {MEMBERSHIP_INCLUDES.map((x) => (
              <div key={x} className="row g-10 small">
                <BadgeCheck size={17} style={{ color: "var(--accent)", flex: "none" }} /> {x}
              </div>
            ))}
          </div>
          {join.plans.data && <PlanPicker value={join.period} onChange={join.setPeriod} plans={join.plans.data.plans} />}
          <Button variant="primary" size="lg" block onClick={join.start}>
            {me ? "Join with M-Pesa" : "Sign in to join"}
          </Button>
          <p className="tiny muted">Konnect is for adults 18 and over. Every member's phone number is confirmed; ID and income badges are added after document review.</p>
        </div>
      </div>
      {join.sheet}
    </div>
  );
}

// ——— Cards ———

function Card({ c, onOpen }: { c: ConnectCard; onOpen?: () => void }) {
  const photo = c.photos[0];
  const body = (
    <>
      {photo ? <img src={photo} alt="" loading="lazy" draggable={false} /> : <span className="ccard-monogram">{c.name[0]}</span>}
      <div className="ccard-top">
        <span className="row g-6">{c.likedYou && <span className="badge badge-glass">Likes you</span>}</span>
        {c.intent === "arrangement" && c.arrangementRole && <span className="badge badge-glass">{ROLE[c.arrangementRole]}</span>}
      </div>
      <div className="ccard-body">
        <div className="ccard-name">
          {c.name}, {c.age} {c.badges.id && <BadgeCheck />}
        </div>
        <div className="ccard-sub">
          {c.neighbourhood ? `${c.neighbourhood}, ` : ""}
          {c.city} · {INTENT[c.intent]}
        </div>
      </div>
    </>
  );
  return onOpen ? (
    <button className="ccard" onClick={onOpen} style={{ textAlign: "left" }}>
      {body}
    </button>
  ) : (
    <Link to={`/connect/${c.userId}`} className="ccard">
      {body}
    </Link>
  );
}

type Filters = { intent: string; role: string; gender: string; ageMin: string; ageMax: string; city: string; verified: boolean };
const NO_FILTERS: Filters = { intent: "", role: "", gender: "", ageMin: "", ageMax: "", city: "", verified: false };
const qsOf = (f: Filters, mode: string) => {
  const p = new URLSearchParams({ mode });
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
  return p.toString();
};

export function MatchFlash({ match, onClose }: { match: { matchId: string; name: string; photo?: string | null } | null; onClose: () => void }) {
  const { me } = useAuth();
  const nav = useNavigate();
  if (!match) return null;
  return (
    <div className="match-flash" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow" style={{ color: "rgba(255,255,255,.6)" }}>
          Connect
        </div>
        <h2 className="display d-2 mt-8">You and {match.name} like each other</h2>
        <div className="pair">
          <Avatar name={me?.fullName ?? ""} src={me?.photoUrl} size={96} />
          <Avatar name={match.name} src={match.photo} size={96} />
        </div>
        <div className="row g-8" style={{ justifyContent: "center" }}>
          <Button variant="on-image" onClick={onClose}>
            Keep browsing
          </Button>
          <Button variant="primary" onClick={() => nav(`/messages/${match.matchId}`)} icon={<MessageCircle />}>
            Send a message
          </Button>
        </div>
      </div>
    </div>
  );
}

function useReact() {
  const toast = useToast();
  const [match, setMatch] = useState<{ matchId: string; name: string; photo?: string | null } | null>(null);
  const react = useCallback(
    async (c: ConnectCard, kind: "like" | "pass") => {
      try {
        const r = await api.post<{ matched: boolean; matchId: string | null }>(`/connect/profiles/${c.userId}/${kind}`);
        if (r.data.matched && r.data.matchId) setMatch({ matchId: r.data.matchId, name: c.name, photo: c.photos[0] });
        void invalidate("/connect/likes", "/connect/matches");
        return true;
      } catch (e) {
        toast(errorCode(e) === "no_profile" ? "Set up your Connect profile first" : errorMessage(e), "error");
        return false;
      }
    },
    [toast],
  );
  return { react, match, setMatch };
}

// ——— Swipe ———

function SwipeDeck({ filters }: { filters: Filters }) {
  const key = `/connect/browse?${qsOf(filters, "swipe")}`;
  const { data, loading, reload } = useApi<{ items: ConnectCard[] }>(key, { staleMs: 0 });
  const [queue, setQueue] = useState<ConnectCard[]>([]);
  const [last, setLast] = useState<ConnectCard | null>(null);
  const { react, match, setMatch } = useReact();
  const card = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; dx: number; dy: number; id: number } | null>(null);
  const nav = useNavigate();

  useEffect(() => setQueue(data?.items ?? []), [data]);

  const fling = async (dir: 1 | -1) => {
    const c = queue[0];
    if (!c) return;
    const el = card.current;
    if (el) {
      el.style.transition = "transform 380ms cubic-bezier(.2,.7,.1,1), opacity 380ms";
      el.style.transform = `translate(${dir * 640}px, -40px) rotate(${dir * 24}deg)`;
      el.style.opacity = "0";
    }
    setTimeout(() => {
      setQueue((q) => q.slice(1));
      setLast(c);
      if (queue.length <= 3) void reload();
    }, 260);
    await react(c, dir === 1 ? "like" : "pass");
  };

  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, dx: 0, dy: 0, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (card.current) card.current.style.transition = "none";
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = card.current;
    if (!d || !el) return;
    d.dx = e.clientX - d.x;
    d.dy = e.clientY - d.y;
    el.style.transform = `translate(${d.dx}px, ${d.dy * 0.3}px) rotate(${d.dx / 18}deg)`;
    const like = el.querySelector<HTMLElement>(".deck-stamp.like");
    const pass = el.querySelector<HTMLElement>(".deck-stamp.pass");
    if (like) like.style.opacity = String(Math.max(0, Math.min(1, d.dx / 110)));
    if (pass) pass.style.opacity = String(Math.max(0, Math.min(1, -d.dx / 110)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    const el = card.current;
    if (!d || !el) return;
    if (Math.abs(d.dx) > 120) return void fling(d.dx > 0 ? 1 : -1);
    el.style.transition = "transform 320ms cubic-bezier(.16,1,.3,1)";
    el.style.transform = "";
    el.querySelectorAll<HTMLElement>(".deck-stamp").forEach((s) => (s.style.opacity = "0"));
    if (Math.abs(d.dx) < 6 && Math.abs(d.dy) < 6 && queue[0]) nav(`/connect/${queue[0].userId}`);
  };

  if (loading) return <Skeleton h={560} r={16} className="deck" />;
  if (!queue.length)
    return (
      <Empty icon={<HeartHandshake />} title="You've seen everyone for now" action={<Button onClick={() => reload()}>Check again</Button>}>
        New members appear here as they join. Widen your filters to see more people.
      </Empty>
    );

  return (
    <div>
      <div className="deck">
        {queue[1] && (
          <div className="deck-card behind" key={queue[1].userId}>
            <Card c={queue[1]} onOpen={() => {}} />
          </div>
        )}
        <div className="deck-card" key={queue[0].userId} ref={card} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <span className="deck-stamp like">Like</span>
          <span className="deck-stamp pass">Pass</span>
          <Card c={queue[0]} onOpen={() => {}} />
        </div>
      </div>
      <div className="deck-actions">
        <button className="round-btn small" onClick={() => last && setQueue((q) => [last, ...q])} disabled={!last} aria-label="Back" title="Show the last profile again">
          <Undo2 />
        </button>
        <button className="round-btn" onClick={() => fling(-1)} aria-label="Pass">
          <X />
        </button>
        <button className="round-btn like" onClick={() => fling(1)} aria-label="Like">
          <Heart />
        </button>
      </div>
      <MatchFlash match={match} onClose={() => setMatch(null)} />
    </div>
  );
}

// ——— Hub ———

export default function Connect() {
  const { me, ready } = useAuth();
  const [tab, setTab] = useState<"discover" | "swipe" | "likes">("discover");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [setup, setSetup] = useState(false);
  const browse = useApi<{ items: ConnectCard[]; hasProfile: boolean }>(me?.premium.active && tab === "discover" ? `/connect/browse?${qsOf(filters, "browse")}` : null);
  const likes = useApi<{ items: ConnectCard[] }>(me?.premium.active && tab === "likes" ? "/connect/likes" : null, { staleMs: 0 });
  useEffect(() => onLive("match", () => void invalidate("/connect")), []);

  if (!ready) return null;
  if (!me?.premium.active) return <Paywall />;

  if (!me.hasConnectProfile || setup)
    return (
      <div className="page page-narrow">
        <PageHead eyebrow="Connect" title={me.hasConnectProfile ? "Your Connect profile" : "Set up your profile"}>
          Members see your first name, age, neighbourhood, photos and what you write here. Your phone number and email are never shown.
        </PageHead>
        <ConnectProfileEditor onSaved={() => setSetup(false)} />
      </div>
    );

  const active = Object.values(filters).filter(Boolean).length;
  return (
    <div className="page">
      <PageHead
        eyebrow="Connect"
        title="Members"
        actions={
          <>
            <Button variant="outline" size="sm" icon={<SlidersHorizontal />} onClick={() => setFilterOpen(true)}>
              Filters{active ? ` · ${active}` : ""}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSetup(true)}>
              Edit my profile
            </Button>
            <LinkButton to="/messages" size="sm" variant="ink" icon={<MessageCircle />}>
              Messages
            </LinkButton>
          </>
        }
      />
      <div className="tabs" role="tablist" style={{ marginBottom: 24 }}>
        {(
          [
            ["discover", "Discover"],
            ["swipe", "One at a time"],
            ["likes", "Likes you"],
          ] as const
        ).map(([k, v]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {v}
          </button>
        ))}
      </div>

      {tab === "swipe" ? (
        <SwipeDeck filters={filters} />
      ) : tab === "discover" ? (
        browse.loading ? (
          <div className="ccards">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} h={0} className="ccard" />
            ))}
          </div>
        ) : (browse.data?.items.length ?? 0) === 0 ? (
          <Empty icon={<HeartHandshake />} title={active ? "No members match these filters" : "No other members yet"} action={active ? <Button onClick={() => setFilters(NO_FILTERS)}>Clear filters</Button> : undefined}>
            {active ? "Try a wider age range or another city." : "Members appear here as they join and set up a profile."}
          </Empty>
        ) : (
          <div className="ccards">
            {browse.data!.items.map((c) => (
              <Card key={c.userId} c={c} />
            ))}
          </div>
        )
      ) : likes.loading ? (
        <Skeleton h={300} />
      ) : (likes.data?.items.length ?? 0) === 0 ? (
        <Empty icon={<Heart />} title="No new likes">
          When someone likes you, they appear here. Like them back to start talking.
        </Empty>
      ) : (
        <div className="ccards">
          {likes.data!.items.map((c) => (
            <Card key={c.userId} c={c} />
          ))}
        </div>
      )}

      <Modal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filters"
        footer={
          <div className="row between">
            <button className="link small" onClick={() => setFilters(NO_FILTERS)}>
              Clear
            </button>
            <Button variant="ink" onClick={() => setFilterOpen(false)}>
              Done
            </Button>
          </div>
        }
      >
        <div className="stack g-20">
          <div className="stack g-8">
            <span className="label">Looking for</span>
            <div className="chips">
              <button className="chip" aria-pressed={!filters.intent} onClick={() => setFilters({ ...filters, intent: "", role: "" })}>
                Anything
              </button>
              {Object.entries(INTENT).map(([k, v]) => (
                <button key={k} className="chip" aria-pressed={filters.intent === k} onClick={() => setFilters({ ...filters, intent: k, role: k === "arrangement" ? filters.role : "" })}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          {filters.intent === "arrangement" && (
            <div className="stack g-8">
              <span className="label">Show</span>
              <div className="chips">
                {Object.entries(ROLE).map(([k, v]) => (
                  <button key={k} className="chip" aria-pressed={filters.role === k} onClick={() => setFilters({ ...filters, role: filters.role === k ? "" : k })}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="stack g-8">
            <span className="label">Gender</span>
            <div className="chips">
              <button className="chip" aria-pressed={!filters.gender} onClick={() => setFilters({ ...filters, gender: "" })}>
                Everyone
              </button>
              {Object.entries(GENDER).map(([k, v]) => (
                <button key={k} className="chip" aria-pressed={filters.gender === k} onClick={() => setFilters({ ...filters, gender: k })}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="stack g-8">
            <span className="label">Age</span>
            <div className="row g-10">
              <select className="select" value={filters.ageMin} onChange={(e) => setFilters({ ...filters, ageMin: e.target.value })} aria-label="From">
                <option value="">18</option>
                {Array.from({ length: 60 }, (_, i) => i + 19).map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
              <span className="muted">to</span>
              <select className="select" value={filters.ageMax} onChange={(e) => setFilters({ ...filters, ageMax: e.target.value })} aria-label="To">
                <option value="">Any</option>
                {Array.from({ length: 60 }, (_, i) => i + 19).map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="stack g-8">
            <span className="label">City</span>
            <select className="select" value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })}>
              <option value="">Anywhere</option>
              {["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Naivasha", "Nanyuki", "Eldoret"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <label className="check">
            <input type="checkbox" checked={filters.verified} onChange={(e) => setFilters({ ...filters, verified: e.target.checked })} /> ID-verified members only
          </label>
        </div>
      </Modal>
    </div>
  );
}

// ——— A member's profile ———

export function ConnectProfileView() {
  const { userId } = useParams();
  const { me } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ profile: ConnectProfile }>(me?.premium.active ? `/connect/profiles/${userId}` : null, { staleMs: 0 });
  const [i, setI] = useState(0);
  const [report, setReport] = useState(false);
  const { react, match, setMatch } = useReact();
  if (!me?.premium.active) return <Paywall />;
  if (loading) return <div className="page section"><Skeleton h={520} r={22} /></div>;
  if (error || !data)
    return (
      <div className="page">
        <Empty icon={<HeartHandshake />} title="This profile isn't available" action={<LinkButton to="/connect">Back to Connect</LinkButton>}>
          The member may have paused their profile.
        </Empty>
      </div>
    );
  const p = data.profile;
  const photos = p.photos;
  const block = async () => {
    if (!confirm(`Block ${p.name}? You won't see each other in Connect, and any conversation ends.`)) return;
    await api.post(`/safety/block/${p.userId}`);
    toast(`${p.name} is blocked`, "ok");
    void invalidate("/connect", "/messages");
    nav("/connect");
  };
  return (
    <div className="page" style={{ paddingTop: 20 }}>
      <div className="row between" style={{ marginBottom: 16 }}>
        <BackLink to="/connect">Connect</BackLink>
        <Menu
          trigger={(_, t) => (
            <button className="icon-btn" onClick={t} aria-label="More">
              <Ellipsis />
            </button>
          )}
        >
          {(close) => (
            <>
              <button
                onClick={() => {
                  close();
                  setReport(true);
                }}
              >
                <Flag /> Report
              </button>
              <button
                className="danger"
                onClick={() => {
                  close();
                  void block();
                }}
              >
                <ShieldBan /> Block
              </button>
            </>
          )}
        </Menu>
      </div>
      <div className="profile-view">
        <div className="photo-stack">
          {photos.length ? <img key={photos[i]} src={photos[i]} alt={p.name} style={{ animation: "fade 300ms both" }} /> : <span className="ccard-monogram">{p.name[0]}</span>}
          {photos.length > 1 && (
            <>
              <div className="bars">
                {photos.map((_, k) => (
                  <span key={k} className={k === i ? "on" : ""} />
                ))}
              </div>
              <button className="tap l" onClick={() => setI((x) => Math.max(0, x - 1))} aria-label="Previous photo" />
              <button className="tap r" onClick={() => setI((x) => Math.min(photos.length - 1, x + 1))} aria-label="Next photo" />
            </>
          )}
        </div>
        <div className="stack g-24">
          <div className="stack g-8">
            <div className="row g-8 wrap">
              {p.online ? <span className="badge badge-ok">Online</span> : <span className="badge">{activeLabel(p.lastSeen)}</span>}
              {p.likedYou && <span className="badge badge-accent">Likes you</span>}
            </div>
            <h1 className="display d-2 row g-10">
              {p.name}, {p.age} {p.badges.id && <Verified />}
            </h1>
            <div className="row g-8 soft">
              <MapPin size={16} /> {p.neighbourhood ? `${p.neighbourhood}, ` : ""}
              {p.city}
              {p.occupation && <span className="muted">· {p.occupation}</span>}
            </div>
          </div>
          {p.headline && <p className="lede">{p.headline}</p>}
          <div className="row g-8 wrap">
            <span className="badge badge-outline">{INTENT[p.intent]}</span>
            {p.arrangementRole && <span className="badge badge-outline">{ROLE[p.arrangementRole]}</span>}
            {p.badges.id && <span className="badge badge-ok">ID verified</span>}
            {p.badges.income && <span className="badge badge-brass">Income verified</span>}
            {p.badges.phone && <span className="badge">Phone confirmed</span>}
          </div>
          {p.bio && (
            <section className="stack g-8">
              <h2 className="h-3">About</h2>
              <p className="soft prewrap">{p.bio}</p>
            </section>
          )}
          {p.interests.length > 0 && (
            <section className="stack g-8">
              <h2 className="h-3">Interests</h2>
              <div className="chips">
                {p.interests.map((x) => (
                  <span key={x} className="chip" style={{ cursor: "default" }}>
                    {x}
                  </span>
                ))}
              </div>
            </section>
          )}
          <div className="row g-10 wrap">
            {p.matchId ? (
              <LinkButton to={`/messages/${p.matchId}`} variant="primary" size="lg" icon={<MessageCircle />}>
                Message {p.name}
              </LinkButton>
            ) : p.liked ? (
              <Button size="lg" disabled icon={<Heart />}>
                You liked {p.name}
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="lg"
                  icon={<Heart />}
                  onClick={async () => {
                    if (await react(p, "like")) void reload();
                  }}
                >
                  Like
                </Button>
                <Button
                  size="lg"
                  icon={<X />}
                  onClick={async () => {
                    if (await react(p, "pass")) nav("/connect");
                  }}
                >
                  Pass
                </Button>
              </>
            )}
          </div>
          <p className="tiny muted">Messaging opens when you both like each other.</p>
        </div>
      </div>
      <ReportModal open={report} onClose={() => setReport(false)} target={{ targetUserId: p.userId }} />
      <MatchFlash
        match={match}
        onClose={() => {
          setMatch(null);
          void reload();
        }}
      />
    </div>
  );
}

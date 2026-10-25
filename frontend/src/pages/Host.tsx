import { BedDouble, CalendarDays, Check, DoorOpen, Flower2, LayoutDashboard, List, Plus, Sparkles, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage, invalidate, useApi } from "../api/client";
import { Calendar } from "../components/Calendar";
import { Availability } from "../components/ListingCard";
import { useMeta } from "../components/SearchPanel";
import { BarChart } from "../components/Chart";
import { PaymentSheet } from "../components/PaymentSheet";
import { Button, Empty, Input, LinkButton, Modal, PageHead, Skeleton, StatusBadge } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ui";
import { addDays, fmtDate, fmtDay, fmtRange, fmtTime, kes, plural, thumb, todayYmd } from "../lib/format";
import type { Booking, ListingCard } from "../types";
import { ListingEditor } from "./ListingEditor";

type HostListing = ListingCard & { bookings: number; rejectionReason: string | null; featuredUntil: string | null; updatedAt: string };

const PAYOUT_LABEL: Record<string, string> = { QUEUED: "Waiting to send", SENDING: "Sending", PAID: "Sent", FAILED: "Retrying", HELD: "Held" };

/** Nairobi wall-clock for a datetime-local input, and back. */
const toLocalInput = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(0, 16);
const fromLocalInput = (v: string) => new Date(`${v}:00+03:00`).toISOString();

function OccupancyModal({ l, onClose, onSaved }: { l: HostListing; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const occupied = l.availability?.status === "occupied";
  const [status, setStatus] = useState<"available" | "occupied">(occupied ? "occupied" : "available");
  const [until, setUntil] = useState(() => (l.availability?.until ? toLocalInput(l.availability.until) : `${addDays(todayYmd(), 1)}T10:00`));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/listings/${l.id}/occupancy`, status === "occupied" ? { status, until: fromLocalInput(until) } : { status });
      toast(status === "occupied" ? "Marked occupied" : "Marked available", "ok");
      onSaved();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={l.title}>
      <div className="stack g-16">
        <div className="segmented" style={{ width: "100%" }}>
          <button type="button" style={{ flex: 1 }} aria-pressed={status === "available"} onClick={() => setStatus("available")}>
            Available
          </button>
          <button type="button" style={{ flex: 1 }} aria-pressed={status === "occupied"} onClick={() => setStatus("occupied")}>
            Occupied
          </button>
        </div>
        {status === "occupied" ? (
          <>
            <Input label="The current guest checks out" type="datetime-local" value={until} min={toLocalInput(new Date().toISOString())} onChange={(e) => setUntil(e.target.value)} hint="Guests see when it's free, and can book from then. It turns back to available by itself after this time." />
          </>
        ) : (
          <p className="small muted">Guests see “Available now” and can book any open night on your calendar.</p>
        )}
        <Button variant="primary" block loading={busy} disabled={status === "occupied" && !until} onClick={save}>
          Save
        </Button>
      </div>
    </Modal>
  );
}

export default function Host() {
  const { me } = useAuth();
  if (!me) return <HostIntro />;
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");
  return (
    <Routes>
      <Route path="listings/new" element={<ListingEditor />} />
      <Route path="listings/:id" element={<ListingEditor />} />
      <Route
        path="*"
        element={
          me.isHost ? (
            <div className="page">
              <PageHead eyebrow="Hosting" title="Your hosting" actions={<LinkButton to="/host/listings/new" variant="primary" icon={<Plus />}>New listing</LinkButton>} />
              <div className="split">
                <nav className="side-nav" aria-label="Hosting">
                  <NavLink to="/host" end className={link}>
                    <LayoutDashboard /> Overview
                  </NavLink>
                  <NavLink to="/host/listings" end className={link}>
                    <List /> Listings
                  </NavLink>
                  <NavLink to="/host/bookings" className={link}>
                    <CalendarDays /> Bookings
                  </NavLink>
                  <NavLink to="/host/payouts" className={link}>
                    <Wallet /> Payouts
                  </NavLink>
                </nav>
                <div style={{ minWidth: 0 }}>
                  <Routes>
                    <Route index element={<Overview />} />
                    <Route path="listings" element={<Listings />} />
                    <Route path="bookings" element={<Bookings />} />
                    <Route path="payouts" element={<Payouts />} />
                    <Route path="calendar/:id" element={<HostCalendar />} />
                    <Route path="*" element={<Navigate to="/host" replace />} />
                  </Routes>
                </div>
              </div>
            </div>
          ) : (
            <HostIntro />
          )
        }
      />
    </Routes>
  );
}

function HostIntro() {
  const { me } = useAuth();
  const steps = [
    ["Create the listing", "Photos, a description, your price, and your calendar or hours."],
    ["Konnect reviews it", "Usually within a day. You'll get a message when it's live."],
    ["Guests book and pay", "Payment is taken by M-Pesa when they book, before they arrive."],
    ["85% goes to your M-Pesa", "Straight away, to the payout number on your account. Konnect keeps 15%."],
  ];
  return (
    <div className="page page-mid">
      <PageHead eyebrow="Hosting" title="Host a stay or offer a treatment">
        For apartment and villa hosts, and for massage therapists, physiotherapists and beauty practitioners. Listing is free. When a guest pays, 85% is sent to your M-Pesa and Konnect keeps 15%.
      </PageHead>
      <div className="grid-cards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <Link to={me ? "/host/listings/new?type=STAY" : "/login?next=/host/listings/new?type=STAY"} className="card card-pad stack g-12" style={{ minHeight: 200 }}>
          <BedDouble size={26} style={{ color: "var(--accent)" }} />
          <span className="display d-4">List a stay</span>
          <span className="soft small">An apartment, a cottage, a villa or a room, with your own calendar and nightly price.</span>
        </Link>
        <Link to={me ? "/host/listings/new?type=WELLNESS" : "/login?next=/host/listings/new?type=WELLNESS"} className="card card-pad stack g-12" style={{ minHeight: 200 }}>
          <Flower2 size={26} style={{ color: "var(--accent)" }} />
          <span className="display d-4">Offer a treatment</span>
          <span className="soft small">Massage, physiotherapy, beauty or spa sessions, at your studio or at clients' homes.</span>
        </Link>
      </div>
      <section className="section">
        <h2 className="h-1" style={{ marginBottom: 20 }}>
          How it works
        </h2>
        <div className="grid-stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
          {steps.map(([t, d], i) => (
            <div key={t} className="stat">
              <span className="value" style={{ fontSize: 26 }}>
                {i + 1}
              </span>
              <span className="strong">{t}</span>
              <span className="small muted">{d}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const MONTH = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-KE", { month: "short", timeZone: "UTC" });

function Overview() {
  const { data, loading } = useApi<{ totals: Record<string, number>; months: { month: string; earned: number; bookings: number }[]; upcoming: Booking[] }>("/host/overview", { staleMs: 0 });
  const series = useMemo(() => {
    const out: { label: string; value: number }[] = [];
    const now = new Date(Date.now() + 3 * 3_600_000);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const ym = d.toISOString().slice(0, 7);
      out.push({ label: MONTH(ym), value: data?.months.find((m) => m.month === ym)?.earned ?? 0 });
    }
    return out;
  }, [data]);
  if (loading || !data) return <Skeleton h={320} r={16} />;
  const t = data.totals;
  return (
    <div className="stack g-24">
      <div className="grid-stats">
        <div className="stat">
          <span className="label">Paid out</span>
          <span className="value">{kes(t.paid)}</span>
        </div>
        <div className="stat">
          <span className="label">On the way</span>
          <span className="value">{kes(t.scheduled)}</span>
          {t.held > 0 && <span className="delta">{kes(t.held)} held</span>}
        </div>
        <div className="stat">
          <span className="label">Upcoming bookings</span>
          <span className="value">{t.upcoming}</span>
        </div>
        <div className="stat">
          <span className="label">Rating</span>
          <span className="value">{t.rating ? t.rating.toFixed(2) : "—"}</span>
          <span className="delta">{plural(t.completed, "completed booking")}</span>
        </div>
      </div>
      <section className="card card-pad stack g-12">
        <div className="row between">
          <h2 className="h-2">Earnings, last 12 months</h2>
          <span className="small muted">Your 85%</span>
        </div>
        <BarChart data={series} format={(n) => kes(n)} />
      </section>
      <section className="card card-pad stack g-12">
        <div className="row between">
          <h2 className="h-2">Next up</h2>
          <Link to="/host/bookings" className="small link">
            All bookings
          </Link>
        </div>
        {data.upcoming.length === 0 ? <p className="small muted">No upcoming bookings.</p> : <BookingRows items={data.upcoming} />}
      </section>
      {t.in_review > 0 && <div className="notice notice-warn">{plural(t.in_review, "listing")} in review. You'll get a message when it's live.</div>}
    </div>
  );
}

function BookingRows({ items }: { items: Booking[] }) {
  return (
    <div className="list">
      {items.map((b) => (
        <div key={b.id} className="list-row">
          <div className="grow stack g-4" style={{ minWidth: 0 }}>
            <span className="strong">
              {b.counterpart.name} · {b.listing.title}
            </span>
            <span className="small muted">
              {b.kind === "STAY" ? `${fmtRange(b.checkIn!, b.checkOut!)} · ${plural(b.guests, "guest")}` : `${fmtDay(b.startsAt!.slice(0, 10), { weekday: "short", day: "numeric", month: "short" })} at ${fmtTime(b.startsAt!)} · ${b.serviceMode === "home" ? "Home visit" : "Studio"}`}
              {" · "}
              {b.ref}
            </span>
            {b.visitAddress && <span className="small soft">{b.visitAddress}</span>}
          </div>
          <div className="stack g-4" style={{ alignItems: "flex-end" }}>
            <StatusBadge status={b.status} />
            {b.payout && (
              <span className="small num">
                {kes(b.payout.amount)} to you · <span className={b.payout.status === "PAID" ? "accent-text" : "muted"}>{PAYOUT_LABEL[b.payout.status]}</span>
              </span>
            )}
            {b.counterpart.phone && (
              <a className="small link num" href={`tel:${b.counterpart.phone}`}>
                {b.counterpart.phone.replace(/^\+254/, "0")}
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Listings() {
  const { data, loading, reload } = useApi<{ items: HostListing[] }>("/host/listings", { staleMs: 0 });
  const toast = useToast();
  const [promote, setPromote] = useState<HostListing | null>(null);
  const [weeks, setWeeks] = useState(1);
  const [paying, setPaying] = useState(false);
  const [occupancy, setOccupancy] = useState<HostListing | null>(null);
  const week = useMeta().data?.promotionWeekKes ?? 1000;
  if (loading) return <Skeleton h={260} r={16} />;
  if (!data?.items.length)
    return (
      <Empty icon={<List />} title="No listings yet" action={<LinkButton to="/host/listings/new" variant="primary">Create a listing</LinkButton>}>
        Create your first stay or treatment.
      </Empty>
    );
  const act = async (l: HostListing, a: "pause" | "resume" | "submit") => {
    try {
      await api.post(`/listings/${l.id}/${a}`);
      await reload();
      toast(a === "submit" ? "Sent for review" : a === "pause" ? "Paused" : "Live again", "ok");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  return (
    <div className="stack g-12">
      {data.items.map((l) => (
        <div key={l.id} className="trip" style={{ gridTemplateColumns: "120px 1fr auto" }}>
          <div className="thumb">{l.photos[0] && <img src={thumb(l.photos[0])} alt="" />}</div>
          <div className="stack g-4" style={{ minWidth: 0 }}>
            <div className="row g-8 wrap">
              <StatusBadge status={l.status} />
              {l.featured && <span className="badge badge-brass">Featured until {fmtDate(l.featuredUntil!)}</span>}
              {l.sample && <span className="badge">Sample</span>}
            </div>
            <Link to={`/host/listings/${l.id}`} className="h-2">
              {l.title}
            </Link>
            <span className="small muted">
              {l.neighbourhood}, {l.city} · {kes(l.priceKes)} / {l.unit} · {plural(l.bookings, "booking")}
            </span>
            <Availability a={l.availability} />
            {l.status === "REJECTED" && l.rejectionReason && <span className="small" style={{ color: "var(--danger)" }}>{l.rejectionReason}</span>}
          </div>
          <div className="row g-6 wrap" style={{ justifyContent: "flex-end" }}>
            {l.type === "STAY" && (
              <>
                <Button size="sm" variant={l.availability?.status === "occupied" ? "primary" : "outline"} icon={<DoorOpen />} onClick={() => setOccupancy(l)}>
                  {l.availability?.status === "occupied" ? "Occupied" : "Available"}
                </Button>
                <LinkButton size="sm" to={`/host/calendar/${l.id}`} icon={<CalendarDays />}>
                  Calendar
                </LinkButton>
              </>
            )}
            {(l.status === "DRAFT" || l.status === "REJECTED") && (
              <Button size="sm" variant="primary" onClick={() => act(l, "submit")}>
                Submit
              </Button>
            )}
            {l.status === "APPROVED" && (
              <>
                <Button size="sm" icon={<Sparkles />} onClick={() => setPromote(l)}>
                  Feature
                </Button>
                <Button size="sm" variant="ghost" onClick={() => act(l, "pause")}>
                  Pause
                </Button>
              </>
            )}
            {l.status === "PAUSED" && (
              <Button size="sm" onClick={() => act(l, "resume")}>
                Resume
              </Button>
            )}
            <LinkButton size="sm" variant="ghost" to={`/host/listings/${l.id}`}>
              Edit
            </LinkButton>
          </div>
        </div>
      ))}
      {occupancy && (
        <OccupancyModal
          l={occupancy}
          onClose={() => setOccupancy(null)}
          onSaved={() => {
            setOccupancy(null);
            void reload();
            void invalidate("/listings");
          }}
        />
      )}
      <Modal open={Boolean(promote) && !paying} onClose={() => setPromote(null)} title="Feature this listing">
        <div className="stack g-16">
          <p className="soft">Featured listings appear first in search and on the home page, marked “Featured”.</p>
          <div className="chips">
            {[1, 2, 4].map((w) => (
              <button key={w} className="chip" aria-pressed={weeks === w} onClick={() => setWeeks(w)}>
                {plural(w, "week")} · {kes(week * w)}
              </button>
            ))}
          </div>
          <Button variant="primary" block onClick={() => setPaying(true)}>
            Continue
          </Button>
        </div>
      </Modal>
      {promote && (
        <PaymentSheet
          open={paying}
          onClose={() => {
            setPaying(false);
            setPromote(null);
            void reload();
          }}
          title={`Feature for ${plural(weeks, "week")}`}
          amount={week * weeks}
          start={async (phone) => (await api.post(`/listings/${promote.id}/promote`, { weeks, phone })).data}
          onPaid={() => void invalidate("/listings")}
        />
      )}
    </div>
  );
}

function Bookings() {
  const [status, setStatus] = useState<"upcoming" | "past" | "cancelled">("upcoming");
  const { data, loading } = useApi<{ items: Booking[] }>(`/host/bookings?status=${status}`, { staleMs: 0 });
  return (
    <div className="stack g-16">
      <div className="tabs" role="tablist">
        {(["upcoming", "past", "cancelled"] as const).map((s) => (
          <button key={s} role="tab" aria-selected={status === s} onClick={() => setStatus(s)}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {loading ? <Skeleton h={200} /> : (data?.items.length ?? 0) === 0 ? <Empty icon={<CalendarDays />} title={`No ${status} bookings`} /> : <BookingRows items={data!.items} />}
    </div>
  );
}

function Payouts() {
  const { data, loading } = useApi<{
    items: { id: string; amount_kes: number; gross_kes: number | null; commission_kes: number | null; status: string; created_at: string; paid_at: string | null; reference: string | null; booking_ref: string; title: string; phone: string }[];
  }>("/host/payouts", { staleMs: 0 });
  if (loading) return <Skeleton h={200} />;
  if (!data?.items.length) return <Empty icon={<Wallet />} title="No payouts yet">When a guest pays, your 85% is sent straight to your M-Pesa and listed here.</Empty>;
  return (
    <div className="card card-pad">
      <div className="list">
        {data.items.map((p) => (
          <div key={p.id} className="list-row">
            <div className="grow stack g-4">
              <span className="strong">{p.title}</span>
              <span className="small muted">
                {p.booking_ref} · {p.status === "PAID" ? `Sent ${fmtDate(p.paid_at!)}${p.reference ? ` · ${p.reference}` : ""}` : p.status === "HELD" ? "Held: booking cancelled" : fmtDate(p.created_at)} · to {p.phone.replace(/^\+254/, "0")}
                {p.gross_kes ? ` · ${kes(p.gross_kes)} paid, ${kes(p.commission_kes ?? 0)} to Konnect` : ""}
              </span>
            </div>
            <div className="stack g-4" style={{ alignItems: "flex-end" }}>
              <span className="num strong">{kes(p.amount_kes)}</span>
              <span className={`badge ${p.status === "PAID" ? "badge-ok" : p.status === "HELD" ? "badge-danger" : "badge-warn"}`}>{PAYOUT_LABEL[p.status] ?? p.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HostCalendar() {
  const { id } = useParams();
  const toast = useToast();
  const nav = useNavigate();
  const [month, setMonth] = useState(() => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7));
  const next = (() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  })();
  const a = useApi<{ blocked: string[]; bookings: { ref: string; check_in: string; check_out: string; guest: string }[] }>(`/host/calendar/${id}?month=${month}`, { staleMs: 0 });
  const b = useApi<{ blocked: string[]; bookings: { ref: string; check_in: string; check_out: string; guest: string }[] }>(`/host/calendar/${id}?month=${next}`, { staleMs: 0 });
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const blocked = useMemo(() => {
    const s = new Set([...(a.data?.blocked ?? []), ...(b.data?.blocked ?? [])]);
    for (const [d, on] of Object.entries(pending)) on ? s.add(d) : s.delete(d);
    return s;
  }, [a.data, b.data, pending]);
  const booked = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of [...(a.data?.bookings ?? []), ...(b.data?.bookings ?? [])]) {
      if (!x.check_in) continue;
      for (let d = x.check_in; d < x.check_out; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) m.set(d, `${x.guest} · ${x.ref}`);
    }
    return m;
  }, [a.data, b.data]);
  const dirty = Object.keys(pending).length > 0;
  const save = async () => {
    const add = Object.entries(pending).filter(([, v]) => v).map(([d]) => d);
    const remove = Object.entries(pending).filter(([, v]) => !v).map(([d]) => d);
    try {
      await api.put(`/listings/${id}/blocks`, { add, remove });
      setPending({});
      await Promise.all([a.reload(), b.reload()]);
      toast("Calendar saved", "ok");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  return (
    <div className="stack g-16">
      <div className="row between wrap g-12">
        <button className="back-link" onClick={() => nav("/host/listings")}>
          ← Listings
        </button>
        <div className="row g-12 small muted">
          <span className="row g-6">
            <span className="cal-day booked-host" style={{ width: 18, height: 18, minHeight: 0 }} /> Booked
          </span>
          <span className="row g-6">
            <span className="cal-day blocked-host" style={{ width: 18, height: 18, minHeight: 0 }} /> Closed
          </span>
        </div>
      </div>
      <div className="card card-pad">
        <Calendar mode="host" month={month} onMonth={setMonth} blocked={blocked} booked={booked} onToggle={(d) => setPending((p) => ({ ...p, [d]: !blocked.has(d) }))} />
      </div>
      <div className="row g-8">
        <Button variant="primary" disabled={!dirty} onClick={save} icon={<Check />}>
          Save changes
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setPending({})}>
            Discard
          </Button>
        )}
        <span className="small muted">Tap a night to close or reopen it.</span>
      </div>
    </div>
  );
}

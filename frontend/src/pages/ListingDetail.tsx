import {
  AirVent,
  Bath,
  Bed,
  Briefcase,
  Building2,
  Car,
  Clock,
  CookingPot,
  Dumbbell,
  Fence,
  Flag,
  House,
  MapPin,
  ShieldCheck,
  ShowerHead,
  Star,
  Store,
  Sunset,
  Trees,
  Tv,
  Users,
  WashingMachine,
  Waves,
  Wifi,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api, errorCode, errorMessage, useApi } from "../api/client";
import { Calendar } from "../components/Calendar";
import { Gallery } from "../components/Gallery";
import { Availability } from "../components/ListingCard";
import { PaymentSheet } from "../components/PaymentSheet";
import { Avatar, BackLink, Button, Empty, Modal, Select, Skeleton, Textarea, Verified } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ui";
import { useSite } from "../lib/site";
import { addDays, CATEGORY, daysBetween, fmtDay, fmtMonthYear, fmtRange, fmtTime, kes, plural, todayYmd } from "../lib/format";
import type { Booking, Host, ListingDetail as L, Review } from "../types";

const AMENITY_ICON: Record<string, ReactNode> = {
  "Wi-Fi": <Wifi />, Workspace: <Briefcase />, Kitchen: <CookingPot />, Parking: <Car />, Pool: <Waves />, Gym: <Dumbbell />, "Backup power": <Zap />,
  "Hot shower": <ShowerHead />, Washer: <WashingMachine />, "Air conditioning": <AirVent />, Balcony: <Fence />, Garden: <Trees />, Security: <ShieldCheck />,
  "Smart TV": <Tv />, "Ocean view": <Sunset />, "City view": <Building2 />,
};
const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Data = { listing: L; host: Host; reviews: Review[] };

export default function ListingDetail() {
  const { id } = useParams();
  const { data, error, loading } = useApi<Data>(`/listings/${id}`);
  if (loading)
    return (
      <div className="page" style={{ paddingTop: 24 }}>
        <Skeleton h={420} r={22} />
        <div className="stack g-12 mt-24">
          <Skeleton h={36} w="50%" />
          <Skeleton h={16} w="30%" />
        </div>
      </div>
    );
  if (error || !data)
    return (
      <div className="page">
        <Empty icon={<House />} title="This listing isn't available" action={<Link className="btn btn-outline" to="/stays">Browse stays</Link>}>
          It may have been paused by its host or removed.
        </Empty>
      </div>
    );
  return <Detail data={data} />;
}

function Detail({ data }: { data: Data }) {
  const { listing: l, host, reviews } = data;
  const [reportOpen, setReportOpen] = useState(false);
  const stay = l.type === "STAY";
  return (
    <div className="page" style={{ paddingTop: 20 }}>
      <div className="row between" style={{ marginBottom: 14 }}>
        <BackLink to={stay ? "/stays" : "/wellness"}>{stay ? "Stays" : "Wellness"}</BackLink>
        {l.mine && (
          <Link to={`/host/listings/${l.id}`} className="btn btn-sm btn-outline">
            Edit listing
          </Link>
        )}
      </div>
      <Gallery photos={l.photos} title={l.title} />

      <div className="detail mt-32">
        <div className="stack g-32">
          <div className="stack g-12">
            <div className="row g-8 wrap">
              {l.sample && <span className="badge">Sample listing</span>}
              {l.featured && <span className="badge badge-brass">Featured</span>}
              {!stay && <span className="badge">{CATEGORY[l.category ?? ""]}</span>}
              {l.mine && l.status !== "APPROVED" && <span className="badge badge-warn">Only you can see this · {l.status.toLowerCase()}</span>}
            </div>
            <h1 className="display d-2">{l.title}</h1>
            <div className="detail-facts">
              <span>
                <MapPin /> {l.neighbourhood}, {l.city}
              </span>
              {l.reviews > 0 ? (
                <span>
                  <Star /> {l.rating.toFixed(2)} · {plural(l.reviews, "review")}
                </span>
              ) : (
                <span>
                  <Star /> New
                </span>
              )}
              {stay ? (
                <>
                  <span>
                    <Users /> {plural(l.maxGuests ?? 1, "guest")}
                  </span>
                  <span>
                    <Bed /> {l.bedrooms === 0 ? "Studio" : plural(l.bedrooms ?? 1, "bedroom")}
                  </span>
                  <span>
                    <Bath /> {plural(l.bathrooms ?? 1, "bathroom")}
                  </span>
                </>
              ) : (
                <>
                  <span>
                    <Clock /> {l.durationMin} minutes
                  </span>
                  <span>
                    {l.serviceModes.includes("home") ? <House /> : <Store />}
                    {l.serviceModes.length === 2 ? "Studio or home visit" : l.serviceModes[0] === "home" ? "Home visits" : "At the studio"}
                  </span>
                </>
              )}
            </div>
          </div>

          {stay && l.availability && (
            <div className={`notice ${l.availability.status === "available" ? "notice-ok" : "notice-warn"}`}>
              <Availability a={l.availability} long />
            </div>
          )}

          <hr className="rule" />

          <div className="host-card">
            <Avatar name={host.name} src={host.photoUrl} size={56} />
            <div className="stack g-4">
              <div className="h-2 row g-6">
                {stay ? "Hosted by" : "With"} {host.name} {host.badges.id && <Verified />}
              </div>
              <div className="small muted">
                {host.level} · on Konnect since {fmtMonthYear(host.since)}
                {host.badges.background ? " · Background checked" : ""}
              </div>
            </div>
          </div>

          {l.summary && <p className="lede">{l.summary}</p>}
          {l.description && <p className="prewrap soft">{l.description}</p>}

          {stay && l.amenities.length > 0 && (
            <section className="stack g-16">
              <h2 className="h-1">What's there</h2>
              <div className="amenities">
                {l.amenities.map((a) => (
                  <div key={a}>
                    {AMENITY_ICON[a] ?? <ShieldCheck />} {a}
                  </div>
                ))}
              </div>
            </section>
          )}

          {stay ? (
            <section className="stack g-12">
              <h2 className="h-1">Good to know</h2>
              <dl className="kv" style={{ maxWidth: 440 }}>
                {l.checkInTime && (
                  <>
                    <dt>Check-in</dt>
                    <dd>From {l.checkInTime}</dd>
                  </>
                )}
                {l.checkOutTime && (
                  <>
                    <dt>Check-out</dt>
                    <dd>By {l.checkOutTime}</dd>
                  </>
                )}
                <dt>Minimum stay</dt>
                <dd>{plural(l.minNights, "night")}</dd>
                <dt>Cancellation</dt>
                <dd>Free up to 48 hours before check-in</dd>
              </dl>
              {l.houseRules && <p className="small soft prewrap">{l.houseRules}</p>}
            </section>
          ) : (
            l.hours && (
              <section className="stack g-12">
                <h2 className="h-1">Hours</h2>
                <dl className="kv" style={{ maxWidth: 360 }}>
                  {Object.entries(l.hours)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([d, [o, c]]) => (
                      <FragmentKV key={d} k={DAY_NAMES[Number(d)]} v={`${o} – ${c}`} />
                    ))}
                </dl>
                {l.depositPct ? <p className="small muted">A {l.depositPct}% deposit holds the booking; the balance is paid to the practitioner at the session.</p> : null}
              </section>
            )
          )}

          <section className="stack g-20">
            <h2 className="h-1">{l.reviews > 0 ? `${l.rating.toFixed(2)} · ${plural(l.reviews, "review")}` : "Reviews"}</h2>
            {reviews.length === 0 ? (
              <p className="muted">No reviews yet. Guests can review after their stay or session.</p>
            ) : (
              <div className="reviews-grid">
                {reviews.map((r) => (
                  <div key={r.id} className="review">
                    <div className="head">
                      <Avatar name={r.author} src={r.author_photo} size={40} />
                      <div>
                        <div className="strong">{r.author}</div>
                        <div className="tiny muted">{fmtMonthYear(r.created_at)}</div>
                      </div>
                    </div>
                    <div className="row g-4" aria-label={`${r.rating} stars`}>
                      {Array.from({ length: 5 }, (_, k) => (
                        <Star key={k} size={13} fill={k < r.rating ? "currentColor" : "none"} />
                      ))}
                    </div>
                    {r.body && <p className="soft">{r.body}</p>}
                    {r.host_reply && <div className="reply">Reply from {host.name}: {r.host_reply}</div>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {!l.mine && (
            <button className="row g-8 small muted" onClick={() => setReportOpen(true)} style={{ alignSelf: "flex-start" }}>
              <Flag size={15} /> Report this listing
            </button>
          )}
        </div>

        <BookingPanel l={l} />
      </div>
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} target={{ targetListingId: l.id }} />
    </div>
  );
}

const FragmentKV = ({ k, v }: { k: string; v: string }) => (
  <>
    <dt>{k}</dt>
    <dd>{v}</dd>
  </>
);

function BookingPanel({ l }: { l: L }) {
  const { me } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const stay = l.type === "STAY";
  const [range, setRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [guests, setGuests] = useState(1);
  const [day, setDay] = useState<string>(todayYmd());
  const [slot, setSlot] = useState<string | null>(null);
  const [mode, setMode] = useState<"studio" | "home">(l.serviceModes[0] ?? "studio");
  const [address, setAddress] = useState("");
  const [payMode, setPayMode] = useState<"full" | "deposit">("full");
  const [calOpen, setCalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);

  const avail = useApi<{ unavailable: string[] }>(stay ? `/listings/${l.id}/availability?from=${todayYmd()}&to=${addDays(todayYmd(), 365)}` : null);
  const unavailable = useMemo(() => new Set(avail.data?.unavailable ?? []), [avail.data]);
  const slots = useApi<{ slots: string[] }>(!stay ? `/listings/${l.id}/slots?date=${day}` : null, { staleMs: 30_000 });
  useEffect(() => setSlot(null), [day]);

  const nights = range.start && range.end ? daysBetween(range.start, range.end) : 0;
  const subtotal = stay ? l.priceKes * nights : l.priceKes;
  const deposit = !stay && payMode === "deposit" && l.depositPct ? Math.ceil((l.priceKes * l.depositPct) / 100) : subtotal;
  const ready = stay ? nights > 0 : Boolean(slot) && (mode !== "home" || address.trim().length >= 6);
  const site = useSite();

  const reserve = async () => {
    setErr(null);
    if (!me) return nav(`/login?next=${encodeURIComponent(loc.pathname)}`);
    if (me.phoneVerificationRequired && !me.phoneVerified) return nav(`/verify-phone?next=${encodeURIComponent(loc.pathname)}`);
    if (!ready) return stay ? setCalOpen(true) : setErr(slot ? "Add the address for the home visit" : "Choose a time");
    setBusy(true);
    try {
      const body = stay
        ? { listingId: l.id, checkIn: range.start, checkOut: range.end, guests }
        : { listingId: l.id, startsAt: slot, serviceMode: mode, visitAddress: mode === "home" ? address : undefined, payMode };
      const r = await api.post<{ booking: Booking }>("/bookings", body);
      setBooking(r.data.booking);
    } catch (e) {
      setErr(errorMessage(e));
      if (errorCode(e) === "dates_unavailable" || errorCode(e) === "slot_unavailable") {
        void avail.reload();
        void slots.reload();
      }
    } finally {
      setBusy(false);
    }
  };

  const days = Array.from({ length: 14 }, (_, i) => addDays(todayYmd(), i));
  const breakdown = (
    <dl className="kv">
      <dt>{stay ? `${kes(l.priceKes)} × ${plural(nights, "night")}` : `${l.durationMin}-minute session`}</dt>
      <dd>{kes(subtotal)}</dd>
      {!stay && deposit < subtotal && (
        <>
          <dt>Paid at the session</dt>
          <dd>− {kes(subtotal - deposit)}</dd>
        </>
      )}
      <dt className="total">{!stay && deposit < subtotal ? "Due now" : "Total"}</dt>
      <dd className="total">{kes(deposit)}</dd>
    </dl>
  );

  const panel = (
    <>
      <div className="book-price">
        <span className="amount">{kes(l.priceKes)}</span>
        <span className="muted">/ {stay ? "night" : "session"}</span>
      </div>
      {stay ? (
        <div className="book-fields">
          <button type="button" onClick={() => setCalOpen(true)}>
            <span className="k">Check-in</span>
            <span className={`v ${range.start ? "" : "muted"}`}>{range.start ? fmtDay(range.start, { weekday: "short", day: "numeric", month: "short" }) : "Add date"}</span>
          </button>
          <button type="button" onClick={() => setCalOpen(true)}>
            <span className="k">Check-out</span>
            <span className={`v ${range.end ? "" : "muted"}`}>{range.end ? fmtDay(range.end, { weekday: "short", day: "numeric", month: "short" }) : "Add date"}</span>
          </button>
          <label className="full">
            <span className="k">Guests</span>
            <select value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
              {Array.from({ length: l.maxGuests ?? 1 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {plural(i + 1, "guest")}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className="stack g-14" style={{ gap: 14 }}>
          {l.serviceModes.length > 1 && (
            <div className="segmented" style={{ width: "100%" }}>
              {l.serviceModes.map((m) => (
                <button key={m} type="button" style={{ flex: 1 }} aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {m === "home" ? "Home visit" : "At the studio"}
                </button>
              ))}
            </div>
          )}
          <div className="days-strip">
            {days.map((d) => (
              <button key={d} type="button" className="day-pill" aria-pressed={d === day} onClick={() => setDay(d)}>
                <span className="dow">{fmtDay(d, { weekday: "short" })}</span>
                <span className="d">{Number(d.slice(8))}</span>
              </button>
            ))}
          </div>
          {slots.loading ? (
            <Skeleton h={88} />
          ) : (slots.data?.slots.length ?? 0) === 0 ? (
            <p className="small muted">No times left on {fmtDay(day, { weekday: "long", day: "numeric", month: "long" })}.</p>
          ) : (
            <div className="slots">
              {slots.data!.slots.map((s) => (
                <button key={s} type="button" className="slot" aria-pressed={slot === s} onClick={() => setSlot(s)}>
                  {fmtTime(s)}
                </button>
              ))}
            </div>
          )}
          {mode === "home" && <Textarea label="Address for the visit" rows={2} style={{ minHeight: 70 }} value={address} onChange={(e) => setAddress(e.target.value)} hint="Shared with the practitioner once the booking is paid." />}
          {l.depositPct ? (
            <Select label="Payment" value={payMode} onChange={(e) => setPayMode(e.target.value as "full" | "deposit")}>
              <option value="full">Pay in full now</option>
              <option value="deposit">Pay a {l.depositPct}% deposit now</option>
            </Select>
          ) : null}
        </div>
      )}
      {err && <div className="notice notice-danger small">{err}</div>}
      <Button variant="primary" size="lg" block loading={busy} onClick={reserve} disabled={l.mine || !site.bookingsOpen}>
        {l.mine ? "This is your listing" : !site.bookingsOpen ? "Bookings are paused for now" : stay ? (nights ? "Reserve" : "Check availability") : "Book"}
      </Button>
      {(stay ? nights > 0 : Boolean(slot)) && breakdown}
      <p className="tiny muted center">Paid by M-Pesa. You won't be charged until you enter your PIN.</p>
    </>
  );

  return (
    <>
      <aside className="book-panel desktop">{panel}</aside>
      <div className="book-bar">
        <div className="stack">
          <span className="strong num">
            {kes(l.priceKes)} <span className="muted" style={{ fontWeight: 400 }}>/ {stay ? "night" : "session"}</span>
          </span>
          {stay && range.start && range.end && <span className="tiny muted">{fmtRange(range.start, range.end)}</span>}
        </div>
        <MobileBook panel={panel} />
      </div>

      <Modal open={calOpen} onClose={() => setCalOpen(false)} title={nights ? plural(nights, "night") : "Choose dates"} wide>
        <Calendar mode="range" start={range.start} end={range.end} unavailable={unavailable} minNights={l.minNights} onChange={(s, e) => setRange({ start: s, end: e })} />
        <div className="row between mt-16">
          <button className="link small" onClick={() => setRange({ start: null, end: null })}>
            Clear dates
          </button>
          <Button variant="ink" onClick={() => setCalOpen(false)} disabled={!nights}>
            {nights ? `Continue · ${kes(subtotal)}` : "Continue"}
          </Button>
        </div>
      </Modal>

      {booking && (
        <PaymentSheet
          open
          onClose={() => {
            const b = booking;
            setBooking(null);
            if (b) nav(`/trips/${b.id}`);
          }}
          title={stay ? "Confirm and pay" : "Confirm your booking"}
          amount={booking.price.dueNow}
          summary={
            <div className="row g-12">
              <div style={{ width: 72, aspectRatio: "4/3", borderRadius: 10, overflow: "hidden", flex: "none", background: "var(--surface-2)" }}>
                {l.photos[0] && <img src={l.photos[0].replace(/-1600\.webp$/, "-720.webp")} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              </div>
              <div className="stack g-4">
                <span className="strong">{l.title}</span>
                <span className="small muted">
                  {stay && booking.checkIn && booking.checkOut ? `${fmtRange(booking.checkIn, booking.checkOut)} · ${plural(booking.guests, "guest")}` : booking.startsAt ? `${fmtDay(booking.startsAt.slice(0, 10), { weekday: "short", day: "numeric", month: "short" })} at ${fmtTime(booking.startsAt)}` : ""}
                </span>
                <span className="tiny muted">Ref {booking.ref} · held for 30 minutes</span>
              </div>
            </div>
          }
          start={async (phone) => (await api.post("/mpesa/stk-push", { purpose: "BOOKING", refId: booking.id, phone })).data}
          onPaid={() => toast("Booking confirmed", "ok")}
          doneLabel="View booking"
        />
      )}
    </>
  );
}

function MobileBook({ panel }: { panel: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Book
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Book">
        <div className="stack g-16">{panel}</div>
      </Modal>
    </>
  );
}

export function ReportModal({ open, onClose, target }: { open: boolean; onClose: () => void; target: { targetUserId?: string; targetListingId?: string } }) {
  const toast = useToast();
  const [reason, setReason] = useState("misleading_listing");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setReason(target.targetListingId ? "misleading_listing" : "fake_profile");
      setDetails("");
    }
  }, [open, target.targetListingId]);
  const reasons = target.targetListingId
    ? { misleading_listing: "The listing is misleading", scam: "It looks like a scam", inappropriate: "Inappropriate content", safety: "A safety concern", other: "Something else" }
    : { fake_profile: "Fake profile", harassment: "Harassment", scam: "Scam or asking for money", inappropriate: "Inappropriate photos or messages", underage: "May be under 18", safety: "I feel unsafe", other: "Something else" };
  const send = async () => {
    setBusy(true);
    try {
      await api.post("/safety/report", { ...target, reason, details });
      toast("Report sent to the safety team", "ok");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Report">
      <div className="stack g-16">
        <div className="stack g-8">
          {Object.entries(reasons).map(([k, v]) => (
            <label key={k} className="check">
              <input type="radio" name="reason" checked={reason === k} onChange={() => setReason(k)} style={{ borderRadius: 99 }} /> {v}
            </label>
          ))}
        </div>
        <Textarea label="What happened" value={details} onChange={(e) => setDetails(e.target.value)} rows={3} hint="The safety team reads every report. The other person isn't told who reported them." />
        <Button variant="ink" block loading={busy} onClick={send}>
          Send report
        </Button>
      </div>
    </Modal>
  );
}

import { CalendarDays, Phone, Star } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, errorMessage, invalidate, useApi } from "../api/client";
import { PaymentSheet } from "../components/PaymentSheet";
import { BackLink, Button, Empty, LinkButton, Modal, PageHead, Skeleton, StatusBadge, Textarea } from "../components/ui";
import { useToast } from "../context/ui";
import { CATEGORY, fmtDate, fmtDay, fmtDayLong, fmtRange, fmtTime, kes, plural, thumb } from "../lib/format";
import type { Booking } from "../types";

const when = (b: Booking) =>
  b.kind === "STAY" && b.checkIn && b.checkOut ? `${fmtRange(b.checkIn, b.checkOut)} · ${plural(b.nights ?? 0, "night")}` : b.startsAt ? `${fmtDay(b.startsAt.slice(0, 10), { weekday: "short", day: "numeric", month: "short" })} · ${fmtTime(b.startsAt)}` : "";

const startOf = (b: Booking) => (b.kind === "STAY" ? `${b.checkIn}T14:00:00+03:00` : b.startsAt!);

export function Trips() {
  const { data, loading } = useApi<{ items: Booking[] }>("/bookings");
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const now = Date.now();
  const items = (data?.items ?? []).filter((b) => {
    const upcoming = ["PENDING_PAYMENT", "CONFIRMED"].includes(b.status) && new Date(b.kind === "STAY" ? `${b.checkOut}T11:00:00+03:00` : b.endsAt!).getTime() > now;
    return tab === "upcoming" ? upcoming : !upcoming;
  });
  if (tab === "upcoming") items.sort((a, b) => startOf(a).localeCompare(startOf(b)));
  return (
    <div className="page page-mid">
      <PageHead eyebrow="Trips" title="Stays and appointments" />
      <div className="tabs" role="tablist" style={{ marginBottom: 24 }}>
        <button role="tab" aria-selected={tab === "upcoming"} onClick={() => setTab("upcoming")}>
          Upcoming
        </button>
        <button role="tab" aria-selected={tab === "past"} onClick={() => setTab("past")}>
          Past and cancelled
        </button>
      </div>
      {loading ? (
        <div className="stack g-12">
          <Skeleton h={124} r={16} />
          <Skeleton h={124} r={16} />
        </div>
      ) : items.length === 0 ? (
        <Empty
          icon={<CalendarDays />}
          title={tab === "upcoming" ? "Nothing booked yet" : "No past bookings"}
          action={
            tab === "upcoming" && (
              <div className="row g-8">
                <LinkButton to="/stays">Find a stay</LinkButton>
                <LinkButton to="/wellness">Book a treatment</LinkButton>
              </div>
            )
          }
        >
          {tab === "upcoming" ? "Bookings you make appear here with their reference and receipt." : undefined}
        </Empty>
      ) : (
        <div className="stack g-12">
          {items.map((b) => (
            <Link key={b.id} to={`/trips/${b.id}`} className="trip">
              <div className="thumb">{b.listing.photo && <img src={thumb(b.listing.photo)} alt="" loading="lazy" />}</div>
              <div className="stack g-4" style={{ minWidth: 0 }}>
                <span className="tiny muted">
                  {b.listing.neighbourhood}, {b.listing.city} · {b.ref}
                </span>
                <span className="h-2">{b.listing.title}</span>
                <span className="small soft">{when(b)}</span>
              </div>
              <div className="stack g-8" style={{ alignItems: "flex-end" }}>
                <StatusBadge status={b.status} />
                <span className="small num strong">{kes(b.price.total)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function TripDetail() {
  const { id } = useParams();
  const { data, loading, reload } = useApi<{ booking: Booking }>(`/bookings/${id}`, { staleMs: 0 });
  const toast = useToast();
  const [pay, setPay] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");

  if (loading) return <div className="page page-narrow section"><Skeleton h={420} r={22} /></div>;
  const b = data?.booking;
  if (!b) return <div className="page"><Empty title="Booking not found" /></div>;

  const doCancel = async () => {
    setBusy(true);
    try {
      await api.post(`/bookings/${b.id}/cancel`, { reason });
      await Promise.all([reload(), invalidate("/bookings")]);
      setCancel(false);
      toast("Booking cancelled", "ok");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const doReview = async () => {
    setBusy(true);
    try {
      await api.post(`/bookings/${b.id}/review`, { rating, body });
      await reload();
      setReview(false);
      toast("Thank you. Your review is published.", "ok");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const payable = b.status === "PENDING_PAYMENT" && b.holdUntil && new Date(b.holdUntil) > new Date();

  return (
    <div className="page page-narrow" style={{ paddingTop: 20 }}>
      <BackLink to="/trips">Trips</BackLink>
      <div className="ticket mt-16">
        <div className="ticket-media">
          {b.listing.photo && <img src={b.listing.photo} alt="" />}
          <StatusBadge status={b.status} />
        </div>
        <div className="ticket-body stack g-20">
          <div className="stack g-6">
            <span className="eyebrow">
              {b.kind === "STAY" ? "Stay" : CATEGORY[b.listing.category ?? ""]} · {b.listing.neighbourhood}, {b.listing.city}
            </span>
            <Link to={`/listings/${b.listing.id}`} className="display d-3">
              {b.listing.title}
            </Link>
          </div>
          <div className="ticket-cols">
            {b.kind === "STAY" ? (
              <>
                <div>
                  <div className="k">Check-in</div>
                  <div className="v">{fmtDayLong(b.checkIn!)}</div>
                  {b.checkInTime && <div className="small muted">From {b.checkInTime}</div>}
                </div>
                <div>
                  <div className="k">Check-out</div>
                  <div className="v">{fmtDayLong(b.checkOut!)}</div>
                  {b.checkOutTime && <div className="small muted">By {b.checkOutTime}</div>}
                </div>
                <div>
                  <div className="k">Guests</div>
                  <div className="v">{b.guests}</div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="k">Date</div>
                  <div className="v">{fmtDayLong(b.startsAt!.slice(0, 10))}</div>
                </div>
                <div>
                  <div className="k">Time</div>
                  <div className="v">
                    {fmtTime(b.startsAt!)} – {fmtTime(b.endsAt!)}
                  </div>
                </div>
                <div>
                  <div className="k">Where</div>
                  <div className="v">{b.serviceMode === "home" ? "Home visit" : "At the studio"}</div>
                  {b.visitAddress && <div className="small muted">{b.visitAddress}</div>}
                </div>
              </>
            )}
            <div>
              <div className="k">Reference</div>
              <div className="v num">{b.ref}</div>
            </div>
          </div>

          <dl className="kv">
            <dt>{b.kind === "STAY" ? `${kes(b.price.unit)} × ${plural(b.nights ?? 0, "night")}` : "Session"}</dt>
            <dd>{kes(b.price.subtotal)}</dd>
            <dt>Booking fee</dt>
            <dd>{kes(b.price.fee)}</dd>
            {b.price.payLater > 0 && (
              <>
                <dt>Paid at the session</dt>
                <dd>{kes(b.price.payLater)}</dd>
              </>
            )}
            <dt className="total">{b.price.payLater > 0 ? "Paid by M-Pesa" : "Total"}</dt>
            <dd className="total">{kes(b.price.dueNow)}</dd>
          </dl>
          {b.receipt && <p className="small muted">M-Pesa receipt {b.receipt}</p>}

          {(b.status === "CONFIRMED" || b.status === "COMPLETED") && (
            <div className="inset row between wrap g-12">
              <div className="row g-12">
                <span className="strong">{b.counterpart.name}</span>
                <span className="small muted">{b.kind === "STAY" ? "Host" : "Practitioner"}</span>
              </div>
              {b.counterpart.phone && (
                <a href={`tel:${b.counterpart.phone}`} className="btn btn-sm btn-outline">
                  <Phone /> {b.counterpart.phone.replace(/^\+254/, "0")}
                </a>
              )}
            </div>
          )}

          {b.status === "CANCELLED" && b.cancelReason && <div className="notice">Cancelled{b.cancelledAt ? ` on ${fmtDate(b.cancelledAt)}` : ""}. {b.cancelReason}</div>}

          <div className="row g-8 wrap">
            {payable && (
              <Button variant="primary" size="lg" onClick={() => setPay(true)}>
                Pay {kes(b.price.dueNow)} with M-Pesa
              </Button>
            )}
            {b.canReview && (
              <Button variant="primary" onClick={() => setReview(true)} icon={<Star />}>
                Leave a review
              </Button>
            )}
            {(b.status === "CONFIRMED" || b.status === "PENDING_PAYMENT") && (
              <Button variant="ghost" onClick={() => setCancel(true)}>
                Cancel booking
              </Button>
            )}
          </div>
          {payable && <p className="tiny muted">Held until {fmtTime(b.holdUntil!)}. After that the dates are released.</p>}
        </div>
      </div>

      <PaymentSheet
        open={pay}
        onClose={() => {
          setPay(false);
          void reload();
        }}
        title="Pay for your booking"
        amount={b.price.dueNow}
        start={async (phone) => (await api.post("/mpesa/stk-push", { purpose: "BOOKING", refId: b.id, phone })).data}
        onPaid={() => void reload()}
      />

      <Modal open={cancel} onClose={() => setCancel(false)} title="Cancel this booking?">
        <div className="stack g-16">
          <p className="soft">{b.status === "CONFIRMED" ? "Paid bookings can be cancelled up to 48 hours before they start. The payment is refunded to your M-Pesa." : "Nothing has been paid; the dates will be released."}</p>
          <Textarea label="Reason (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row g-8">
            <Button block onClick={() => setCancel(false)}>
              Keep it
            </Button>
            <Button block variant="danger" loading={busy} onClick={doCancel}>
              Cancel booking
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={review} onClose={() => setReview(false)} title={`How was ${b.listing.title}?`}>
        <div className="stack g-16">
          <div className="stars" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" className={n <= rating ? "on" : ""} onClick={() => setRating(n)} aria-label={`${n} stars`} role="radio" aria-checked={n === rating}>
                <Star />
              </button>
            ))}
          </div>
          <Textarea label="Your review" rows={4} value={body} onChange={(e) => setBody(e.target.value)} hint="Shown on the listing with your first name." />
          <Button variant="ink" block loading={busy} onClick={doReview}>
            Publish review
          </Button>
        </div>
      </Modal>
    </div>
  );
}

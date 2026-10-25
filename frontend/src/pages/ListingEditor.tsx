import { ArrowLeft, ArrowRight, BedDouble, Camera, Flower2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, errorMessage, fieldErrors, invalidate, useApi } from "../api/client";
import { Stepper, useMeta } from "../components/SearchPanel";
import { BackLink, Button, Field, Input, PageHead, Select, Skeleton, StatusBadge, Textarea } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ui";
import { CATEGORY, kes } from "../lib/format";
import type { ListingDetail } from "../types";

type Form = {
  type: "STAY" | "WELLNESS";
  title: string;
  summary: string;
  description: string;
  city: string;
  neighbourhood: string;
  priceKes: string;
  bedrooms: number;
  bathrooms: number;
  maxGuests: number;
  minNights: number;
  checkInTime: string;
  checkOutTime: string;
  houseRules: string;
  amenities: string[];
  category: string;
  durationMin: string;
  serviceModes: ("home" | "studio")[];
  depositPct: string;
  hours: Record<string, [string, string]>;
};

const DAYS: [string, string][] = [["1", "Monday"], ["2", "Tuesday"], ["3", "Wednesday"], ["4", "Thursday"], ["5", "Friday"], ["6", "Saturday"], ["7", "Sunday"]];
const DEFAULT_HOURS: Form["hours"] = { "1": ["09:00", "18:00"], "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["10:00", "16:00"] };

const blank = (type: Form["type"]): Form => ({
  type, title: "", summary: "", description: "", city: "Nairobi", neighbourhood: "", priceKes: "",
  bedrooms: 1, bathrooms: 1, maxGuests: 2, minNights: 1, checkInTime: "14:00", checkOutTime: "10:00", houseRules: "", amenities: [],
  category: "massage", durationMin: "60", serviceModes: ["studio"], depositPct: "0", hours: DEFAULT_HOURS,
});

const fromListing = (l: ListingDetail): Form => ({
  type: l.type, title: l.title, summary: l.summary, description: l.description, city: l.city, neighbourhood: l.neighbourhood, priceKes: String(l.priceKes),
  bedrooms: l.bedrooms ?? 1, bathrooms: l.bathrooms ?? 1, maxGuests: l.maxGuests ?? 2, minNights: l.minNights, checkInTime: l.checkInTime ?? "14:00",
  checkOutTime: l.checkOutTime ?? "10:00", houseRules: l.houseRules, amenities: l.amenities, category: l.category ?? "massage",
  durationMin: String(l.durationMin ?? 60), serviceModes: l.serviceModes.length ? l.serviceModes : ["studio"], depositPct: String(l.depositPct ?? 0), hours: l.hours ?? DEFAULT_HOURS,
});

const payload = (f: Form) => {
  const base = { title: f.title, summary: f.summary, description: f.description, city: f.city, neighbourhood: f.neighbourhood, priceKes: Number(f.priceKes) || undefined };
  return f.type === "STAY"
    ? { ...base, bedrooms: f.bedrooms, bathrooms: f.bathrooms, maxGuests: f.maxGuests, minNights: f.minNights, checkInTime: f.checkInTime, checkOutTime: f.checkOutTime, houseRules: f.houseRules, amenities: f.amenities }
    : { ...base, category: f.category, durationMin: Number(f.durationMin), serviceModes: f.serviceModes, depositPct: Number(f.depositPct), hours: f.hours };
};

const STEPS = ["Basics", "Location", "Details", "Price", "Photos", "Review"];

export function ListingEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { me } = useAuth();
  const existing = useApi<{ listing: ListingDetail }>(id ? `/listings/${id}` : null, { staleMs: 0 });
  const [type, setType] = useState<Form["type"] | null>((params.get("type") as Form["type"]) ?? null);
  if (!me) return null;
  if (id && existing.loading) return <div className="page section"><Skeleton h={400} r={16} /></div>;
  if (id && existing.data) return <Wizard initial={fromListing(existing.data.listing)} listing={existing.data.listing} onSaved={() => void existing.reload()} />;
  if (!type)
    return (
      <div className="page page-mid">
        <BackLink to="/host">Hosting</BackLink>
        <PageHead title="What are you listing?" />
        <div className="grid-cards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <button className="card card-pad stack g-12" style={{ textAlign: "left", minHeight: 180 }} onClick={() => setType("STAY")}>
            <BedDouble size={26} style={{ color: "var(--accent)" }} />
            <span className="display d-4">A stay</span>
            <span className="small soft">An apartment, house, cottage or room, booked by the night.</span>
          </button>
          <button className="card card-pad stack g-12" style={{ textAlign: "left", minHeight: 180 }} onClick={() => setType("WELLNESS")}>
            <Flower2 size={26} style={{ color: "var(--accent)" }} />
            <span className="display d-4">A treatment</span>
            <span className="small soft">A massage, physiotherapy, beauty or spa session, booked by the hour.</span>
          </button>
        </div>
      </div>
    );
  return <Wizard initial={blank(type)} />;
}

function Wizard({ initial, listing, onSaved }: { initial: Form; listing?: ListingDetail; onSaved?: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { refresh } = useAuth();
  const { data: meta } = useMeta();
  const { me } = useAuth();
  const pct = meta?.commissionPct ?? 15;
  const [f, setF] = useState<Form>(initial);
  const [step, setStep] = useState(0);
  const [id, setId] = useState(listing?.id ?? null);
  const [photos, setPhotos] = useState<string[]>(listing?.photos ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const stay = f.type === "STAY";
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const status = listing?.status ?? "DRAFT";
  useEffect(() => {
    if (meta && !f.neighbourhood) set("neighbourhood", meta.neighbourhoods[f.city]?.[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  const save = async (): Promise<string | null> => {
    setBusy(true);
    setErrors({});
    try {
      const body = payload(f);
      if (id) await api.patch(`/listings/${id}`, body);
      else {
        if (!body.priceKes) body.priceKes = stay ? 5000 : 3000; // a placeholder until the price step
        const r = await api.post<{ id: string }>("/listings", { type: f.type, ...body });
        setId(r.data.id);
        void refresh();
        window.history.replaceState(null, "", `/host/listings/${r.data.id}`);
        return r.data.id;
      }
      onSaved?.();
      return id;
    } catch (e) {
      setErrors(fieldErrors(e));
      toast(errorMessage(e), "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const nextStep = async () => {
    if (step === 0 && f.title.trim().length < 6) return setErrors({ title: "At least 6 characters" });
    if (step === 3 && !(Number(f.priceKes) >= 100)) return setErrors({ priceKes: "Set a price of at least KES 100" });
    // Every form step saves, so a draft exists before photos are added.
    if (step <= 3 && !(await save())) return;
    setErrors({});
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const lid = id ?? (await save());
    if (!lid) return;
    setUploading(true);
    try {
      const fd = new FormData();
      [...files].slice(0, 10).forEach((x) => fd.append("photos", x));
      const r = await api.post<{ photos: string[] }>(`/listings/${lid}/photos`, fd);
      setPhotos(r.data.photos);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  };
  const reorder = async (next: string[]) => {
    setPhotos(next);
    if (id) await api.put(`/listings/${id}/photos`, { photos: next }).catch((e) => toast(errorMessage(e), "error"));
  };

  const submit = async () => {
    const lid = await save();
    if (!lid) return;
    try {
      await api.post(`/listings/${lid}/submit`);
      await invalidate("/host");
      toast("Sent for review. You'll get a message when it's live.", "ok");
      nav("/host/listings");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const needPhotos = stay ? 3 : 1;
  const problems = [
    f.title.trim().length < 6 && "Add a title",
    f.description.trim().length < 40 && "Write a description of at least 40 characters",
    !(Number(f.priceKes) >= 100) && "Set a price",
    photos.length < needPhotos && `Add at least ${needPhotos} photo${needPhotos > 1 ? "s" : ""}`,
    !stay && f.serviceModes.length === 0 && "Choose studio, home visits or both",
    !stay && Object.keys(f.hours).length === 0 && "Set your hours",
  ].filter(Boolean) as string[];

  return (
    <div className="page">
      <div style={{ paddingTop: 20 }}>
        <BackLink to="/host/listings">Listings</BackLink>
      </div>
      <PageHead eyebrow={stay ? "Stay" : "Treatment"} title={f.title || (listing ? "Edit listing" : stay ? "New stay" : "New treatment")} actions={<StatusBadge status={status} />} />
      <div className="wizard">
        <nav className="wizard-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <button key={s} className={i === step ? "on" : i < step || id ? "done" : ""} onClick={() => (id || i <= step ? setStep(i) : undefined)}>
              <span className="n">{i + 1}</span> {s}
            </button>
          ))}
        </nav>
        <div className="card card-pad stack g-24" style={{ maxWidth: 720 }}>
          {step === 0 && (
            <>
              <h2 className="h-1">The basics</h2>
              <Input label="Title" value={f.title} maxLength={80} onChange={(e) => set("title", e.target.value)} error={errors.title} hint={stay ? "For example: Garden cottage in Karen" : "For example: Deep tissue massage"} />
              <Input label="One-line summary" value={f.summary} maxLength={160} onChange={(e) => set("summary", e.target.value)} hint="Shown on the listing card." />
              <Textarea label="Description" rows={7} value={f.description} maxLength={4000} onChange={(e) => set("description", e.target.value)} error={errors.description} hint={`${f.description.length} characters · at least 40`} />
            </>
          )}
          {step === 1 && (
            <>
              <h2 className="h-1">Where</h2>
              <div className="form-grid">
                <Select label="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value, neighbourhood: meta?.neighbourhoods[e.target.value]?.[0] ?? "" })}>
                  {Object.keys(meta?.neighbourhoods ?? { Nairobi: [] }).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
                <Select label="Neighbourhood" value={f.neighbourhood} onChange={(e) => set("neighbourhood", e.target.value)} error={errors.neighbourhood}>
                  {(meta?.neighbourhoods[f.city] ?? []).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </div>
              <p className="small muted">{stay ? "Guests see the neighbourhood. Share the exact address with them once they've booked." : "Clients see the neighbourhood. For home visits they give you their address when they book."}</p>
            </>
          )}
          {step === 2 &&
            (stay ? (
              <>
                <h2 className="h-1">The space</h2>
                <div className="list">
                  {(
                    [
                      ["bedrooms", "Bedrooms", 0, 20],
                      ["bathrooms", "Bathrooms", 1, 20],
                      ["maxGuests", "Guests", 1, 30],
                      ["minNights", "Minimum nights", 1, 60],
                    ] as const
                  ).map(([k, label, min, max]) => (
                    <div key={k} className="list-row">
                      <span className="grow">
                        {label}
                        {k === "bedrooms" && f.bedrooms === 0 && <span className="small muted"> · Studio</span>}
                      </span>
                      <Stepper value={f[k]} onChange={(v) => set(k, v)} min={min} max={max} />
                    </div>
                  ))}
                </div>
                <div className="form-grid">
                  <Input label="Check-in from" type="time" value={f.checkInTime} onChange={(e) => set("checkInTime", e.target.value)} />
                  <Input label="Check-out by" type="time" value={f.checkOutTime} onChange={(e) => set("checkOutTime", e.target.value)} />
                </div>
                <Field label="Amenities">
                  <div className="chips">
                    {(meta?.amenities ?? []).map((a) => (
                      <button key={a} type="button" className="chip" aria-pressed={f.amenities.includes(a)} onClick={() => set("amenities", f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a])}>
                        {a}
                      </button>
                    ))}
                  </div>
                </Field>
                <Textarea label="House rules" rows={3} value={f.houseRules} onChange={(e) => set("houseRules", e.target.value)} />
              </>
            ) : (
              <>
                <h2 className="h-1">The session</h2>
                <div className="form-grid">
                  <Select label="Category" value={f.category} onChange={(e) => set("category", e.target.value)}>
                    {Object.entries(CATEGORY).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                  <Select label="Length" value={f.durationMin} onChange={(e) => set("durationMin", e.target.value)}>
                    {[30, 45, 60, 75, 90, 120, 150, 180].map((m) => (
                      <option key={m} value={m}>
                        {m} minutes
                      </option>
                    ))}
                  </Select>
                </div>
                <Field label="Where you work" error={errors.serviceModes}>
                  <div className="chips">
                    {(["studio", "home"] as const).map((m) => (
                      <button key={m} type="button" className="chip" aria-pressed={f.serviceModes.includes(m)} onClick={() => set("serviceModes", f.serviceModes.includes(m) ? f.serviceModes.filter((x) => x !== m) : [...f.serviceModes, m])}>
                        {m === "studio" ? "At my studio" : "Home visits"}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Hours you take bookings">
                  <div className="hours">
                    {DAYS.map(([d, name]) => {
                      const on = Boolean(f.hours[d]);
                      return (
                        <div key={d} className="hours-row">
                          <span>{name}</span>
                          <label className="check small">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={(e) => {
                                const h = { ...f.hours };
                                if (e.target.checked) h[d] = ["09:00", "18:00"];
                                else delete h[d];
                                set("hours", h);
                              }}
                            />
                            {on ? "Open" : "Closed"}
                          </label>
                          {on && (
                            <span className="times">
                              <input className="input" type="time" value={f.hours[d][0]} onChange={(e) => set("hours", { ...f.hours, [d]: [e.target.value, f.hours[d][1]] })} />
                              <span className="muted">–</span>
                              <input className="input" type="time" value={f.hours[d][1]} onChange={(e) => set("hours", { ...f.hours, [d]: [f.hours[d][0], e.target.value] })} />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Field>
              </>
            ))}
          {step === 3 && (
            <>
              <h2 className="h-1">Price</h2>
              <Field label={stay ? "Per night" : "Per session"} error={errors.priceKes}>
                <div className="input-group">
                  <span className="prefix">KES</span>
                  <input className="input num" inputMode="numeric" value={f.priceKes} onChange={(e) => set("priceKes", e.target.value.replace(/\D/g, ""))} style={{ fontSize: 20, height: 56 }} />
                </div>
              </Field>
              {!stay && (
                <Select label="Deposit" value={f.depositPct} onChange={(e) => set("depositPct", e.target.value)} hint="With a deposit, clients pay part now and the rest to you at the session.">
                  <option value="0">No deposit option: paid in full when booking</option>
                  {[20, 30, 50].map((p) => (
                    <option key={p} value={p}>
                      Allow a {p}% deposit
                    </option>
                  ))}
                </Select>
              )}
              {Number(f.priceKes) >= 100 && (
                <div className="inset">
                  <dl className="kv">
                    <dt>Guest pays{stay ? " for one night" : ""}</dt>
                    <dd>{kes(Number(f.priceKes))}</dd>
                    <dt>Konnect ({pct}%)</dt>
                    <dd>− {kes(Math.round((Number(f.priceKes) * pct) / 100))}</dd>
                    <dt className="total">You receive</dt>
                    <dd className="total">{kes(Number(f.priceKes) - Math.round((Number(f.priceKes) * pct) / 100))}</dd>
                  </dl>
                  <p className="tiny muted mt-8">Sent to your M-Pesa number {me?.payoutPhone.replace(/^\+254/, "0")} as soon as the guest's payment clears. Change it in Account.</p>
                </div>
              )}
            </>
          )}
          {step === 4 && (
            <>
              <div className="stack g-4">
                <h2 className="h-1">Photos</h2>
                <p className="small muted">At least {needPhotos}. The first photo is the cover. Bright, level photos taken in daylight work best.</p>
              </div>
              <div className="photo-slots wide">
                {photos.map((p, i) => (
                  <div key={p} className="photo-slot">
                    <img src={p} alt="" />
                    <button className="remove" onClick={() => reorder(photos.filter((x) => x !== p))} aria-label="Remove">
                      <X />
                    </button>
                    {i === 0 ? (
                      <span className="badge badge-glass first">Cover</span>
                    ) : (
                      <button className="badge badge-glass first" onClick={() => reorder([p, ...photos.filter((x) => x !== p)])}>
                        Make cover
                      </button>
                    )}
                  </div>
                ))}
                <button className="photo-slot" onClick={() => file.current?.click()} disabled={uploading}>
                  {uploading ? <span className="spinner" /> : <span className="stack g-6" style={{ alignItems: "center" }}><Camera /> <span className="small">Add photos</span></span>}
                </button>
              </div>
              <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
            </>
          )}
          {step === 5 && (
            <>
              <h2 className="h-1">{status === "APPROVED" ? "Your listing is live" : "Ready to submit?"}</h2>
              {problems.length ? (
                <div className="notice notice-warn">
                  <span>Still needed: {problems.join(" · ")}</span>
                </div>
              ) : status === "APPROVED" ? (
                <p className="soft">Changes you save appear on the listing straight away.</p>
              ) : (
                <p className="soft">The Konnect team reviews new listings, usually within a day. You'll get a message when it's live.</p>
              )}
              <div className="row g-12">
                {photos[0] && <img src={photos[0]} alt="" style={{ width: 120, aspectRatio: "4/3", objectFit: "cover", borderRadius: 10 }} />}
                <div className="stack g-4">
                  <span className="h-2">{f.title}</span>
                  <span className="small muted">
                    {f.neighbourhood}, {f.city} · {Number(f.priceKes) ? kes(Number(f.priceKes)) : "No price"} / {stay ? "night" : "session"}
                  </span>
                </div>
              </div>
            </>
          )}

          <div className="row between" style={{ borderTop: "1px solid var(--line)", paddingTop: 18 }}>
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} icon={<ArrowLeft />}>
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="ink" loading={busy} onClick={nextStep}>
                {step <= 3 ? "Save and continue" : "Continue"} <ArrowRight />
              </Button>
            ) : status === "APPROVED" || status === "PENDING" || status === "PAUSED" ? (
              <Button
                variant="primary"
                loading={busy}
                onClick={async () => {
                  if (await save()) toast("Saved", "ok");
                }}
              >
                Save changes
              </Button>
            ) : (
              <Button variant="primary" loading={busy} disabled={problems.length > 0} onClick={submit}>
                Submit for review
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

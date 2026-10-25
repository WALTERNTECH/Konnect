import { Download, Plus, RefreshCw, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "../api/client";
import { AreaChart } from "../components/Chart";
import { Lightbox } from "../components/Gallery";
import { Avatar, Button, Empty, Input, Modal, Select, Skeleton, StatusBadge, Textarea, Toggle } from "../components/ui";
import { useToast } from "../context/ui";
import { ago, fmtDate, fmtDateTime, fmtRange, kes, num, thumb } from "../lib/format";
import { adminApi, useAdmin, useBlobUrl } from "./api";

export type Row = Record<string, any>;

export function Head({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="admin-head">
      <h1>{title}</h1>
      {children && <div className="row g-8 wrap">{children}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
      {options.map(([v, l]) => (
        <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Table({ cols, rows, onRow, empty = "Nothing here" }: { cols: [string, (r: Row) => ReactNode, string?][]; rows: Row[] | undefined; onRow?: (r: Row) => void; empty?: string }) {
  if (!rows) return <Skeleton h={240} r={16} />;
  if (!rows.length)
    return (
      <div className="table-wrap">
        <Empty title={empty} />
      </div>
    );
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {cols.map(([h, , cls]) => (
              <th key={h} className={cls}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className={onRow ? "click" : ""} onClick={onRow ? () => onRow(r) : undefined}>
              {cols.map(([h, f, cls]) => (
                <td key={h} className={cls}>
                  {f(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Runs an admin action with a toast, then reloads. */
export function useDo(reload: () => Promise<void> | void) {
  const toast = useToast();
  return async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, "ok");
      await reload();
      return true;
    } catch (e) {
      toast(errorMessage(e), "error");
      return false;
    }
  };
}

/** Asks for a short reason before an action that needs one. */
export function usePrompt() {
  const [state, setState] = useState<{ title: string; label: string; resolve: (v: string | null) => void } | null>(null);
  const [value, setValue] = useState("");
  const ask = (title: string, label: string) =>
    new Promise<string | null>((resolve) => {
      setValue("");
      setState({ title, label, resolve });
    });
  const modal = state && (
    <Modal open onClose={() => (state.resolve(null), setState(null))} title={state.title}>
      <div className="stack g-16">
        <Textarea label={state.label} rows={3} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <Button variant="ink" disabled={value.trim().length < 3} onClick={() => (state.resolve(value.trim()), setState(null))}>
          Confirm
        </Button>
      </div>
    </Modal>
  );
  return { ask, modal };
}

// ——— Overview ———

const PURPOSE: Record<string, string> = { BOOKING: "Booking", SUBSCRIPTION: "Membership (old)", AD_CAMPAIGN: "Ads", PROMOTION: "Featured" };

export function Overview() {
  const { data } = useAdmin<{ revenue: Record<string, number>; counts: Record<string, number>; series: { day: string; signups: number; revenue: number; bookings: number }[]; neighbourhoods: Row[]; recent: Row[]; driver: string; payoutDriver: string | null }>("/overview");
  if (!data) return <Skeleton h={480} r={16} />;
  const { revenue: r, counts: c } = data;
  const queues: [string, number, string][] = [
    ["Listings to review", c.q_listings, "/listings"],
    ["Verifications", c.q_verifications, "/verification"],
    ["Open reports", c.q_reports, "/reports"],
    ["Open SOS", c.q_sos, "/safety"],
    ["Payouts to check", c.q_payouts, "/payouts"],
    ["Refunds to send", c.q_refunds, "/payments"],
    ["Ads to review", c.q_ads, "/ads"],
  ];
  return (
    <>
      <Head title="Overview">
        {data.driver === "simulated" && <span className="badge badge-warn">Payments are simulated · no money moves</span>}
        {data.driver !== "simulated" && !data.payoutDriver && <span className="badge badge-warn">B2C not set up · host payouts wait in Payouts</span>}
      </Head>
      <div className="stack g-20">
        <div className="grid-stats">
          <div className="stat">
            <span className="label">Konnect income, 30 days</span>
            <span className="value">{kes(r.commission + r.ads + r.promotions)}</span>
            <span className="delta">
              {kes(r.commission)} commission · {kes(r.ads + r.promotions)} ads and featuring
            </span>
          </div>
          <div className="stat">
            <span className="label">Paid in by M-Pesa, 30 days</span>
            <span className="value">{kes(r.month)}</span>
            <span className="delta">{kes(r.paidOut)} sent to hosts</span>
          </div>
          <div className="stat">
            <span className="label">Hosts</span>
            <span className="value">{num(c.hosts)}</span>
            <span className="delta">of {num(c.users)} accounts</span>
          </div>
          <div className="stat">
            <span className="label">Bookings, 30 days</span>
            <span className="value">{num(c.bookings_month)}</span>
            <span className="delta">{kes(r.bookingVolume)} paid in</span>
          </div>
          <div className="stat">
            <span className="label">Sign-ups, 7 days</span>
            <span className="value">{num(c.signups_week)}</span>
            <span className="delta">{num(c.live_listings)} live listings</span>
          </div>
          <div className="stat">
            <span className="label">Ad impressions, 7 days</span>
            <span className="value">{num(c.impressions_week)}</span>
          </div>
        </div>
        <div className="queue-tiles">
          {queues.map(([l, n, to]) => (
            <Link key={l} to={to} className={`queue-tile ${n ? "hot" : ""}`}>
              <span className="n">{n}</span>
              <span className="l">{l}</span>
            </Link>
          ))}
        </div>
        <div className="detail" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 20 }}>
          <section className="card card-pad stack g-12">
            <div className="row between">
              <h2 className="h-2">Revenue by day</h2>
              <span className="small muted">
                Bookings {kes(r.bookingVolume)} · Commission {kes(r.commission)} · Ads {kes(r.ads)} · Featured {kes(r.promotions)}
              </span>
            </div>
            <AreaChart data={data.series.map((d) => ({ label: d.day.slice(5), value: d.revenue }))} format={(n) => kes(n)} />
            <h2 className="h-2 mt-12">Sign-ups by day</h2>
            <AreaChart data={data.series.map((d) => ({ label: d.day.slice(5), value: d.signups }))} height={130} format={(n) => `${n} sign-ups`} />
          </section>
          <section className="stack g-20">
            <div className="card card-pad stack g-12">
              <h2 className="h-2">Where bookings are, 90 days</h2>
              {data.neighbourhoods.length === 0 ? (
                <p className="small muted">No bookings yet.</p>
              ) : (
                <div className="stack g-8">
                  {data.neighbourhoods.map((h) => {
                    const max = data.neighbourhoods[0].bookings;
                    return (
                      <div key={h.neighbourhood + h.city} className="stack g-4">
                        <div className="row between small">
                          <span>
                            {h.neighbourhood}, {h.city}
                          </span>
                          <span className="num">{h.bookings}</span>
                        </div>
                        <div className="progress-line">
                          <i style={{ width: `${(h.bookings / max) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="card card-pad stack g-8">
              <h2 className="h-2">Latest payments</h2>
              <div className="list">
                {data.recent.map((p) => (
                  <div key={p.id} className="list-row" style={{ padding: "10px 0" }}>
                    <span className="grow small">
                      <span className="strong">{PURPOSE[p.purpose]}</span> · {p.full_name ?? "—"}
                      <br />
                      <span className="muted">{ago(p.created_at)}</span>
                    </span>
                    <span className="stack" style={{ alignItems: "flex-end" }}>
                      <span className="num small strong">{kes(p.amount_kes)}</span>
                      <span className={`tiny ${p.status === "SUCCESS" ? "accent-text" : "muted"}`}>{p.status.toLowerCase()}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

// ——— Users ———

const badges = (u: Row) =>
  [u.phone_verified_at && "Phone", u.id_verified_at && "ID", u.income_verified_at && "Income", u.background_checked_at && "Background"].filter(Boolean).join(" · ") || "—";

export function Users() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [term, setTerm] = useState("");
  const { data, reload } = useAdmin<{ items: Row[]; total: number }>(`/users?${new URLSearchParams({ ...(term && { q: term }), ...(status && { status }), ...(kind && { kind }) })}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <Head title="Users">
        <form
          className="row g-8 wrap"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q);
          }}
        >
          <div className="input-group">
            <Search size={16} style={{ position: "absolute", left: 12, color: "var(--ink-3)" }} />
            <input className="input" style={{ paddingLeft: 36, height: 38, width: 260 }} placeholder="Name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" style={{ height: 38, width: 130 }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
            <option value="">Everyone</option>
            <option value="hosts">Hosts</option>
            <option value="guests">Guests</option>
          </select>
          <select className="select" style={{ height: 38, width: 130 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deleted">Closed</option>
          </select>
        </form>
      </Head>
      <p className="small muted" style={{ marginBottom: 12 }}>
        {data ? `${num(data.total)} accounts` : ""}
      </p>
      <Table
        rows={data?.items}
        onRow={(r) => setOpen(r.id)}
        cols={[
          ["Name", (r) => (
            <span className="stack">
              <span className="strong">{r.full_name}</span>
              {r.is_host && <span className="tiny muted">Host</span>}
            </span>
          )],
          ["Contact", (r) => (
            <span className="small">
              {r.email}
              <br />
              <span className="muted">{r.phone}</span>
            </span>
          )],
          ["Payout number", (r) => <span className="small num">{r.is_host ? (r.payout_phone ?? r.phone) : "—"}</span>],
          ["Age", (r) => r.age, "r"],
          ["Verified", badges],
          ["Status", (r) => <span className={`badge ${r.status === "active" ? "badge-ok" : r.status === "suspended" ? "badge-danger" : ""}`}>{r.status}</span>],
          ["Joined", (r) => <span className="small muted">{fmtDate(r.created_at)}</span>],
        ]}
      />
      {open && <UserDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}

function UserDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, reload } = useAdmin<{ user: Row; bookings: Row[]; payments: Row[]; reports: Row[]; verifications: Row[]; listings: Row[]; payouts: Row[] }>(`/users/${id}`);
  const run = useDo(async () => {
    await reload();
    onChanged();
  });
  const { ask, modal } = usePrompt();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ fullName: "", email: "", phone: "", payoutPhone: "", city: "" });
  const [temp, setTemp] = useState<string | null>(null);
  const act = (body: Row, ok: string) => run(() => adminApi.post(`/users/${id}/action`, body), ok);
  const u = data?.user;
  const startEdit = () => {
    if (!u) return;
    setF({ fullName: u.full_name, email: u.email, phone: u.phone, payoutPhone: u.payout_phone ?? u.phone, city: u.city });
    setEditing(true);
  };
  return (
    <Modal open onClose={onClose} title={u?.full_name ?? "User"} wide>
      {!u ? (
        <Skeleton h={300} />
      ) : (
        <div className="stack g-20">
          <div className="row g-16">
            <Avatar name={u.full_name} src={u.photo_url} size={64} />
            <div className="stack g-4">
              <span className="small">
                {u.email} · {u.phone}
              </span>
              <span className="small muted">
                {u.age} · {u.gender} · {u.city}
                {u.neighbourhood ? `, ${u.neighbourhood}` : ""} · joined {fmtDate(u.created_at)} · seen {ago(u.last_seen_at)}
              </span>
              <span className="small">
                Payout number <span className="num strong">{u.payout_phone ?? u.phone}</span> · Verified: {badges(u)}
              </span>
              {u.status === "suspended" && <span className="small" style={{ color: "var(--danger)" }}>Suspended: {u.suspended_reason}</span>}
            </div>
          </div>

          {editing ? (
            <div className="inset stack g-14" style={{ gap: 14 }}>
              <div className="form-grid">
                <Input label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
                <Input label="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
                <Input label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
                <Input label="Payout number" value={f.payoutPhone} onChange={(e) => setF({ ...f, payoutPhone: e.target.value })} hint="Where this host's 85% is sent." />
                <Input label="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
              </div>
              <div className="row g-8">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={async () => {
                    if (await run(() => adminApi.patch(`/users/${id}`, f), "Saved")) setEditing(false);
                  }}
                >
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="row g-8 wrap">
              {u.status !== "deleted" && (
                <Button size="sm" onClick={startEdit}>
                  Edit details
                </Button>
              )}
              {u.status === "active" ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    const reason = await ask("Suspend account", "Reason (kept in the audit log)");
                    if (reason) await act({ action: "suspend", reason }, "Suspended");
                  }}
                >
                  Suspend
                </Button>
              ) : u.status === "suspended" ? (
                <Button size="sm" onClick={() => act({ action: "reactivate" }, "Reactivated")}>
                  Reactivate
                </Button>
              ) : null}
              {!u.phone_verified_at && u.status !== "deleted" && (
                <Button size="sm" onClick={() => act({ action: "verify_phone" }, "Phone marked confirmed")}>
                  Confirm phone
                </Button>
              )}
              {u.status !== "deleted" && (
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      const r = await adminApi.post<{ temporaryPassword: string }>(`/users/${id}/password`);
                      setTemp(r.data.temporaryPassword);
                    } catch (e) {
                      toast(errorMessage(e), "error");
                    }
                  }}
                >
                  Reset password
                </Button>
              )}
              {(["id", "income", "background"] as const).map(
                (b) =>
                  u[{ id: "id_verified_at", income: "income_verified_at", background: "background_checked_at" }[b]] && (
                    <Button key={b} size="sm" variant="ghost" onClick={() => act({ action: "revoke_badge", badge: b }, "Badge removed")}>
                      Remove {b} badge
                    </Button>
                  ),
              )}
              <Button size="sm" variant="ghost" onClick={() => act({ action: "sign_out" }, "Signed out everywhere")}>
                Sign out everywhere
              </Button>
              {u.status !== "deleted" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(`Close ${u.full_name}'s account? Their profile and matches are removed; bookings and payments stay.`)) return;
                    if (await run(() => adminApi.delete(`/users/${id}`), "Account closed")) onClose();
                  }}
                >
                  Close account
                </Button>
              )}
            </div>
          )}
          {temp && (
            <div className="notice notice-accent stack g-6" style={{ display: "flex" }}>
              <span className="small">Temporary password, shown once. Give it to them privately; they're signed out everywhere until they use it.</span>
              <span className="secret">{temp}</span>
            </div>
          )}
          <div className="form-grid">
            <MiniList title="Bookings" rows={data.bookings} render={(b) => `${b.ref} · ${b.title} · ${b.status.toLowerCase()} · ${kes(b.total_kes)}`} />
            <MiniList title="Payments" rows={data.payments} render={(p) => `${PURPOSE[p.purpose]} · ${kes(p.amount_kes)} · ${p.status.toLowerCase()}${p.mpesa_receipt ? ` · ${p.mpesa_receipt}` : ""}`} />
            <MiniList title="Payouts to them" rows={data.payouts} render={(p) => `${p.ref} · ${kes(p.amount_kes)} · ${p.status.toLowerCase()}${p.reference ? ` · ${p.reference}` : ""}`} />
            <MiniList title="Listings" rows={data.listings} render={(l) => `${l.title} · ${l.status.toLowerCase()}`} />
            <MiniList title="Reports about them" rows={data.reports} render={(r) => `${r.reason} · ${r.status.toLowerCase()} · from ${r.reporter}`} />
            <MiniList title="Verification" rows={data.verifications} render={(v) => `${v.kind} · ${v.status.toLowerCase()} · ${fmtDate(v.created_at)}`} />
          </div>
        </div>
      )}
      {modal}
    </Modal>
  );
}

function MiniList({ title, rows, render }: { title: string; rows: Row[]; render: (r: Row) => string }) {
  return (
    <div className="inset stack g-6">
      <span className="h-3">{title}</span>
      {rows.length === 0 ? (
        <span className="small muted">None</span>
      ) : (
        rows.slice(0, 8).map((r) => (
          <span key={r.id} className="small">
            {render(r)}
          </span>
        ))
      )}
    </div>
  );
}

// ——— Listings ———

const toLocalInput = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(0, 16);

export function Listings({ siteUrl }: { siteUrl: string }) {
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "ALL">("PENDING");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const { data, reload } = useAdmin<{ items: Row[] }>(`/listings?status=${status}${term ? `&q=${encodeURIComponent(term)}` : ""}`);
  const [view, setView] = useState<string | null>(null);
  return (
    <>
      <Head title="Listings">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q);
          }}
          className="input-group"
        >
          <Search size={16} style={{ position: "absolute", left: 12, color: "var(--ink-3)" }} />
          <input className="input" style={{ paddingLeft: 36, height: 38, width: 260 }} placeholder="Title, area or host" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </Head>
      <Tabs value={status} onChange={setStatus} options={[["PENDING", "To review"], ["APPROVED", "Live"], ["REJECTED", "Changes asked"], ["PAUSED", "Paused"], ["ALL", "All"]]} />
      <Table
        rows={data?.items}
        empty={status === "PENDING" ? "No listings waiting for review" : "Nothing here"}
        onRow={(r) => setView(r.id)}
        cols={[
          ["", (r) => (r.photos?.[0] ? <img className="thumb" src={thumb(r.photos[0])} alt="" /> : <span className="thumb" />)],
          ["Listing", (r) => (
            <span className="stack">
              <span className="strong">{r.title}</span>
              <span className="small muted">
                {r.type === "STAY" ? "Stay" : r.category} · {r.neighbourhood}, {r.city}
                {r.is_sample ? " · sample" : ""}
              </span>
            </span>
          )],
          ["Host", (r) => (
            <span className="small">
              {r.host_name}
              {r.host_id_verified ? " ✓" : ""}
              <br />
              <span className="muted">{r.host_phone}</span>
            </span>
          )],
          ["Price", (r) => kes(r.price_kes), "r"],
          ["Now", (r) => (r.type === "STAY" ? (r.occupancy === "occupied" && r.occupied_until && new Date(r.occupied_until) > new Date()) || r.booked_until ? <span className="avail busy">Occupied</span> : <span className="avail ok">Free</span> : <span className="muted small">—</span>)],
          ["Status", (r) => <StatusBadge status={r.status} />],
          ["Updated", (r) => <span className="small muted">{ago(r.updated_at)}</span>],
        ]}
      />
      {view && <ListingDrawer id={view} siteUrl={siteUrl} onClose={() => setView(null)} onChanged={reload} />}
    </>
  );
}

function ListingDrawer({ id, siteUrl, onClose, onChanged }: { id: string; siteUrl: string; onClose: () => void; onChanged: () => void }) {
  const { data, reload } = useAdmin<{ listing: Row }>(`/listings/${id}`);
  const run = useDo(async () => {
    await reload();
    onChanged();
  });
  const { ask, modal } = usePrompt();
  const [edit, setEdit] = useState<Row | null>(null);
  const [until, setUntil] = useState("");
  const l = data?.listing;
  const act = (body: Row, ok: string) => run(() => adminApi.post(`/listings/${id}/action`, body), ok);
  return (
    <Modal open onClose={onClose} title={l?.title ?? "Listing"} wide>
      {!l ? (
        <Skeleton h={300} />
      ) : (
        <div className="stack g-16">
          <div className="doc-grid">
            {l.photos.map((p: string) => (
              <div key={p} style={{ position: "relative" }}>
                <img src={thumb(p)} alt="" />
                <button
                  className="badge badge-glass"
                  style={{ position: "absolute", top: 8, right: 8 }}
                  onClick={() => confirm("Remove this photo?") && run(() => adminApi.put(`/listings/${id}/photos`, { photos: l.photos.filter((x: string) => x !== p) }), "Photo removed")}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="row g-8 wrap">
            <StatusBadge status={l.status} />
            {l.availability && (
              <span className={`avail ${l.availability.status === "available" ? "ok" : "busy"}`}>
                {l.availability.status === "available" ? "Available now" : `Occupied until ${fmtDateTime(l.availability.until)}`}
              </span>
            )}
            <span className="small muted">
              {l.booking_count} paid bookings · {kes(l.paid_in)} paid in · host {l.host_name} ({l.host_phone}, payouts to {l.host_payout_phone ?? l.host_phone})
            </span>
          </div>

          {edit ? (
            <div className="inset stack g-14" style={{ gap: 14 }}>
              <div className="form-grid">
                <Input wrapClass="full" label="Title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
                <Input wrapClass="full" label="Summary" value={edit.summary} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} />
                <Textarea wrapClass="full" label="Description" rows={5} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
                <Input label="Price (KES)" inputMode="numeric" value={edit.priceKes} onChange={(e) => setEdit({ ...edit, priceKes: e.target.value.replace(/\D/g, "") })} />
                <Select label="Status" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  {["DRAFT", "PENDING", "APPROVED", "REJECTED", "PAUSED"].map((s) => (
                    <option key={s} value={s}>
                      {s.toLowerCase()}
                    </option>
                  ))}
                </Select>
                <Input label="City" value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} />
                <Input label="Neighbourhood" value={edit.neighbourhood} onChange={(e) => setEdit({ ...edit, neighbourhood: e.target.value })} />
                {l.type === "STAY" && (
                  <>
                    <Input label="Bedrooms" inputMode="numeric" value={edit.bedrooms} onChange={(e) => setEdit({ ...edit, bedrooms: e.target.value.replace(/\D/g, "") })} />
                    <Input label="Guests" inputMode="numeric" value={edit.maxGuests} onChange={(e) => setEdit({ ...edit, maxGuests: e.target.value.replace(/\D/g, "") })} />
                    <Input label="Minimum nights" inputMode="numeric" value={edit.minNights} onChange={(e) => setEdit({ ...edit, minNights: e.target.value.replace(/\D/g, "") })} />
                  </>
                )}
              </div>
              <div className="row g-8">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={async () => {
                    const body: Row = { title: edit.title, summary: edit.summary, description: edit.description, priceKes: Number(edit.priceKes), status: edit.status, city: edit.city, neighbourhood: edit.neighbourhood };
                    if (l.type === "STAY") Object.assign(body, { bedrooms: Number(edit.bedrooms), maxGuests: Number(edit.maxGuests), minNights: Number(edit.minNights) });
                    if (await run(() => adminApi.patch(`/listings/${id}`, body), "Listing saved")) setEdit(null);
                  }}
                >
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              {l.summary && <p className="strong">{l.summary}</p>}
              <p className="soft prewrap small">{l.description}</p>
              <p className="small muted">
                {l.type === "STAY" ? `${l.bedrooms === 0 ? "Studio" : `${l.bedrooms} bed`} · ${l.max_guests} guests · min ${l.min_nights} nights` : `${l.category} · ${l.duration_min} min · ${l.service_modes.join(" / ")}`} · {kes(l.price_kes)}
              </p>
            </>
          )}

          {l.type === "STAY" && !edit && (
            <div className="inset row g-8 wrap">
              <span className="small strong">Occupancy</span>
              <input className="input" type="datetime-local" style={{ height: 36, width: 220 }} value={until} onChange={(e) => setUntil(e.target.value)} aria-label="Occupied until" />
              <Button size="sm" disabled={!until} onClick={() => run(() => adminApi.put(`/listings/${id}/occupancy`, { status: "occupied", until: new Date(`${until}:00+03:00`).toISOString() }), "Marked occupied")}>
                Mark occupied until
              </Button>
              <Button size="sm" variant="ghost" onClick={() => run(() => adminApi.put(`/listings/${id}/occupancy`, { status: "available" }), "Marked available")}>
                Mark available
              </Button>
              {l.availability?.until && <span className="tiny muted">Now occupied until {toLocalInput(l.availability.until).replace("T", " ")}</span>}
            </div>
          )}

          {!edit && (
            <div className="row g-8 wrap">
              <Button
                size="sm"
                onClick={() =>
                  setEdit({
                    title: l.title, summary: l.summary, description: l.description, priceKes: String(l.price_kes), status: l.status, city: l.city, neighbourhood: l.neighbourhood,
                    bedrooms: String(l.bedrooms ?? 0), maxGuests: String(l.max_guests ?? 1), minNights: String(l.min_nights ?? 1),
                  })
                }
              >
                Edit
              </Button>
              {l.status !== "APPROVED" && (
                <Button variant="primary" size="sm" onClick={() => act({ action: "approve" }, "Approved and live")}>
                  Approve
                </Button>
              )}
              {l.status !== "REJECTED" && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    const reason = await ask("Ask for changes", "What needs to change (sent to the host)");
                    if (reason) await act({ action: "reject", reason }, "Sent back to the host");
                  }}
                >
                  Ask for changes
                </Button>
              )}
              {l.status === "APPROVED" && (
                <>
                  <Button size="sm" onClick={() => act({ action: "pause" }, "Paused")}>
                    Pause
                  </Button>
                  <Button size="sm" onClick={() => act({ action: "feature", days: 7 }, "Featured for 7 days")}>
                    Feature 7 days
                  </Button>
                  {l.featured_until && new Date(l.featured_until) > new Date() && (
                    <Button size="sm" variant="ghost" onClick={() => act({ action: "unfeature" }, "No longer featured")}>
                      Unfeature
                    </Button>
                  )}
                </>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (!confirm("Delete this listing? If it has bookings it is paused instead.")) return;
                  if (await run(() => adminApi.delete(`/listings/${id}`), "Done")) onClose();
                }}
              >
                Delete
              </Button>
              {siteUrl && l.status === "APPROVED" && (
                <a className="btn btn-sm btn-ghost" href={`${siteUrl}/listings/${id}`} target="_blank" rel="noreferrer">
                  Open on the site
                </a>
              )}
            </div>
          )}
        </div>
      )}
      {modal}
    </Modal>
  );
}

// ——— Bookings ———

export function Bookings() {
  const [status, setStatus] = useState("ALL");
  const { data, reload } = useAdmin<{ items: Row[] }>(`/bookings?status=${status}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <Head title="Bookings">
        <select className="select" style={{ height: 38, width: 190 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          {["ALL", "PENDING_PAYMENT", "CONFIRMED", "COMPLETED", "CANCELLED", "EXPIRED"].map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All" : s.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
      </Head>
      <Table
        rows={data?.items}
        onRow={(r) => setOpen(r.id)}
        cols={[
          ["Ref", (r) => <span className="num strong">{r.ref}</span>],
          ["Listing", (r) => r.title],
          ["When", (r) => <span className="small">{r.kind === "STAY" ? fmtRange(r.check_in, r.check_out) : fmtDateTime(r.starts_at)}</span>],
          ["Guest", (r) => r.guest],
          ["Host", (r) => r.host],
          ["Paid", (r) => kes(r.due_now_kes), "r"],
          ["Konnect", (r) => kes(r.platform_fee_kes), "r"],
          ["Status", (r) => <StatusBadge status={r.status} />],
        ]}
      />
      {open && <BookingDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}

function BookingDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, reload } = useAdmin<{ booking: Row }>(`/bookings/${id}`);
  const run = useDo(async () => {
    await reload();
    onChanged();
  });
  const { ask, modal } = usePrompt();
  const b = data?.booking;
  return (
    <Modal open onClose={onClose} title={b ? `${b.ref} · ${b.title}` : "Booking"} wide>
      {!b ? (
        <Skeleton h={260} />
      ) : (
        <div className="stack g-16">
          <div className="row g-8 wrap">
            <StatusBadge status={b.status} />
            <span className="small muted">Made {fmtDateTime(b.created_at)}</span>
          </div>
          <div className="form-grid">
            <div className="inset stack g-6">
              <span className="h-3">When</span>
              <span className="small">{b.kind === "STAY" ? `${fmtRange(b.check_in, b.check_out)} · ${b.nights} nights · ${b.guests} guests` : `${fmtDateTime(b.starts_at)} · ${b.service_mode === "home" ? `Home visit: ${b.visit_address ?? ""}` : "Studio"}`}</span>
            </div>
            <div className="inset stack g-6">
              <span className="h-3">Money</span>
              <span className="small">
                Paid {kes(b.due_now_kes)}
                {b.total_kes > b.due_now_kes ? ` (of ${kes(b.total_kes)}, rest at the session)` : ""} · Konnect {kes(b.platform_fee_kes)} · host {kes(b.due_now_kes - b.platform_fee_kes)}
              </span>
              <span className="small muted">
                {b.mpesa_receipt ? `M-Pesa ${b.mpesa_receipt} from ${b.paid_from}` : `Payment ${String(b.payment_status ?? "not started").toLowerCase()}`}
                {b.refund_needed ? " · refund to send" : b.refund_reference ? ` · refunded ${b.refund_reference}` : ""}
              </span>
            </div>
            <div className="inset stack g-6">
              <span className="h-3">Guest</span>
              <span className="small">
                {b.guest_name} · {b.guest_phone} · {b.guest_email}
              </span>
            </div>
            <div className="inset stack g-6">
              <span className="h-3">Host payout</span>
              <span className="small">
                {b.host_name} · {b.payout_status ? `${kes(b.payout_kes)} ${String(b.payout_status).toLowerCase()} to ${b.payout_phone}${b.payout_reference ? ` · ${b.payout_reference}` : ""}` : "None yet"}
              </span>
              {b.payout_error && <span className="tiny muted">{b.payout_error}</span>}
            </div>
          </div>
          {b.cancel_reason && <div className="notice small">Cancelled: {b.cancel_reason}</div>}
          <div className="row g-8 wrap">
            {b.status === "CONFIRMED" && (
              <Button size="sm" onClick={() => run(() => adminApi.post(`/bookings/${id}/complete`), "Marked complete")}>
                Mark complete
              </Button>
            )}
            {["PENDING_PAYMENT", "CONFIRMED"].includes(b.status) && (
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  const reason = await ask(`Cancel ${b.ref}`, "Reason (sent to guest and host)");
                  if (reason) await run(() => adminApi.post(`/bookings/${id}/cancel`, { reason }), "Cancelled; refund queued if paid");
                }}
              >
                Cancel booking
              </Button>
            )}
            {b.refund_needed && b.payment_id && (
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  const ref = await ask("Refund sent", "M-Pesa reference of the refund");
                  if (ref) await run(() => adminApi.post(`/payments/${b.payment_id}/refunded`, { reference: ref }), "Marked refunded");
                }}
              >
                Mark refunded
              </Button>
            )}
          </div>
        </div>
      )}
      {modal}
    </Modal>
  );
}

// ——— Payments ———

export function Payments() {
  const [f, setF] = useState({ status: "ALL", purpose: "ALL", from: "", to: "", refunds: false });
  const qs = new URLSearchParams({ status: f.status, purpose: f.purpose, ...(f.from && { from: f.from }), ...(f.to && { to: f.to }), ...(f.refunds && { refunds: "true" }) }).toString();
  const { data, reload } = useAdmin<{ items: Row[] }>(`/payments?${qs}`);
  const run = useDo(reload);
  const { ask, modal } = usePrompt();
  const toast = useToast();
  const exportCsv = async () => {
    try {
      const r = await adminApi.get(`/payments.csv?${qs}`, { responseType: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(r.data);
      a.download = `konnect-payments-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const total = (data?.items ?? []).filter((p) => p.status === "SUCCESS").reduce((s, p) => s + p.amount_kes, 0);
  return (
    <>
      <Head title="Payments">
        <Button size="sm" icon={<RefreshCw />} onClick={() => run(() => adminApi.post("/payments/reconcile"), "Asked M-Pesa about pending payments")}>
          Check pending
        </Button>
        <Button size="sm" variant="ink" icon={<Download />} onClick={exportCsv}>
          Export CSV
        </Button>
      </Head>
      <div className="row g-8 wrap" style={{ marginBottom: 14 }}>
        <select className="select" style={{ height: 38, width: 150 }} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          {["ALL", "PENDING", "SUCCESS", "FAILED"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select className="select" style={{ height: 38, width: 170 }} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })}>
          {["ALL", "BOOKING", "SUBSCRIPTION", "AD_CAMPAIGN", "PROMOTION"].map((s) => (
            <option key={s} value={s}>
              {s === "ALL" ? "All purposes" : PURPOSE[s]}
            </option>
          ))}
        </select>
        <input className="input" type="date" style={{ height: 38, width: 160 }} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From" />
        <input className="input" type="date" style={{ height: 38, width: 160 }} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To" />
        <label className="check small">
          <input type="checkbox" checked={f.refunds} onChange={(e) => setF({ ...f, refunds: e.target.checked })} /> Refunds to send
        </label>
        <span className="small muted" style={{ marginLeft: "auto" }}>
          {data ? `${num(data.items.length)} shown · ${kes(total)} received` : ""}
        </span>
      </div>
      <Table
        rows={data?.items}
        cols={[
          ["When", (r) => <span className="small">{fmtDateTime(r.created_at)}</span>],
          ["For", (r) => PURPOSE[r.purpose]],
          ["Who", (r) => (
            <span className="small">
              {r.full_name ?? "—"}
              <br />
              <span className="muted">{r.phone}</span>
            </span>
          )],
          ["Amount", (r) => <span className="strong">{kes(r.amount_kes)}</span>, "r"],
          ["Status", (r) => <span className={`badge ${r.status === "SUCCESS" ? "badge-ok" : r.status === "FAILED" ? "badge-danger" : "badge-warn"}`}>{r.status.toLowerCase()}</span>],
          ["Receipt", (r) => <span className="num small">{r.mpesa_receipt ?? (r.result_desc ? <span className="muted">{r.result_desc.slice(0, 40)}</span> : "—")}</span>],
          ["", (r) => (
            <span className="row g-6">
              {r.driver === "simulated" && <span className="badge">test</span>}
              {r.refund_needed && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={async () => {
                    const ref = await ask("Refund sent", "M-Pesa reference of the refund");
                    if (ref) await run(() => adminApi.post(`/payments/${r.id}/refunded`, { reference: ref }), "Marked refunded");
                  }}
                >
                  Mark refunded
                </Button>
              )}
            </span>
          )],
        ]}
      />
      {modal}
    </>
  );
}

// ——— Payouts ———

export function Payouts() {
  const [status, setStatus] = useState<"ATTENTION" | "SENDING" | "HELD" | "PAID" | "ALL">("ATTENTION");
  const { data, reload } = useAdmin<{ items: Row[]; driver: string | null }>(`/payouts?status=${status}`);
  const run = useDo(reload);
  const { ask, modal } = usePrompt();
  const LABEL: Record<string, string> = { QUEUED: "waiting", SENDING: "sending", PAID: "sent", FAILED: "failed", HELD: "held" };
  return (
    <>
      <Head title="Payouts" />
      <p className="small muted" style={{ marginTop: -10, marginBottom: 14 }}>
        {data?.driver
          ? "Each host's 85% is sent by M-Pesa B2C the moment the guest's payment clears. Anything that failed or couldn't be sent waits here."
          : "M-Pesa B2C isn't set up, so payouts wait here. Send each one from the Konnect M-Pesa account to the host's number and record the reference."}
      </p>
      <Tabs value={status} onChange={setStatus} options={[["ATTENTION", "Needs attention"], ["SENDING", "Sending"], ["HELD", "Held"], ["PAID", "Sent"], ["ALL", "All"]]} />
      <Table
        rows={data?.items}
        empty="Nothing here"
        cols={[
          ["Created", (r) => <span className="small">{fmtDateTime(r.created_at)}</span>],
          ["Host", (r) => (
            <span className="small">
              {r.host_name}
              <br />
              <span className="muted num">{r.phone}</span>
            </span>
          )],
          ["Booking", (r) => (
            <span className="small">
              {r.booking_ref} · {r.title}
              {r.gross_kes ? (
                <>
                  <br />
                  <span className="muted">
                    {kes(r.gross_kes)} paid · {kes(r.commission_kes)} commission
                  </span>
                </>
              ) : null}
            </span>
          )],
          ["To host", (r) => <span className="strong">{kes(r.amount_kes)}</span>, "r"],
          ["Status", (r) => (
            <span className="stack g-4">
              <span className={`badge ${r.status === "PAID" ? "badge-ok" : r.status === "HELD" || r.status === "FAILED" ? "badge-danger" : "badge-warn"}`}>{LABEL[r.status] ?? r.status}</span>
              {r.last_error && <span className="tiny muted">{String(r.last_error).slice(0, 80)}</span>}
            </span>
          )],
          ["", (r) => (
            <span className="row g-6 wrap">
              {(r.status === "QUEUED" || r.status === "FAILED") && (
                <>
                  {data?.driver && (
                    <Button size="sm" variant="primary" onClick={() => run(() => adminApi.post(`/payouts/${r.id}/action`, { action: "send" }), "Sent to M-Pesa")}>
                      Send now
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={data?.driver ? "outline" : "primary"}
                    onClick={async () => {
                      const reference = await ask(`Paid ${kes(r.amount_kes)} to ${r.host_name} by hand`, "M-Pesa reference of the payment");
                      if (reference) await run(() => adminApi.post(`/payouts/${r.id}/action`, { action: "paid", reference }), "Recorded as paid");
                    }}
                  >
                    Mark paid
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => run(() => adminApi.post(`/payouts/${r.id}/action`, { action: "hold" }), "Held")}>
                    Hold
                  </Button>
                </>
              )}
              {r.status === "HELD" && (
                <Button size="sm" onClick={() => run(() => adminApi.post(`/payouts/${r.id}/action`, { action: "release" }), "Released")}>
                  Release
                </Button>
              )}
              {r.reference && <span className="small muted num">{r.reference}</span>}
            </span>
          )],
        ]}
      />
      {modal}
    </>
  );
}

// ——— Ads ———

export function Ads() {
  const { data, reload } = useAdmin<{ items: Row[] }>("/ads");
  const run = useDo(reload);
  const { ask, modal } = usePrompt();
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ advertiser: "", headline: "", text: "", cta: "Learn more", url: "https://", billing: "CPM", budgetKes: "0", house: false });
  const act = (id: string, body: Row, ok: string) => run(() => adminApi.post(`/ads/${id}/action`, body), ok);
  return (
    <>
      <Head title="Ads">
        <Button size="sm" variant="ink" icon={<Plus />} onClick={() => setCreating(true)}>
          Team campaign
        </Button>
      </Head>
      <Table
        rows={data?.items}
        cols={[
          ["", (r) => (r.image_url ? <img className="thumb" src={r.image_url} alt="" /> : <span className="thumb" />)],
          ["Campaign", (r) => (
            <span className="stack">
              <span className="strong">{r.headline}</span>
              <span className="small muted">
                {r.advertiser}
                {r.is_house ? " · house" : r.owner_name ? ` · ${r.owner_name}` : " · team"}
              </span>
            </span>
          )],
          ["Billing", (r) => r.billing],
          ["Budget", (r) => kes(r.budget_kes), "r"],
          ["Spent", (r) => kes(r.spent_kes), "r"],
          ["Impr.", (r) => num(r.impressions), "r"],
          ["Clicks", (r) => num(r.clicks), "r"],
          ["Status", (r) => <span className={`badge ${r.status === "ACTIVE" ? "badge-ok" : r.status === "PENDING_REVIEW" ? "badge-warn" : r.status === "REJECTED" ? "badge-danger" : ""}`}>{r.status.replace("_", " ").toLowerCase()}</span>],
          ["", (r) => (
            <span className="row g-6">
              {r.status === "PENDING_REVIEW" && (
                <>
                  <Button size="sm" variant="primary" onClick={() => act(r.id, { action: "approve" }, "Approved")}>
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      const note = await ask("Ask for changes", "What needs to change");
                      if (note) await act(r.id, { action: "reject", note }, "Sent back");
                    }}
                  >
                    Reject
                  </Button>
                </>
              )}
              {r.status === "ACTIVE" && (
                <Button size="sm" variant="ghost" onClick={() => act(r.id, { action: "pause" }, "Paused")}>
                  Pause
                </Button>
              )}
              {r.status === "PAUSED" && (
                <Button size="sm" onClick={() => act(r.id, { action: "resume" }, "Running")}>
                  Resume
                </Button>
              )}
              {!["ENDED", "REJECTED"].includes(r.status) && (
                <Button size="sm" variant="ghost" onClick={() => act(r.id, { action: "end" }, "Ended")}>
                  End
                </Button>
              )}
            </span>
          )],
        ]}
      />
      <Modal open={creating} onClose={() => setCreating(false)} title="Team campaign">
        <div className="stack g-14" style={{ gap: 14 }}>
          <Input label="Advertiser" value={f.advertiser} onChange={(e) => setF({ ...f, advertiser: e.target.value })} />
          <Input label="Headline" maxLength={60} value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} />
          <Input label="Text" maxLength={140} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
          <div className="form-grid">
            <Input label="Button" value={f.cta} onChange={(e) => setF({ ...f, cta: e.target.value })} />
            <Input label="Budget (KES)" inputMode="numeric" value={f.budgetKes} onChange={(e) => setF({ ...f, budgetKes: e.target.value.replace(/\D/g, "") })} />
          </div>
          <Input label="Link" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} hint="A full https:// link, or a path inside Konnect such as /membership." />
          <label className="check small">
            <input type="checkbox" checked={f.house} onChange={(e) => setF({ ...f, house: e.target.checked })} /> House placement (no budget, shown when no paid campaign runs)
          </label>
          <Button
            variant="primary"
            onClick={async () => {
              if (await run(() => adminApi.post("/ads", { ...f, budgetKes: Number(f.budgetKes) }), "Campaign running")) setCreating(false);
            }}
          >
            Start campaign
          </Button>
        </div>
      </Modal>
      {modal}
    </>
  );
}

// ——— Verification ———

const KIND: Record<string, string> = { ID: "ID", INCOME: "Income", BACKGROUND: "Background check" };

function Doc({ id, onOpen }: { id: string; onOpen: (url: string) => void }) {
  const url = useBlobUrl(`/media/${id}`);
  return url ? <img src={url} alt="Document" onClick={() => onOpen(url)} /> : <Skeleton h={160} />;
}

export function Verification() {
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");
  const { data, reload } = useAdmin<{ items: Row[] }>(`/verifications?status=${status}`);
  const run = useDo(reload);
  const { ask, modal } = usePrompt();
  const [zoom, setZoom] = useState<string | null>(null);
  return (
    <>
      <Head title="Verification" />
      <Tabs value={status} onChange={setStatus} options={[["PENDING", "To review"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"]]} />
      {!data ? (
        <Skeleton h={300} />
      ) : data.items.length === 0 ? (
        <div className="table-wrap">
          <Empty title="Nothing waiting" />
        </div>
      ) : (
        <div className="stack g-16">
          {data.items.map((v) => (
            <div key={v.id} className="card card-pad stack g-14" style={{ gap: 14 }}>
              <div className="row between wrap g-12">
                <div className="row g-12">
                  <Avatar name={v.full_name} src={v.photo_url} size={44} />
                  <div className="stack">
                    <span className="strong">
                      {v.full_name} · {KIND[v.kind]}
                    </span>
                    <span className="small muted">
                      {v.age} · {v.gender} · {v.phone} · sent {ago(v.created_at)}
                    </span>
                  </div>
                </div>
                {status === "PENDING" && (
                  <div className="row g-8">
                    <Button size="sm" variant="primary" onClick={() => run(() => adminApi.post(`/verifications/${v.id}/action`, { action: "approve" }), "Approved; badge added")}>
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        const note = await ask("Not approved", "Reason (sent to the member)");
                        if (note) await run(() => adminApi.post(`/verifications/${v.id}/action`, { action: "reject", note }), "Rejected");
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
              {v.note && <p className="small soft">“{v.note}”</p>}
              <div className="doc-grid">
                {v.documents.map((d: string) => (
                  <Doc key={d} id={d} onOpen={setZoom} />
                ))}
              </div>
              {v.kind === "ID" && <p className="tiny muted">Check that the name and date of birth match the account ({v.full_name}, {v.age}) and that the selfie shows the same person holding the same document.</p>}
            </div>
          ))}
        </div>
      )}
      {zoom && <Lightbox photos={[zoom]} start={0} onClose={() => setZoom(null)} />}
      {modal}
    </>
  );
}

// ——— Reports and safety ———

const REASON: Record<string, string> = {
  fake_profile: "Fake profile", harassment: "Harassment", scam: "Scam", inappropriate: "Inappropriate", underage: "May be under 18",
  safety: "Safety concern", misleading_listing: "Misleading listing", other: "Other",
};

export function Reports() {
  const [status, setStatus] = useState<"OPEN" | "ACTIONED" | "DISMISSED">("OPEN");
  const { data, reload } = useAdmin<{ items: Row[] }>(`/reports?status=${status}`);
  const run = useDo(reload);
  const resolve = (id: string, action: string, ok: string) => run(() => adminApi.post(`/reports/${id}/resolve`, { action }), ok);
  return (
    <>
      <Head title="Reports" />
      <Tabs value={status} onChange={setStatus} options={[["OPEN", "Open"], ["ACTIONED", "Actioned"], ["DISMISSED", "Dismissed"]]} />
      <Table
        rows={data?.items}
        empty="No reports"
        cols={[
          ["When", (r) => <span className="small">{ago(r.created_at)}</span>],
          ["About", (r) => (
            <span className="small">
              <span className="strong">{r.target_name ?? r.listing_title}</span>
              {r.target_name && r.open_reports > 1 ? <span className="badge badge-danger" style={{ marginLeft: 6 }}>{r.open_reports} reporters</span> : null}
              <br />
              <span className="muted">{r.target_user_id ? `Member · ${r.target_status}` : "Listing"}</span>
            </span>
          )],
          ["Reason", (r) => <span className={`badge ${r.reason === "underage" ? "badge-danger" : ""}`}>{REASON[r.reason]}</span>],
          ["Details", (r) => <span className="small soft">{r.details || "—"}</span>],
          ["From", (r) => <span className="small">{r.reporter_name}</span>],
          ["", (r) =>
            status === "OPEN" ? (
              <span className="row g-6 wrap">
                {r.target_user_id ? (
                  <>
                    <Button size="sm" variant="danger" onClick={() => resolve(r.id, "suspend_user", "Account suspended")}>
                      Suspend
                    </Button>
                    <Button size="sm" onClick={() => resolve(r.id, "hide_profile", "Hidden from Connect")}>
                      Hide profile
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => resolve(r.id, "pause_listing", "Listing paused")}>
                    Pause listing
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => resolve(r.id, r.target_user_id ? "restore_profile" : "dismiss", "Dismissed")}>
                  Dismiss
                </Button>
              </span>
            ) : (
              <span className="small muted">{r.resolution}</span>
            )],
        ]}
      />
    </>
  );
}

export function Safety() {
  const { data, reload } = useAdmin<{ items: Row[] }>("/safety");
  const run = useDo(reload);
  return (
    <>
      <Head title="Safety" />
      <Table
        rows={data?.items}
        empty="No SOS alerts or shared meetups"
        cols={[
          ["When", (r) => <span className="small">{fmtDateTime(r.created_at)}</span>],
          ["Type", (r) => <span className={`badge ${r.kind === "sos" ? (r.status === "OPEN" ? "badge-danger" : "") : ""}`}>{r.kind === "sos" ? "SOS" : "Meetup shared"}</span>],
          ["Member", (r) => (
            <span className="small">
              <span className="strong">{r.full_name}</span>
              <br />
              <a className="link num" href={`tel:${r.phone}`}>
                {r.phone}
              </a>
            </span>
          )],
          ["With", (r) => r.with_name ?? "—"],
          ["Where", (r) =>
            r.lat != null ? (
              <a className="link small" href={`https://maps.google.com/?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer">
                Open map
              </a>
            ) : (
              <span className="small">{r.place ?? "—"}</span>
            )],
          ["Trusted contact", (r) => (
            <span className="small">
              {r.trusted_contact_name ?? "None set"}
              <br />
              <span className="muted">{r.trusted_contact_phone ?? ""}{r.notified_contact ? " · texted" : ""}</span>
            </span>
          )],
          ["", (r) =>
            r.status === "OPEN" && r.kind === "sos" ? (
              <Button size="sm" variant="primary" onClick={() => run(() => adminApi.post(`/safety/${r.id}/handled`), "Marked handled")}>
                Handled
              </Button>
            ) : (
              <span className="small muted">{r.status.toLowerCase()}</span>
            )],
        ]}
      />
    </>
  );
}

// ——— Settings and switches ———

const SETTING_LABELS: [string, string][] = [
  ["commission_pct", "Konnect commission on bookings (%)"],
  ["promotion_week_kes", "Featured listing, per week (KES)"],
  ["ad_cpm_kes", "Ads: per 1,000 impressions (KES)"],
  ["ad_cpc_kes", "Ads: per click (KES)"],
  ["ad_min_budget_kes", "Ads: minimum first payment (KES)"],
  ["support_phone", "Support phone"],
  ["safety_phone", "Safety team phone (gets SOS texts)"],
];

const SWITCHES: [string, string, string][] = [
  ["signups_open", "New accounts", "People can create accounts."],
  ["bookings_open", "Bookings", "Guests can book and pay. Off pauses every new booking and payment prompt."],
  ["connect_open", "Connect", "Profiles, likes, matches and messages."],
  ["wellness_open", "Wellness", "Treatments are listed and bookable. Off hides them from the site."],
];

export function SettingsPage() {
  const { data, reload } = useAdmin<{ settings: Row; integrations: Row }>("/settings");
  const [draft, setDraft] = useState<Row | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const run = useDo(reload);
  const toast = useToast();
  if (!data) return <Skeleton h={400} />;
  const s = draft ?? data.settings;
  const i = data.integrations;
  const flip = (k: string, v: boolean) => run(() => adminApi.put("/settings", { [k]: v }), `${SWITCHES.find((x) => x[0] === k)![1]} ${v ? "on" : "off"}`);
  return (
    <>
      <Head title="Settings and switches" />
      <div className="stack g-20">
        <section className="card card-pad stack g-12">
          <div className="stack g-4">
            <h2 className="h-2">Site switches</h2>
            <p className="small muted">Changes reach the site within about ten seconds.</p>
          </div>
          <div className="list">
            {SWITCHES.map(([k, title, d]) => (
              <div key={k} className="list-row">
                <div className="grow stack g-4">
                  <span className="strong">{title}</span>
                  <span className="small muted">{d}</span>
                </div>
                <span className={`small ${data.settings[k] ? "accent-text" : "muted"}`} style={{ minWidth: 28 }}>
                  {data.settings[k] ? "On" : "Off"}
                </span>
                <Toggle checked={Boolean(data.settings[k])} onChange={(v) => flip(k, v)} label={title} />
              </div>
            ))}
          </div>
          <div className="stack g-8">
            <span className="label">Banner across the site</span>
            <div className="row g-8">
              <input className="input" maxLength={200} placeholder="Empty for none" value={banner ?? data.settings.site_banner ?? ""} onChange={(e) => setBanner(e.target.value)} />
              <Button
                disabled={banner === null}
                onClick={async () => {
                  if (await run(() => adminApi.put("/settings", { site_banner: banner }), banner ? "Banner shown" : "Banner removed")) setBanner(null);
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </section>

        <div className="detail" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 20 }}>
          <section className="card card-pad stack g-16">
            <h2 className="h-2">Prices and rules</h2>
            <div className="form-grid">
              {SETTING_LABELS.map(([k, l]) => (
                <Input key={k} label={l} value={String(s[k] ?? "")} onChange={(e) => setDraft({ ...s, [k]: k.endsWith("phone") ? e.target.value : e.target.value.replace(/\D/g, "") })} />
              ))}
            </div>
            <div className="row g-8">
              <Button
                variant="primary"
                disabled={!draft}
                onClick={async () => {
                  const body = Object.fromEntries(SETTING_LABELS.map(([k]) => [k, k.endsWith("phone") ? draft![k] : Number(draft![k])]));
                  if (await run(() => adminApi.put("/settings", body), "Settings saved")) setDraft(null);
                }}
              >
                Save
              </Button>
              {draft && (
                <Button variant="ghost" onClick={() => setDraft(null)}>
                  Discard
                </Button>
              )}
            </div>
          </section>
          <section className="stack g-20">
            <div className="card card-pad stack g-12">
              <h2 className="h-2">Integrations</h2>
              <dl className="kv">
                <dt>M-Pesa collections</dt>
                <dd>{i.mpesa.driver === "daraja" ? `Daraja (${i.mpesa.env}) · ${i.mpesa.till ? `till ${i.mpesa.till}` : `shortcode ${i.mpesa.shortcode}`}` : <span className="badge badge-warn">Simulated</span>}</dd>
                <dt>Host payouts (B2C)</dt>
                <dd>{i.b2c.driver === "daraja" ? `Daraja · shortcode ${i.b2c.shortcode}` : i.b2c.driver === "simulated" ? <span className="badge badge-warn">Simulated</span> : <span className="badge">Not set up · paid by hand</span>}</dd>
                <dt>SMS (Africa's Talking)</dt>
                <dd>{i.sms.configured ? `On${i.sms.senderId ? ` · ${i.sms.senderId}` : ""}` : <span className="badge">Off · texts go to the server log</span>}</dd>
                <dt>Phone confirmation at sign-up</dt>
                <dd>{i.phoneVerification ? "Required" : "Off"}</dd>
                <dt>Photo storage</dt>
                <dd>{i.cloudinary.configured ? "Cloudinary" : "Database"}</dd>
                <dt>Sample listings</dt>
                <dd>{i.sampleContent ? "Shown" : "Off"}</dd>
              </dl>
              <p className="tiny muted">These are set in the server's environment on Render (MPESA_*, AT_*, CLOUDINARY_URL, PHONE_VERIFICATION, SAMPLE_CONTENT).</p>
            </div>
            <div className="card card-pad stack g-12">
              <h2 className="h-2">Send a test SMS</h2>
              <div className="row g-8">
                <input className="input" placeholder="07XX XXX XXX" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
                <Button
                  onClick={async () => {
                    try {
                      const r = await adminApi.post<{ sent: boolean }>("/sms/test", { phone: testPhone });
                      toast(r.data.sent ? "Sent" : "SMS is off: the text was written to the server log", r.data.sent ? "ok" : "info");
                    } catch (e) {
                      toast(errorMessage(e), "error");
                    }
                  }}
                >
                  Send
                </Button>
              </div>
            </div>
            {i.sampleContent && (
              <div className="card card-pad stack g-12">
                <h2 className="h-2">Sample listings</h2>
                <p className="small muted">Removes the sample stays and treatments and the Konnect house placement. Do this once real hosts are live; it can't be undone.</p>
                <div>
                  <Button
                    variant="danger"
                    onClick={async () => {
                      if (confirm("Remove all sample listings?")) await run(() => adminApi.post("/samples/remove"), "Samples removed");
                    }}
                  >
                    Remove samples
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

// ——— Audit ———

export function Audit() {
  const { data } = useAdmin<{ items: Row[] }>("/audit");
  return (
    <>
      <Head title="Audit log" />
      <Table
        rows={data?.items}
        cols={[
          ["When", (r) => <span className="small">{fmtDateTime(r.created_at)}</span>],
          ["Who", (r) => r.admin_name ?? "—"],
          ["Action", (r) => <span className="num small">{r.action}</span>],
          ["Target", (r) => <span className="small muted">{r.target_type ? `${r.target_type} ${String(r.target_id).slice(0, 8)}` : "—"}</span>],
          ["Detail", (r) => <span className="small muted">{Object.keys(r.detail ?? {}).length ? JSON.stringify(r.detail).slice(0, 120) : ""}</span>],
        ]}
      />
    </>
  );
}

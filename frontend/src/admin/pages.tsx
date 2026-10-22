import { Download, Plus, RefreshCw, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "../api/client";
import { AreaChart } from "../components/Chart";
import { Lightbox } from "../components/Gallery";
import { Avatar, Button, Empty, Input, Modal, Select, Skeleton, StatusBadge, Textarea } from "../components/ui";
import { useToast } from "../context/ui";
import { ago, fmtDate, fmtDateTime, fmtRange, kes, num, thumb } from "../lib/format";
import type { AdminMe } from "./Admin";
import { adminApi, useAdmin, useBlobUrl } from "./api";

type Row = Record<string, any>;

function Head({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="admin-head">
      <h1>{title}</h1>
      {children && <div className="row g-8 wrap">{children}</div>}
    </div>
  );
}

function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
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

function Table({ cols, rows, onRow, empty = "Nothing here" }: { cols: [string, (r: Row) => ReactNode, string?][]; rows: Row[] | undefined; onRow?: (r: Row) => void; empty?: string }) {
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
function useDo(reload: () => Promise<void> | void) {
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
function usePrompt() {
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

const PURPOSE: Record<string, string> = { BOOKING: "Booking", SUBSCRIPTION: "Membership", AD_CAMPAIGN: "Ads", PROMOTION: "Featured" };

export function Overview() {
  const { data } = useAdmin<{ revenue: Record<string, number>; counts: Record<string, number>; series: { day: string; signups: number; revenue: number; bookings: number }[]; neighbourhoods: Row[]; recent: Row[]; driver: string }>("/overview");
  if (!data) return <Skeleton h={480} r={16} />;
  const { revenue: r, counts: c } = data;
  const queues: [string, number, string][] = [
    ["Listings to review", c.q_listings, "/admin/listings"],
    ["Verifications", c.q_verifications, "/admin/verification"],
    ["Open reports", c.q_reports, "/admin/reports"],
    ["Open SOS", c.q_sos, "/admin/safety"],
    ["Payouts due", c.q_payouts, "/admin/payouts"],
    ["Refunds to send", c.q_refunds, "/admin/payments"],
    ["Ads to review", c.q_ads, "/admin/ads"],
  ];
  return (
    <>
      <Head title="Overview">{data.driver === "simulated" && <span className="badge badge-warn">Payments are simulated · no money moves</span>}</Head>
      <div className="stack g-20">
        <div className="grid-stats">
          <div className="stat">
            <span className="label">Revenue, 30 days</span>
            <span className="value">{kes(r.month)}</span>
            <span className="delta">
              {kes(r.today)} today · {kes(r.week)} this week
            </span>
          </div>
          <div className="stat">
            <span className="label">Members</span>
            <span className="value">{num(c.members)}</span>
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
                Membership {kes(r.subscriptions)} · Fees {kes(r.bookingFees)} · Ads {kes(r.ads)} · Featured {kes(r.promotions)}
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
  const [term, setTerm] = useState("");
  const { data, reload } = useAdmin<{ items: Row[]; total: number }>(`/users?${new URLSearchParams({ ...(term && { q: term }), ...(status && { status }) })}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <Head title="Users">
        <form
          className="row g-8"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q);
          }}
        >
          <div className="input-group">
            <Search size={16} style={{ position: "absolute", left: 12, color: "var(--ink-3)" }} />
            <input className="input" style={{ paddingLeft: 36, height: 38, width: 260 }} placeholder="Name, email, phone, code" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" style={{ height: 38, width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
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
          ["Name", (r) => <span className="strong">{r.full_name}</span>],
          ["Contact", (r) => (
            <span className="small">
              {r.email}
              <br />
              <span className="muted">{r.phone}</span>
            </span>
          )],
          ["Age", (r) => r.age, "r"],
          ["Verified", badges],
          ["Plan", (r) => (r.premium_until ? <span className="badge badge-brass">Member</span> : <span className="muted small">Free</span>)],
          ["Status", (r) => <span className={`badge ${r.status === "active" ? "badge-ok" : r.status === "suspended" ? "badge-danger" : ""}`}>{r.status}</span>],
          ["Joined", (r) => <span className="small muted">{fmtDate(r.created_at)}</span>],
        ]}
      />
      {open && <UserDrawer id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}

function UserDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, reload } = useAdmin<{ user: Row; bookings: Row[]; payments: Row[]; reports: Row[]; verifications: Row[]; listings: Row[]; subscriptions: Row[] }>(`/users/${id}`);
  const run = useDo(async () => {
    await reload();
    onChanged();
  });
  const { ask, modal } = usePrompt();
  const [days, setDays] = useState("30");
  const act = (body: Row, ok: string) => run(() => adminApi.post(`/users/${id}/action`, body), ok);
  const u = data?.user;
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
              <span className="small">Verified: {badges(u)}</span>
              {u.status === "suspended" && <span className="small" style={{ color: "var(--danger)" }}>Suspended: {u.suspended_reason}</span>}
            </div>
          </div>
          <div className="row g-8 wrap">
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
            {!u.phone_verified_at && (
              <Button size="sm" onClick={() => act({ action: "verify_phone" }, "Phone marked confirmed")}>
                Confirm phone
              </Button>
            )}
            <span className="row g-6">
              <select className="select" style={{ height: 36, width: 100 }} value={days} onChange={(e) => setDays(e.target.value)}>
                {["7", "30", "90", "365"].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={() => act({ action: "grant_premium", days: Number(days) }, "Membership added")}>
                Add membership
              </Button>
            </span>
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
          </div>
          <div className="form-grid">
            <MiniList title="Bookings" rows={data.bookings} render={(b) => `${b.ref} · ${b.title} · ${b.status.toLowerCase()} · ${kes(b.total_kes)}`} />
            <MiniList title="Payments" rows={data.payments} render={(p) => `${PURPOSE[p.purpose]} · ${kes(p.amount_kes)} · ${p.status.toLowerCase()}${p.mpesa_receipt ? ` · ${p.mpesa_receipt}` : ""}`} />
            <MiniList title="Membership" rows={data.subscriptions} render={(s) => `${s.period} · ${s.source} · until ${fmtDate(s.expires_at)}`} />
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

export function Listings() {
  const [status, setStatus] = useState<"PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "ALL">("PENDING");
  const { data, reload } = useAdmin<{ items: Row[] }>(`/listings?status=${status}`);
  const run = useDo(reload);
  const { ask, modal } = usePrompt();
  const [view, setView] = useState<Row | null>(null);
  const act = (id: string, body: Row, ok: string) => run(() => adminApi.post(`/listings/${id}/action`, body), ok);
  return (
    <>
      <Head title="Listings" />
      <Tabs value={status} onChange={setStatus} options={[["PENDING", "To review"], ["APPROVED", "Live"], ["REJECTED", "Changes asked"], ["PAUSED", "Paused"], ["ALL", "All"]]} />
      <Table
        rows={data?.items}
        empty={status === "PENDING" ? "No listings waiting for review" : "Nothing here"}
        onRow={setView}
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
          ["Photos", (r) => r.photos?.length ?? 0, "r"],
          ["Status", (r) => <StatusBadge status={r.status} />],
          ["Updated", (r) => <span className="small muted">{ago(r.updated_at)}</span>],
        ]}
      />
      {view && (
        <Modal open onClose={() => setView(null)} title={view.title} wide>
          <div className="stack g-16">
            <div className="doc-grid">
              {view.photos.map((p: string) => (
                <img key={p} src={thumb(p)} alt="" />
              ))}
            </div>
            <p className="small muted">
              {view.type === "STAY" ? `${view.bedrooms} bed · ${view.max_guests} guests · min ${view.min_nights} nights` : `${view.category} · ${view.duration_min} min · ${view.service_modes.join(" / ")}`} · {kes(view.price_kes)}
            </p>
            {view.summary && <p className="strong">{view.summary}</p>}
            <p className="soft prewrap small">{view.description}</p>
            <div className="row g-8 wrap">
              {view.status !== "APPROVED" && (
                <Button variant="primary" size="sm" onClick={async () => (await act(view.id, { action: "approve" }, "Approved and live")) && setView(null)}>
                  Approve
                </Button>
              )}
              {view.status !== "REJECTED" && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={async () => {
                    const reason = await ask("Ask for changes", "What needs to change (sent to the host)");
                    if (reason && (await act(view.id, { action: "reject", reason }, "Sent back to the host"))) setView(null);
                  }}
                >
                  Ask for changes
                </Button>
              )}
              {view.status === "APPROVED" && (
                <>
                  <Button size="sm" onClick={() => act(view.id, { action: "pause" }, "Paused")}>
                    Pause
                  </Button>
                  <Button size="sm" onClick={() => act(view.id, { action: "feature", days: 7 }, "Featured for 7 days")}>
                    Feature 7 days
                  </Button>
                  {view.featured_until && new Date(view.featured_until) > new Date() && (
                    <Button size="sm" variant="ghost" onClick={() => act(view.id, { action: "unfeature" }, "No longer featured")}>
                      Unfeature
                    </Button>
                  )}
                </>
              )}
              <Link className="btn btn-sm btn-ghost" to={`/listings/${view.id}`} target="_blank">
                Open listing
              </Link>
            </div>
          </div>
        </Modal>
      )}
      {modal}
    </>
  );
}

// ——— Bookings ———

export function Bookings() {
  const [status, setStatus] = useState("ALL");
  const { data, reload } = useAdmin<{ items: Row[] }>(`/bookings?status=${status}`);
  const run = useDo(reload);
  const { ask, modal } = usePrompt();
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
        cols={[
          ["Ref", (r) => <span className="num strong">{r.ref}</span>],
          ["Listing", (r) => r.title],
          ["When", (r) => <span className="small">{r.kind === "STAY" ? fmtRange(r.check_in, r.check_out) : fmtDateTime(r.starts_at)}</span>],
          ["Guest", (r) => r.guest],
          ["Host", (r) => r.host],
          ["Paid", (r) => kes(r.due_now_kes), "r"],
          ["Fee", (r) => kes(r.platform_fee_kes), "r"],
          ["Status", (r) => <StatusBadge status={r.status} />],
          ["", (r) =>
            ["PENDING_PAYMENT", "CONFIRMED"].includes(r.status) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={async (e) => {
                  e.stopPropagation();
                  const reason = await ask(`Cancel ${r.ref}`, "Reason (sent to guest and host)");
                  if (reason) await run(() => adminApi.post(`/bookings/${r.id}/cancel`, { reason }), "Cancelled; refund queued if paid");
                }}
              >
                Cancel
              </Button>
            )],
        ]}
      />
      {modal}
    </>
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
  const [status, setStatus] = useState<"DUE" | "SCHEDULED" | "HELD" | "PAID" | "ALL">("DUE");
  const { data, reload } = useAdmin<{ items: Row[] }>(`/payouts?status=${status}`);
  const run = useDo(reload);
  const { ask, modal } = usePrompt();
  return (
    <>
      <Head title="Payouts" />
      <p className="small muted" style={{ marginTop: -10, marginBottom: 14 }}>
        Send each payout from the Konnect M-Pesa account to the host's number, then record the M-Pesa reference here.
      </p>
      <Tabs value={status} onChange={setStatus} options={[["DUE", "Due now"], ["SCHEDULED", "Scheduled"], ["HELD", "Held"], ["PAID", "Paid"], ["ALL", "All"]]} />
      <Table
        rows={data?.items}
        empty="No payouts here"
        cols={[
          ["Due", (r) => <span className="small">{fmtDateTime(r.due_at)}</span>],
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
            </span>
          )],
          ["Amount", (r) => <span className="strong">{kes(r.amount_kes)}</span>, "r"],
          ["Status", (r) => <span className={`badge ${r.status === "PAID" ? "badge-ok" : r.status === "HELD" ? "badge-danger" : "badge-warn"}`}>{r.status.toLowerCase()}</span>],
          ["", (r) => (
            <span className="row g-6">
              {r.status === "SCHEDULED" && (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      const reference = await ask(`Pay ${kes(r.amount_kes)} to ${r.host_name}`, "M-Pesa reference of the payment");
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

// ——— Settings, team, audit ———

const SETTING_LABELS: [string, string][] = [
  ["premium_monthly_kes", "Monthly membership (KES)"],
  ["premium_annual_kes", "Annual membership (KES)"],
  ["booking_fee_kes", "Booking fee (KES)"],
  ["promotion_week_kes", "Featured listing, per week (KES)"],
  ["ad_cpm_kes", "Ads: per 1,000 impressions (KES)"],
  ["ad_cpc_kes", "Ads: per click (KES)"],
  ["ad_min_budget_kes", "Ads: minimum first payment (KES)"],
  ["payout_delay_hours", "Payout after check-in (hours)"],
  ["referral_days", "Referral reward (days)"],
  ["support_phone", "Support phone"],
  ["safety_phone", "Safety team phone (gets SOS texts)"],
];

export function SettingsPage({ me }: { me: AdminMe }) {
  const { data, reload } = useAdmin<{ settings: Row; integrations: Row }>("/settings");
  const [draft, setDraft] = useState<Row | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const run = useDo(reload);
  const toast = useToast();
  if (!data) return <Skeleton h={400} />;
  const s = draft ?? data.settings;
  const i = data.integrations;
  const canEdit = me.role === "owner" || me.role === "admin";
  return (
    <>
      <Head title="Settings" />
      <div className="detail" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 20 }}>
        <section className="card card-pad stack g-16">
          <h2 className="h-2">Prices and rules</h2>
          <div className="form-grid">
            {SETTING_LABELS.map(([k, l]) => (
              <Input key={k} label={l} value={String(s[k] ?? "")} disabled={!canEdit} onChange={(e) => setDraft({ ...s, [k]: k.endsWith("phone") ? e.target.value : e.target.value.replace(/\D/g, "") })} />
            ))}
          </div>
          {canEdit && (
            <div className="row g-8">
              <Button
                variant="primary"
                disabled={!draft}
                onClick={async () => {
                  const body = Object.fromEntries(Object.entries(draft!).map(([k, v]) => [k, k.endsWith("phone") ? v : Number(v)]));
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
          )}
        </section>
        <section className="stack g-20">
          <div className="card card-pad stack g-12">
            <h2 className="h-2">Integrations</h2>
            <dl className="kv">
              <dt>M-Pesa</dt>
              <dd>{i.mpesa.driver === "daraja" ? `Daraja (${i.mpesa.env}) · ${i.mpesa.till ? `till ${i.mpesa.till}` : `shortcode ${i.mpesa.shortcode}`}` : <span className="badge badge-warn">Simulated</span>}</dd>
              <dt>Callback</dt>
              <dd className="small">{i.mpesa.callbackUrl}</dd>
              <dt>SMS (Africa's Talking)</dt>
              <dd>{i.sms.configured ? `On${i.sms.senderId ? ` · ${i.sms.senderId}` : ""}` : <span className="badge">Off · codes go to the server log</span>}</dd>
              <dt>Phone confirmation at sign-up</dt>
              <dd>{i.phoneVerification ? "Required" : "Off"}</dd>
              <dt>Photo storage</dt>
              <dd>{i.cloudinary.configured ? "Cloudinary" : "Database"}</dd>
              <dt>Sample listings</dt>
              <dd>{i.sampleContent ? "Shown" : "Off"}</dd>
            </dl>
            <p className="tiny muted">These are set in the server's environment (MPESA_*, AT_*, CLOUDINARY_URL, PHONE_VERIFICATION, SAMPLE_CONTENT).</p>
          </div>
          {canEdit && (
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
          )}
          {canEdit && i.sampleContent && (
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
    </>
  );
}

export function Team({ me }: { me: AdminMe }) {
  const { data, reload } = useAdmin<{ items: Row[] }>("/team");
  const run = useDo(reload);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ email: "", name: "", role: "moderator" });
  const [temp, setTemp] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const toast = useToast();
  return (
    <>
      <Head title="Team">
        {me.role === "owner" && (
          <Button size="sm" variant="ink" icon={<Plus />} onClick={() => setAdding(true)}>
            Add admin
          </Button>
        )}
      </Head>
      <Table
        rows={data?.items}
        cols={[
          ["Name", (r) => <span className="strong">{r.name}</span>],
          ["Email", (r) => r.email],
          ["Role", (r) => <span className="badge">{r.role}</span>],
          ["Authenticator", (r) => (r.totp_enabled ? <span className="badge badge-ok">On</span> : <span className="badge badge-warn">Not set up</span>)],
          ["Last sign-in", (r) => <span className="small muted">{r.last_login_at ? ago(r.last_login_at) : "Never"}</span>],
          ["", (r) =>
            me.role === "owner" && r.id !== me.id && r.role !== "owner" ? (
              <Button size="sm" variant="ghost" onClick={() => confirm(`Remove ${r.name}?`) && run(() => adminApi.delete(`/team/${r.id}`), "Removed")}>
                Remove
              </Button>
            ) : null],
        ]}
      />
      <section className="card card-pad stack g-12 mt-24" style={{ maxWidth: 520 }}>
        <h2 className="h-2">Your password</h2>
        <Input type="password" label="Current" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        <Input type="password" label="New" hint="At least 12 characters. You'll sign in again after changing it." value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        <div>
          <Button
            disabled={!pw.current || pw.next.length < 12}
            onClick={async () => {
              try {
                await adminApi.post("/password", pw);
                toast("Password changed. Sign in again.", "ok");
                location.reload();
              } catch (e) {
                toast(errorMessage(e), "error");
              }
            }}
          >
            Change password
          </Button>
        </div>
      </section>
      <Modal open={adding} onClose={() => (setAdding(false), setTemp(null))} title="Add an admin">
        {temp ? (
          <div className="stack g-12">
            <p className="soft">Give them this temporary password privately. They set up their authenticator on first sign-in at /admin.</p>
            <span className="secret">{temp}</span>
          </div>
        ) : (
          <div className="stack g-14" style={{ gap: 14 }}>
            <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <Select label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="admin">Admin: everything except the team</option>
              <option value="moderator">Moderator: listings, users, reports, verification, safety</option>
              <option value="finance">Finance: payments, payouts, refunds</option>
            </Select>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  const r = await adminApi.post<{ temporaryPassword: string }>("/team", f);
                  setTemp(r.data.temporaryPassword);
                  void reload();
                } catch (e) {
                  toast(errorMessage(e), "error");
                }
              }}
            >
              Add
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}

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

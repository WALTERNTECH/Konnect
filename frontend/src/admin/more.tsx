import { Search } from "lucide-react";
import { useState } from "react";
import { errorMessage, fieldErrors } from "../api/client";
import { Avatar, Button, CodeInput, Input, Modal, Select, Skeleton, Textarea } from "../components/ui";
import { useToast } from "../context/ui";
import { ago, fmtDateTime, INTENT, ROLE } from "../lib/format";
import { adminApi, useAdmin } from "./api";
import { Head, Table, Tabs, useDo, type Row } from "./pages";

// ——— Connect ———

export function ConnectPage() {
  const [visible, setVisible] = useState<"all" | "shown" | "hidden">("all");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const { data, reload } = useAdmin<{ items: Row[] }>(`/connect?visible=${visible}${term ? `&q=${encodeURIComponent(term)}` : ""}`);
  const run = useDo(reload);
  return (
    <>
      <Head title="Connect">
        <form
          className="input-group"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(q);
          }}
        >
          <Search size={16} style={{ position: "absolute", left: 12, color: "var(--ink-3)" }} />
          <input className="input" style={{ paddingLeft: 36, height: 38, width: 260 }} placeholder="Name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
      </Head>
      <Tabs value={visible} onChange={setVisible} options={[["all", "All profiles"], ["shown", "Shown"], ["hidden", "Hidden"]]} />
      <Table
        rows={data?.items}
        empty="No Connect profiles"
        cols={[
          ["", (r) => <Avatar name={r.full_name} src={r.photos?.[0]} size={36} />],
          ["Member", (r) => (
            <span className="stack">
              <span className="strong">
                {r.full_name}, {r.age}
                {r.id_verified_at ? " ✓" : ""}
              </span>
              <span className="small muted">
                {r.gender} · {r.city} · {r.phone}
              </span>
            </span>
          )],
          ["Looking for", (r) => <span className="small">{INTENT[r.intent]}{r.arrangement_role ? ` · ${ROLE[r.arrangement_role]}` : ""}</span>],
          ["Matches", (r) => r.matches, "r"],
          ["Open reports", (r) => (r.open_reports ? <span className="badge badge-danger">{r.open_reports}</span> : <span className="muted">0</span>), "r"],
          ["Seen", (r) => <span className="small muted">{ago(r.last_seen_at)}</span>],
          ["", (r) =>
            r.visible ? (
              <Button size="sm" variant="ghost" onClick={() => run(() => adminApi.post(`/connect/${r.user_id}/visibility`, { visible: false }), "Hidden from Connect")}>
                Hide
              </Button>
            ) : (
              <Button size="sm" onClick={() => run(() => adminApi.post(`/connect/${r.user_id}/visibility`, { visible: true }), "Shown in Connect")}>
                Show
              </Button>
            )],
        ]}
      />
    </>
  );
}

// ——— Announcements ———

const AUDIENCE: Record<string, string> = { all: "Everyone", hosts: "Hosts", guests: "Guests (not hosting)", user: "One person" };

export function Announcements() {
  const { data, reload } = useAdmin<{ items: Row[] }>("/announcements");
  const toast = useToast();
  const [f, setF] = useState({ audience: "all", userId: "", title: "", body: "", link: "", sms: false });
  const [who, setWho] = useState("");
  const [found, setFound] = useState<Row[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const findUser = async () => {
    try {
      const r = await adminApi.get<{ items: Row[] }>(`/users?q=${encodeURIComponent(who)}&status=active`);
      setFound(r.data.items.slice(0, 6));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };
  const send = async () => {
    if (!confirm(`Send to ${f.audience === "user" ? "this person" : AUDIENCE[f.audience].toLowerCase()}${f.sms ? ", including a text message" : ""}?`)) return;
    setBusy(true);
    setErrors({});
    try {
      const r = await adminApi.post<{ recipients: number }>("/announcements", { ...f, userId: f.audience === "user" ? f.userId : undefined, link: f.link || undefined });
      toast(`Sent to ${r.data.recipients} ${r.data.recipients === 1 ? "person" : "people"}`, "ok");
      setF({ ...f, title: "", body: "", link: "" });
      await reload();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Head title="Announcements" />
      <div className="detail" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)", gap: 20 }}>
        <section className="card card-pad stack g-16">
          <h2 className="h-2">New message</h2>
          <Select label="To" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}>
            {Object.entries(AUDIENCE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          {f.audience === "user" && (
            <div className="stack g-8">
              <div className="row g-8">
                <input className="input" placeholder="Name, email or phone" value={who} onChange={(e) => setWho(e.target.value)} />
                <Button onClick={findUser}>Find</Button>
              </div>
              {found.map((u) => (
                <button key={u.id} className={`chip`} aria-pressed={f.userId === u.id} onClick={() => setF({ ...f, userId: u.id })} style={{ justifyContent: "flex-start" }}>
                  {u.full_name} · {u.phone}
                </button>
              ))}
              {errors.userId && <span className="tiny" style={{ color: "var(--danger)" }}>{errors.userId}</span>}
            </div>
          )}
          <Input label="Title" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} error={errors.title} />
          <Textarea label="Message" rows={4} maxLength={600} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          <Input label="Opens (optional)" placeholder="/host or /stays" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} error={errors.link} hint="A page on the site the notification opens." />
          <label className="check small">
            <input type="checkbox" checked={f.sms} onChange={(e) => setF({ ...f, sms: e.target.checked })} /> Also send it as a text message
          </label>
          <Button variant="primary" loading={busy} disabled={f.title.trim().length < 3 || (f.audience === "user" && !f.userId)} onClick={send}>
            Send
          </Button>
        </section>
        <section className="stack g-12">
          <h2 className="h-2">Sent</h2>
          <Table
            rows={data?.items}
            empty="Nothing sent yet"
            cols={[
              ["When", (r) => <span className="small">{fmtDateTime(r.created_at)}</span>],
              ["To", (r) => <span className="small">{r.audience === "user" ? r.user_name : AUDIENCE[r.audience]}</span>],
              ["Message", (r) => (
                <span className="stack">
                  <span className="strong small">{r.title}</span>
                  {r.body && <span className="small muted clamp-2">{r.body}</span>}
                </span>
              )],
              ["Reached", (r) => <span className="small">{r.recipients}{r.sms ? " · SMS" : ""}</span>, "r"],
            ]}
          />
        </section>
      </div>
    </>
  );
}

// ——— Security ———

export function SecurityPage({ email, onToken }: { email: string; onToken: (t: string) => void }) {
  const { data, reload } = useAdmin<{ email: string; totpEnabled: boolean; lastLoginAt: string | null; createdAt: string; signIns: Row[] }>("/security");
  const toast = useToast();
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [mail, setMail] = useState({ email: "", password: "" });
  const [enrol, setEnrol] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [offPw, setOffPw] = useState("");
  const [offOpen, setOffOpen] = useState(false);
  const call = async (fn: () => Promise<unknown>, ok: string) => {
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
  if (!data) return <Skeleton h={300} />;
  return (
    <>
      <Head title="Security" />
      <div className="detail" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 20 }}>
        <div className="stack g-20">
          <section className="card card-pad stack g-12">
            <h2 className="h-2">The control centre account</h2>
            <p className="small muted">This is the only account. No other can be created; if you lose the password, reset it from the sign-in page with the setup key.</p>
            <dl className="kv">
              <dt>Email</dt>
              <dd>{data.email}</dd>
              <dt>Created</dt>
              <dd>{fmtDateTime(data.createdAt)}</dd>
              <dt>Last sign-in</dt>
              <dd>{data.lastLoginAt ? fmtDateTime(data.lastLoginAt) : "—"}</dd>
            </dl>
          </section>
          <section className="card card-pad stack g-12">
            <h2 className="h-2">Change password</h2>
            <Input type="password" label="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
            <Input type="password" label="New password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" hint="At least 10 characters. Other devices are signed out." />
            <Input type="password" label="Confirm new password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" error={pw.confirm && pw.confirm !== pw.next ? "Doesn't match" : undefined} />
            <div>
              <Button
                variant="primary"
                disabled={!pw.current || pw.next.length < 10 || pw.next !== pw.confirm}
                onClick={() =>
                  call(async () => {
                    const r = await adminApi.post<{ token: string }>("/password", { current: pw.current, next: pw.next });
                    onToken(r.data.token);
                    setPw({ current: "", next: "", confirm: "" });
                  }, "Password changed")
                }
              >
                Change password
              </Button>
            </div>
          </section>
          <section className="card card-pad stack g-12">
            <h2 className="h-2">Change email</h2>
            <Input type="email" label="New email" value={mail.email} onChange={(e) => setMail({ ...mail, email: e.target.value })} placeholder={email} />
            <Input type="password" label="Password" value={mail.password} onChange={(e) => setMail({ ...mail, password: e.target.value })} autoComplete="current-password" />
            <div>
              <Button disabled={!mail.email || !mail.password} onClick={() => call(() => adminApi.post("/security/email", mail).then(() => setMail({ email: "", password: "" })), "Email changed")}>
                Change email
              </Button>
            </div>
          </section>
        </div>
        <div className="stack g-20">
          <section className="card card-pad stack g-12">
            <div className="row between">
              <h2 className="h-2">Authenticator app</h2>
              <span className={`badge ${data.totpEnabled ? "badge-ok" : ""}`}>{data.totpEnabled ? "On" : "Off"}</span>
            </div>
            <p className="small muted">Optional. When it's on, signing in asks for a 6-digit code from Google Authenticator, Microsoft Authenticator or 1Password after your password.</p>
            {data.totpEnabled ? (
              <div>
                <Button variant="ghost" onClick={() => setOffOpen(true)}>
                  Turn off
                </Button>
              </div>
            ) : enrol ? (
              <div className="stack g-12" style={{ alignItems: "flex-start" }}>
                <img src={enrol.qr} alt="Authenticator QR code" className="qr" />
                <span className="secret">{enrol.secret.replace(/(.{4})/g, "$1 ").trim()}</span>
                <CodeInput value={code} onChange={setCode} />
                <Button
                  variant="primary"
                  disabled={code.length !== 6}
                  onClick={async () => {
                    if (await call(() => adminApi.post("/security/totp/confirm", { code }), "Authenticator on")) {
                      setEnrol(null);
                      setCode("");
                    }
                  }}
                >
                  Turn on
                </Button>
              </div>
            ) : (
              <div>
                <Button
                  onClick={async () => {
                    try {
                      setEnrol((await adminApi.post<{ secret: string; qr: string }>("/security/totp/start")).data);
                    } catch (e) {
                      toast(errorMessage(e), "error");
                    }
                  }}
                >
                  Set up an authenticator
                </Button>
              </div>
            )}
          </section>
          <section className="card card-pad stack g-12">
            <h2 className="h-2">Sessions</h2>
            <p className="small muted">Signs out every other browser where the control centre is open.</p>
            <div>
              <Button
                onClick={() =>
                  call(async () => {
                    const r = await adminApi.post<{ token: string }>("/security/sign-out-everywhere");
                    onToken(r.data.token);
                  }, "Signed out everywhere else")
                }
              >
                Sign out other devices
              </Button>
            </div>
          </section>
          <section className="card card-pad stack g-8">
            <h2 className="h-2">Recent sign-ins</h2>
            <div className="list">
              {data.signIns.map((s, i) => (
                <div key={i} className="list-row" style={{ padding: "10px 0" }}>
                  <span className={`badge ${s.action === "admin.sign_in_failed" ? "badge-danger" : s.action === "admin.recover" ? "badge-warn" : "badge-ok"}`}>
                    {s.action === "admin.sign_in_failed" ? "Wrong password" : s.action === "admin.recover" ? "Reset" : "Signed in"}
                  </span>
                  <span className="grow small muted">{s.detail?.ip ?? ""}</span>
                  <span className="small">{fmtDateTime(s.created_at)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      <Modal open={offOpen} onClose={() => setOffOpen(false)} title="Turn off the authenticator">
        <div className="stack g-16">
          <Input type="password" label="Password" value={offPw} onChange={(e) => setOffPw(e.target.value)} />
          <Button
            variant="danger"
            disabled={!offPw}
            onClick={async () => {
              if (await call(() => adminApi.post("/security/totp/disable", { password: offPw }), "Authenticator off")) {
                setOffOpen(false);
                setOffPw("");
              }
            }}
          >
            Turn off
          </Button>
        </div>
      </Modal>
    </>
  );
}

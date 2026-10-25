import { Bell, Camera, Check, Clock, HeartHandshake, KeyRound, ScanFace, ShieldCheck, Upload, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, errorMessage, fieldErrors, useApi } from "../api/client";
import { ConnectProfileEditor } from "../components/ConnectProfileEditor";
import { Avatar, Button, Field, Input, Modal, PageHead, PhoneInput, Select, Textarea, Toggle } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ui";
import { fmtDate } from "../lib/format";
import type { Me } from "../types";
import { useMeta } from "../components/SearchPanel";

export default function Account() {
  const { me } = useAuth();
  if (!me) return null;
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");
  return (
    <div className="page">
      <PageHead eyebrow="Account" title={me.fullName} />
      <div className="split">
        <nav className="side-nav" aria-label="Account">
          <NavLink to="/account" end className={link}>
            <User /> Profile
          </NavLink>
          <NavLink to="/account/connect" className={link}>
            <HeartHandshake /> Connect profile
          </NavLink>
          <NavLink to="/account/verification" className={link}>
            <ScanFace /> Verification
          </NavLink>
          <NavLink to="/account/safety" className={link}>
            <ShieldCheck /> Safety
          </NavLink>
          <NavLink to="/account/notifications" className={link}>
            <Bell /> Notifications
          </NavLink>
          <NavLink to="/account/security" className={link}>
            <KeyRound /> Sign-in and security
          </NavLink>
        </nav>
        <div style={{ minWidth: 0, maxWidth: 680 }}>
          <Routes>
            <Route index element={<Profile />} />
            <Route path="connect" element={<ConnectSection />} />
            <Route path="verification" element={<Verification />} />
            <Route path="safety" element={<Safety />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="security" element={<Security />} />
            <Route path="*" element={<Navigate to="/account" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, sub }: { title: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <section className="card card-pad stack g-20" style={{ marginBottom: 16 }}>
      <div className="stack g-4">
        <h2 className="h-1">{title}</h2>
        {sub && <p className="small muted">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Profile() {
  const { me, setMe } = useAuth();
  const toast = useToast();
  const { data: meta } = useMeta();
  const [f, setF] = useState({ fullName: me!.fullName, bio: me!.bio, city: me!.city, neighbourhood: me!.neighbourhood ?? "", gender: me!.gender });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.patch<{ user: Me }>("/users/me", { ...f, neighbourhood: f.neighbourhood || null });
      setMe(r.data.user);
      toast("Saved", "ok");
    } catch (e) {
      setErrors(fieldErrors(e));
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.[0]) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", files[0]);
      const r = await api.post<{ user: Me }>("/users/me/photo", fd);
      setMe(r.data.user);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setUploading(false);
    }
  };
  return (
    <>
      <Section title="Profile" sub="Your first name and photo appear on bookings and reviews.">
        <div className="row g-16">
          <Avatar name={me!.fullName} src={me!.photoUrl} size={76} />
          <div className="stack g-8">
            <Button size="sm" icon={<Camera />} loading={uploading} onClick={() => file.current?.click()}>
              {me!.photoUrl ? "Change photo" : "Add a photo"}
            </Button>
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files)} />
          </div>
        </div>
        <div className="form-grid">
          <Input wrapClass="full" label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} error={errors.fullName} />
          <Select label="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value, neighbourhood: "" })}>
            {Object.keys(meta?.neighbourhoods ?? { Nairobi: [] }).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select label="Neighbourhood" value={f.neighbourhood} onChange={(e) => setF({ ...f, neighbourhood: e.target.value })}>
            <option value="">Not shown</option>
            {(meta?.neighbourhoods[f.city] ?? []).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </Select>
          <Select label="Gender" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value as Me["gender"] })}>
            <option value="woman">Woman</option>
            <option value="man">Man</option>
            <option value="nonbinary">Non-binary</option>
          </Select>
          <Field label="Date of birth" hint="Contact support to correct it.">
            <input className="input" value={fmtDate(me!.dateOfBirth)} disabled />
          </Field>
          <Textarea wrapClass="full" label="About you" rows={4} maxLength={600} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />
        </div>
        <div>
          <Button variant="primary" loading={busy} onClick={save}>
            Save
          </Button>
        </div>
      </Section>
      <Section title="Contact details" sub="Never shown to other members. Hosts see your phone number once a booking is paid.">
        <dl className="kv">
          <dt>Email</dt>
          <dd>{me!.email}</dd>
          <dt>Phone</dt>
          <dd>
            {me!.phone.replace(/^\+254/, "0")} {me!.phoneVerified ? <span className="badge badge-ok">Confirmed</span> : me!.phoneVerificationRequired ? <span className="badge badge-warn">Not confirmed</span> : null}
          </dd>
          <dt>Member since</dt>
          <dd>{fmtDate(me!.createdAt)}</dd>
        </dl>
      </Section>
      <PayoutNumber />
    </>
  );
}

/** Where a host's 85% is sent. Changing it needs the password, and the account phone is told. */
function PayoutNumber() {
  const { me, setMe } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const r = await api.post<{ user: Me }>("/users/me/payout-phone", { phone, password });
      setMe(r.data.user);
      setOpen(false);
      toast("Payout number changed", "ok");
    } catch (e) {
      setErrors(fieldErrors(e));
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Payout number" sub="When a guest pays for one of your listings, 85% is sent to this M-Pesa number straight away. Konnect keeps 15%.">
      <div className="row between wrap g-12">
        <span className="h-2 num">{me!.payoutPhone.replace(/^\+254/, "0")}</span>
        <Button
          size="sm"
          onClick={() => {
            setPhone("");
            setPassword("");
            setErrors({});
            setOpen(true);
          }}
        >
          Change
        </Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Change payout number">
        <div className="stack g-16">
          <PhoneInput label="New M-Pesa number" value={phone} onChange={setPhone} error={errors.phone} autoFocus />
          <Input label="Your password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} autoComplete="current-password" />
          <p className="small muted">We'll text your account phone to let you know it changed.</p>
          <Button variant="primary" block loading={busy} disabled={!/^0[17]\d{8}$/.test(phone) || !password} onClick={save}>
            Save
          </Button>
        </div>
      </Modal>
    </Section>
  );
}

function ConnectSection() {
  const { me } = useAuth();
  return (
    <Section title="Connect profile" sub="What other members see in Connect.">
      <ConnectProfileEditor />
    </Section>
  );
}

const KINDS = {
  ID: { title: "ID verification", body: "A photo of your national ID or passport, and a selfie holding it. Adds the ID verified badge.", files: ["ID or passport", "Selfie holding the ID"] },
  INCOME: { title: "Income verification", body: "A recent payslip or three months of bank or M-Pesa statements. Adds the Income verified badge to your Connect profile.", files: ["Payslip or statement"] },
  BACKGROUND: { title: "Background check", body: "Your DCI Certificate of Good Conduct, issued in the last 12 months. Adds the Background checked badge for hosts and practitioners.", files: ["Certificate of Good Conduct"] },
} as const;

function Verification() {
  const { me, refresh } = useAuth();
  const { data, reload } = useApi<{ items: { kind: keyof typeof KINDS; status: string; reviewer_note: string | null; created_at: string }[] }>("/verification", { staleMs: 0 });
  const [open, setOpen] = useState<keyof typeof KINDS | null>(null);
  const byKind = Object.fromEntries((data?.items ?? []).map((v) => [v.kind, v]));
  const badge = { ID: me!.badges.id, INCOME: me!.badges.income, BACKGROUND: me!.badges.background };
  return (
    <>
      {(Object.keys(KINDS) as (keyof typeof KINDS)[]).map((k) => {
        const v = byKind[k];
        const done = badge[k];
        return (
          <Section key={k} title={KINDS[k].title} sub={KINDS[k].body}>
            <div className="row between wrap g-12">
              {done ? (
                <span className="badge badge-ok">
                  <Check /> Verified
                </span>
              ) : v?.status === "PENDING" ? (
                <span className="badge badge-warn">
                  <Clock /> In review since {fmtDate(v.created_at)}
                </span>
              ) : v?.status === "REJECTED" ? (
                <span className="badge badge-danger">Not approved{v.reviewer_note ? `: ${v.reviewer_note}` : ""}</span>
              ) : (
                <span className="badge">Not started</span>
              )}
              {!done && v?.status !== "PENDING" && (
                <Button size="sm" icon={<Upload />} onClick={() => setOpen(k)}>
                  {v?.status === "REJECTED" ? "Send again" : "Start"}
                </Button>
              )}
            </div>
          </Section>
        );
      })}
      <p className="small muted">Documents are seen only by the Konnect verification team and are never shown on your profile.</p>
      {open && (
        <UploadDocs
          kind={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            setOpen(null);
            void reload();
            void refresh();
          }}
        />
      )}
    </>
  );
}

function UploadDocs({ kind, onClose, onDone }: { kind: keyof typeof KINDS; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [files, setFiles] = useState<(File | null)[]>(KINDS[kind].files.map(() => null));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      files.forEach((f) => f && fd.append("documents", f));
      fd.append("note", note);
      await api.post(`/verification/${kind}`, fd);
      toast("Sent for review", "ok");
      onDone();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={KINDS[kind].title}>
      <div className="stack g-16">
        {KINDS[kind].files.map((label, i) => (
          <Field key={label} label={label}>
            <label className="btn btn-outline" style={{ justifyContent: "flex-start", overflow: "hidden" }}>
              <Upload /> <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{files[i]?.name ?? "Choose a photo or scan"}</span>
              <input type="file" accept="image/*" hidden onChange={(e) => setFiles((x) => x.map((f, k) => (k === i ? (e.target.files?.[0] ?? null) : f)))} />
            </label>
          </Field>
        ))}
        <Textarea label="Note for the reviewer (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        <Button variant="primary" block loading={busy} disabled={files.some((f) => !f)} onClick={submit}>
          Send for review
        </Button>
      </div>
    </Modal>
  );
}

function Safety() {
  const { me, setMe } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(me!.trustedContact?.name ?? "");
  const [phone, setPhone] = useState(me!.trustedContact?.phone.replace(/^\+254/, "0") ?? "");
  const [busy, setBusy] = useState(false);
  const blocks = useApi<{ items: { id: string; name: string; since: string }[] }>("/safety/blocks", { staleMs: 0 });
  const save = async (clear = false) => {
    setBusy(true);
    try {
      const r = await api.patch<{ user: Me }>("/users/me", { trustedContact: clear ? null : { name, phone } });
      setMe(r.data.user);
      if (clear) {
        setName("");
        setPhone("");
      }
      toast(clear ? "Trusted contact removed" : "Trusted contact saved", "ok");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Section title="Trusted contact" sub="Someone who gets a text when you share a meetup or send an SOS from a conversation.">
        <div className="form-grid">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <PhoneInput label="Phone" value={phone} onChange={setPhone} />
        </div>
        <div className="row g-8">
          <Button variant="primary" loading={busy} onClick={() => save()} disabled={name.trim().length < 2 || !/^0[17]\d{8}$/.test(phone)}>
            Save
          </Button>
          {me!.trustedContact && (
            <Button variant="ghost" onClick={() => save(true)}>
              Remove
            </Button>
          )}
        </div>
      </Section>
      <Section title="Blocked members" sub="People you've blocked can't see you in Connect or message you.">
        {(blocks.data?.items.length ?? 0) === 0 ? (
          <p className="small muted">You haven't blocked anyone.</p>
        ) : (
          <div className="list">
            {blocks.data!.items.map((b) => (
              <div key={b.id} className="list-row">
                <span className="grow">
                  <span className="strong">{b.name}</span> <span className="small muted">since {fmtDate(b.since)}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api.delete(`/safety/block/${b.id}`);
                    void blocks.reload();
                  }}
                >
                  Unblock
                </Button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

function Notifications() {
  const { me, setMe } = useAuth();
  const [prefs, setPrefs] = useState(me!.prefs);
  useEffect(() => setPrefs(me!.prefs), [me]);
  const set = async (k: keyof Me["prefs"], v: boolean) => {
    setPrefs({ ...prefs, [k]: v });
    const r = await api.patch<{ user: Me }>("/users/me", { prefs: { [k]: v } });
    setMe(r.data.user);
  };
  const rows: [keyof Me["prefs"], string, string][] = [
    ["sms", "Text messages", "Booking confirmations, reminders and payouts by SMS."],
    ["messages", "New messages", "An alert when a match writes to you while you're away."],
    ["matches", "New matches", "An alert when someone you liked likes you back."],
    ["reminders", "Reminders", "Appointment reminders."],
  ];
  return (
    <Section title="Notifications">
      <div className="list">
        {rows.map(([k, t, d]) => (
          <div key={k} className="list-row">
            <div className="grow stack g-4">
              <span className="strong">{t}</span>
              <span className="small muted">{d}</span>
            </div>
            <Toggle checked={prefs[k] !== false} onChange={(v) => set(k, v)} label={t} />
          </div>
        ))}
      </div>
    </Section>
  );
}

function Security() {
  const { adopt, me, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const [delPw, setDelPw] = useState("");
  return (
    <>
      <Section title="Password">
        <div className="form-grid">
          <Input label="Current password" type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
          <Input label="New password" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" hint="At least 8 characters." />
        </div>
        <div>
          <Button
            variant="primary"
            loading={busy}
            disabled={!cur || next.length < 8}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post("/users/me/password", { current: cur, next });
                setCur("");
                setNext("");
                toast("Password changed", "ok");
              } catch (e) {
                toast(errorMessage(e), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Change password
          </Button>
        </div>
      </Section>
      <Section title="Devices" sub="Sign out of Konnect everywhere except this browser.">
        <div>
          <Button
            onClick={async () => {
              const r = await api.post<{ token: string }>("/auth/logout-all");
              adopt(r.data.token, me!);
              toast("Signed out on other devices", "ok");
            }}
          >
            Sign out other devices
          </Button>
        </div>
      </Section>
      <Section title="Close account" sub="Your profile, Connect profile and matches are removed. Booking and payment records are kept as financial records.">
        <div>
          <Button variant="danger" onClick={() => setDel(true)}>
            Close my account
          </Button>
        </div>
      </Section>
      <Modal open={del} onClose={() => setDel(false)} title="Close your account?">
        <div className="stack g-16">
          <p className="soft">This can't be undone. Enter your password to confirm.</p>
          <Input type="password" label="Password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
          <Button
            variant="danger"
            block
            disabled={!delPw}
            onClick={async () => {
              try {
                await api.delete("/users/me", { data: { password: delPw } });
                logout();
                nav("/");
              } catch (e) {
                toast(errorMessage(e), "error");
              }
            }}
          >
            Close account
          </Button>
        </div>
      </Modal>
    </>
  );
}

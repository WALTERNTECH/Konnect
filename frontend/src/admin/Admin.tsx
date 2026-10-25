import {
  BadgeCheck,
  CalendarDays,
  ExternalLink,
  Flag,
  HeartHandshake,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Megaphone,
  Receipt,
  ScrollText,
  Send,
  Settings,
  Siren,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { errorMessage, fieldErrors } from "../api/client";
import { Logo, Mark } from "../components/brand/Logo";
import { ThemeSwitch } from "../components/Layout";
import { Button, CodeInput, Input, Spinner } from "../components/ui";
import { adminApi, adminToken, setOnExpired, useAdmin } from "./api";
import { Announcements, ConnectPage, SecurityPage } from "./more";
import { Ads, Audit, Bookings, Listings, Overview, Payments, Payouts, Reports, Safety, SettingsPage, Users as UsersPage, Verification } from "./pages";

export type AdminMe = { id: string; email: string; name: string; role: string };

export default function Admin() {
  const [token, setToken] = useState(adminToken.get());
  const [me, setMe] = useState<AdminMe | null>(null);
  const [siteUrl, setSiteUrl] = useState("");
  useEffect(() => {
    setOnExpired(() => {
      setToken(null);
      setMe(null);
    });
  }, []);
  useEffect(() => {
    if (!token) return;
    adminApi
      .get<{ admin: AdminMe; siteUrl: string }>("/me")
      .then((r) => {
        setMe(r.data.admin);
        setSiteUrl(r.data.siteUrl);
      })
      .catch(() => {
        adminToken.set(null);
        setToken(null);
      });
  }, [token]);
  const adopt = (t: string) => {
    adminToken.set(t);
    setToken(t);
  };
  if (!token) return <SignIn onDone={adopt} />;
  if (!me)
    return (
      <div className="auth">
        <Spinner />
      </div>
    );
  return <Shell me={me} siteUrl={siteUrl} onToken={adopt} onSignOut={() => (adminToken.set(null), setToken(null), setMe(null))} />;
}

// ——— Sign-in ———

type Stage = "setup" | "password" | "code" | "recover";

function SignIn({ onDone }: { onDone: (token: string) => void }) {
  const setup = useAdmin<{ needed: boolean; available: boolean }>("/setup");
  const [stage, setStage] = useState<Stage>("password");
  const [pre, setPre] = useState<string | null>(null);
  const [f, setF] = useState({ key: "", email: "", password: "", confirm: "" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (setup.data?.needed) setStage("setup");
  }, [setup.data?.needed]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrors({});
    if ((stage === "setup" || stage === "recover") && f.password !== f.confirm) return setErrors({ confirm: "The passwords don't match" });
    setBusy(true);
    try {
      if (stage === "setup") {
        const r = await adminApi.post<{ token: string }>("/setup", { token: f.key, email: f.email, password: f.password });
        onDone(r.data.token);
      } else if (stage === "recover") {
        const r = await adminApi.post<{ token: string }>("/recover", { token: f.key, password: f.password });
        onDone(r.data.token);
      } else if (stage === "password") {
        const r = await adminApi.post<{ token: string; needsCode: boolean }>("/login", { email: f.email, password: f.password });
        if (r.data.needsCode) {
          setPre(r.data.token);
          setStage("code");
        } else onDone(r.data.token);
      } else {
        const r = await adminApi.post<{ token: string }>("/totp", { code }, { headers: { Authorization: `Bearer ${pre}` } });
        onDone(r.data.token);
      }
    } catch (err) {
      setError(errorMessage(err));
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  };

  if (setup.loading)
    return (
      <div className="auth">
        <Spinner />
      </div>
    );

  const title = { setup: "Set up the control centre", password: "Konnect Control", code: "Authenticator code", recover: "Reset your password" }[stage];
  const sub = {
    setup: "This creates the only account the control centre will ever have. Use the setup key from the server's ADMIN_SETUP_TOKEN setting, then choose your email and password.",
    password: "Sign in with your email and password.",
    code: "Enter the 6-digit code from your authenticator app.",
    recover: "The setup key sets a new password. It also removes the authenticator and signs out every other device.",
  }[stage];

  return (
    <div className="auth control-auth">
      <div className="auth-card">
        <div className="row g-10" style={{ color: "var(--ink)" }}>
          <Mark size={40} />
          <span className="badge badge-outline">Control</span>
        </div>
        <div className="stack g-8">
          <h1 className="display d-3">{title}</h1>
          <p className="soft small">{sub}</p>
        </div>
        <form className="stack g-16" onSubmit={submit}>
          {(stage === "setup" || stage === "recover") && (
            <Input label="Setup key" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} autoComplete="off" error={errors.token} autoFocus />
          )}
          {(stage === "setup" || stage === "password") && (
            <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" error={errors.email} autoFocus={stage === "password"} />
          )}
          {stage !== "code" && (
            <Input
              label={stage === "password" ? "Password" : "New password"}
              type="password"
              value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })}
              autoComplete={stage === "password" ? "current-password" : "new-password"}
              hint={stage === "password" ? undefined : "At least 10 characters."}
              error={errors.password}
            />
          )}
          {(stage === "setup" || stage === "recover") && (
            <Input label="Confirm password" type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" error={errors.confirm} />
          )}
          {stage === "code" && <CodeInput value={code} onChange={setCode} autoFocus />}
          {error && <div className="notice notice-danger small">{error}</div>}
          <Button variant="primary" size="lg" block loading={busy} type="submit">
            {{ setup: "Create the account", password: "Sign in", code: "Verify", recover: "Set new password" }[stage]}
          </Button>
          {stage === "password" && (
            <button type="button" className="small link" style={{ alignSelf: "center" }} onClick={() => (setStage("recover"), setError(null))}>
              Forgot your password?
            </button>
          )}
          {(stage === "recover" || stage === "code") && (
            <button type="button" className="small link" style={{ alignSelf: "center" }} onClick={() => (setStage("password"), setError(null))}>
              Back to sign in
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

// ——— Shell ———

function Shell({ me, siteUrl, onSignOut, onToken }: { me: AdminMe; siteUrl: string; onSignOut: () => void; onToken: (t: string) => void }) {
  const nav = useNavigate();
  const ov = useAdmin<{ counts: Record<string, number> }>("/overview");
  const c = ov.data?.counts ?? {};
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");
  const Count = ({ n }: { n?: number }) => (n ? <span className="count">{n}</span> : null);
  return (
    <div className="admin">
      <aside className="admin-side">
        <div className="brand">
          <Logo height={22} node="#cc6845" />
          <small>Control</small>
        </div>
        <NavLink to="/" end className={link}>
          <LayoutDashboard /> Overview
        </NavLink>
        <div className="group">Money</div>
        <NavLink to="/bookings" className={link}>
          <CalendarDays /> Bookings
        </NavLink>
        <NavLink to="/payments" className={link}>
          <Receipt /> Payments <Count n={c.q_refunds} />
        </NavLink>
        <NavLink to="/payouts" className={link}>
          <Wallet /> Payouts <Count n={c.q_payouts} />
        </NavLink>
        <NavLink to="/ads" className={link}>
          <Megaphone /> Ads <Count n={c.q_ads} />
        </NavLink>
        <div className="group">People and places</div>
        <NavLink to="/listings" className={link}>
          <ListChecks /> Listings <Count n={c.q_listings} />
        </NavLink>
        <NavLink to="/users" className={link}>
          <Users /> Users
        </NavLink>
        <NavLink to="/connect" className={link}>
          <HeartHandshake /> Connect
        </NavLink>
        <NavLink to="/verification" className={link}>
          <BadgeCheck /> Verification <Count n={c.q_verifications} />
        </NavLink>
        <div className="group">Safety</div>
        <NavLink to="/reports" className={link}>
          <Flag /> Reports <Count n={c.q_reports} />
        </NavLink>
        <NavLink to="/safety" className={link}>
          <Siren /> SOS and meetups <Count n={c.q_sos} />
        </NavLink>
        <div className="group">Platform</div>
        <NavLink to="/announcements" className={link}>
          <Send /> Announcements
        </NavLink>
        <NavLink to="/settings" className={link}>
          <Settings /> Settings and switches
        </NavLink>
        <NavLink to="/security" className={link}>
          <KeyRound /> Security
        </NavLink>
        <NavLink to="/audit" className={link}>
          <ScrollText /> Audit log
        </NavLink>
        <div className="foot stack g-10">
          {siteUrl && (
            <a href={siteUrl} target="_blank" rel="noreferrer" className="row g-8" style={{ padding: 0, color: "inherit" }}>
              <ExternalLink size={15} /> Open the site
            </a>
          )}
          <span className="tiny" style={{ wordBreak: "break-all" }}>
            {me.email}
          </span>
          <button
            className="row g-8"
            style={{ color: "inherit" }}
            onClick={() => {
              onSignOut();
              nav("/");
            }}
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
      <main className="admin-main">
        <Routes>
          <Route index element={<Overview />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="listings" element={<Listings siteUrl={siteUrl} />} />
          <Route path="bookings" element={<Bookings />} />
          <Route path="payments" element={<Payments />} />
          <Route path="payouts" element={<Payouts />} />
          <Route path="ads" element={<Ads />} />
          <Route path="connect" element={<ConnectPage />} />
          <Route path="verification" element={<Verification />} />
          <Route path="reports" element={<Reports />} />
          <Route path="safety" element={<Safety />} />
          <Route path="announcements" element={<Announcements />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="security" element={<SecurityPage email={me.email} onToken={onToken} />} />
          <Route path="audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <div className="row mt-48" style={{ justifyContent: "flex-end" }}>
          <ThemeSwitch />
        </div>
      </main>
    </div>
  );
}

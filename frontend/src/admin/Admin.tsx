import "../styles/admin.css";
import {
  BadgeCheck,
  CalendarDays,
  Flag,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Megaphone,
  Receipt,
  ScrollText,
  Settings,
  Siren,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { errorMessage } from "../api/client";
import { Logo, Mark } from "../components/brand/Logo";
import { ThemeSwitch } from "../components/Layout";
import { Button, CodeInput, Input, Spinner } from "../components/ui";
import { adminApi, adminToken, setOnExpired, useAdmin } from "./api";
import { Ads, Audit, Bookings, Listings, Overview, Payments, Payouts, Reports, Safety, SettingsPage, Team, Users as UsersPage, Verification } from "./pages";

export type AdminMe = { id: string; email: string; name: string; role: "owner" | "admin" | "moderator" | "finance" };
type Enrol = { secret: string; uri: string; qr: string };

export default function Admin() {
  const [token, setToken] = useState(adminToken.get());
  const [me, setMe] = useState<AdminMe | null>(null);
  useEffect(() => {
    document.title = "Konnect Admin";
    setOnExpired(() => {
      setToken(null);
      setMe(null);
    });
    return () => {
      document.title = "Konnect";
    };
  }, []);
  useEffect(() => {
    if (!token) return;
    adminApi
      .get<{ admin: AdminMe }>("/me")
      .then((r) => setMe(r.data.admin))
      .catch(() => {
        adminToken.set(null);
        setToken(null);
      });
  }, [token]);
  if (!token) return <SignIn onDone={(t) => (adminToken.set(t), setToken(t))} />;
  if (!me)
    return (
      <div className="auth">
        <Spinner />
      </div>
    );
  return <Shell me={me} onSignOut={() => (adminToken.set(null), setToken(null), setMe(null))} />;
}

function SignIn({ onDone }: { onDone: (token: string) => void }) {
  const setup = useAdmin<{ needed: boolean; available: boolean }>("/setup");
  const [stage, setStage] = useState<"password" | "code">("password");
  const [pre, setPre] = useState<string | null>(null);
  const [enrol, setEnrol] = useState<Enrol | null>(null);
  const [f, setF] = useState({ email: "", password: "", name: "", token: "" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRun = setup.data?.needed;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (stage === "password") {
        const r = firstRun
          ? await adminApi.post<{ token: string; enrol: Enrol }>("/setup", { token: f.token, name: f.name, email: f.email, password: f.password })
          : await adminApi.post<{ token: string; enrol: Enrol | null }>("/login", { email: f.email, password: f.password });
        setPre(r.data.token);
        setEnrol(r.data.enrol);
        setStage("code");
      } else {
        const r = await adminApi.post<{ token: string }>("/totp", { code }, { headers: { Authorization: `Bearer ${pre}` } });
        onDone(r.data.token);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="row g-10" style={{ color: "var(--ink)" }}>
          <Mark size={40} />
          <span className="badge badge-outline">Admin</span>
        </div>
        <div className="stack g-8">
          <h1 className="display d-3">{stage === "code" ? (enrol ? "Set up your authenticator" : "Authenticator code") : firstRun ? "Create the owner account" : "Admin sign-in"}</h1>
          <p className="soft small">
            {stage === "code"
              ? enrol
                ? "Scan this with Google Authenticator, Microsoft Authenticator or 1Password, then enter the 6-digit code it shows."
                : "Enter the 6-digit code from your authenticator app."
              : firstRun
                ? "No admin exists yet. Use the setup token from the server's ADMIN_SETUP_TOKEN setting."
                : "For the Konnect team."}
          </p>
        </div>
        <form className="stack g-16" onSubmit={submit}>
          {stage === "password" ? (
            <>
              {firstRun && (
                <>
                  <Input label="Setup token" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} autoComplete="off" />
                  <Input label="Your name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </>
              )}
              <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="username" autoFocus={!firstRun} />
              <Input label="Password" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete={firstRun ? "new-password" : "current-password"} hint={firstRun ? "At least 12 characters." : undefined} />
            </>
          ) : (
            <>
              {enrol && (
                <div className="stack g-10" style={{ alignItems: "center" }}>
                  <img src={enrol.qr} alt="Authenticator QR code" className="qr" />
                  <span className="tiny muted">Or enter this key by hand</span>
                  <span className="secret">{enrol.secret.replace(/(.{4})/g, "$1 ").trim()}</span>
                </div>
              )}
              <CodeInput value={code} onChange={setCode} autoFocus />
            </>
          )}
          {error && <div className="notice notice-danger small">{error}</div>}
          <Button variant="primary" size="lg" block loading={busy} type="submit">
            {stage === "code" ? "Verify" : firstRun ? "Create owner" : "Continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}

function Shell({ me, onSignOut }: { me: AdminMe; onSignOut: () => void }) {
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
          <small>Admin</small>
        </div>
        <NavLink to="/admin" end className={link}>
          <LayoutDashboard /> Overview
        </NavLink>
        <div className="group">Moderation</div>
        <NavLink to="/admin/listings" className={link}>
          <ListChecks /> Listings <Count n={c.q_listings} />
        </NavLink>
        <NavLink to="/admin/verification" className={link}>
          <BadgeCheck /> Verification <Count n={c.q_verifications} />
        </NavLink>
        <NavLink to="/admin/reports" className={link}>
          <Flag /> Reports <Count n={c.q_reports} />
        </NavLink>
        <NavLink to="/admin/safety" className={link}>
          <Siren /> Safety <Count n={c.q_sos} />
        </NavLink>
        <NavLink to="/admin/users" className={link}>
          <Users /> Users
        </NavLink>
        <div className="group">Money</div>
        <NavLink to="/admin/bookings" className={link}>
          <CalendarDays /> Bookings
        </NavLink>
        <NavLink to="/admin/payments" className={link}>
          <Receipt /> Payments <Count n={c.q_refunds} />
        </NavLink>
        <NavLink to="/admin/payouts" className={link}>
          <Wallet /> Payouts <Count n={c.q_payouts} />
        </NavLink>
        <NavLink to="/admin/ads" className={link}>
          <Megaphone /> Ads <Count n={c.q_ads} />
        </NavLink>
        <div className="group">Platform</div>
        <NavLink to="/admin/settings" className={link}>
          <Settings /> Settings
        </NavLink>
        <NavLink to="/admin/team" className={link}>
          <UserCog /> Team
        </NavLink>
        <NavLink to="/admin/audit" className={link}>
          <ScrollText /> Audit log
        </NavLink>
        <div className="foot stack g-10">
          <span>
            {me.name} · {me.role}
          </span>
          <button
            className="row g-8"
            style={{ color: "inherit" }}
            onClick={() => {
              onSignOut();
              nav("/admin");
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
          <Route path="listings" element={<Listings />} />
          <Route path="bookings" element={<Bookings />} />
          <Route path="payments" element={<Payments />} />
          <Route path="payouts" element={<Payouts />} />
          <Route path="ads" element={<Ads />} />
          <Route path="verification" element={<Verification />} />
          <Route path="reports" element={<Reports />} />
          <Route path="safety" element={<Safety />} />
          <Route path="settings" element={<SettingsPage me={me} />} />
          <Route path="team" element={<Team me={me} />} />
          <Route path="audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
        <div className="row mt-48" style={{ justifyContent: "flex-end" }}>
          <ThemeSwitch />
        </div>
      </main>
    </div>
  );
}

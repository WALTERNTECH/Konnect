import {
  Bell,
  CalendarDays,
  Compass,
  Flower2,
  HeartHandshake,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu as MenuIcon,
  MessageCircle,
  Monitor,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  User,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, useApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useTheme, type ThemePref } from "../context/ui";
import { ago } from "../lib/format";
import type { Notification } from "../types";
import { Logo } from "./brand/Logo";
import { Avatar, Menu, Spinner } from "./ui";

function useScrolled(px = 8) {
  const [s, setS] = useState(false);
  useEffect(() => {
    const on = () => setS(window.scrollY > px);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [px]);
  return s;
}

function Notifications() {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const { data, reload } = useApi<{ items: Notification[]; unread: number }>(me ? "/notifications" : null, { staleMs: 15_000 });
  const unread = me?.unread.notifications ?? 0;
  useEffect(() => {
    if (unread) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread]);
  return (
    <Menu
      trigger={(_, toggle) => (
        <button
          className="icon-btn"
          aria-label="Notifications"
          onClick={() => {
            toggle();
            if (unread) void api.post("/notifications/read").then(() => refresh());
          }}
        >
          <Bell />
          {unread > 0 && <span className="dot">{unread > 9 ? "9+" : unread}</span>}
        </button>
      )}
    >
      {(close) => (
        <div style={{ width: "min(360px, calc(100vw - 32px))" }}>
          <div className="row between" style={{ padding: "8px 10px 6px" }}>
            <span className="h-3">Notifications</span>
          </div>
          {!data ? (
            <div className="row" style={{ padding: 16, justifyContent: "center" }}>
              <Spinner />
            </div>
          ) : data.items.length === 0 ? (
            <p className="small muted" style={{ padding: "8px 10px 14px" }}>
              Booking updates, matches and messages appear here.
            </p>
          ) : (
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {data.items.slice(0, 20).map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    close();
                    if (n.link) nav(n.link);
                  }}
                  style={{ alignItems: "flex-start", flexDirection: "column", gap: 2 }}
                >
                  <span className="row g-8" style={{ width: "100%" }}>
                    {!n.read_at && <span style={{ width: 6, height: 6, borderRadius: 6, background: "var(--accent)", flex: "none" }} />}
                    <span className="strong grow" style={{ color: "var(--ink)" }}>
                      {n.title}
                    </span>
                    <span className="tiny muted nowrap">{ago(n.created_at)}</span>
                  </span>
                  {n.body && <span className="small muted clamp-2">{n.body}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Menu>
  );
}

function AccountMenu() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  if (!me) return null;
  return (
    <Menu
      trigger={(_, toggle) => (
        <button className="account-trigger" onClick={toggle} aria-label="Account menu">
          <MenuIcon />
          <Avatar name={me.fullName} src={me.photoUrl} size={30} />
        </button>
      )}
    >
      {(close) => (
        <>
          <div style={{ padding: "8px 10px 10px" }}>
            <div className="strong">{me.fullName}</div>
            <div className="tiny muted">{me.email}</div>
          </div>
          <hr />
          <Link to="/trips" onClick={close}>
            <CalendarDays /> Trips and appointments
          </Link>
          <Link to="/messages" onClick={close}>
            <MessageCircle /> Messages
          </Link>
          <hr />
          <Link to="/host" onClick={close}>
            <LayoutDashboard /> {me.isHost ? "Hosting" : "Host on Konnect"}
          </Link>
          <Link to="/advertise" onClick={close}>
            <Megaphone /> Advertise
          </Link>
          <hr />
          <Link to="/account" onClick={close}>
            <Settings /> Account
          </Link>
          <Link to="/safety" onClick={close}>
            <ShieldCheck /> Safety
          </Link>
          <button
            className="danger"
            onClick={() => {
              close();
              logout();
              nav("/");
            }}
          >
            <LogOut /> Sign out
          </button>
        </>
      )}
    </Menu>
  );
}

export function TopBar({ overHero }: { overHero?: boolean }) {
  const { me, ready } = useAuth();
  const scrolled = useScrolled();
  const loc = useLocation();
  const next = encodeURIComponent(loc.pathname + loc.search);
  return (
    <header className={`topbar ${scrolled ? "scrolled" : ""} ${overHero ? "over-hero" : ""}`}>
      <div className="page topbar-inner">
        <Link to="/" className="brand" aria-label="Konnect home">
          <Logo height={26} />
        </Link>
        <nav className="nav-main" aria-label="Main">
          <NavLink to="/stays" className={({ isActive }) => (isActive ? "active" : "")}>
            Stays
          </NavLink>
          <NavLink to="/wellness" className={({ isActive }) => (isActive ? "active" : "")}>
            Wellness
          </NavLink>
          <NavLink to="/connect" className={({ isActive }) => (isActive ? "active" : "")}>
            Connect
          </NavLink>
        </nav>
        <div className="nav-side">
          {!ready ? null : me ? (
            <>
              <Link to="/host" className="nav-text-link hide-mobile">
                {me.isHost ? "Hosting" : "Host"}
              </Link>
              <Link to="/messages" className="icon-btn hide-mobile" aria-label="Messages">
                <MessageCircle />
                {me.unread.messages > 0 && <span className="dot">{me.unread.messages > 9 ? "9+" : me.unread.messages}</span>}
              </Link>
              <Notifications />
              <AccountMenu />
            </>
          ) : (
            <>
              <Link to="/host" className="nav-text-link hide-mobile">
                Host
              </Link>
              <Link to={`/login?next=${next}`} className="nav-text-link">
                Sign in
              </Link>
              <Link to={`/signup?next=${next}`} className="btn btn-sm btn-ink hide-mobile">
                Create account
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function BottomNav() {
  const { me } = useAuth();
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");
  return (
    <nav className="bottomnav" aria-label="Main">
      <NavLink to="/" end className={cls}>
        <Compass /> Explore
      </NavLink>
      <NavLink to="/wellness" className={cls}>
        <Flower2 /> Wellness
      </NavLink>
      <NavLink to="/connect" className={cls}>
        <HeartHandshake /> Connect
        {me && me.unread.messages > 0 && <span className="dot" />}
      </NavLink>
      <NavLink to="/trips" className={cls}>
        <CalendarDays /> Trips
      </NavLink>
      <NavLink to={me ? "/account" : "/login"} className={cls}>
        <User /> {me ? "Account" : "Sign in"}
      </NavLink>
    </nav>
  );
}

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const opts: { v: ThemePref; icon: ReactNode; label: string }[] = [
    { v: "light", icon: <Sun />, label: "Light" },
    { v: "dark", icon: <Moon />, label: "Dark" },
    { v: "system", icon: <Monitor />, label: "System" },
  ];
  return (
    <div className="theme-switch">
      <span className="label">Theme</span>
      <div className="segmented" role="group" aria-label="Theme">
        {opts.map((o) => (
          <button key={o.v} type="button" aria-pressed={theme === o.v} onClick={() => setTheme(o.v)} title={o.label}>
            {o.icon}
            <span className="hide-xs">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="page footer-inner">
        <span>© {new Date().getFullYear()} Konnect</span>
        <nav aria-label="Footer">
          <Link to="/host">Host</Link>
          <Link to="/advertise">Advertise</Link>
          <Link to="/safety">Safety</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
        </nav>
        <ThemeSwitch />
      </div>
    </footer>
  );
}

export function AppLayout() {
  const loc = useLocation();
  const overHero = loc.pathname === "/";
  const bare = loc.pathname.startsWith("/messages");
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);
  return (
    <>
      <TopBar overHero={overHero} />
      <main className="app-main">
        <div key={loc.pathname} className="route">
          <Outlet />
        </div>
      </main>
      {!bare && <Footer />}
      <BottomNav />
    </>
  );
}

/** Sends signed-out visitors to sign in, then back here. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, ready } = useAuth();
  const loc = useLocation();
  if (!ready)
    return (
      <div className="page section center">
        <Spinner />
      </div>
    );
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}


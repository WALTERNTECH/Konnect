import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, errorMessage, fieldErrors, tokenStore } from "../api/client";
import { Mark } from "../components/brand/Logo";
import { Button, CodeInput, Field, Input, PhoneInput } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ui";
import type { Me } from "../types";

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

function AuthShell({ title, sub, children }: { title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <Link to="/" aria-label="Konnect home" style={{ color: "var(--ink)", alignSelf: "flex-start" }}>
          <Mark size={40} className="brand-mark" />
        </Link>
        <div className="stack g-8">
          <h1 className="display d-3">{title}</h1>
          {sub && <p className="soft">{sub}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, label = "Password", error, autoComplete = "current-password", hint }: { value: string; onChange: (v: string) => void; label?: string; error?: string; autoComplete?: string; hint?: string }) {
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      <div className="input-group">
        <input id={id} className="input" style={{ paddingRight: 48 }} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} aria-invalid={error ? true : undefined} />
        <span className="suffix">
          <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} style={{ width: 34, height: 34 }}>
            {show ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </span>
      </div>
    </Field>
  );
}

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = safeNext(params.get("next"));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await login(identifier, password);
      nav(me.phoneVerificationRequired && !me.phoneVerified ? `/verify-phone?next=${encodeURIComponent(next)}` : next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Sign in">
      <form className="stack g-16" onSubmit={submit}>
        <Input label="Email or phone" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoFocus />
        <PasswordInput value={password} onChange={setPassword} />
        {error && <div className="notice notice-danger small">{error}</div>}
        <Button variant="primary" size="lg" block loading={busy} type="submit">
          Sign in
        </Button>
        <div className="row between small">
          <Link to="/forgot" className="link">
            Forgot password
          </Link>
          <Link to={`/signup?next=${encodeURIComponent(next)}`} className="link">
            Create an account
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function Signup() {
  const { signup } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ fullName: "", email: "", phone: "", password: "", day: "", month: "", year: "", gender: "", referralCode: params.get("ref") ?? "", agree: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const thisYear = new Date().getFullYear();
  const dob = f.year && f.month && f.day ? `${f.year}-${f.month.padStart(2, "0")}-${f.day.padStart(2, "0")}` : "";

  const check = (s: number) => {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (f.fullName.trim().length < 2) e.fullName = "Enter your full name";
      if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = "Enter a valid email address";
      if (!/^0[17]\d{8}$/.test(f.phone)) e.phone = "Enter a Kenyan mobile number";
    }
    if (s === 1) {
      if (!dob) e.dateOfBirth = "Enter your date of birth";
      else {
        const d = new Date(`${dob}T00:00:00Z`);
        const now = new Date();
        let age = now.getUTCFullYear() - d.getUTCFullYear();
        if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) age--;
        if (age < 18) e.dateOfBirth = "Konnect is for adults aged 18 and over";
      }
      if (!f.gender) e.gender = "Choose one";
    }
    if (s === 2) {
      if (f.password.length < 8) e.password = "Use at least 8 characters";
      if (!f.agree) e.agree = "Confirm to continue";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!check(step)) return;
    if (step < 2) return setStep(step + 1);
    setBusy(true);
    setError(null);
    try {
      const me = await signup({ fullName: f.fullName.trim(), email: f.email.trim(), phone: f.phone, password: f.password, dateOfBirth: dob, gender: f.gender, referralCode: f.referralCode || undefined });
      nav(me.phoneVerificationRequired && !me.phoneVerified ? `/verify-phone?next=${encodeURIComponent(next)}` : next, { replace: true });
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      setError(errorMessage(err));
      if (fe.email || fe.phone || fe.fullName) setStep(0);
      else if (fe.dateOfBirth || fe.gender) setStep(1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create your account" sub={["Your details", "About you", "Secure your account"][step]}>
      <div className="steps">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i <= step ? "on" : ""} />
        ))}
      </div>
      <form className="stack g-16" onSubmit={submit} noValidate>
        {step === 0 && (
          <>
            <Input label="Full name" value={f.fullName} onChange={(e) => set("fullName")(e.target.value)} autoComplete="name" error={errors.fullName} autoFocus />
            <Input label="Email" type="email" value={f.email} onChange={(e) => set("email")(e.target.value)} autoComplete="email" error={errors.email} />
            <PhoneInput label="Phone number" value={f.phone} onChange={set("phone")} error={errors.phone} hint="Used for M-Pesa and sign-in codes." />
          </>
        )}
        {step === 1 && (
          <>
            <Field label="Date of birth" error={errors.dateOfBirth}>
              <div className="row g-8">
                <select className="select" value={f.day} onChange={(e) => set("day")(e.target.value)} aria-label="Day" style={{ flex: "0 0 84px" }}>
                  <option value="">Day</option>
                  {Array.from({ length: 31 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
                <select className="select grow" value={f.month} onChange={(e) => set("month")(e.target.value)} aria-label="Month">
                  <option value="">Month</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
                <select className="select" value={f.year} onChange={(e) => set("year")(e.target.value)} aria-label="Year" style={{ flex: "0 0 104px" }}>
                  <option value="">Year</option>
                  {Array.from({ length: 82 }, (_, i) => thisYear - 18 - i).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Gender" error={errors.gender}>
              <div className="segmented" style={{ width: "100%" }}>
                {[
                  ["woman", "Woman"],
                  ["man", "Man"],
                  ["nonbinary", "Non-binary"],
                ].map(([v, l]) => (
                  <button key={v} type="button" style={{ flex: 1 }} aria-pressed={f.gender === v} onClick={() => set("gender")(v)}>
                    {l}
                  </button>
                ))}
              </div>
            </Field>
          </>
        )}
        {step === 2 && (
          <>
            <PasswordInput label="Password" value={f.password} onChange={set("password")} error={errors.password} autoComplete="new-password" hint="At least 8 characters." />
            <Input label="Referral code (optional)" value={f.referralCode} onChange={(e) => set("referralCode")(e.target.value.toUpperCase())} error={errors.referralCode} />
            <label className="check small" style={{ alignItems: "flex-start" }}>
              <input type="checkbox" checked={f.agree} onChange={(e) => set("agree")(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                I am 18 or older and accept the{" "}
                <Link to="/terms" className="link" target="_blank">
                  Terms
                </Link>{" "}
                and{" "}
                <Link to="/privacy" className="link" target="_blank">
                  Privacy notice
                </Link>
                .
              </span>
            </label>
            {errors.agree && <div className="tiny" style={{ color: "var(--danger)" }}>{errors.agree}</div>}
          </>
        )}
        {error && <div className="notice notice-danger small">{error}</div>}
        <div className="row g-8">
          {step > 0 && (
            <Button type="button" variant="outline" size="lg" onClick={() => setStep(step - 1)} icon={<ArrowLeft />} aria-label="Back" />
          )}
          <Button variant="primary" size="lg" block loading={busy} type="submit">
            {step < 2 ? "Continue" : "Create account"}
          </Button>
        </div>
        <p className="small center muted">
          Already have an account?{" "}
          <Link to={`/login?next=${encodeURIComponent(next)}`} className="link">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function VerifyPhone() {
  const { me, setMe } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const toast = useToast();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = safeNext(params.get("next"));
  useEffect(() => {
    if (me && (me.phoneVerified || !me.phoneVerificationRequired)) nav(next, { replace: true });
  }, [me, nav, next]);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (code.length !== 6) return setError("Enter the 6-digit code");
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: Me }>("/auth/phone/verify", { code });
      setMe(r.data.user);
      toast("Number confirmed", "ok");
      nav(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (code.length === 6) void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);
  return (
    <AuthShell title="Confirm your number" sub={me ? `Enter the code sent by SMS to ${me.phone.replace(/^\+254/, "0")}.` : undefined}>
      <form className="stack g-16" onSubmit={submit}>
        <CodeInput value={code} onChange={setCode} autoFocus />
        {error && <div className="notice notice-danger small">{error}</div>}
        <Button variant="primary" size="lg" block loading={busy} type="submit">
          Confirm
        </Button>
        <button
          type="button"
          className="small link"
          style={{ alignSelf: "center" }}
          onClick={async () => {
            try {
              await api.post("/auth/phone/send");
              toast("A new code is on its way", "ok");
            } catch (err) {
              toast(errorMessage(err), "error");
            }
          }}
        >
          Send a new code
        </button>
      </form>
    </AuthShell>
  );
}

export function Forgot() {
  const nav = useNavigate();
  const { adopt } = useAuth();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!sent) {
        await api.post("/auth/password/forgot", { phone });
        setSent(true);
      } else {
        const r = await api.post<{ token: string; user: Me }>("/auth/password/reset", { phone, code, password });
        tokenStore.set(r.data.token);
        adopt(r.data.token, r.data.user);
        nav("/", { replace: true });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Reset your password" sub={sent ? "If an account uses that number, a code is on its way by SMS." : "We'll send a code to the phone number on your account."}>
      <form className="stack g-16" onSubmit={submit}>
        {!sent ? (
          <PhoneInput label="Phone number" value={phone} onChange={setPhone} autoFocus />
        ) : (
          <>
            <Field label="Code">
              <CodeInput value={code} onChange={setCode} autoFocus />
            </Field>
            <PasswordInput label="New password" value={password} onChange={setPassword} autoComplete="new-password" hint="At least 8 characters." />
          </>
        )}
        {error && <div className="notice notice-danger small">{error}</div>}
        <Button variant="primary" size="lg" block loading={busy} type="submit">
          {sent ? "Set new password" : "Send code"}
        </Button>
        <Link to="/login" className="small link" style={{ alignSelf: "center" }}>
          Back to sign in
        </Link>
      </form>
    </AuthShell>
  );
}


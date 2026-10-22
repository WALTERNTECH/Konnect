import { BadgeCheck, ChevronLeft, X } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { initials, STATUS_LABEL, STATUS_TONE } from "../lib/format";

// ——— Buttons ———

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ink" | "outline" | "ghost" | "danger" | "on-image";
  size?: "sm" | "md" | "lg";
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
};
export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = "outline", size = "md", block, loading, icon, children, className = "", disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={`btn btn-${variant} ${size !== "md" ? `btn-${size}` : ""} ${block ? "btn-block" : ""} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({ to, variant = "outline", size = "md", block, icon, children, className = "", ...rest }: { to: string; variant?: BtnProps["variant"]; size?: BtnProps["size"]; block?: boolean; icon?: ReactNode; children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <Link to={to} className={`btn btn-${variant} ${size !== "md" ? `btn-${size}` : ""} ${block ? "btn-block" : ""} ${className}`} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export const Spinner = () => <span className="spinner" aria-label="Loading" />;

// ——— Fields ———

export function Field({ label, hint, error, children, className = "", htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={`field ${className}`}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <div className="error">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string; wrapClass?: string };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, hint, error, wrapClass, id, className = "", ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid} className={wrapClass}>
      <input ref={ref} id={fid} className={`input ${className}`} aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; hint?: ReactNode; error?: string; wrapClass?: string };
export function Select({ label, hint, error, wrapClass, id, className = "", children, ...rest }: SelectProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid} className={wrapClass}>
      <select id={fid} className={`select ${className}`} aria-invalid={error ? true : undefined} {...rest}>
        {children}
      </select>
    </Field>
  );
}

type AreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode; error?: string; wrapClass?: string };
export function Textarea({ label, hint, error, wrapClass, id, className = "", ...rest }: AreaProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={fid} className={wrapClass}>
      <textarea id={fid} className={`textarea ${className}`} aria-invalid={error ? true : undefined} {...rest} />
    </Field>
  );
}

/** Kenyan mobile number with a fixed +254 prefix. */
export function PhoneInput({ value, onChange, label = "M-Pesa number", error, hint, autoFocus }: { value: string; onChange: (v: string) => void; label?: string; error?: string; hint?: ReactNode; autoFocus?: boolean }) {
  const id = useId();
  const local = value.replace(/^\+?254/, "0");
  return (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      <div className="input-group">
        <span className="prefix">+254</span>
        <input
          id={id}
          className="input num"
          inputMode="tel"
          autoComplete="tel-national"
          autoFocus={autoFocus}
          value={local.replace(/^0/, "")}
          onChange={(e) => onChange("0" + e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9))}
          aria-invalid={error ? true : undefined}
        />
      </div>
    </Field>
  );
}

export function CodeInput({ value, onChange, length = 6, autoFocus }: { value: string; onChange: (v: string) => void; length?: number; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const set = (i: number, ch: string) => {
    const arr = value.padEnd(length, " ").split("");
    arr[i] = ch || " ";
    onChange(arr.join("").replace(/\s+$/, ""));
  };
  return (
    <div className="code-input">
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          autoFocus={autoFocus && i === 0}
          maxLength={1}
          className="num"
          value={value[i]?.trim() ?? ""}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "");
            if (d.length > 1) {
              onChange(d.slice(0, length));
              refs.current[Math.min(d.length, length) - 1]?.focus();
              return;
            }
            set(i, d);
            if (d && i < length - 1) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !value[i]?.trim() && i > 0) refs.current[i - 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)} />;
}

export function Segmented<T extends string>({ value, onChange, options, className = "" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div className={`segmented ${className}`} role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ——— Display ———

export function Avatar({ name, src, size = 40, className = "" }: { name: string; src?: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`avatar ${className}`} style={{ ["--s" as string]: `${size}px` }}>
      {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : initials(name) || "·"}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status];
  return <span className={`badge ${tone ? `badge-${tone}` : ""}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function Verified({ title = "ID verified" }: { title?: string }) {
  return (
    <span className="verified" title={title} aria-label={title}>
      <BadgeCheck />
    </span>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="glyph">{icon}</div>}
      <div className="h-2">{title}</div>
      {children && <p>{children}</p>}
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%", r, className = "" }: { h?: number | string; w?: number | string; r?: number; className?: string }) {
  return <div className={`skeleton ${className}`} style={{ height: h, width: w, borderRadius: r }} />;
}

export function CardSkeletons({ n = 8 }: { n?: number }) {
  return (
    <div className="grid-cards">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="lcard">
          <Skeleton h={0} className="lcard-media" />
          <div className="stack g-6">
            <Skeleton h={12} w="40%" />
            <Skeleton h={14} w="80%" />
            <Skeleton h={12} w="30%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function BackLink({ to, children = "Back" }: { to: string; children?: ReactNode }) {
  return (
    <Link to={to} className="back-link">
      <ChevronLeft /> {children}
    </Link>
  );
}

export function PageHead({ eyebrow, title, children, actions }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="stack">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="display d-2">{title}</h1>
        {children && <p className="lede mt-12" style={{ maxWidth: 620 }}>{children}</p>}
      </div>
      {actions && <div className="row g-8">{actions}</div>}
    </div>
  );
}

// ——— Overlays ———

export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="h-1">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-body" style={{ paddingTop: 0 }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Menu({ trigger, children, className = "" }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <div className={`menu-wrap ${className}`} ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && <div className="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

/** Adds .in to elements with .reveal as they scroll into view. */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal:not(.in)");
    if (!("IntersectionObserver" in window)) {
      els.forEach((e) => e.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries)
          if (en.isIntersecting) {
            en.target.classList.add("in");
            io.unobserve(en.target);
          }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

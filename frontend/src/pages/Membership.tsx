import { Check, Copy, Crown } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, invalidate, useApi } from "../api/client";
import { PaymentSheet } from "../components/PaymentSheet";
import { Button, PageHead, Skeleton } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ui";
import { fmtDate, kes } from "../lib/format";

type Plans = { plans: { id: "monthly" | "annual"; name: string; priceKes: number; days: number; saving?: number }[]; includes: string[]; referralDays: number };
type Mine = { active: boolean; until: string | null; history: { id: string; period: string; status: string; starts_at: string; expires_at: string; amount_kes: number; source: string; mpesa_receipt: string | null }[] };

export const MEMBERSHIP_INCLUDES = [
  "Connect: browse members, like, match and message",
  "No partner placements anywhere in Konnect",
  "Your stays and treatments listed ahead of non-members'",
  "Your Connect profile visible to other members",
];

export function PlanPicker({ value, onChange, plans }: { value: string; onChange: (v: "monthly" | "annual") => void; plans: Plans["plans"] }) {
  return (
    <div className="plans">
      {plans.map((p) => (
        <button key={p.id} type="button" className="plan" aria-pressed={value === p.id} onClick={() => onChange(p.id)}>
          {p.saving ? <span className="badge badge-brass save">Save {kes(p.saving)}</span> : null}
          <span className="small strong">{p.name}</span>
          <span className="price">{kes(p.priceKes)}</span>
          <span className="tiny muted">{p.id === "annual" ? "for 12 months" : "every 30 days"}</span>
        </button>
      ))}
    </div>
  );
}

export function useJoin() {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const plans = useApi<Plans>("/subscriptions/plans", { staleMs: 5 * 60_000 });
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  const amount = plans.data?.plans.find((p) => p.id === period)?.priceKes ?? 0;
  const start = () => (me ? setOpen(true) : nav(`/login?next=${encodeURIComponent("/membership")}`));
  const sheet = (
    <PaymentSheet
      open={open}
      onClose={() => setOpen(false)}
      title={period === "annual" ? "Annual membership" : "Monthly membership"}
      amount={amount}
      start={async (phone) => (await api.post("/subscriptions/initiate", { period, phone })).data}
      onPaid={async () => {
        await refresh();
        await invalidate("/subscriptions", "/connect", "/ads");
        toast("Membership active", "ok");
      }}
      doneLabel="Continue"
    />
  );
  return { plans, period, setPeriod, start, sheet };
}

export default function Membership() {
  const { me } = useAuth();
  const toast = useToast();
  const join = useJoin();
  const mine = useApi<Mine>(me ? "/subscriptions/me" : null);
  const [copied, setCopied] = useState(false);
  const active = me?.premium.active;
  const shareUrl = me ? `${location.origin}/signup?ref=${me.referralCode}` : "";

  return (
    <div className="page page-mid">
      <PageHead eyebrow="Membership" title={active ? "You're a member" : "Konnect Membership"}>
        {active && me?.premium.until ? `Your membership runs until ${fmtDate(me.premium.until)}. Paying again adds time after that date.` : "One membership, paid by M-Pesa. No automatic renewals: you choose when to pay again."}
      </PageHead>

      <div className="detail" style={{ gridTemplateColumns: "minmax(0,1fr) 400px" }}>
        <div className="stack g-32">
          <section className="stack g-16">
            <h2 className="h-1">What it includes</h2>
            <div className="stack g-12">
              {MEMBERSHIP_INCLUDES.map((x) => (
                <div key={x} className="row g-12">
                  <span className="verified" style={{ color: "var(--accent)" }}>
                    <Check size={18} />
                  </span>
                  <span>{x}</span>
                </div>
              ))}
            </div>
            <p className="small muted">Stays and wellness bookings are open to everyone, member or not.</p>
          </section>

          {me && (
            <section className="stack g-12">
              <h2 className="h-1">Referrals</h2>
              <p className="soft">
                When someone signs up with your code and starts a membership, you both get {join.plans.data?.referralDays ?? 30} days added. {me.referralCount > 0 && `${me.referralCount} ${me.referralCount === 1 ? "person has" : "people have"} joined with your code.`}
              </p>
              <div className="row g-8 wrap">
                <span className="badge badge-outline num" style={{ height: 40, fontSize: 15, padding: "0 16px", letterSpacing: "0.08em" }}>
                  {me.referralCode}
                </span>
                <Button
                  variant="outline"
                  icon={copied ? <Check /> : <Copy />}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(shareUrl);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1800);
                    } catch {
                      toast(shareUrl);
                    }
                  }}
                >
                  {copied ? "Link copied" : "Copy invite link"}
                </Button>
              </div>
            </section>
          )}

          {me && (mine.data?.history.length ?? 0) > 0 && (
            <section className="stack g-12">
              <h2 className="h-1">History</h2>
              <div className="list">
                {mine.data!.history.map((h) => (
                  <div key={h.id} className="list-row">
                    <div className="grow stack g-4">
                      <span className="strong">{h.source === "referral" ? "Referral days" : h.source === "admin" ? "Added by Konnect" : h.period === "annual" ? "Annual" : "Monthly"}</span>
                      <span className="small muted">
                        {fmtDate(h.starts_at)} – {fmtDate(h.expires_at)}
                        {h.mpesa_receipt ? ` · ${h.mpesa_receipt}` : ""}
                      </span>
                    </div>
                    <span className="num">{h.amount_kes ? kes(h.amount_kes) : "—"}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="book-panel">
          <div className="row g-10">
            <span className="badge badge-brass">
              <Crown /> Membership
            </span>
          </div>
          {join.plans.loading ? <Skeleton h={110} /> : <PlanPicker value={join.period} onChange={join.setPeriod} plans={join.plans.data?.plans ?? []} />}
          <Button variant="primary" size="lg" block onClick={join.start}>
            {active ? "Add time" : "Join"} · {kes(join.plans.data?.plans.find((p) => p.id === join.period)?.priceKes ?? 0)}
          </Button>
          <p className="tiny muted center">Paid by M-Pesa STK prompt.</p>
        </aside>
      </div>
      {join.sheet}
    </div>
  );
}

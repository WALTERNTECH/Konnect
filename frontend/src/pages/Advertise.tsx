import { ImagePlus, Megaphone, Pause, Play, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { api, errorMessage, fieldErrors, useApi } from "../api/client";
import { AreaChart } from "../components/Chart";
import { PartnerCard } from "../components/ListingCard";
import { PaymentSheet } from "../components/PaymentSheet";
import { Button, Empty, Input, Modal, PageHead, Select, Skeleton } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ui";
import { fmtDate, kes, num } from "../lib/format";
import { Navigate } from "react-router-dom";

type Campaign = {
  id: string; advertiser: string; headline: string; text: string; imageUrl: string | null; cta: string; url: string; house: boolean;
  billing: "CPM" | "CPC"; status: string; budgetKes: number; spentKes: number; impressions: number; clicks: number; ctr: number; reviewNote: string | null; createdAt: string;
};
type Mine = { items: Campaign[]; pricing: { cpmKes: number; cpcKes: number; minBudgetKes: number } };

const STATUS: Record<string, [string, string]> = {
  DRAFT: ["Draft", ""], PENDING_PAYMENT: ["Add budget to start", "warn"], PENDING_REVIEW: ["In review", "warn"], ACTIVE: ["Running", "ok"],
  PAUSED: ["Paused", ""], ENDED: ["Budget used", ""], REJECTED: ["Changes needed", "danger"],
};

export default function Advertise() {
  const { me } = useAuth();
  const { data, loading, reload } = useApi<Mine>(me ? "/ads/mine" : null, { staleMs: 0 });
  const [editing, setEditing] = useState<Campaign | "new" | null>(null);
  const [fund, setFund] = useState<Campaign | null>(null);
  const [stats, setStats] = useState<Campaign | null>(null);
  const toast = useToast();
  if (!me) return <Navigate to="/login?next=/advertise" replace />;
  const p = data?.pricing;
  return (
    <div className="page page-mid">
      <PageHead
        eyebrow="Advertise"
        title="Partner placements"
        actions={
          <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>
            New campaign
          </Button>
        }
      >
        Placements appear between listings and on the home page. {p && `${kes(p.cpmKes)} per 1,000 impressions or ${kes(p.cpcKes)} per click. Campaigns start from ${kes(p.minBudgetKes)}, paid by M-Pesa, and are reviewed before they run.`}
      </PageHead>
      {loading ? (
        <Skeleton h={240} r={16} />
      ) : !data?.items.length ? (
        <Empty icon={<Megaphone />} title="No campaigns yet" action={<Button onClick={() => setEditing("new")}>Create a campaign</Button>}>
          Write a headline, add an image and a link, then add budget with M-Pesa.
        </Empty>
      ) : (
        <div className="stack g-12">
          {data.items.map((c) => {
            const [label, tone] = STATUS[c.status] ?? [c.status, ""];
            return (
              <div key={c.id} className="trip" style={{ gridTemplateColumns: "120px 1fr auto" }}>
                <div className="thumb">{c.imageUrl ? <img src={c.imageUrl} alt="" /> : <div style={{ height: "100%", display: "grid", placeItems: "center" }} className="muted"><ImagePlus /></div>}</div>
                <div className="stack g-4" style={{ minWidth: 0 }}>
                  <div className="row g-8 wrap">
                    <span className={`badge ${tone ? `badge-${tone}` : ""}`}>{label}</span>
                    <span className="tiny muted">{c.billing === "CPM" ? "Per 1,000 impressions" : "Per click"}</span>
                  </div>
                  <button className="h-2" style={{ textAlign: "left" }} onClick={() => setStats(c)}>
                    {c.headline}
                  </button>
                  <span className="small muted num">
                    {num(c.impressions)} impressions · {num(c.clicks)} clicks · {kes(c.spentKes)} of {kes(c.budgetKes)}
                  </span>
                  {c.status === "REJECTED" && c.reviewNote && <span className="small" style={{ color: "var(--danger)" }}>{c.reviewNote}</span>}
                </div>
                <div className="row g-6 wrap" style={{ justifyContent: "flex-end" }}>
                  <Button size="sm" variant={c.budgetKes === 0 ? "primary" : "outline"} onClick={() => setFund(c)}>
                    Add budget
                  </Button>
                  {c.status === "ACTIVE" && (
                    <Button size="sm" variant="ghost" icon={<Pause />} onClick={async () => { await api.post(`/ads/${c.id}/pause`); void reload(); }}>
                      Pause
                    </Button>
                  )}
                  {c.status === "PAUSED" && (
                    <Button size="sm" variant="ghost" icon={<Play />} onClick={async () => { await api.post(`/ads/${c.id}/resume`); void reload(); }}>
                      Resume
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && <CampaignEditor initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
      {fund && (
        <FundSheet
          c={fund}
          min={fund.budgetKes === 0 ? (p?.minBudgetKes ?? 5000) : 500}
          onClose={() => {
            setFund(null);
            void reload();
          }}
          onPaid={() => toast("Budget added", "ok")}
        />
      )}
      {stats && <StatsModal c={stats} onClose={() => setStats(null)} />}
    </div>
  );
}

function CampaignEditor({ initial, onClose, onSaved }: { initial: Campaign | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ advertiser: initial?.advertiser ?? "", headline: initial?.headline ?? "", text: initial?.text ?? "", cta: initial?.cta ?? "Learn more", url: initial?.url ?? "https://", billing: initial?.billing ?? "CPM" });
  const [image, setImage] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const preview = image ? URL.createObjectURL(image) : initial?.imageUrl ?? null;
  const save = async () => {
    setBusy(true);
    try {
      const r = initial ? await api.patch<{ campaign: Campaign }>(`/ads/${initial.id}`, f) : await api.post<{ campaign: Campaign }>("/ads", f);
      if (image) {
        const fd = new FormData();
        fd.append("image", image);
        await api.post(`/ads/${r.data.campaign.id}/image`, fd);
      }
      toast(initial ? "Saved. Changes are reviewed before they run." : "Campaign created. Add budget to send it for review.", "ok");
      onSaved();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={initial ? "Edit campaign" : "New campaign"} wide>
      <div className="detail" style={{ gridTemplateColumns: "minmax(0,1fr) 260px", gap: 28 }}>
        <div className="stack g-16">
          <Input label="Business name" value={f.advertiser} onChange={(e) => setF({ ...f, advertiser: e.target.value })} error={errors.advertiser} />
          <Input label="Headline" maxLength={60} value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} error={errors.headline} hint={`${f.headline.length} of 60`} />
          <Input label="Line of text" maxLength={140} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} hint={`${f.text.length} of 140`} />
          <div className="form-grid">
            <Input label="Button" maxLength={20} value={f.cta} onChange={(e) => setF({ ...f, cta: e.target.value })} />
            <Select label="Pay" value={f.billing} onChange={(e) => setF({ ...f, billing: e.target.value as "CPM" | "CPC" })}>
              <option value="CPM">Per 1,000 impressions</option>
              <option value="CPC">Per click</option>
            </Select>
          </div>
          <Input label="Link" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} error={errors.url} />
          <Button icon={<ImagePlus />} onClick={() => file.current?.click()}>
            {preview ? "Change image" : "Add an image"}
          </Button>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
          <Button variant="primary" loading={busy} onClick={save}>
            {initial ? "Save" : "Create campaign"}
          </Button>
        </div>
        <div className="stack g-8">
          <span className="label">Preview</span>
          <PartnerCard ad={{ id: "preview", advertiser: f.advertiser || "Your business", headline: f.headline || "Your headline", text: f.text, imageUrl: preview, cta: f.cta, url: "#", house: false }} />
        </div>
      </div>
    </Modal>
  );
}

function FundSheet({ c, min, onClose, onPaid }: { c: Campaign; min: number; onClose: () => void; onPaid: () => void }) {
  const [amount, setAmount] = useState(String(min));
  const [go, setGo] = useState(false);
  const n = Number(amount);
  if (!go)
    return (
      <Modal open onClose={onClose} title="Add budget">
        <div className="stack g-16">
          <p className="soft">{c.budgetKes === 0 ? `The first payment for a campaign is at least ${kes(min)}. The campaign is reviewed once paid, then starts.` : "Added budget is used as the campaign runs."}</p>
          <div className="chips">
            {[min, min * 2, min * 4].map((v) => (
              <button key={v} className="chip" aria-pressed={n === v} onClick={() => setAmount(String(v))}>
                {kes(v)}
              </button>
            ))}
          </div>
          <div className="input-group">
            <span className="prefix">KES</span>
            <input className="input num" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
          </div>
          <Button variant="primary" block disabled={n < min} onClick={() => setGo(true)}>
            Continue
          </Button>
        </div>
      </Modal>
    );
  return <PaymentSheet open onClose={onClose} title="Campaign budget" amount={n} start={async (phone) => (await api.post("/mpesa/stk-push", { purpose: "AD_CAMPAIGN", refId: c.id, amount: n, phone })).data} onPaid={onPaid} />;
}

function StatsModal({ c, onClose }: { c: Campaign; onClose: () => void }) {
  const { data } = useApi<{ days: { day: string; impressions: number; clicks: number; spentKes: number }[] }>(`/ads/${c.id}/stats`, { staleMs: 0 });
  return (
    <Modal open onClose={onClose} title={c.headline} wide>
      <div className="stack g-20">
        <div className="grid-stats">
          <div className="stat">
            <span className="label">Impressions</span>
            <span className="value">{num(c.impressions)}</span>
          </div>
          <div className="stat">
            <span className="label">Clicks</span>
            <span className="value">{num(c.clicks)}</span>
            <span className="delta">{(c.ctr * 100).toFixed(2)}% of impressions</span>
          </div>
          <div className="stat">
            <span className="label">Spent</span>
            <span className="value">{kes(c.spentKes)}</span>
            <span className="delta">of {kes(c.budgetKes)}</span>
          </div>
        </div>
        {data && data.days.length > 1 ? (
          <AreaChart data={data.days.map((d) => ({ label: d.day.slice(5), value: d.impressions }))} format={(n) => `${num(n)} impressions`} />
        ) : (
          <p className="small muted">Daily figures appear once the campaign has run for two days.</p>
        )}
        <p className="tiny muted">Created {fmtDate(c.createdAt)}</p>
      </div>
    </Modal>
  );
}

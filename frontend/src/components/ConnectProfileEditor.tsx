import { Camera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage, fieldErrors, invalidate, useApi } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ui";
import { GENDER_PLURAL, INTENT, ROLE } from "../lib/format";
import type { MyConnectProfile } from "../types";
import { Button, Field, Input, Textarea, Toggle } from "./ui";

export function ConnectProfileEditor({ onSaved, compact }: { onSaved?: () => void; compact?: boolean }) {
  const { me, refresh } = useAuth();
  const toast = useToast();
  const { data, reload } = useApi<{ profile: MyConnectProfile | null }>("/connect/profile", { staleMs: 0 });
  const { data: opts } = useApi<{ interests: string[] }>("/connect/options", { staleMs: 600_000 });
  const [p, setP] = useState<MyConnectProfile>({
    headline: "",
    intent: "dating",
    arrangementRole: null,
    interestedIn: me?.gender === "man" ? ["woman"] : me?.gender === "woman" ? ["man"] : [],
    ageMin: 21,
    ageMax: 45,
    interests: [],
    occupation: "",
    visible: true,
    photos: [],
  });
  const [bio, setBio] = useState(me?.bio ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const exists = Boolean(data?.profile);

  useEffect(() => {
    if (data?.profile) setP(data.profile);
  }, [data?.profile]);

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      await api.put("/connect/profile", { ...p, arrangementRole: p.intent === "arrangement" ? p.arrangementRole : null });
      if (bio !== (me?.bio ?? "")) await api.patch("/users/me", { bio });
      await Promise.all([reload(), refresh(), invalidate("/connect/browse")]);
      toast("Profile saved", "ok");
      onSaved?.();
    } catch (e) {
      setErrors(fieldErrors(e));
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!exists) await save();
    setUploading(true);
    try {
      const fd = new FormData();
      [...files].slice(0, 6 - p.photos.length).forEach((f) => fd.append("photos", f));
      const r = await api.post<{ photos: string[] }>("/connect/profile/photos", fd);
      setP((x) => ({ ...x, photos: r.data.photos }));
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  };
  const removePhoto = async (url: string) => {
    const photos = p.photos.filter((x) => x !== url);
    setP((x) => ({ ...x, photos }));
    await api.put("/connect/profile/photos", { photos }).catch((e) => toast(errorMessage(e), "error"));
  };
  const makeFirst = async (url: string) => {
    const photos = [url, ...p.photos.filter((x) => x !== url)];
    setP((x) => ({ ...x, photos }));
    await api.put("/connect/profile/photos", { photos }).catch(() => {});
  };

  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="stack g-24">
      <Field label="Photos" hint="Up to six. The first is the one people see in Discover. Clear photos of your face work best.">
        <div className="photo-slots">
          {p.photos.map((url, i) => (
            <div key={url} className="photo-slot">
              <img src={url} alt="" />
              <button className="remove" onClick={() => removePhoto(url)} aria-label="Remove photo">
                <X />
              </button>
              {i === 0 ? (
                <span className="badge badge-glass first">Main</span>
              ) : (
                <button className="badge badge-glass first" onClick={() => makeFirst(url)}>
                  Make main
                </button>
              )}
            </div>
          ))}
          {p.photos.length < 6 && (
            <button type="button" className="photo-slot" onClick={() => file.current?.click()} disabled={uploading}>
              {uploading ? <span className="spinner" /> : <Camera />}
            </button>
          )}
        </div>
        <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
      </Field>

      <Input label="Headline" value={p.headline} maxLength={120} onChange={(e) => setP({ ...p, headline: e.target.value })} hint="One line about you." error={errors.headline} />

      <Field label="Looking for" error={errors.intent}>
        <div className="chips">
          {Object.entries(INTENT).map(([k, v]) => (
            <button key={k} type="button" className="chip" aria-pressed={p.intent === k} onClick={() => setP({ ...p, intent: k as MyConnectProfile["intent"] })}>
              {v}
            </button>
          ))}
        </div>
      </Field>
      {p.intent === "arrangement" && (
        <Field label="Your side of the arrangement" error={errors.arrangementRole} hint="Benefactors can add an income verification badge from Account › Verification.">
          <div className="segmented" style={{ width: "100%" }}>
            {Object.entries(ROLE).map(([k, v]) => (
              <button key={k} type="button" style={{ flex: 1 }} aria-pressed={p.arrangementRole === k} onClick={() => setP({ ...p, arrangementRole: k as "benefactor" | "seeking" })}>
                {v}
              </button>
            ))}
          </div>
        </Field>
      )}

      <Field label="Interested in" error={errors.interestedIn}>
        <div className="chips">
          {Object.entries(GENDER_PLURAL).map(([k, v]) => (
            <button key={k} type="button" className="chip" aria-pressed={p.interestedIn.includes(k)} onClick={() => setP({ ...p, interestedIn: toggle(p.interestedIn, k) })}>
              {v}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Ages" error={errors.ageMax}>
        <div className="row g-10">
          <select className="select" value={p.ageMin} onChange={(e) => setP({ ...p, ageMin: Number(e.target.value) })} aria-label="Youngest">
            {Array.from({ length: 62 }, (_, i) => i + 18).map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <span className="muted">to</span>
          <select className="select" value={p.ageMax} onChange={(e) => setP({ ...p, ageMax: Number(e.target.value) })} aria-label="Oldest">
            {Array.from({ length: 62 }, (_, i) => i + 18).map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
      </Field>

      <Textarea label="About you" rows={4} maxLength={600} value={bio} onChange={(e) => setBio(e.target.value)} hint={`${bio.length} of 600`} />

      <Input label="Work" value={p.occupation} maxLength={60} onChange={(e) => setP({ ...p, occupation: e.target.value })} />

      <Field label="Interests" hint={`${p.interests.length} of 12`}>
        <div className="chips">
          {(opts?.interests ?? []).map((x) => (
            <button key={x} type="button" className="chip" aria-pressed={p.interests.includes(x)} onClick={() => p.interests.includes(x) || p.interests.length < 12 ? setP({ ...p, interests: toggle(p.interests, x) }) : null}>
              {x}
            </button>
          ))}
        </div>
      </Field>

      {!compact && (
        <div className="row between inset">
          <div className="stack g-4">
            <span className="strong">Show me in Connect</span>
            <span className="small muted">Turn off to pause. Your matches and messages stay.</span>
          </div>
          <Toggle checked={p.visible} onChange={(v) => setP({ ...p, visible: v })} label="Show me in Connect" />
        </div>
      )}

      <Button variant="primary" size="lg" loading={busy} onClick={save}>
        {exists ? "Save profile" : "Create profile"}
      </Button>
    </div>
  );
}

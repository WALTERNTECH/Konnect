import { Minus, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../api/client";
import { CATEGORY, fmtRange } from "../lib/format";
import { Calendar } from "./Calendar";
import { Button } from "./ui";

export type Meta = {
  neighbourhoods: Record<string, string[]>;
  amenities: string[];
  categories: string[];
  counts: { type: string; city: string; neighbourhood: string; n: number; min: number; max: number }[];
  bookingFeeKes: number;
  promotionWeekKes: number;
};

export function useMeta() {
  return useApi<Meta>("/listings/meta", { staleMs: 5 * 60_000 });
}

/** "Kilimani, Nairobi" style places, grouped by city, with listings first. */
export function PlaceSelect({ value, onChange, type, className = "", anyLabel = "Anywhere" }: { value: string; onChange: (v: string) => void; type?: "STAY" | "WELLNESS"; className?: string; anyLabel?: string }) {
  const { data } = useMeta();
  const live = new Set((data?.counts ?? []).filter((c) => !type || c.type === type).map((c) => `${c.neighbourhood}|${c.city}`));
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Where">
      <option value="">{anyLabel}</option>
      {Object.entries(data?.neighbourhoods ?? {}).map(([city, hoods]) => (
        <optgroup key={city} label={city}>
          <option value={`|${city}`}>All of {city}</option>
          {[...hoods]
            .sort((a, b) => Number(live.has(`${b}|${city}`)) - Number(live.has(`${a}|${city}`)))
            .map((h) => (
              <option key={h} value={`${h}|${city}`}>
                {h}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/** "Kilimani|Nairobi" → query params. */
export const placeParams = (v: string) => {
  const [neighbourhood, city] = v.split("|");
  const p: Record<string, string> = {};
  if (city) p.city = city;
  if (neighbourhood) p.neighbourhood = neighbourhood;
  return p;
};

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return { open, setOpen, ref };
}

export function Stepper({ value, onChange, min = 1, max = 16 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <div className="row g-12">
      <button type="button" className="icon-btn" style={{ boxShadow: "inset 0 0 0 1px var(--line-2)" }} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Fewer">
        <Minus />
      </button>
      <span className="num strong" style={{ minWidth: 20, textAlign: "center" }}>
        {value}
      </span>
      <button type="button" className="icon-btn" style={{ boxShadow: "inset 0 0 0 1px var(--line-2)" }} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="More">
        <Plus />
      </button>
    </div>
  );
}

export function SearchPanel() {
  const nav = useNavigate();
  const [tab, setTab] = useState<"STAY" | "WELLNESS">("STAY");
  const [place, setPlace] = useState("");
  const [range, setRange] = useState<{ start: string | null; end: string | null }>({ start: null, end: null });
  const [guests, setGuests] = useState(2);
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState("");
  const dates = usePopover();
  const people = usePopover();

  const go = () => {
    const p = new URLSearchParams(placeParams(place));
    if (tab === "STAY") {
      if (range.start && range.end) {
        p.set("checkIn", range.start);
        p.set("checkOut", range.end);
      }
      if (guests > 1) p.set("guests", String(guests));
      nav(`/stays?${p}`);
    } else {
      if (category) p.set("category", category);
      if (mode) p.set("mode", mode);
      nav(`/wellness?${p}`);
    }
  };

  return (
    <div className="search" role="search">
      <div className="search-tabs">
        <button type="button" aria-pressed={tab === "STAY"} onClick={() => setTab("STAY")}>
          Stays
        </button>
        <button type="button" aria-pressed={tab === "WELLNESS"} onClick={() => setTab("WELLNESS")}>
          Wellness
        </button>
      </div>
      <div className="search-fields">
        <label className="search-field">
          <span className="k">Where</span>
          <PlaceSelect value={place} onChange={setPlace} type={tab} />
        </label>
        {tab === "STAY" ? (
          <>
            <div className="search-field" ref={dates.ref}>
              <button type="button" className="stack g-4" style={{ textAlign: "left" }} onClick={() => dates.setOpen((o) => !o)}>
                <span className="k">Dates</span>
                <span className={`v ${range.start ? "" : "placeholder"}`}>{range.start && range.end ? fmtRange(range.start, range.end) : range.start ? "Choose check-out" : "Add dates"}</span>
              </button>
              {dates.open && (
                <div className="search-popover" style={{ width: "min(680px, calc(100vw - 24px))" }}>
                  <Calendar
                    mode="range"
                    start={range.start}
                    end={range.end}
                    onChange={(s, e) => {
                      setRange({ start: s, end: e });
                      if (s && e) dates.setOpen(false);
                    }}
                  />
                  <div className="row between mt-12">
                    <button className="link small" onClick={() => setRange({ start: null, end: null })}>
                      Clear dates
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="search-field" ref={people.ref}>
              <button type="button" className="stack g-4" style={{ textAlign: "left" }} onClick={() => people.setOpen((o) => !o)}>
                <span className="k">Guests</span>
                <span className="v">{guests === 1 ? "1 guest" : `${guests} guests`}</span>
              </button>
              {people.open && (
                <div className="search-popover" style={{ width: 280 }}>
                  <div className="row between">
                    <div>
                      <div className="strong">Guests</div>
                      <div className="tiny muted">Adults and children</div>
                    </div>
                    <Stepper value={guests} onChange={setGuests} />
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <label className="search-field">
              <span className="k">Treatment</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Any treatment</option>
                {Object.entries(CATEGORY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="search-field">
              <span className="k">Where it happens</span>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="">Studio or home</option>
                <option value="studio">At a studio</option>
                <option value="home">At my home</option>
              </select>
            </label>
          </>
        )}
        <div className="search-go">
          <Button variant="primary" onClick={go} icon={<Search />}>
            Search
          </Button>
        </div>
      </div>
    </div>
  );
}

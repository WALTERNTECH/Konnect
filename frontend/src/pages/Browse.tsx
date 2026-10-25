import { CalendarDays, Search, SlidersHorizontal, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { Calendar } from "../components/Calendar";
import { ListingGrid } from "../components/ListingCard";
import { PlaceSelect, Stepper, useMeta } from "../components/SearchPanel";
import { Button, CardSkeletons, Empty, Modal, PageHead } from "../components/ui";
import { CATEGORY, fmtRange, kes, num } from "../lib/format";
import type { ListingCard as L } from "../types";

type Kind = "STAY" | "WELLNESS";

const SORTS: Record<string, string> = { recommended: "Recommended", price_asc: "Price: low to high", price_desc: "Price: high to low", rating: "Highest rated", newest: "Newest" };

export default function Browse({ type }: { type: Kind }) {
  const [params, setParams] = useSearchParams();
  const { data: meta } = useMeta();
  const [items, setItems] = useState<L[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [datesOpen, setDatesOpen] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams(params);
    p.set("type", type);
    return p;
  }, [params, type]);

  const qs = query.toString();
  useEffect(() => {
    let live = true;
    setLoading(true);
    setPage(1);
    api
      .get<{ items: L[]; total: number }>(`/listings?${qs}&page=1`)
      .then((r) => {
        if (!live) return;
        setItems(r.data.items);
        setTotal(r.data.total);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [qs]);

  const loadMore = async () => {
    setMore(true);
    try {
      const r = await api.get<{ items: L[]; total: number }>(`/listings?${qs}&page=${page + 1}`);
      setItems((x) => [...x, ...r.data.items]);
      setPage((p) => p + 1);
    } finally {
      setMore(false);
    }
  };

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    setParams(p, { replace: true });
  };
  const place = params.get("neighbourhood") || params.get("city") ? `${params.get("neighbourhood") ?? ""}|${params.get("city") ?? ""}` : "";
  const amenities = params.getAll("amenity");
  const activeCount = ["minPrice", "maxPrice", "bedrooms"].filter((k) => params.get(k)).length + amenities.length;
  const checkIn = params.get("checkIn");
  const checkOut = params.get("checkOut");
  const guests = Number(params.get("guests") ?? 1);
  const where = params.get("neighbourhood") ?? params.get("city");

  return (
    <>
      <div className="page">
        <PageHead eyebrow={type === "STAY" ? "Stays" : "Wellness"} title={type === "STAY" ? (where ? `Stays in ${where}` : "Stays") : where ? `Wellness in ${where}` : "Wellness"}>
          {type === "STAY"
            ? "Short stays paid by M-Pesa. Prices are per night in shillings, and that's what you pay."
            : "Massage, physiotherapy, beauty and spa sessions at a studio or at home. Book a time and pay by M-Pesa."}
        </PageHead>
      </div>

      <div className="filterbar">
        <div className="page filterbar-inner">
          <label className="chip" style={{ paddingRight: 6 }}>
            <Search />
            <PlaceSelect
              value={place}
              type={type}
              onChange={(v) => {
                const [n, c] = v.split("|");
                set({ neighbourhood: n || null, city: c || null });
              }}
              anyLabel="Anywhere"
              className="chip-select"
            />
          </label>
          {type === "STAY" ? (
            <>
              <button className="chip" aria-pressed={Boolean(checkIn)} onClick={() => setDatesOpen(true)}>
                <CalendarDays /> {checkIn && checkOut ? fmtRange(checkIn, checkOut) : "Dates"}
              </button>
              <span className="chip">
                <Users />
                <Stepper value={guests} onChange={(g) => set({ guests: g > 1 ? String(g) : null })} />
              </span>
              <button className="chip" aria-pressed={params.get("availableNow") === "true"} onClick={() => set({ availableNow: params.get("availableNow") === "true" ? null : "true" })}>
                Available now
              </button>
            </>
          ) : (
            <>
              <span className="sep" />
              <button className="chip" aria-pressed={!params.get("category")} onClick={() => set({ category: null })}>
                All
              </button>
              {Object.entries(CATEGORY).map(([k, v]) => (
                <button key={k} className="chip" aria-pressed={params.get("category") === k} onClick={() => set({ category: params.get("category") === k ? null : k })}>
                  {v}
                </button>
              ))}
              <span className="sep" />
              <button className="chip" aria-pressed={params.get("mode") === "home"} onClick={() => set({ mode: params.get("mode") === "home" ? null : "home" })}>
                Home visits
              </button>
              <button className="chip" aria-pressed={params.get("mode") === "studio"} onClick={() => set({ mode: params.get("mode") === "studio" ? null : "studio" })}>
                Studio
              </button>
            </>
          )}
          <span className="sep" />
          <button className="chip" aria-pressed={activeCount > 0} onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal /> Filters {activeCount > 0 && <span className="count">{activeCount}</span>}
          </button>
          <label className="chip"><select className="chip-select" value={params.get("sort") ?? "recommended"} onChange={(e) => set({ sort: e.target.value === "recommended" ? null : e.target.value })} aria-label="Sort">
            {Object.entries(SORTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select></label>
        </div>
      </div>

      <div className="page" style={{ paddingTop: 24 }}>
        <div className="row between" style={{ marginBottom: 18 }}>
          <span className="small muted num">{loading ? "Searching…" : `${num(total)} ${type === "STAY" ? (total === 1 ? "stay" : "stays") : total === 1 ? "treatment" : "treatments"}`}</span>
          {(params.toString() && !loading) ? (
            <button className="small link" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Clear all
            </button>
          ) : null}
        </div>
        {loading ? (
          <CardSkeletons />
        ) : items.length === 0 ? (
          <Empty icon={<Search />} title="Nothing matches these filters" action={<Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button>}>
            {type === "STAY" ? "Try other dates, another neighbourhood or fewer filters." : "Try another treatment or neighbourhood."}
          </Empty>
        ) : (
          <>
            <ListingGrid items={items} slot={type} />
            {items.length < total && (
              <div className="row mt-48" style={{ justifyContent: "center" }}>
                <Button onClick={loadMore} loading={more}>
                  Show more
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <Modal open={datesOpen} onClose={() => setDatesOpen(false)} title="Dates" wide>
        <Calendar
          mode="range"
          start={checkIn}
          end={checkOut}
          onChange={(s, e) => {
            set({ checkIn: s, checkOut: e });
            if (s && e) setDatesOpen(false);
          }}
        />
        <div className="row between mt-16">
          <button className="link small" onClick={() => set({ checkIn: null, checkOut: null })}>
            Clear dates
          </button>
          <Button variant="ink" onClick={() => setDatesOpen(false)}>
            Done
          </Button>
        </div>
      </Modal>

      <FiltersModal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        type={type}
        amenities={meta?.amenities ?? []}
        params={params}
        onApply={(patch, ams) => {
          const p = new URLSearchParams(params);
          for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k);
          p.delete("amenity");
          ams.forEach((a) => p.append("amenity", a));
          setParams(p, { replace: true });
          setFiltersOpen(false);
        }}
      />
    </>
  );
}

function FiltersModal({ open, onClose, type, amenities, params, onApply }: { open: boolean; onClose: () => void; type: Kind; amenities: string[]; params: URLSearchParams; onApply: (p: Record<string, string>, amenities: string[]) => void }) {
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [beds, setBeds] = useState("");
  const [ams, setAms] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    setMin(params.get("minPrice") ?? "");
    setMax(params.get("maxPrice") ?? "");
    setBeds(params.get("bedrooms") ?? "");
    setAms(params.getAll("amenity"));
  }, [open, params]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <div className="row between">
          <button
            className="link small"
            onClick={() => {
              setMin("");
              setMax("");
              setBeds("");
              setAms([]);
            }}
          >
            Clear
          </button>
          <Button variant="ink" onClick={() => onApply({ minPrice: min, maxPrice: max, bedrooms: beds }, ams)}>
            Show results
          </Button>
        </div>
      }
    >
      <div className="stack g-24">
        <div className="stack g-10">
          <div className="h-3">Price {type === "STAY" ? "per night" : "per session"}</div>
          <div className="row g-10">
            <div className="input-group grow">
              <span className="prefix">KES</span>
              <input className="input num" inputMode="numeric" placeholder="Min" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} />
            </div>
            <span className="muted">–</span>
            <div className="input-group grow">
              <span className="prefix">KES</span>
              <input className="input num" inputMode="numeric" placeholder="Max" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
          {min && max && Number(min) > Number(max) && <span className="tiny" style={{ color: "var(--danger)" }}>The minimum is above the maximum</span>}
          {!min && !max && <span className="tiny muted">For example {kes(type === "STAY" ? 5000 : 2500)} to {kes(type === "STAY" ? 15000 : 6000)}</span>}
        </div>
        {type === "STAY" && (
          <>
            <div className="stack g-10">
              <div className="h-3">Bedrooms</div>
              <div className="chips">
                {["", "1", "2", "3", "4"].map((b) => (
                  <button key={b} className="chip" aria-pressed={beds === b} onClick={() => setBeds(b)}>
                    {b ? `${b}+` : "Any"}
                  </button>
                ))}
              </div>
            </div>
            <div className="stack g-10">
              <div className="h-3">Amenities</div>
              <div className="chips">
                {amenities.map((a) => {
                  const on = ams.includes(a);
                  return (
                    <button key={a} className="chip" aria-pressed={on} onClick={() => setAms((x) => (on ? x.filter((y) => y !== a) : [...x, a]))}>
                      {on && <X />} {a}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

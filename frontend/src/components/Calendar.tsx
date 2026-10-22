import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { addDays, todayYmd } from "../lib/format";

// Month grids in Nairobi dates (YYYY-MM-DD strings, so no time zone can shift a day).
// "range" picks check-in and check-out around nights that can't be booked;
// "host" shows a host's closed and booked nights and toggles closures.

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function monthDays(ym: string) {
  const first = `${ym}-01`;
  const dow = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday first
  const next = addDays(addDays(first, 32).slice(0, 7) + "-01", 0);
  const days: (string | null)[] = Array.from({ length: dow }, () => null);
  for (let d = first; d < next; d = addDays(d, 1)) days.push(d);
  return days;
}
const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const monthName = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-KE", { month: "long", year: "numeric", timeZone: "UTC" });

type RangeProps = {
  mode: "range";
  start: string | null;
  end: string | null;
  onChange: (start: string | null, end: string | null) => void;
  unavailable?: Set<string>;
  minNights?: number;
  months?: number;
};
type HostProps = {
  mode: "host";
  blocked: Set<string>;
  booked: Map<string, string>;
  onToggle: (day: string) => void;
  months?: number;
  month?: string;
  onMonth?: (ym: string) => void;
};

export function Calendar(props: RangeProps | HostProps) {
  const today = todayYmd();
  const [own, setOwn] = useState(() => (props.mode === "range" && props.start ? props.start : today).slice(0, 7));
  const month = props.mode === "host" && props.month ? props.month : own;
  const setMonth = (m: string) => (props.mode === "host" && props.onMonth ? props.onMonth(m) : setOwn(m));
  const months = props.months ?? 2;
  const list = Array.from({ length: months }, (_, i) => shiftMonth(month, i));

  // When choosing check-out, nights after the first unavailable one can't be reached.
  const limit = useMemo(() => {
    if (props.mode !== "range" || !props.start || props.end || !props.unavailable) return null;
    let d = props.start;
    for (let i = 0; i < 400; i++) {
      if (props.unavailable.has(d)) return d; // checkout may fall on it, not beyond
      d = addDays(d, 1);
    }
    return null;
  }, [props]);

  const click = (d: string) => {
    if (props.mode === "host") return props.onToggle(d);
    const { start, end, onChange, minNights = 1 } = props;
    if (!start || end || d <= start) return onChange(d, null);
    const nights = Math.round((Date.parse(d) - Date.parse(start)) / 86_400_000);
    if (nights < minNights) return onChange(start, addDays(start, minNights));
    onChange(start, d);
  };

  return (
    <div className="cal" style={{ ["--months" as string]: months }}>
      {list.map((ym, mi) => (
        <div key={ym}>
          <div className="cal-head">
            {mi === 0 ? (
              <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))} disabled={ym <= today.slice(0, 7) && props.mode === "range"} aria-label="Previous month">
                <ChevronLeft />
              </button>
            ) : (
              <span style={{ width: 40 }} />
            )}
            <div className="cal-month-name">{monthName(ym)}</div>
            {mi === list.length - 1 ? (
              <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
                <ChevronRight />
              </button>
            ) : (
              <span style={{ width: 40 }} />
            )}
          </div>
          <div className="cal-grid">
            {DOW.map((d) => (
              <div key={d} className="cal-dow">
                {d}
              </div>
            ))}
            {monthDays(ym).map((d, i) => {
              if (!d) return <span key={`x${i}`} />;
              const past = d < today;
              let cls = "cal-day";
              let disabled = past;
              let title: string | undefined;
              if (props.mode === "range") {
                const { start, end, unavailable } = props;
                const choosingEnd = Boolean(start && !end);
                const blocked = unavailable?.has(d) ?? false;
                if (choosingEnd && start && d > start) disabled = limit !== null && d > limit; // a check-out may land on a taken night
                else disabled = past || blocked; // picking (or re-picking) check-in
                if (start && d === start) cls += end ? " start" : " single";
                if (end && d === end) cls += " end";
                if (start && end && d > start && d < end) cls += " in-range";
              } else {
                const booked = props.booked.get(d);
                if (booked) {
                  cls += " booked-host";
                  title = booked;
                  disabled = true;
                } else if (props.blocked.has(d)) {
                  cls += " blocked-host";
                  title = "Closed";
                }
              }
              if (past) cls += " past";
              if (d === today) cls += " today";
              return (
                <button key={d} type="button" className={cls} disabled={disabled} onClick={() => click(d)} title={title} aria-label={d}>
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

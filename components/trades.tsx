"use client";
import { useEffect, useRef, useState } from "react";
import type { RunResult, Trade } from "../engine";
import type { Market } from "../lib/markets";
import { fmtDate, fmtDay, fmtPrice, fmtR, fmtTime } from "../lib/format";
import { TradeChart, type Candles } from "./chart";

export type { Candles };

const SHORT: Record<Trade["reason"], string> = {
  tp2: "Reached the far side of the range",
  stop: "Stopped out",
  breakeven: "Half at 50%, the rest back at entry",
  time: "Closed at the end of day 3",
  end: "Still open when the prices ended"
};

const tone = (r: number) => (r > 0.005 ? "pos" : r < -0.005 ? "neg" : "flat");

function units(x: number, m: Market) {
  const v = x / m.unit;
  if (m.unitName === "dollars") return `$${v.toFixed(2)}`;
  return `${v.toFixed(1)} ${m.unitName}`;
}

type Filter = "all" | "won" | "lost";

export function Trades({ result, market, getCandles }: { result: RunResult | null; market: Market; getCandles: (from: number, to: number) => Promise<Candles> }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(25);
  const [open, setOpen] = useState<Trade | null>(null);
  useEffect(() => setShown(25), [result, filter]);

  if (!result || !result.all.trades) return null;
  const list = [...result.trades].reverse().filter((t) => (filter === "won" ? t.r > 0.005 : filter === "lost" ? t.r < -0.005 : true));
  const counts = { all: result.trades.length, won: result.trades.filter((t) => t.r > 0.005).length, lost: result.trades.filter((t) => t.r < -0.005).length };

  return (
    <section className="sec-trades" aria-labelledby="trades-h">
      <h2 className="sec" id="trades-h">Every trade</h2>
      <p className="sec-note">Newest first. Open one to see it on the chart, step by step. Times are UTC, like Deriv&apos;s MT5 charts.</p>
      <div className="filters" role="radiogroup" aria-label="Show">
        {(["all", "won", "lost"] as Filter[]).map((f) => (
          <label key={f} className="chip">
            <input type="radio" name="trade-filter" checked={filter === f} onChange={() => setFilter(f)} />
            <span>{f === "all" ? "All" : f === "won" ? "Won" : "Lost"} ({counts[f]})</span>
          </label>
        ))}
      </div>
      <ul className="tlist">
        {list.slice(0, shown).map((t) => (
          <li key={t.id}>
            <button className="trow" onClick={() => setOpen(t)}>
              <span className={`dir ${t.dir === 1 ? "buy" : "sell"}`}>{t.dir === 1 ? "Buy" : "Sell"}</span>
              <span className="t-main">
                <span className="t-date">{fmtDay(t.entryT - 900)} {new Date(t.entryT * 1000).getUTCFullYear()}</span>
                <span className="t-why">{SHORT[t.reason]}</span>
              </span>
              <span className={`t-r ${tone(t.r)}`}>{fmtR(t.r, 2)}</span>
            </button>
          </li>
        ))}
      </ul>
      {list.length > shown && <button className="btn quiet small more" onClick={() => setShown((n) => n + 50)}>Show {Math.min(50, list.length - shown)} more</button>}
      {open && <TradeSheet trade={open} market={market} getCandles={getCandles} onClose={() => setOpen(null)} />}
    </section>
  );
}

function TradeSheet({ trade: t, market, getCandles, onClose }: { trade: Trade; market: Market; getCandles: (from: number, to: number) => Promise<Candles>; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [candles, setCandles] = useState<Candles | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  useEffect(() => {
    let live = true;
    getCandles(t.rangeDayT, Math.max(t.exitT, t.entryT) + 8 * 900).then(
      (c) => { if (live) setCandles(c); },
      (e: Error) => { if (live) setErr(e.message); }
    );
    return () => { live = false; };
  }, [t, getCandles]);

  const long = t.dir === 1;
  const d = market.digits;
  const px = (x: number) => fmtPrice(x, d);
  // a Monday's candle starts on Sunday evening, so name the day by its middle
  const rangeDay = fmtDay(t.rangeDayT + 12 * 3600).split(" ")[0];
  const steps: { t?: number; day?: string; text: string }[] = [
    { day: rangeDay, text: `Range day: high ${px(t.rangeHigh)}, low ${px(t.rangeLow)}, 50% at ${px(t.mid)}.` },
    { t: t.sweepT, text: `Took the day before's ${long ? "low" : "high"}, reaching ${px(t.sweepPrice)}.` }
  ];
  if (t.zone) {
    const kind = t.zone.fvg && t.zone.ob ? "order block and gap" : t.zone.fvg ? "gap" : "order block";
    steps.push({ t: t.zone.t, text: `1-hour ${kind} finished forming: ${px(t.zone.bottom)} to ${px(t.zone.top)}.` });
    if (t.touchT) steps.push({ t: t.touchT, text: "Price came back into the zone." });
  }
  steps.push({ t: t.entryT, text: `A 15-minute candle closed ${long ? "above" : "below"} the ${px(t.mssLevel)} swing ${long ? "high" : "low"}. ${long ? "Bought" : "Sold"} at ${px(t.entry)}.` });
  steps.push({ text: `Stop ${px(t.stop)}, risking ${units(t.risk, market)}. Half off at ${px(t.tp1)}, the rest at ${px(t.tp2)}.` });
  if (t.partialT) steps.push({ t: t.partialT, text: "Half closed at 50%. The stop moved to the entry price." });
  steps.push({ t: t.exitT, text: `${SHORT[t.reason]} at ${px(t.exit)}: ${fmtR(t.r, 2)} on the whole trade.` });

  return (
    <dialog
      ref={ref} className="sheet" aria-labelledby="sheet-h" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
    >
      <div className="sheet-inner">
        <div className="sheet-head">
          <div>
            <h3 id="sheet-h">{long ? "Buy" : "Sell"} on {fmtDate(t.entryT - 900)}</h3>
            <p className={tone(t.r)}>{fmtR(t.r, 2)}. {SHORT[t.reason]}.</p>
          </div>
          <button className="close" onClick={() => ref.current?.close()} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="sheet-body">
          <div className="chart-box">
            <TradeChart trade={t} candles={candles} digits={d} />
            {!candles && <div className="chart-msg">{err ?? "Drawing the chart"}</div>}
          </div>
          <ul className="legend" aria-label="Chart key">
            <li><i style={{ borderColor: "var(--fog)" }} />Range high and low</li>
            <li><i className="dash" style={{ borderColor: "var(--gold)" }} />50%</li>
            {t.zone && <li><i className="box" style={{ borderColor: "rgba(227,176,75,0.6)", background: "rgba(227,176,75,0.13)" }} />1-hour zone</li>}
            <li><i className="dash" style={{ borderColor: "var(--paper)" }} />Swing that broke</li>
            <li><i className="dash" style={{ borderColor: "var(--down)" }} />Stop</li>
          </ul>
          <ol className="story">
            {steps.map((s, i) => (
              <li key={i}>
                <time>{s.t !== undefined ? <><span className="s-day">{fmtDay(s.t).split(" ")[0]}</span>{fmtTime(s.t)}</> : s.day ? <span className="s-day">{s.day}</span> : null}</time>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </dialog>
  );
}

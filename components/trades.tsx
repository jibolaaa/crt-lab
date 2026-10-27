"use client";
import { useEffect, useRef, useState } from "react";
import type { RunResult, Trade } from "../engine";
import type { Market } from "../lib/markets";
import { fmtUsd, type MoneyCfg, type MoneyResult, type TradeMoney } from "../lib/money";
import { TF_LABEL, kindName } from "../lib/confluences";
import { fmtDate, fmtDay, fmtPrice, fmtR, fmtTime } from "../lib/format";
import { TradeChart, type Candles } from "./chart";
import { Checklist } from "./now";

export type { Candles };

const SHORT: Record<Trade["reason"], string> = {
  tp2: "Hit the target",
  stop: "Stopped out",
  breakeven: "Half at 50%, the rest back at entry",
  time: "Closed at the end of the next day",
  end: "Still open when the prices ended"
};

/** How a trade ended, in plain words. The time limit closes trades at the end of the day (week) after the entry's. */
export const exitText = (t: Pick<Trade, "reason" | "tf">) =>
  t.reason === "time" ? `Closed at the end of the next ${t.tf === "week" ? "week" : "day"}` : SHORT[t.reason];

const tone = (r: number) => (r > 0.005 ? "pos" : r < -0.005 ? "neg" : "flat");

function units(x: number, m: Market) {
  const v = x / m.unit;
  if (m.unitName === "dollars") return `$${v.toFixed(2)}`;
  return `${v.toFixed(1)} ${m.unitName}`;
}

type Filter = "all" | "won" | "lost";

interface Props {
  result: RunResult | null;
  market: Market;
  getCandles: (from: number, to: number) => Promise<Candles>;
  money: MoneyResult | null;
  moneyCfg: MoneyCfg;
  /** Seconds per candle in the loaded prices. */
  dt: number;
}

export function Trades({ result, market, getCandles, money, moneyCfg, dt }: Props) {
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
      <p className="sec-note">Newest first, with how much of your checklist each one met. Open one to see it on the chart, step by step. Times are UTC, like Deriv&apos;s MT5 charts.</p>
      <div className="filters" role="radiogroup" aria-label="Show">
        {(["all", "won", "lost"] as Filter[]).map((f) => (
          <label key={f} className="chip">
            <input type="radio" name="trade-filter" checked={filter === f} onChange={() => setFilter(f)} />
            <span>{f === "all" ? "All" : f === "won" ? "Won" : "Lost"} ({counts[f]})</span>
          </label>
        ))}
      </div>
      <ul className="tlist">
        {list.slice(0, shown).map((t) => {
          const m = money?.byId.get(t.id);
          return (
            <li key={t.id}>
              <button className="trow" onClick={() => setOpen(t)}>
                <span className={`dir ${t.dir === 1 ? "buy" : "sell"}`}>{t.dir === 1 ? "Buy" : "Sell"}</span>
                <span className="t-main">
                  <span className="t-date">{fmtDay(t.entryT - 1)} {new Date(t.entryT * 1000).getUTCFullYear()} <span className="grade" aria-label={`${Math.round(t.pct)}% of the checklist`}>{Math.round(t.pct)}%</span></span>
                  <span className="t-why">{t.tf === "week" ? "Weekly CRT. " : ""}{exitText(t)}</span>
                </span>
                <span className="t-end">
                  <span className={`t-r ${tone(t.r)}`}>{fmtR(t.r, 2)}</span>
                  {m && !m.skipped && <span className={`t-usd ${tone(m.pnlUsd)}`}>{fmtUsd(m.pnlUsd)}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {list.length > shown && <button className="btn quiet small more" onClick={() => setShown((n) => n + 50)}>Show {Math.min(50, list.length - shown)} more</button>}
      {open && <TradeSheet trade={open} market={market} getCandles={getCandles} money={money?.byId.get(open.id) ?? null} moneyCfg={moneyCfg} dt={dt} onClose={() => setOpen(null)} />}
    </section>
  );
}

function TradeSheet({ trade: t, market, getCandles, money, moneyCfg, dt, onClose }: {
  trade: Trade; market: Market; getCandles: (from: number, to: number) => Promise<Candles>;
  money: TradeMoney | null; moneyCfg: MoneyCfg; dt: number; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [candles, setCandles] = useState<Candles | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  useEffect(() => {
    let live = true;
    const pad = t.tf === "week" ? 8 * 3600 : 8 * 900;
    getCandles(t.rangeDayT, Math.max(t.exitT, t.entryT) + pad).then(
      (c) => { if (live) setCandles(t.tf === "week" ? hourly(c) : c); }, // weekly CRTs are drawn on 1-hour candles
      (e: Error) => { if (live) setErr(e.message); }
    );
    return () => { live = false; };
  }, [t, getCandles]);

  const long = t.dir === 1;
  const d = market.digits;
  const px = (x: number) => fmtPrice(x, d);
  const weekly = t.tf === "week";
  // a Monday's candle starts on Sunday evening, so name the day by its middle
  const rangeDay = weekly ? "Week" : fmtDay(t.rangeDayT + 12 * 3600).split(" ")[0];
  const entryChart = weekly || dt >= 900 ? "15-minute" : "5-minute";
  const zoneChart = weekly ? "4-hour" : "1-hour";
  const steps: { t?: number; day?: string; text: string }[] = [
    { day: rangeDay, text: `Candle 1 (${weekly ? `the week of ${fmtDate(t.rangeDayT + 12 * 3600)}` : "the range day"}): high ${px(t.rangeHigh)}, low ${px(t.rangeLow)}, 50% at ${px(t.mid)}.` },
    {
      t: t.sweepT,
      text: `${t.sweepT >= t.sweepDayT + (weekly ? 7 : 1) * 86400 ? "A later candle swept further" : "Candle 2 took candle 1's " + (long ? "low" : "high")}, reaching ${px(t.sweepPrice)}` +
        (t.keyLevel ? `, into a ${TF_LABEL[t.keyLevel.tf]} ${kindName(t.keyLevel.kind, t.dir)} at ${t.keyLevel.top === t.keyLevel.bottom ? px(t.keyLevel.top) : `${px(t.keyLevel.bottom)} to ${px(t.keyLevel.top)}`}.` : ".")
    }
  ];
  if (t.qm) {
    const q = t.qm;
    steps.push({ t: q.headT, text: `A-shape ${long ? "bottom" : "top"} at ${px(q.head)}, beyond the ${px(q.level)} ${long ? "low" : "high"} before it (the QM line).` });
    steps.push({ t: q.smsT, text: `A ${entryChart} candle closed ${long ? "above" : "below"} ${px(q.smsLevel)}: the shift. ${long ? "Buy" : "Sell"} limit set at ${px(q.level)}.` });
    steps.push({ t: t.entryT, text: `Price came back to the line. ${long ? "Bought" : "Sold"} at ${px(t.entry)}, on candle ${t.entryCandle} of the CRT.` });
  } else {
    if (t.zone) {
      const kind = t.zone.fvg && t.zone.ob ? "order block and gap" : t.zone.fvg ? "gap" : "order block";
      steps.push({ t: t.zone.t, text: `${zoneChart} ${kind} finished forming: ${px(t.zone.bottom)} to ${px(t.zone.top)}.` });
      if (t.touchT) steps.push({ t: t.touchT, text: "Price came back into the zone." });
    }
    const r = t.retest;
    if (r) {
      steps.push({ t: r.bosT, text: `A ${entryChart} candle closed ${long ? "above" : "below"} the ${px(t.mssLevel)} swing ${long ? "high" : "low"} (the BOS). ${long ? "Buy" : "Sell"} limit set at ${px(r.level)}, the order block it left (${px(r.bottom)} to ${px(r.top)}).` });
      steps.push({ t: t.entryT, text: `Price came back to it. ${long ? "Bought" : "Sold"} at ${px(t.entry)}, on candle ${t.entryCandle} of the CRT.` });
    } else {
      steps.push({ t: t.entryT, text: `A ${entryChart} candle closed ${long ? "above" : "below"} the ${px(t.mssLevel)} swing ${long ? "high" : "low"} (the BOS). ${long ? "Bought" : "Sold"} at ${px(t.entry)}, on candle ${t.entryCandle} of the CRT.` });
    }
  }
  steps.push({
    text: `Stop ${px(t.stop)}, risking ${units(t.risk, market)}. Target ${px(t.tp2)}, ${t.plannedR.toFixed(1)}R away` +
      (t.partial ? `, with half off at ${px(t.tp1)}.` : ".")
  });
  if (t.partialT) steps.push({ t: t.partialT, text: "Half closed at 50%. The stop moved to the entry price." });
  steps.push({ t: t.exitT, text: `${exitText(t)} at ${px(t.exit)}: ${fmtR(t.r, 2)} on the whole trade.` });

  return (
    <dialog
      ref={ref} className="sheet" aria-labelledby="sheet-h" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}
    >
      <div className="sheet-inner">
        <div className="sheet-head">
          <div>
            <h3 id="sheet-h">{long ? "Buy" : "Sell"} on {fmtDate(t.entryT - 1)}, {weekly ? "weekly" : "daily"} CRT, {Math.round(t.pct)}% of the checklist</h3>
            <p className={tone(t.r)}>{fmtR(t.r, 2)}{money && !money.skipped ? ` (${fmtUsd(money.pnlUsd)})` : ""}. {exitText(t)}.</p>
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
            {t.keyLevel && <li><i className="box" style={{ borderColor: "rgba(154,163,176,0.6)", background: "rgba(154,163,176,0.12)" }} />Key level</li>}
            {t.zone && !t.qm && <li><i className="box" style={{ borderColor: "rgba(227,176,75,0.6)", background: "rgba(227,176,75,0.13)" }} />{zoneChart} zone</li>}
            {t.qm && <li><i className="dash" style={{ borderColor: "var(--gold)" }} />QM line</li>}
            {t.retest && <li><i className="box" style={{ borderColor: "rgba(236,230,214,0.5)", background: "rgba(236,230,214,0.10)" }} />Order block the BOS left</li>}
            <li><i className="dash" style={{ borderColor: "var(--paper)" }} />{t.qm ? "The shift" : "Swing that broke (BOS)"}</li>
            <li><i className="dash" style={{ borderColor: "var(--down)" }} />Stop</li>
            <li><i style={{ borderColor: "var(--up)" }} />Target</li>
          </ul>

          {money && <MoneyNote money={money} cfg={moneyCfg} />}

          <ol className="story">
            {steps.map((s, i) => (
              <li key={i}>
                <time>{s.t !== undefined ? <><span className="s-day">{weekly ? fmtDay(s.t) : fmtDay(s.t).split(" ")[0]}</span>{fmtTime(s.t)}</> : s.day ? <span className="s-day">{s.day}</span> : null}</time>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>

          <h4 className="checks-h">Checklist: {t.points} of {t.maxPoints} points ({Math.round(t.pct)}%)</h4>
          <Checklist conf={t.conf} />
        </div>
      </div>
    </dialog>
  );
}

/** 15-minute candles joined into 1-hour ones. */
function hourly(c: Candles): Candles {
  const out: Candles = { t: [], o: [], h: [], l: [], c: [] };
  for (let i = 0; i < c.t.length; i++) {
    const ht = c.t[i] - (c.t[i] % 3600), k = out.t.length - 1;
    if (k < 0 || out.t[k] !== ht) { out.t.push(ht); out.o.push(c.o[i]); out.h.push(c.h[i]); out.l.push(c.l[i]); out.c.push(c.c[i]); }
    else { out.h[k] = Math.max(out.h[k], c.h[i]); out.l[k] = Math.min(out.l[k], c.l[i]); out.c[k] = c.c[i]; }
  }
  return out;
}

function MoneyNote({ money: m, cfg }: { money: TradeMoney; cfg: MoneyCfg }) {
  if (m.skipped) return <p className="money-note neg">The account was already empty by this trade.</p>;
  const share = Math.round(m.riskShare * 100);
  return (
    <p className={`money-note ${share > 10 ? "hot" : ""}`}>
      At {m.lots} lots on a {fmtUsd(m.balance)} balance: <b>{fmtUsd(m.riskUsd)}</b> at risk ({share}% of the balance), <b>{fmtUsd(m.targetUsd)}</b> at the target, {fmtUsd(m.margin)} margin at 1:{cfg.leverage}.
      {m.minLotTooBig ? ` Even the smallest lot risked more than ${cfg.riskPct}% here.` : ""}
    </p>
  );
}

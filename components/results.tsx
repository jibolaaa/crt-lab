"use client";
import { useMemo } from "react";
import { CONFLUENCES, type Config, type Grade, type RunResult, type Stats, type Trade } from "../engine";
import type { Market } from "../lib/markets";
import { fmtUsd, type MoneyCfg, type MoneyResult } from "../lib/money";
import type { DataInfo, MatterRow } from "../lib/protocol";
import { fmtDate, fmtInt, fmtMonth, fmtNum, fmtPct, fmtR, fmtSpan } from "../lib/format";
import { CONF_LABEL } from "../lib/confluences";
import { verdict } from "../lib/verdict";

const tone = (x: number, eps = 0.05) => (x > eps ? "pos" : x < -eps ? "neg" : "");

// ---------- the verdict and equity curve ----------
export function Verdict({ result, data, market, failed, money, moneyCfg }: {
  result: RunResult | null; data: DataInfo | null; market: Market; failed: boolean; money: MoneyResult | null; moneyCfg: MoneyCfg;
}) {
  const v = result ? verdict(result) : null;
  return (
    <section className="sec-verdict" aria-labelledby="verdict-h" aria-live="polite">
      <h2 className="sec" id="verdict-h">How your rules did{result ? ` on ${fmtSpan(result.from, result.to)} of ${market.name}` : ""}</h2>
      {!v ? (
        <p className="verdict-line verdict-empty">{failed ? "No prices to test yet." : data ? "Running your rules" : `Getting ${market.name} ready`}</p>
      ) : (
        <>
          <p className="verdict-line">{v.line}</p>
          {v.notes.map((n) => <p key={n} className="verdict-sub">{n}</p>)}
          {v.cautions.map((n) => <p key={n} className="verdict-sub muted">{n}</p>)}
          {result && result.all.trades > 0 && <Equity result={result} />}
          {result && money && result.all.trades > 0 && <MoneyLine result={result} money={money} cfg={moneyCfg} />}
          <p className="r-explain">R is what a trade risked. A trade at +2R made twice what it risked; a full loss is −1R.</p>
        </>
      )}
    </section>
  );
}

function MoneyLine({ result, money, cfg }: { result: RunResult; money: MoneyResult; cfg: MoneyCfg }) {
  const how = cfg.mode === "lots" ? `At ${cfg.lots} lots` : `Risking ${cfg.riskPct}% of the balance each time`;
  const tooBig = [...money.byId.values()].filter((x) => x.minLotTooBig && !x.skipped).length;
  return (
    <>
      <p className="riskline">
        {how}, a {fmtUsd(cfg.account)} account would have ended at <b className={tone(money.final - cfg.account, 0.005)}>{fmtUsd(money.final)}</b> over {fmtSpan(result.from, result.to)}, with a worst drop of <b>{Math.round(money.maxDrawdownPct)}%</b> along the way.
      </p>
      {money.blownAt !== null && <p className="riskline neg">The account would have been wiped out on {fmtDate(money.blownAt)}.</p>}
      {money.riskiest > 0.1 && (
        <p className="riskline">
          The riskiest trade put <b>{Math.round(money.riskiest * 100)}%</b> of the balance on the line{money.overShare > 1 ? `, and ${money.overShare} trades risked more than 10%` : ""}. Many traders keep a single trade to 1 or 2% of the account.
        </p>
      )}
      {cfg.mode === "risk" && tooBig > 0 && <p className="riskline">On {tooBig} trades even the smallest lot risked more than {cfg.riskPct}%.</p>}
    </>
  );
}

function Equity({ result }: { result: RunResult }) {
  const W = 1000, H = 200;
  const { path, zeroY, splitX, lo, hi, years } = useMemo(() => {
    const trades = [...result.trades].sort((a, b) => a.exitT - b.exitT);
    const pts: [number, number][] = [[result.from, 0]];
    let eq = 0;
    for (const t of trades) { eq += t.r; pts.push([t.exitT, eq]); }
    pts.push([result.to, eq]);
    let lo = 0, hi = 0;
    for (const [, y] of pts) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    const pad = Math.max((hi - lo) * 0.08, 0.5);
    lo -= pad; hi += Math.max((hi - lo) * 0.22, 0.6); // headroom so the line stays clear of the labels
    const x = (t: number) => ((t - result.from) / Math.max(1, result.to - result.from)) * W;
    const y = (r: number) => H - ((r - lo) / (hi - lo)) * H;
    let path = "";
    pts.forEach(([t, r], i) => {
      const px = x(t).toFixed(1), py = y(r).toFixed(1);
      if (i === 0) path += `M${px},${py}`;
      else path += `H${px}V${py}`; // equity only moves when a trade closes
    });
    const years: { x: number; label: string }[] = [];
    const y0 = new Date(result.from * 1000).getUTCFullYear(), y1 = new Date(result.to * 1000).getUTCFullYear();
    const step = y1 - y0 > 6 ? 2 : 1;
    for (let yr = y0 + 1; yr <= y1; yr += step) {
      const t = Date.UTC(yr, 0, 1) / 1000;
      if (t > result.from && t < result.to) years.push({ x: (x(t) / W) * 100, label: String(yr) });
    }
    return { path, zeroY: y(0), splitX: x(result.splitT), lo, hi, years };
  }, [result]);
  const short = result.to - result.from < 400 * 86400;
  return (
    <figure className="equity" style={{ margin: "22px 0 0" }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Running total in R over time, ending at ${fmtR(result.all.totalR)}`}>
        <rect x={splitX} y={0} width={W - splitX} height={H} fill="rgba(255,255,255,0.025)" />
        <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="var(--rule)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <line x1={splitX} x2={splitX} y1={0} y2={H} stroke="var(--dim)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        <path d={path} fill="none" stroke="var(--gold)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <span className="eq-label" style={{ top: 4, right: `calc(${100 - (splitX / W) * 100}% + 8px)` }}>First 70%</span>
      <span className="eq-label late" style={{ top: 4, left: `calc(${(splitX / W) * 100}% + 8px)` }}>Last 30%</span>
      <span className="eq-y" style={{ top: `calc(${(zeroY / H) * 190}px - 9px)` }}>0R</span>
      <span className="sr">The chart runs from {fmtR(lo)} to {fmtR(hi)}.</span>
      {!short && years.length > 0 && (
        <div className="eq-axis" aria-hidden style={{ position: "relative", height: 16 }}>
          {years.map((y) => <span key={y.label} style={{ position: "absolute", left: `${y.x}%`, transform: "translateX(-50%)" }}>{y.label}</span>)}
        </div>
      )}
      {short && (
        <div className="eq-axis" aria-hidden><span>{fmtMonth(result.from)}</span><span>{fmtMonth(result.to - 900)}</span></div>
      )}
    </figure>
  );
}

// ---------- first 70% against the last 30% ----------
export function StatsTable({ result }: { result: RunResult | null }) {
  if (!result || !result.all.trades) return null;
  const cols: [string, string, Stats][] = [
    ["First 70%", `${fmtMonth(result.from)} to ${fmtMonth(result.splitT)}`, result.seen],
    ["Last 30%", `kept aside`, result.unseen],
    ["All", fmtSpan(result.from, result.to), result.all]
  ];
  const rows: [string, (s: Stats) => React.ReactNode][] = [
    ["Trades", (s) => fmtInt(s.trades)],
    ["Won", (s) => (s.trades ? fmtPct(s.winRate) : "–")],
    ["Average", (s) => (s.trades ? <span className={tone(s.avgR, 0.005)}>{fmtR(s.avgR, 2)}</span> : "–")],
    ["Total", (s) => <span className={tone(s.totalR)}>{fmtR(s.totalR)}</span>],
    ["Won for each 1R lost", (s) => (!s.trades ? "–" : s.profitFactor === null ? "no losses" : fmtNum(s.profitFactor, 2))],
    ["Worst drop", (s) => (s.trades ? fmtR(-s.maxDrawdownR) : "–")],
    ["Longest losing run", (s) => (s.trades ? fmtInt(s.longestLosingStreak) : "–")],
    ["Trades a month", (s) => fmtNum(s.tradesPerMonth, 1)]
  ];
  return (
    <section className="sec-stats" aria-labelledby="stats-h">
      <h2 className="sec" id="stats-h">Seen against kept aside</h2>
      <p className="sec-note">Tune the rules on the first 70% if you like, then judge them on the last 30%. Rules that only work on the first part are usually fitted to it.</p>
      <div className="table-wrap">
        <table className="grid">
          <thead>
            <tr><th scope="col"><span className="sr">Measure</span></th>{cols.map(([h, sub]) => <th key={h} scope="col">{h}<small>{sub}</small></th>)}</tr>
          </thead>
          <tbody>
            {rows.map(([label, f]) => (
              <tr key={label}><th scope="row">{label}</th>{cols.map(([h, , s]) => <td key={h}>{f(s)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- change one rule ----------
export function Matters({ result, rows }: { result: RunResult | null; rows: MatterRow[] | null }) {
  if (!result) return null;
  const base = result.all.totalR;
  const sorted = rows ? [...rows].sort((a, b) => Math.abs(b.totalR - base) - Math.abs(a.totalR - base)) : null;
  const span = sorted ? Math.max(1, ...sorted.map((r) => Math.abs(r.totalR - base))) : 1;
  return (
    <section className="sec-matters" aria-labelledby="matters-h">
      <h2 className="sec" id="matters-h">Change one rule</h2>
      <p className="sec-note">Each row changes a single rule and keeps the rest, so you can see which parts carry their weight. Yours: {fmtInt(result.all.trades)} trades, {fmtR(base)}.</p>
      {!sorted ? (
        <p className="sec-note">Working it out…</p>
      ) : (
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th scope="col">Change</th>
                <th scope="col">Trades</th>
                <th scope="col">Total</th>
                <th scope="col">Last 30%</th>
                <th scope="col">Difference<small>to the total</small></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const d = r.totalR - base;
                const w = (Math.abs(d) / span) * 50;
                return (
                  <tr key={r.key} className="matter-row">
                    <th scope="row">{r.label}</th>
                    <td>{fmtInt(r.trades)}</td>
                    <td className={tone(r.totalR)}>{fmtR(r.totalR)}</td>
                    <td className={tone(r.lateR)}>{fmtR(r.lateR)}</td>
                    <td>
                      <span className={tone(d)}>{fmtR(d)}</span>
                      <div className="mbar" aria-hidden><i className={d >= 0 ? "pos" : "neg"} style={d >= 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} /></div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------- how days became trades ----------
export function Funnel({ result, cfg }: { result: RunResult | null; cfg: Config }) {
  if (!result) return null;
  const f = result.funnel;
  const max = Math.max(1, f.days, f.sweeps);
  const items: { label: string; n: number; side?: string }[] = [
    { label: "Trading days looked at", n: f.days },
    {
      label: cfg.bias === "off" ? "Times a day took the day before's high or low" : "Times a day took the day before's high or low, in the bias direction",
      n: f.sweeps,
      side: cfg.bias === "off" ? undefined : `${fmtInt(f.biasBlocked)} more went against the weekly bias or had no bias, so they were skipped.`
    }
  ];
  if (cfg.requireKeyLevel) items.push({ label: "The sweep reached a higher-timeframe key level", n: f.keyLevels });
  if (cfg.zone !== "off") {
    items.push({ label: "A 1-hour zone formed after the sweep", n: f.zones });
    items.push({ label: "Price came back into the zone", n: f.touches });
  }
  const skipped = [
    f.skippedNews ? `${fmtInt(f.skippedNews)} on jobs report days` : "",
    f.skippedSession ? `${fmtInt(f.skippedSession)} outside your entry times` : "",
    f.skippedPastMid ? `${fmtInt(f.skippedPastMid)} already at 50%` : "",
    f.skippedLowR ? `${fmtInt(f.skippedLowR)} with the target too close in R` : "",
    f.skippedDailyCap ? `${fmtInt(f.skippedDailyCap)} over the daily limit` : ""
  ].filter(Boolean);
  items.push({ label: "Structure shifted and a trade was taken", n: f.entries, side: skipped.length ? `Skipped after a shift: ${skipped.join(", ")}.` : undefined });
  return (
    <section className="sec-funnel" aria-labelledby="funnel-h">
      <h2 className="sec" id="funnel-h">From days to trades</h2>
      <ol className="funnel">
        {items.map((it, i) => (
          <li key={it.label} className={i === items.length - 1 ? "last" : ""}>
            <span className="f-label">{it.label}</span>
            <span className="f-num">{fmtInt(it.n)}</span>
            <span className="f-track" aria-hidden><span className="f-fill" style={{ display: "block", width: `${(it.n / max) * 100}%` }} /></span>
            {it.side && <span className="f-side">{it.side}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------- do more confluences help? ----------
const GRADES: Grade[] = ["A+", "A", "B", "C"];
const sum = (ts: Trade[]) => ts.reduce((a, t) => a + t.r, 0);

export function Grades({ result }: { result: RunResult | null }) {
  if (!result || !result.all.trades) return null;
  const ts = result.trades;
  const cell = (list: Trade[]) => (list.length ? <span className={tone(sum(list) / list.length, 0.005)}>{fmtR(sum(list) / list.length, 2)}</span> : "–");
  return (
    <section className="sec-grades" aria-labelledby="grades-h">
      <h2 className="sec" id="grades-h">Do more confluences help?</h2>
      <p className="sec-note">
        Each trade is graded on {CONFLUENCES.length} confluences. A+ has all of them, A misses one or two, B three or four, C more. If better grades don&apos;t do better, the extra confluences aren&apos;t adding an edge here.
      </p>
      <div className="table-wrap">
        <table className="grid">
          <thead><tr><th scope="col">Grade</th><th scope="col">Trades</th><th scope="col">Won</th><th scope="col">Average</th><th scope="col">Total</th></tr></thead>
          <tbody>
            {GRADES.map((g) => {
              const list = ts.filter((t) => t.grade === g);
              return (
                <tr key={g}>
                  <th scope="row">{g}</th>
                  <td>{fmtInt(list.length)}</td>
                  <td>{list.length ? fmtPct(list.filter((t) => t.r > 0.005).length / list.length) : "–"}</td>
                  <td>{cell(list)}</td>
                  <td>{list.length ? <span className={tone(sum(list))}>{fmtR(sum(list))}</span> : "–"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-wrap" style={{ marginTop: 18 }}>
        <table className="grid">
          <thead>
            <tr>
              <th scope="col">Confluence</th>
              <th scope="col">With it<small>trades</small></th>
              <th scope="col"><span className="sr">With it, </span>average</th>
              <th scope="col">Without<small>trades</small></th>
              <th scope="col"><span className="sr">Without, </span>average</th>
            </tr>
          </thead>
          <tbody>
            {CONFLUENCES.map((c) => {
              const yes = ts.filter((t) => t.conf[c]), no = ts.filter((t) => !t.conf[c]);
              return (
                <tr key={c}>
                  <th scope="row">{CONF_LABEL[c]}</th>
                  <td>{fmtInt(yes.length)}</td>
                  <td>{cell(yes)}</td>
                  <td>{fmtInt(no.length)}</td>
                  <td>{cell(no)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

"use client";
import { useMemo, useState } from "react";
import type { Config } from "../engine";
import { MARKETS, marketById } from "../lib/markets";
import { combine, forMonth, liveList, monthsOf, type ScanRow } from "../lib/scan";
import { CRT_LABEL } from "../lib/confluences";
import { fmtDate, fmtDay, fmtMonth, fmtPrice, fmtR, fmtTime } from "../lib/format";
import { Choice } from "./controls";
import { CallView, describeSetup } from "./now";
import { exitText } from "./trades";

const LIVE = MARKETS.filter((m) => m.source === "deriv");
const tone = (r: number) => (r > 0.005 ? "pos" : r < -0.005 ? "neg" : "flat");

interface Props {
  ids: string[];
  setIds: (ids: string[]) => void;
  /** The latest result for each chosen market that has loaded. */
  rows: ScanRow[];
  status: { text: string; fraction: number } | null;
  errors: Record<string, string>;
  cfg: Config;
  onOpen: (marketId: string) => void;
  onRefresh: () => void;
}

/** Every chosen market at once: what's close to an entry right now, and how the rules did on each. */
export function AllMarkets(p: Props) {
  const [shown, setShown] = useState(25);
  const [month, setMonth] = useState("all");
  const months = useMemo(() => monthsOf(p.rows), [p.rows]);
  const picked = month !== "all" && months.includes(month) ? month : "all";
  const rows = useMemo(() => (picked === "all" ? p.rows : forMonth(p.rows, picked)), [p.rows, picked]);
  const total = useMemo(() => combine(rows), [rows]);
  const monthName = (ym: string) => fmtMonth(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)) - 1, 15) / 1000);
  const live = useMemo(() => liveList(p.rows, p.cfg.crt), [p.rows, p.cfg.crt]);
  const asOf = p.rows.reduce((a, r) => Math.max(a, r.live?.asOf ?? 0), 0);
  const random = p.ids.some((id) => marketById(id).random);
  const toggle = (id: string, on: boolean) => p.setIds(on ? [...p.ids.filter((x) => x !== id), id] : p.ids.filter((x) => x !== id));
  const byTotal = [...rows].sort((a, b) => b.totalR - a.totalR);

  return (
    <>
      <section className="market-bar" aria-labelledby="pick-h">
        <h2 className="sub" id="pick-h">Markets</h2>
        <fieldset className="group all-pick">
          <legend className="sr">Markets to include</legend>
          <div className="chips">
            {LIVE.map((m) => (
              <label key={m.id} className="chip">
                <input type="checkbox" checked={p.ids.includes(m.id)} onChange={(e) => toggle(m.id, e.target.checked)} />
                <span>{m.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {p.status ? (
          <div className="progress" role="status">
            <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round(Math.max(0.04, p.status.fraction) * 100)}%` }} /></div>
            <p className="progress-text">{p.status.text}</p>
          </div>
        ) : (
          rows.length > 0 && (
            <p className="data-meta">
              Live from Deriv, as far back as it sends 5-minute candles for each market. <button className="linkbtn" onClick={p.onRefresh}>Refresh all</button>
            </p>
          )
        )}
        {Object.entries(p.errors).filter(([id]) => p.ids.includes(id)).map(([id, e]) => (
          <p key={id} className="warn">{marketById(id).name}: {e}</p>
        ))}
        {random && <p className="data-meta">Volatility indices are made by Deriv&apos;s random number generator, and Deriv says any patterns in their history are coincidental.</p>}
      </section>

      <section className="now" aria-labelledby="all-now-h">
        <h2 className="sec" id="all-now-h">Right now on all markets</h2>
        {asOf > 0 && <p className="now-meta">As of {fmtTime(asOf)} UTC ({fmtTime(asOf + 3600)} in Lagos).</p>}
        {rows.length === 0 && <p className="now-empty">{p.status ? "Loading the markets from Deriv." : "Pick a market above."}</p>}
        {rows.length > 0 && live.length === 0 && <p className="now-empty">Nothing close to an entry on these markets right now.</p>}
        <ul className="now-list">
          {live.map(({ marketId, setup: s, dt }, i) => {
            const m = marketById(marketId);
            const { title, text, hot } = describeSetup(s, (x) => fmtPrice(x, m.digits), p.cfg, dt);
            return (
              <li key={`${marketId}-${i}`} className={`now-item${hot ? " hot" : ""}`}>
                <span className={`dir ${s.dir === 1 ? "buy" : "sell"}`}>{s.dir === 1 ? "Buy" : "Sell"}</span>
                <div>
                  <button className="mk-link" onClick={() => p.onOpen(marketId)}>{m.name} · {CRT_LABEL[s.tf]}</button>
                  <b>{title}</b>
                  <span>{text}</span>
                  {s.call && <CallView call={s.call} dir={s.dir} />}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="sec-verdict" aria-labelledby="all-verdict-h" aria-live="polite">
        <h2 className="sec" id="all-verdict-h">How your rules did on all markets{picked !== "all" ? ` in ${monthName(picked)}` : ""}</h2>
        {months.length > 1 && (
          <Choice
            legend="Month" name="month" value={picked} onChange={setMonth}
            options={[["all", "All"], ...months.slice(0, 6).map((ym) => [ym, monthName(ym).split(" ")[0]] as [string, string])]}
          />
        )}
        {total.trades > 0 ? (
          <>
            <p className="verdict-line">
              These rules {total.totalR >= 0 ? "made" : "lost"} <b className={tone(total.totalR)}>{fmtR(Math.abs(total.totalR)).replace(/^\+/, "")}</b> over {total.trades} trade{total.trades === 1 ? "" : "s"} on {total.markets} market{total.markets === 1 ? "" : "s"}, winning {Math.round(total.winRate * 100)}% of them.
            </p>
            <p className="verdict-sub">About {total.perWeek < 10 ? total.perWeek.toFixed(1) : Math.round(total.perWeek)} trades a week across them. The worst run cost {total.maxDrawdownR.toFixed(1)}R from a peak.</p>
          </>
        ) : (
          <p className="verdict-line verdict-empty">{p.status ? "Waiting for the first markets." : rows.length ? "No trades on these markets with your rules." : "No markets loaded yet."}</p>
        )}
      </section>

      {rows.length > 0 && (
        <section className="sec-stats" aria-labelledby="all-table-h">
          <h2 className="sec" id="all-table-h">Each market</h2>
          <p className="sec-note">Tap a market to see its setups, trades and charts. Each one goes back as far as Deriv sends.</p>
          <div className="table-wrap">
            <table className="grid">
              <thead><tr><th>Market</th><th>{picked === "all" ? "Since" : "From"}</th><th>Trades</th><th>Won</th><th>Total</th></tr></thead>
              <tbody>
                {byTotal.map((r) => (
                  <tr key={r.marketId}>
                    <td><button className="mk-link" onClick={() => p.onOpen(r.marketId)}>{marketById(r.marketId).name}</button></td>
                    <td>{fmtDate(r.from)}</td>
                    <td>{r.trades}</td>
                    <td>{r.trades ? `${Math.round((r.wins / r.trades) * 100)}%` : "–"}</td>
                    <td className={tone(r.totalR)}>{r.trades ? fmtR(r.totalR) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {total.list.length > 0 && (
        <section className="sec-trades" aria-labelledby="all-trades-h">
          <h2 className="sec" id="all-trades-h">Every trade</h2>
          <p className="sec-note">Newest first, on all the markets. Tap one to open its market.</p>
          <ul className="tlist">
            {total.list.slice(0, shown).map((t) => (
              <li key={`${t.marketId}-${t.id}`}>
                <button className="trow" onClick={() => p.onOpen(t.marketId)}>
                  <span className={`dir ${t.dir === 1 ? "buy" : "sell"}`}>{t.dir === 1 ? "Buy" : "Sell"}</span>
                  <span className="t-main">
                    <span className="t-date">{marketById(t.marketId).name}, {fmtDay(t.entryT - 1)} <span className="grade">{Math.round(t.pct)}%</span></span>
                    <span className="t-why">{t.tf === "week" ? "Weekly CRT. " : ""}{exitText(t)}</span>
                  </span>
                  <span className="t-end"><span className={`t-r ${tone(t.r)}`}>{fmtR(t.r, 2)}</span></span>
                </button>
              </li>
            ))}
          </ul>
          {total.list.length > shown && <button className="btn quiet small more" onClick={() => setShown((n) => n + 50)}>Show {Math.min(50, total.list.length - shown)} more</button>}
        </section>
      )}
    </>
  );
}

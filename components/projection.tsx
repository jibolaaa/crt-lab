"use client";
import { useMemo, useState } from "react";
import type { RunResult } from "../engine";
import type { Spec } from "../lib/markets";
import { fmtUsd, type MoneyCfg } from "../lib/money";
import { PERIODS, project, type PeriodKey } from "../lib/projection";
import { Choice, NumberField } from "./controls";

const IN: Record<PeriodKey, string> = { week: "a week", month: "a month", quarter: "3 months", year: "a year" };

/** What could happen to the account next, from this market's past trades. */
export function ProjectionCard({ result, spec, money, setMoney }: {
  result: RunResult | null; spec: Spec; money: MoneyCfg; setMoney: (m: Partial<MoneyCfg>) => void;
}) {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const days = PERIODS.find((x) => x.key === period)!.days;
  const p = useMemo(() => (result ? project(result.trades, result.from, result.to, spec, money, days) : null), [result, spec, money, days]);
  if (!result) return null;
  const how = money.mode === "lots" ? `${money.lots} lots a trade` : `${money.riskPct}% of the balance a trade`;
  const pct = (x: number) => (x > 0 && x < 0.01 ? "under 1%" : `${Math.round(x * 100)}%`);
  const tone = (x: number) => (x > money.account + 0.005 ? "pos" : x < money.account - 0.005 ? "neg" : "");
  return (
    <section className="sec-projection" aria-labelledby="proj-h">
      <h2 className="sec" id="proj-h">What could happen next</h2>
      <div className="numrow">
        <NumberField label="Account" unit="$" value={money.account} min={1} max={1e9} onChange={(v) => setMoney({ account: v })} />
      </div>
      <Choice
        legend="Over" name="period" value={period} onChange={setPeriod}
        options={PERIODS.map((x) => [x.key, x.label] as [PeriodKey, string])}
      />
      {p ? (
        <>
          <div className="proj-grid">
            <div><span>Bad case</span><b className={tone(p.low)}>{fmtUsd(p.low)}</b><small>1 run in 10 did worse</small></div>
            <div className="mid"><span>Likely</span><b className={tone(p.mid)}>{fmtUsd(p.mid)}</b><small>the middle run</small></div>
            <div><span>Good case</span><b className={tone(p.high)}>{fmtUsd(p.high)}</b><small>1 run in 10 did better</small></div>
          </div>
          <p className="proj-line">
            About {p.tradesPerPeriod < 10 ? p.tradesPerPeriod.toFixed(1) : Math.round(p.tradesPerPeriod)} trades in {IN[period]}. Chance of ending down: <b>{pct(p.lossChance)}</b>. Chance of losing the whole account: <b className={p.wipeChance >= 0.05 ? "neg" : ""}>{pct(p.wipeChance)}</b>.
          </p>
          <p className="proj-note">
            Each of the {p.runs.toLocaleString("en-GB")} runs picks trades at random from the {result.trades.length} past trades on this market, about as often as they came, at {how}. Change the sizing under Change rules. It shows how wide the outcomes can be, not a forecast.
          </p>
        </>
      ) : (
        <p className="sec-note">Too few trades on this market yet to project. Try a longer history or looser rules.</p>
      )}
    </section>
  );
}

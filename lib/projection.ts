// What could happen to an account over a coming week, month, 3 months or
// year: trades picked at random from the market's past ones, at the pace they
// came, many times over, at the account's lot size or risk. A guide to the
// spread of outcomes, not a forecast.
import type { Trade } from "../engine";
import type { Spec } from "./markets";
import { dollarsPerMove, roundLots, type MoneyCfg } from "./money";

export type PeriodKey = "week" | "month" | "quarter" | "year";
export const PERIODS: { key: PeriodKey; label: string; days: number }[] = [
  { key: "week", label: "A week", days: 7 },
  { key: "month", label: "A month", days: 30.44 },
  { key: "quarter", label: "3 months", days: 91.31 },
  { key: "year", label: "A year", days: 365.25 }
];

export interface Projection {
  runs: number;
  /** Trades in the period, on average, at the past pace. */
  tradesPerPeriod: number;
  /** Ending balances: 1 run in 10 ended at or below `low`, half below `mid`, 1 in 10 at or above `high`. */
  low: number;
  mid: number;
  high: number;
  /** Share of runs that ended below the starting balance. */
  lossChance: number;
  /** Share of runs that lost the whole account. */
  wipeChance: number;
}

/** A small seeded random generator, so the numbers stay put between redraws. */
export function seeded(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

/** How many trades a period holds, when they come at `mean` a period on average. */
export function poisson(mean: number, rand: () => number) {
  if (mean <= 0) return 0;
  if (mean > 60) {
    const u = Math.max(rand(), 1e-12), v = rand();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.max(0, Math.round(mean + z * Math.sqrt(mean)));
  }
  const limit = Math.exp(-mean);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > limit);
  return k - 1;
}

/** Lots for one trade: the fixed size, or the risk share of the balance, never under the smallest lot. */
export function lotsFor(tr: Trade, balance: number, spec: Spec, m: MoneyCfg) {
  if (m.mode === "lots") return Math.max(spec.minLot, roundLots(m.lots, spec.lotStep));
  const lots = roundLots((balance * m.riskPct) / 100 / (tr.risk * dollarsPerMove(spec, 1)), spec.lotStep);
  return Math.max(spec.minLot, lots);
}

export function project(trades: Trade[], from: number, to: number, spec: Spec, m: MoneyCfg, days: number, runs = 2000, seed = 7): Projection | null {
  const spanDays = (to - from) / 86400;
  if (trades.length < 10 || spanDays <= 0) return null;
  const mean = (trades.length / spanDays) * days;
  const rand = seeded(seed);
  const ends: number[] = [];
  let wiped = 0;
  for (let r = 0; r < runs; r++) {
    let balance = m.account;
    const k = poisson(mean, rand);
    for (let j = 0; j < k && balance > 0; j++) {
      const tr = trades[Math.floor(rand() * trades.length)];
      balance += tr.r * tr.risk * dollarsPerMove(spec, lotsFor(tr, balance, spec, m));
    }
    if (balance <= 0) { balance = 0; wiped++; }
    ends.push(balance);
  }
  ends.sort((a, b) => a - b);
  const at = (q: number) => ends[Math.min(runs - 1, Math.floor(q * runs))];
  return {
    runs, tradesPerPeriod: mean, low: at(0.1), mid: at(0.5), high: at(0.9),
    lossChance: ends.filter((x) => x < m.account - 1e-9).length / runs, wipeChance: wiped / runs
  };
}

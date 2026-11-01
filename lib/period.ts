// "From": one market's result from the start of a month to now, e.g. from July till now.
import { stats, type RunResult } from "../engine";

export interface MonthStart { key: string; t: number }

/** The first of each month inside the prices, oldest first, at most `max` of the latest. */
export function monthStarts(from: number, to: number, max = 6): MonthStart[] {
  const out: MonthStart[] = [];
  const d = new Date(from * 1000);
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; // the first month that starts after the prices begin
  for (;;) {
    if (m > 11) { y++; m = 0; }
    const t = Date.UTC(y, m, 1) / 1000;
    if (t >= to) break;
    out.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, t });
    m++;
  }
  return out.slice(-max);
}

/** The result from time `from` on: the trades entered since then, with that stretch's first 70% and last 30%. */
export function sliceResult(r: RunResult, from: number): RunResult {
  if (from <= r.from) return r;
  const to = r.to;
  const trades = r.trades.filter((t) => t.entryT - 1 >= from);
  const splitT = from + Math.round((to - from) * 0.7);
  return {
    ...r, trades, from, splitT,
    seen: stats(trades.filter((t) => t.entryT < splitT), from, splitT),
    unseen: stats(trades.filter((t) => t.entryT >= splitT), splitT, to),
    all: stats(trades, from, to)
  };
}

// Summary numbers for a list of trades, all in R (multiples of the risk).
import type { Stats, Trade } from "./types";

export function stats(trades: Trade[], from: number, to: number): Stats {
  const rs = [...trades].sort((a, b) => a.entryT - b.entryT).map((x) => x.r);
  const wins = rs.filter((r) => r > 0.0001).length;
  const losses = rs.filter((r) => r < -0.0001).length;
  const total = rs.reduce((a, r) => a + r, 0);
  const gain = rs.filter((r) => r > 0).reduce((a, r) => a + r, 0);
  const loss = -rs.filter((r) => r < 0).reduce((a, r) => a + r, 0);
  let peak = 0, eq = 0, dd = 0, streak = 0, worst = 0;
  for (const r of rs) {
    eq += r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
    streak = r < -0.0001 ? streak + 1 : 0;
    worst = Math.max(worst, streak);
  }
  const months = Math.max((to - from) / (30.44 * 86400), 1 / 30);
  return {
    trades: rs.length,
    wins,
    losses,
    winRate: rs.length ? wins / rs.length : 0,
    avgR: rs.length ? total / rs.length : 0,
    totalR: total,
    profitFactor: loss > 0 ? gain / loss : gain > 0 ? null : 0,
    maxDrawdownR: dd,
    longestLosingStreak: worst,
    tradesPerMonth: rs.length / months,
    from,
    to
  };
}

/** Account growth if every trade risked `riskPct` percent of the balance at the time. */
export function compound(trades: Trade[], riskPct: number) {
  let bal = 1, peak = 1, dd = 0;
  const curve: { t: number; v: number }[] = [];
  for (const tr of [...trades].sort((a, b) => a.exitT - b.exitT)) {
    bal *= 1 + (riskPct / 100) * tr.r;
    if (bal < 0) bal = 0;
    peak = Math.max(peak, bal);
    dd = Math.max(dd, peak > 0 ? (peak - bal) / peak : 0);
    curve.push({ t: tr.exitT, v: bal });
  }
  return { growthPct: (bal - 1) * 100, maxDrawdownPct: dd * 100, curve };
}

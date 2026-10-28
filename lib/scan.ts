// All markets: one compact result per market, and the sums across them.
import type { Config, CrtTf, ExitReason, Live, LiveSetup, RunResult, Trade } from "../engine";
import { defaultSpread, defaultStopBuffer, type Market } from "./markets";
import { ACTIONABLE, pickSetups, rank } from "./live";

export interface ScanTrade {
  marketId: string;
  id: number;
  model: Trade["model"];
  dir: 1 | -1;
  tf: CrtTf;
  entryT: number;
  exitT: number;
  r: number;
  pct: number;
  reason: ExitReason;
}

export interface ScanRow {
  marketId: string;
  count: number;
  /** Seconds per candle. */
  dt: number;
  from: number;
  to: number;
  lastClose: number;
  /** A related market was there for the SMT check. */
  smt: boolean;
  trades: number;
  wins: number;
  totalR: number;
  maxDrawdownR: number;
  list: ScanTrade[];
  live: Live | null;
}

/** The rules for one market: the same checks, with that market's spread, stop room and calendar. */
export function marketCfg(cfg: Config, m: Market, lastClose: number): Config {
  return { ...cfg, spread: defaultSpread(m, lastClose), stopBuffer: defaultStopBuffer(m, lastClose), weekendClosed: m.weekendClosed, usdNews: m.usdNews, driftUp: !!m.drift };
}

/** The compact result for one market. */
export function toScanRow(marketId: string, info: { count: number; dt: number; from: number; to: number; lastClose: number }, r: RunResult): ScanRow {
  return {
    marketId, ...info, smt: r.smt,
    trades: r.all.trades,
    wins: r.trades.filter((t) => t.r > 0.005).length,
    totalR: r.all.totalR,
    maxDrawdownR: r.all.maxDrawdownR,
    list: r.trades.map((t) => ({ marketId, id: t.id, model: t.model, dir: t.dir, tf: t.tf, entryT: t.entryT, exitT: t.exitT, r: t.r, pct: t.pct, reason: t.reason })),
    live: r.live
  };
}

export interface Combined {
  markets: number;
  trades: number;
  wins: number;
  winRate: number;
  totalR: number;
  /** Trades a week across the markets, each at its own pace over its own history. */
  perWeek: number;
  /** The worst fall from a peak, with every market's trades in the order they closed. */
  maxDrawdownR: number;
  /** Newest first. */
  list: ScanTrade[];
}

export function combine(rows: ScanRow[]): Combined {
  let trades = 0, wins = 0, totalR = 0, perWeek = 0;
  for (const r of rows) {
    trades += r.trades;
    wins += r.wins;
    totalR += r.totalR;
    const weeks = (r.to - r.from) / (7 * 86400);
    if (weeks > 0) perWeek += r.trades / weeks;
  }
  const all = rows.flatMap((r) => r.list);
  let run = 0, peak = 0, maxDrawdownR = 0;
  for (const t of [...all].sort((a, b) => a.exitT - b.exitT)) {
    run += t.r;
    peak = Math.max(peak, run);
    maxDrawdownR = Math.max(maxDrawdownR, peak - run);
  }
  return {
    markets: rows.length, trades, wins, winRate: trades ? wins / trades : 0, totalR, perWeek, maxDrawdownR,
    list: all.sort((a, b) => b.entryT - a.entryT || a.marketId.localeCompare(b.marketId))
  };
}

export interface LiveRow { marketId: string; setup: LiveSetup; dt: number; asOf: number }

/** Every market's setups close to (or in) a trade, the ones needing attention first. */
export function liveList(rows: ScanRow[], crt: CrtTf[]): LiveRow[] {
  const out: LiveRow[] = [];
  for (const r of rows) {
    if (!r.live) continue;
    for (const tf of crt) {
      for (const s of pickSetups(r.live.setups.filter((x) => x.tf === tf))) {
        if (ACTIONABLE.has(s.stage)) out.push({ marketId: r.marketId, setup: s, dt: r.dt, asOf: r.live.asOf });
      }
    }
  }
  return out.sort((a, b) => rank(a.setup) - rank(b.setup));
}

/** "2026-09" for a trade entered in September 2026 (UTC). */
export function monthKey(entryT: number) {
  const d = new Date((entryT - 1) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The months that have trades, newest first. */
export function monthsOf(rows: ScanRow[]) {
  return [...new Set(rows.flatMap((r) => r.list.map((t) => monthKey(t.entryT))))].sort().reverse();
}

/** Each market's result for one month only: the trades entered that month, over the part of it the prices cover. */
export function forMonth(rows: ScanRow[], ym: string): ScanRow[] {
  const [y, m] = ym.split("-").map(Number);
  const start = Date.UTC(y, m - 1, 1) / 1000, end = Date.UTC(y, m, 1) / 1000;
  return rows.map((r) => {
    const list = r.list.filter((t) => monthKey(t.entryT) === ym);
    const from = Math.max(r.from, start), to = Math.max(from, Math.min(r.to, end));
    return {
      ...r, from, to, list, trades: list.length,
      wins: list.filter((t) => t.r > 0.005).length,
      totalR: list.reduce((a, t) => a + t.r, 0)
    };
  });
}

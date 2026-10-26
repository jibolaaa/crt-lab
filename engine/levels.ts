// Higher-timeframe key levels: order blocks, breaker blocks and fair value
// gaps on the 4-hour, daily and weekly charts.
//
// Every level records when it became known (the close of the candle that
// completed it) and when it broke (the close of the first candle of its own
// timeframe that closed through its far side). The backtest only uses a
// level between those two times, so nothing leaks from the future.
//
// - Fair value gap: three candles where the third leaves a gap past the first.
// - Order block: when a close breaks the latest confirmed swing, the opposite
//   candle with the most extreme price in the move before it (the last
//   10 candles).
// - Breaker block: an order block that price later closed through. It flips
//   sides: a broken bullish order block becomes resistance.
import { closeTimes } from "./htf";
import type { Bar, LevelKind, Tf } from "./types";

export type { LevelKind, Tf };

export interface Level {
  tf: Tf;
  kind: LevelKind;
  /** 1 = support (buys look for it below price), -1 = resistance (sells look above). */
  side: 1 | -1;
  top: number;
  bottom: number;
  /** Start of the candle the zone comes from. */
  t: number;
  knownAt: number;
  brokenAt: number;
  /** Start of the first later day that traded into the zone (Infinity if none). */
  touchedAt: number;
}

/** How long a level stays in play after it forms. */
export const MAX_AGE: Record<Tf, number> = { h4: 30 * 86400, d1: 180 * 86400, w1: 730 * 86400 };

interface Raw extends Level { i: number } // index of the candle that completed it

function make(tf: Tf, kind: LevelKind, side: 1 | -1, top: number, bottom: number, t: number, i: number, knownAt: number): Raw {
  return { tf, kind, side, top, bottom, t, i, knownAt, brokenAt: Infinity, touchedAt: Infinity };
}

/** The candle a move started from: the opposite-colour candle with the most extreme price in the lookback. */
function origin(bars: Bar[], i: number, lookback: number, side: 1 | -1) {
  let best = -1, any = -1;
  for (let x = i - 1; x >= Math.max(0, i - lookback); x--) {
    const b = bars[x];
    if (any < 0 || (side === 1 ? b.l < bars[any].l : b.h > bars[any].h)) any = x;
    const opposite = side === 1 ? b.c < b.o : b.c > b.o;
    if (opposite && (best < 0 || (side === 1 ? b.l < bars[best].l : b.h > bars[best].h))) best = x;
  }
  return best >= 0 ? best : any;
}

/** Close time of the first later candle that closed through the zone's far side, within its life. */
function breakTime(bars: Bar[], ct: Float64Array, z: Raw) {
  const end = z.knownAt + MAX_AGE[z.tf];
  for (let m = z.i + 1; m < bars.length && bars[m].t <= end; m++) {
    const c = bars[m].c;
    if (z.side === 1 ? c < z.bottom : c > z.top) return ct[m];
  }
  return Infinity;
}

export function findLevels(bars: Bar[], tf: Tf, k = 2, lookback = 10): Level[] {
  const raw: Raw[] = [];
  const ct = closeTimes(bars);
  let hi: { j: number; p: number } | null = null, lo: { j: number; p: number } | null = null;
  let usedHi = -1, usedLo = -1;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], known = ct[i];
    if (i >= 2) {
      const a = bars[i - 2];
      if (b.l > a.h) raw.push(make(tf, "fvg", 1, b.l, a.h, a.t, i, known));
      if (b.h < a.l) raw.push(make(tf, "fvg", -1, a.l, b.h, a.t, i, known));
    }
    const j = i - k;
    if (j >= k) {
      let isHigh = true, isLow = true;
      for (let x = j - k; x <= j + k; x++) {
        if (x === j) continue;
        if (x < j ? bars[x].h >= bars[j].h : bars[x].h > bars[j].h) isHigh = false;
        if (x < j ? bars[x].l <= bars[j].l : bars[x].l < bars[j].l) isLow = false;
      }
      if (isHigh) hi = { j, p: bars[j].h };
      if (isLow) lo = { j, p: bars[j].l };
    }
    if (hi && hi.j !== usedHi && b.c > hi.p) {
      usedHi = hi.j;
      const x = origin(bars, i, lookback, 1);
      if (x >= 0) raw.push(make(tf, "ob", 1, bars[x].h, bars[x].l, bars[x].t, i, known));
    }
    if (lo && lo.j !== usedLo && b.c < lo.p) {
      usedLo = lo.j;
      const x = origin(bars, i, lookback, -1);
      if (x >= 0) raw.push(make(tf, "ob", -1, bars[x].h, bars[x].l, bars[x].t, i, known));
    }
  }
  const out: Level[] = [];
  for (const z of raw) {
    if (z.knownAt === Infinity) continue; // completed by a candle that hasn't closed
    z.brokenAt = breakTime(bars, ct, z);
    out.push(z);
    if (z.kind === "ob" && z.brokenAt < Infinity) {
      // the candle that broke it completed the breaker
      let m = z.i + 1;
      while (m < bars.length && ct[m] < z.brokenAt) m++;
      const br = make(tf, "breaker", z.side === 1 ? -1 : 1, z.top, z.bottom, z.t, m, z.brokenAt);
      br.brokenAt = breakTime(bars, ct, br);
      out.push(br);
    }
  }
  return out.sort((a, b) => a.knownAt - b.knownAt);
}

/** First day, starting after the level was known, whose range reached the zone. */
export function markTouches(levels: Level[], days: Bar[]) {
  for (const z of levels) {
    let lo = 0, hi = days.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (days[m].t < z.knownAt) lo = m + 1; else hi = m; }
    const end = z.knownAt + MAX_AGE[z.tf];
    for (let d = lo; d < days.length && days[d].t <= end; d++) {
      if (z.side === 1 ? days[d].l <= z.top : days[d].h >= z.bottom) { z.touchedAt = days[d].t; break; }
    }
  }
}

export interface LevelBook {
  support: Record<Tf, Level[]>;
  resistance: Record<Tf, Level[]>;
}

export function levelBook(byTf: Record<Tf, Level[]>): LevelBook {
  const book: LevelBook = { support: { h4: [], d1: [], w1: [] }, resistance: { h4: [], d1: [], w1: [] } };
  for (const tf of ["h4", "d1", "w1"] as Tf[]) {
    for (const z of byTf[tf]) (z.side === 1 ? book.support : book.resistance)[tf].push(z);
  }
  return book;
}

/**
 * The key level a sweep reached, if any: known before the sweep, not yet
 * broken, not touched on any earlier day, lying past the swept side of
 * candle 1, and reached by the sweep without running far through it (no
 * further past its far side than the zone's own height, or `slack` if that's
 * bigger). Higher timeframes win ties.
 */
export function keyLevelFor(
  book: LevelBook, tfs: Tf[], kinds: LevelKind[], dir: 1 | -1,
  sweepT: number, sweepPrice: number, edge: number, dayStart: number, now: number, slack = 0
): Level | null {
  const pools = dir === 1 ? book.support : book.resistance;
  for (const tf of ["w1", "d1", "h4"] as Tf[]) {
    if (!tfs.includes(tf)) continue;
    const arr = pools[tf];
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].knownAt <= sweepT) lo = m + 1; else hi = m; }
    const oldest = sweepT - MAX_AGE[tf];
    for (let x = lo - 1; x >= 0 && arr[x].knownAt >= oldest; x--) {
      const z = arr[x];
      // broken only by a candle that closed before this decision, not one closing at the same moment
      if (!kinds.includes(z.kind) || z.brokenAt < now || z.touchedAt < dayStart) continue;
      const room = Math.max(z.top - z.bottom, slack);
      if (dir === 1 ? z.bottom < edge && sweepPrice <= z.top && sweepPrice >= z.bottom - room : z.top > edge && sweepPrice >= z.bottom && sweepPrice <= z.top + room) return z;
    }
  }
  return null;
}

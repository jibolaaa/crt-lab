// Higher-timeframe key levels on the 4-hour, daily and weekly charts:
//
// - Old high or low: a confirmed swing high or low. It counts when candle 1
//   or candle 2 is the first to trade through it (the purge).
// - Fair value gap: three candles where the third leaves a gap past the first.
// - Order block: when a close breaks the latest confirmed swing, the opposite
//   candle with the most extreme price in the move before it (the last
//   10 candles).
// - Rejection block: a swing high (low) whose candle has a long upper (lower)
//   wick. The block runs from the body's edge out to the wick's tip.
// - Breaker block: an order block that price later closed through. It flips
//   sides: a broken bullish order block becomes resistance.
//
// Every level records when it became known (the close of the candle that
// completed it) and when it broke (the close of the first candle of its own
// timeframe that closed through its far side). The backtest only uses a
// level between those two times, so nothing leaks from the future.
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
  /** Start of the candle the level comes from. */
  t: number;
  knownAt: number;
  brokenAt: number;
  /** Start of the first later day that traded into the zone, or through the old high or low (Infinity if none). */
  touchedAt: number;
}

/** How long a level stays in play after it forms. */
export const MAX_AGE: Record<Tf, number> = { h4: 30 * 86400, d1: 180 * 86400, w1: 730 * 86400 };

/** A wick at least this share of the candle makes a rejection block. */
export const RB_WICK = 0.4;

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

export function findLevels(bars: Bar[], tf: Tf, k = 2, lookback = 10, dt = 900): Level[] {
  const raw: Raw[] = [];
  const ct = closeTimes(bars, dt);
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
      const s = bars[j], range = s.h - s.l;
      if (isHigh) {
        hi = { j, p: s.h };
        raw.push(make(tf, "old", -1, s.h, s.h, s.t, i, known));
        const body = Math.max(s.o, s.c);
        if (range > 0 && s.h - body >= RB_WICK * range) raw.push(make(tf, "rb", -1, s.h, body, s.t, i, known));
      }
      if (isLow) {
        lo = { j, p: s.l };
        raw.push(make(tf, "old", 1, s.l, s.l, s.t, i, known));
        const body = Math.min(s.o, s.c);
        if (range > 0 && body - s.l >= RB_WICK * range) raw.push(make(tf, "rb", 1, body, s.l, s.t, i, known));
      }
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
    // an old high or low is used up by its purge (touchedAt), not broken by a close
    z.brokenAt = z.kind === "old" ? Infinity : breakTime(bars, ct, z);
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

/** First day, starting after the level was known, whose range reached the zone (or traded through the old high or low). */
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

/** What a sweep is checked against. */
export interface SweepFacts {
  dir: 1 | -1;
  sweepT: number;
  /** The furthest the sweep went. */
  sweepPrice: number;
  /** Candle 1's high (sells) or low (buys): the side that was swept. */
  edge: number;
  /** Candle 1's body on the swept side: an old high or low must lie between it and the sweep. */
  bodyEdge: number;
  /** The level must be untouched before this time (the start of candle 1 or candle 2). */
  freshFrom: number;
  /** The decision time: a level broken by a candle closing before it doesn't count. */
  now: number;
  /** How far past a zone's far side the sweep may poke. */
  slack: number;
}

/**
 * The key level a sweep reached, if any, known before the sweep and
 * untouched before `freshFrom`.
 * - Zones (gap, order block, rejection block, breaker) must lie past the
 *   swept side of candle 1, be reached by the sweep, and not be run through by
 *   more than their own height (or `slack` if that's bigger).
 * - An old high or low must have been known before candle 1, lie between
 *   candle 1's body and the sweep's tip, and be purged by candle 1 or 2.
 * Higher timeframes win ties.
 */
export function keyLevelFor(book: LevelBook, tfs: Tf[], kinds: LevelKind[], f: SweepFacts): Level | null {
  const { dir, sweepT, sweepPrice, edge, bodyEdge, freshFrom, now, slack } = f;
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
      if (!kinds.includes(z.kind) || z.brokenAt < now || z.touchedAt < freshFrom) continue;
      if (z.kind === "old") {
        const p = z.top;
        if (z.knownAt <= freshFrom && (dir === 1 ? p <= bodyEdge && p >= sweepPrice : p >= bodyEdge && p <= sweepPrice)) return z;
        continue;
      }
      const room = Math.max(z.top - z.bottom, slack);
      if (dir === 1 ? z.bottom < edge && sweepPrice <= z.top && sweepPrice >= z.bottom - room : z.top > edge && sweepPrice >= z.bottom && sweepPrice <= z.top + room) return z;
    }
  }
  return null;
}

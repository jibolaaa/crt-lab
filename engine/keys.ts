// Model 1's key levels, read from structure. For a sell (buys are the mirror image), a level on the
// chart one step up from the range (daily and 4-hour levels for a 4-hour range, weekly and daily for
// a daily range, weekly for a weekly range) counts when the sweep reaches it, nothing touched it
// since the range candle began, no candle of its own chart has closed through it, and it fits the
// structure on its chart:
//
//  - supply: the order block of the last lower high, where the last drop to a lower low started
//    (the order block left by the latest close below a swing low);
//  - flip: where price broke down from: an old swing low that a close went below, now resistance,
//    or a breaker block (a broken bullish order block);
//  - leg: an order block or gap the latest drop left on its way down (formed after the last swing high);
//  - premium: any zone whose middle sits above the middle of the latest swing range.
//
// Touches are read on 4-hour candles, so a level touched earlier in the day still counts as fresh
// for a 4-hour range that starts after the touch.
import type { Prepared } from "./backtest";
import { build4h, closeTimes } from "./htf";
import { findLevels, MAX_AGE, type Level } from "./levels";
import type { Bar, CrtTf, Dir, KeyFit, LevelKind, Tf } from "./types";

interface TfData {
  bars: Bar[];
  /** When each candle closed (Infinity for the last, still forming). */
  ct: Float64Array;
  /** The latest confirmed swing high and low after each candle closed, and their candles' start times. */
  hiP: Float64Array;
  hiT: Float64Array;
  loP: Float64Array;
  loT: Float64Array;
  support: Level[];
  resistance: Level[];
}

export interface KeyBook {
  h4: { bars: Bar[]; of: Int32Array };
  byTf: Record<Tf, TfData>;
}

const SWING = 2;

/** Old swing lows that a close went below (now resistance), and old swing highs closed above (now support). */
export function flips(bars: Bar[], tf: Tf, ct: Float64Array, k = SWING): Level[] {
  const out: (Level & { i: number })[] = [];
  let hi: { j: number; p: number } | null = null, lo: { j: number; p: number } | null = null;
  let usedHi = -1, usedLo = -1;
  for (let i = 0; i < bars.length; i++) {
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
    if (ct[i] === Infinity) continue; // the candle hasn't closed
    const c = bars[i].c;
    if (lo && lo.j !== usedLo && c < lo.p) {
      usedLo = lo.j;
      out.push({ tf, kind: "flip", side: -1, top: lo.p, bottom: lo.p, t: bars[lo.j].t, knownAt: ct[i], brokenAt: Infinity, touchedAt: Infinity, i });
    }
    if (hi && hi.j !== usedHi && c > hi.p) {
      usedHi = hi.j;
      out.push({ tf, kind: "flip", side: 1, top: hi.p, bottom: hi.p, t: bars[hi.j].t, knownAt: ct[i], brokenAt: Infinity, touchedAt: Infinity, i });
    }
  }
  // it stops counting once a close goes back through it
  for (const z of out) {
    const end = z.knownAt + MAX_AGE[tf];
    for (let m = z.i + 1; m < bars.length && bars[m].t <= end; m++) {
      if (z.side === -1 ? bars[m].c > z.top : bars[m].c < z.bottom) { z.brokenAt = ct[m]; break; }
    }
  }
  return out.map(({ i: _i, ...z }) => z);
}

/**
 * The first 4-hour candle, starting once the level was known, that reached it. A flip or a breaker
 * forms right where price broke through, so it only counts as touched once price has first moved
 * away from it by half the candle that broke it: the wiggle at the break isn't the retest.
 */
function touches(levels: Level[], h4: Bar[], bars: Bar[], ct: Float64Array) {
  for (const z of levels) {
    let lo = 0, hi = h4.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (h4[m].t < z.knownAt) lo = m + 1; else hi = m; }
    const end = z.knownAt + MAX_AGE[z.tf];
    z.touchedAt = Infinity;
    let away = Infinity; // how far price has to move off a flip or breaker first
    if (z.kind === "flip" || z.kind === "breaker") {
      let a = 0, b = ct.length;
      while (a < b) { const m = (a + b) >> 1; if (ct[m] < z.knownAt) a = m + 1; else b = m; }
      away = a < bars.length ? 0.5 * (bars[a].h - bars[a].l) : 0;
    }
    let armed = away === Infinity;
    for (let x = lo; x < h4.length && h4[x].t <= end; x++) {
      if (!armed) {
        if (z.side === -1 ? h4[x].l <= z.bottom - away : h4[x].h >= z.top + away) armed = true;
        continue; // the candle that moved away can't count as the return too
      }
      if (z.side === 1 ? h4[x].l <= z.top : h4[x].h >= z.bottom) { z.touchedAt = h4[x].t; break; }
    }
  }
}

function swingsOf(bars: Bar[], k = SWING) {
  const n = bars.length;
  const hiP = new Float64Array(n), hiT = new Float64Array(n), loP = new Float64Array(n), loT = new Float64Array(n);
  let hp = NaN, ht = NaN, lp = NaN, lt = NaN;
  for (let i = 0; i < n; i++) {
    const j = i - k;
    if (j >= k) {
      let isHigh = true, isLow = true;
      for (let x = j - k; x <= j + k; x++) {
        if (x === j) continue;
        if (x < j ? bars[x].h >= bars[j].h : bars[x].h > bars[j].h) isHigh = false;
        if (x < j ? bars[x].l <= bars[j].l : bars[x].l < bars[j].l) isLow = false;
      }
      if (isHigh) { hp = bars[j].h; ht = bars[j].t; }
      if (isLow) { lp = bars[j].l; lt = bars[j].t; }
    }
    hiP[i] = hp; hiT[i] = ht; loP[i] = lp; loT[i] = lt;
  }
  return { hiP, hiT, loP, loT };
}

const cache = new WeakMap<Prepared, KeyBook>();

/** Model 1's levels and structure for prepared prices, worked out once. */
export function keyBook(p: Prepared): KeyBook {
  let b = cache.get(p);
  if (b) return b;
  const h4 = build4h(p.s);
  const charts: Record<Tf, Bar[]> = { h4: h4.bars, d1: p.cal.days, w1: p.cal.weeks };
  const byTf = {} as Record<Tf, TfData>;
  for (const tf of ["h4", "d1", "w1"] as Tf[]) {
    const bars = charts[tf], ct = closeTimes(bars, p.dt);
    const all = [...findLevels(bars, tf, SWING, 10, p.dt), ...flips(bars, tf, ct)].sort((a, c) => a.knownAt - c.knownAt);
    touches(all, h4.bars, bars, ct);
    byTf[tf] = { bars, ct, ...swingsOf(bars), support: all.filter((z) => z.side === 1), resistance: all.filter((z) => z.side === -1) };
  }
  b = { h4, byTf };
  cache.set(p, b);
  return b;
}

/** The charts a range's key levels come from: one step up, and its own. */
export const KEY_TFS: Record<CrtTf, Tf[]> = { h4: ["d1", "h4"], day: ["w1", "d1"], week: ["w1"] };

export interface SweepInfo {
  dir: Dir;
  /** When the sweep's tip printed, and the price. */
  sweepT: number;
  sweepPrice: number;
  /** The range's high (sells) or low (buys): the side that was swept. */
  edge: number;
  /** The range candle's body on the swept side. */
  bodyEdge: number;
  /** The level must be untouched before this time (the start of the range candle). */
  freshFrom: number;
  /** The decision time: a level broken by a candle that closed before it doesn't count. */
  now: number;
  /** A tenth of the range: how far past a level the sweep may poke. */
  slack: number;
}

export interface KeyHit { level: Level; fit: KeyFit }

/** The newest candle that had closed by time t, or -1. */
function closedBy(ct: Float64Array, t: number) {
  let lo = 0, hi = ct.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ct[m] <= t) lo = m + 1; else hi = m; }
  return lo - 1;
}

/** The key level a sweep reached, and how it fits the structure; higher charts first. */
export function structureKeyFor(book: KeyBook, tfs: Tf[], kinds: LevelKind[], needFit: boolean, f: SweepInfo): KeyHit | null {
  const { dir, sweepT, sweepPrice, edge, bodyEdge, freshFrom, now, slack } = f;
  const sell = dir === -1;
  for (const tf of ["w1", "d1", "h4"] as Tf[]) {
    if (!tfs.includes(tf)) continue;
    const D = book.byTf[tf];
    const pool = sell ? D.resistance : D.support;
    // the structure on this chart at the sweep
    const bi = closedBy(D.ct, sweepT);
    const eq = bi >= 0 ? (D.hiP[bi] + D.loP[bi]) / 2 : NaN;
    const legFrom = bi >= 0 ? (sell ? D.hiT[bi] : D.loT[bi]) : NaN; // the last swing high: the latest drop started there
    let lo = 0, hi = pool.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (pool[m].knownAt <= sweepT) lo = m + 1; else hi = m; }
    const oldest = sweepT - MAX_AGE[tf];
    let newestOb: Level | null = null, seenOb = false;
    for (let x = lo - 1; x >= 0 && pool[x].knownAt >= oldest; x--) {
      const z = pool[x];
      if (z.kind === "ob" && !seenOb) { seenOb = true; newestOb = z; }
      if (!kinds.includes(z.kind) || z.brokenAt < now || z.touchedAt < freshFrom) continue;
      // the sweep reached it
      if (z.kind === "old" || z.kind === "flip") {
        const p = z.top, room = 2 * slack;
        if (z.kind === "old" && z.knownAt > freshFrom) continue;
        if (sell ? !(p >= bodyEdge && sweepPrice >= p && sweepPrice <= p + room) : !(p <= bodyEdge && sweepPrice <= p && sweepPrice >= p - room)) continue;
      } else {
        const room = Math.max(z.top - z.bottom, slack);
        if (sell ? !(z.top > edge && sweepPrice >= z.bottom && sweepPrice <= z.top + room) : !(z.bottom < edge && sweepPrice <= z.top && sweepPrice >= z.bottom - room)) continue;
      }
      // it fits the structure
      const mid = (z.top + z.bottom) / 2;
      const fit: KeyFit | null =
        z === newestOb ? "supply"
          : z.kind === "flip" || z.kind === "breaker" ? "flip"
            : (z.kind === "ob" || z.kind === "fvg") && z.t >= legFrom ? "leg"
              : Number.isFinite(eq) && (sell ? mid >= eq : mid <= eq) ? "premium"
                : null;
      if (fit) return { level: z, fit };
      if (!needFit) return { level: z, fit: "any" };
    }
  }
  return null;
}

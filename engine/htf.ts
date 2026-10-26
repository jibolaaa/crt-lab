// Higher-timeframe helpers: 4-hour candles, and structure direction and the
// latest swing range on any timeframe, all built from closed candles only.
import type { Bar, Series } from "./types";

const H4 = 4 * 3600;

/** 4-hour candles on fixed UTC blocks (00, 04, 08, 12, 16, 20), as MT5 shows them on GMT+0 servers. */
export function build4h(s: Series): { bars: Bar[]; of: Int32Array } {
  const bars: Bar[] = [];
  const of = new Int32Array(s.n); // 15-minute candle index -> 4-hour candle index
  for (let i = 0; i < s.n; i++) {
    const key = Math.floor(s.t[i] / H4);
    const b = bars[bars.length - 1];
    if (!b || b.key !== key) bars.push({ key, t: s.t[i], tEnd: s.t[i], o: s.o[i], h: s.h[i], l: s.l[i], c: s.c[i], i0: i, i1: i });
    else {
      if (s.h[i] > b.h) b.h = s.h[i];
      if (s.l[i] < b.l) b.l = s.l[i];
      b.c = s.c[i];
      b.tEnd = s.t[i];
      b.i1 = i;
    }
    of[i] = bars.length - 1;
  }
  return { bars, of };
}

/**
 * When each candle closed. The last candle in the data may still be
 * forming, so it never counts as closed: a test that stops part-way through
 * a day must not treat that half day as a finished candle.
 */
export function closeTimes(bars: Bar[]) {
  const out = new Float64Array(bars.length);
  for (let i = 0; i < bars.length; i++) out[i] = i === bars.length - 1 ? Infinity : bars[i].tEnd + 900;
  return out;
}

export interface Structure {
  trend: Int8Array; // after bar i closed: 1 = last break was up, -1 = down, 0 = none yet
  rangeHigh: Float64Array; // latest confirmed swing high after bar i closed (NaN if none)
  rangeLow: Float64Array;
}

/**
 * Swings need k bars on each side (strict on the left), so a swing at bar j
 * is only known once bar j + k has closed. A close beyond the latest known
 * swing sets the direction. Read bar i's values only once bar i has closed.
 */
export function structure(bars: Bar[], k: number): Structure {
  const n = bars.length;
  const out: Structure = { trend: new Int8Array(n), rangeHigh: new Float64Array(n), rangeLow: new Float64Array(n) };
  let hi = NaN, lo = NaN, trend = 0;
  for (let i = 0; i < n; i++) {
    const j = i - k;
    if (j >= k) {
      let isHigh = true, isLow = true;
      for (let x = j - k; x <= j + k; x++) {
        if (x === j) continue;
        if (x < j ? bars[x].h >= bars[j].h : bars[x].h > bars[j].h) isHigh = false;
        if (x < j ? bars[x].l <= bars[j].l : bars[x].l < bars[j].l) isLow = false;
      }
      if (isHigh) hi = bars[j].h;
      if (isLow) lo = bars[j].l;
    }
    if (!Number.isNaN(hi) && bars[i].c > hi) trend = 1;
    else if (!Number.isNaN(lo) && bars[i].c < lo) trend = -1;
    out.trend[i] = trend;
    out.rangeHigh[i] = hi;
    out.rangeLow[i] = lo;
  }
  return out;
}

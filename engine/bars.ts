// Daily and weekly candles built from 15-minute ones, plus the weekly bias.
import { dayKey, weekKey } from "./calendar";
import type { Bar, Config, Series } from "./types";

export interface Calendar {
  days: Bar[];
  dayOf: Int32Array; // 15-minute candle index -> day index
  weeks: Bar[];
  weekOfDay: Int32Array; // day index -> week index
}

export function buildCalendar(s: Series, cfg: Pick<Config, "dayStart" | "weekendClosed">): Calendar {
  const days: Bar[] = [];
  const dayOf = new Int32Array(s.n);
  for (let i = 0; i < s.n; i++) {
    const key = dayKey(s.t[i], cfg.dayStart, cfg.weekendClosed);
    let d = days[days.length - 1];
    if (!d || d.key !== key) {
      d = { key, t: s.t[i], tEnd: s.t[i], o: s.o[i], h: s.h[i], l: s.l[i], c: s.c[i], i0: i, i1: i };
      days.push(d);
    } else {
      if (s.h[i] > d.h) d.h = s.h[i];
      if (s.l[i] < d.l) d.l = s.l[i];
      d.c = s.c[i];
      d.tEnd = s.t[i];
      d.i1 = i;
    }
    dayOf[i] = days.length - 1;
  }
  const weeks: Bar[] = [];
  const weekOfDay = new Int32Array(days.length);
  days.forEach((d, di) => {
    const key = weekKey(d.key);
    let w = weeks[weeks.length - 1];
    if (!w || w.key !== key) {
      w = { key, t: d.t, tEnd: d.tEnd, o: d.o, h: d.h, l: d.l, c: d.c, i0: d.i0, i1: d.i1 };
      weeks.push(w);
    } else {
      if (d.h > w.h) w.h = d.h;
      if (d.l < w.l) w.l = d.l;
      w.c = d.c;
      w.tEnd = d.tEnd;
      w.i1 = d.i1;
    }
    weekOfDay[di] = weeks.length - 1;
  });
  return { days, dayOf, weeks, weekOfDay };
}

export interface WeeklyBias {
  weeklyCrt: Int8Array;
  structure: Int8Array;
  premiumDiscount: Int8Array;
  majority: Int8Array;
  allAgree: Int8Array;
}

/**
 * The bias to trade with during each week, worked out only from weeks that
 * had already finished (no peeking at the week itself).
 * - Weekly CRT: last week swept one side of the week before and closed back inside.
 * - Structure: last weekly close beyond a confirmed weekly swing high (bullish) or low (bearish).
 * - Premium/discount: last close below the middle of the latest weekly swing range = buy, above = sell.
 */
export function weeklyBias(weeks: Bar[], k: number): WeeklyBias {
  const n = weeks.length;
  const out: WeeklyBias = {
    weeklyCrt: new Int8Array(n),
    structure: new Int8Array(n),
    premiumDiscount: new Int8Array(n),
    majority: new Int8Array(n),
    allAgree: new Int8Array(n)
  };
  let lastHigh: number | null = null, lastLow: number | null = null, trend = 0;
  for (let w = 0; w < n; w++) {
    // 1. weekly CRT from the two weeks before
    if (w >= 2) {
      const a = weeks[w - 2], b = weeks[w - 1];
      const tookLow = b.l < a.l, tookHigh = b.h > a.h, inside = b.c > a.l && b.c < a.h;
      out.weeklyCrt[w] = tookLow && !tookHigh && inside ? 1 : tookHigh && !tookLow && inside ? -1 : 0;
    }
    // 2 and 3 use what was known when week w-1 closed
    out.structure[w] = trend;
    if (lastHigh !== null && lastLow !== null && w >= 1) {
      const mid = (lastHigh + lastLow) / 2, close = weeks[w - 1].c;
      out.premiumDiscount[w] = close < mid ? 1 : close > mid ? -1 : 0;
    }
    const votes = [out.weeklyCrt[w], out.structure[w], out.premiumDiscount[w]];
    const up = votes.filter((v) => v === 1).length, down = votes.filter((v) => v === -1).length;
    out.majority[w] = up >= 2 ? 1 : down >= 2 ? -1 : 0;
    out.allAgree[w] = up === 3 ? 1 : down === 3 ? -1 : 0;

    // now let week w close: confirm the swing k weeks back, then check for a break
    const j = w - k;
    if (j >= k) {
      let isHigh = true, isLow = true;
      for (let x = j - k; x <= j + k; x++) {
        if (x === j) continue;
        if (x < j ? weeks[x].h >= weeks[j].h : weeks[x].h > weeks[j].h) isHigh = false;
        if (x < j ? weeks[x].l <= weeks[j].l : weeks[x].l < weeks[j].l) isLow = false;
      }
      if (isHigh) lastHigh = weeks[j].h;
      if (isLow) lastLow = weeks[j].l;
    }
    if (lastHigh !== null && weeks[w].c > lastHigh) trend = 1;
    else if (lastLow !== null && weeks[w].c < lastLow) trend = -1;
  }
  return out;
}

export function biasArray(b: WeeklyBias, mode: Config["bias"]): Int8Array | null {
  return mode === "off" ? null : b[mode];
}

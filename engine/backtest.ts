// The backtest: walks through 15-minute candles one at a time, the way a
// trader watching live would, and only ever uses candles that have closed.
//
// The strategy, for a buy (sells are the mirror image):
//  1. Weekly bias says buys are allowed (or the bias is switched off).
//  2. Daily CRT: yesterday's candle is the range. Today price trades below
//     its low (the sweep).
//  3. 1-hour zone: after the sweep, a 1-hour fair value gap and/or order
//     block forms on the way back up.
//  4. Price comes back into the zone, then a 15-minute candle closes above
//     the last 15-minute swing high made before the low (structure shift).
//     That close is the entry.
//  5. Stop just beyond the sweep's wick (or the pullback's). Take half at the range's 50% level
//     (stop moves to entry), the rest at the range high. Anything left is
//     closed at the end of the day after the sweep day.
// Timing: "sameDay" enters on the sweep day, "nextDay" only after the sweep
// day has closed back inside the range, "either" allows both.
import { biasArray, buildCalendar, weeklyBias, type Calendar } from "./bars";
import { dayKey, inSessions, nfpTimes } from "./calendar";
import { stats } from "./stats";
import type { Config, Dir, Funnel, RunResult, Series, Trade, Zone } from "./types";

interface Swing { t: number; price: number; }

interface H1 { t: number; o: number; h: number; l: number; c: number; }

interface Setup {
  dir: Dir;
  d1: number; // range day index
  d2: number; // sweep day index
  rangeHigh: number;
  rangeLow: number;
  mid: number;
  bias: number;
  swept: boolean;
  sweepT: number;
  sweepPrice: number;
  sweepHourT: number;
  insideClose: boolean | null; // did the sweep day close back inside? known after it closes
  zone: Zone | null;
  zoneCounted: boolean;
  touched: boolean;
  touchCounted: boolean;
  touchT: number;
  extreme: number; // lowest low (buy) / highest high (sell) since the touch
  extremeT: number;
  done: boolean;
}

interface Open { trade: Trade; stop: number; half: boolean; realized: number; lastDay: number; }

export interface Prepared {
  s: Series;
  cal: Calendar;
  bias: ReturnType<typeof weeklyBias>;
  nfpDays: Set<number>; // day keys that hold a US jobs report
}

/** The slow, config-independent work, so several runs can share it. */
export function prepare(s: Series, cfg: Pick<Config, "dayStart" | "weekendClosed" | "swingWeekly">): Prepared {
  const cal = buildCalendar(s, cfg);
  const bias = weeklyBias(cal.weeks, cfg.swingWeekly);
  const nfpDays = new Set<number>();
  // the news calendar is known in advance, so include a release later on the last day
  if (s.n) for (const t of nfpTimes(s.t[0], s.t[s.n - 1] + 86400)) nfpDays.add(dayKey(t, cfg.dayStart, cfg.weekendClosed));
  return { s, cal, bias, nfpDays };
}

export function runBacktest(p: Prepared, cfg: Config): RunResult {
  const { s, cal, nfpDays } = p;
  const { days, dayOf, weekOfDay } = cal;
  const biasByWeek = biasArray(p.bias, cfg.bias);
  const k = cfg.swing15;
  const sp = cfg.spread;

  const trades: Trade[] = [];
  const funnel: Funnel = { days: 0, sweeps: 0, biasBlocked: 0, zones: 0, touches: 0, entries: 0, skippedNews: 0, skippedSession: 0, skippedPastMid: 0 };
  let setups: Setup[] = [];
  let open: Open[] = [];
  const highs: Swing[] = [], lows: Swing[] = [];
  const h1: H1[] = [];
  let bar: H1 | null = null;
  let curDay = -1;

  const closeTrade = (o: Open, t: number, price: number, reason: Trade["reason"]) => {
    const tr = o.trade;
    const r = (tr.dir === 1 ? price - tr.entry : tr.entry - price) / tr.risk;
    tr.r = o.half ? o.realized + 0.5 * r : r;
    tr.exitT = t;
    tr.exit = price;
    tr.reason = reason;
  };

  // A 1-hour candle has closed: look for zones on setups that need one.
  const onHour = (doneAt: number) => {
    const n1 = h1.length;
    for (const st of setups) {
      if (st.done || !st.swept || st.zone || cfg.zone === "off") continue;
      const b = h1[n1 - 1];
      let zone: Zone | null = null;
      if (cfg.zone === "ob") {
        // the last opposite candle since the sweep, once a 1-hour close goes beyond it
        for (let x = n1 - 2; x >= 0 && h1[x].t >= st.sweepHourT; x--) {
          const ob = h1[x];
          const opposite = st.dir === 1 ? ob.c < ob.o : ob.c > ob.o;
          if (!opposite) continue;
          if (st.dir === 1 ? b.c > ob.h : b.c < ob.l) zone = { top: ob.h, bottom: ob.l, t: doneAt, ob: { top: ob.h, bottom: ob.l, t: ob.t } };
          break;
        }
      } else if (n1 >= 3 && h1[n1 - 3].t >= st.sweepHourT) {
        const a = h1[n1 - 3];
        const gap = st.dir === 1 ? b.l > a.h : b.h < a.l;
        if (gap) {
          const fvg = st.dir === 1 ? { top: b.l, bottom: a.h, t: a.t } : { top: a.l, bottom: b.h, t: a.t };
          if (cfg.zone === "fvg") zone = { top: fvg.top, bottom: fvg.bottom, t: doneAt, fvg };
          else {
            // order block: the last opposite candle before the move that left the gap
            for (let x = n1 - 3; x >= 0 && h1[x].t >= st.sweepHourT; x--) {
              const ob = h1[x];
              if (st.dir === 1 ? ob.c < ob.o : ob.c > ob.o) {
                zone = {
                  top: Math.max(fvg.top, ob.h), bottom: Math.min(fvg.bottom, ob.l), t: doneAt,
                  fvg, ob: { top: ob.h, bottom: ob.l, t: ob.t }
                };
                break;
              }
            }
          }
        }
      }
      if (zone) {
        st.zone = zone;
        if (!st.zoneCounted) { st.zoneCounted = true; funnel.zones++; }
      }
    }
  };

  const closeHour = () => {
    if (!bar) return;
    h1.push(bar);
    const doneAt = bar.t + 3600;
    bar = null;
    onHour(doneAt);
  };

  for (let i = 0; i < s.n; i++) {
    const t = s.t[i], o = s.o[i], hi = s.h[i], lo = s.l[i], c = s.c[i];
    const di = dayOf[i];

    // ---- a new trading day ----
    if (di !== curDay) {
      // time stops: anything still open from the day before
      if (i > 0) {
        open = open.filter((op) => {
          if (di <= op.lastDay || !cfg.timeStop) return true;
          const px = op.trade.dir === 1 ? s.c[i - 1] : s.c[i - 1] + sp;
          closeTrade(op, s.t[i - 1] + 900, px, "time");
          return false;
        });
      }
      // the sweep day that just closed: did it close back inside the range?
      if (curDay >= 0) {
        const d = days[curDay];
        for (const st of setups) {
          if (st.d2 !== curDay || st.done) continue;
          st.insideClose = d.c > st.rangeLow && d.c < st.rangeHigh;
          const canNext = cfg.timing !== "sameDay" && st.swept && st.insideClose;
          if (!canNext) st.done = true;
          else if (cfg.timing === "nextDay") st.touched = false; // wait for a fresh retest after the close
        }
      }
      setups = setups.filter((st) => !st.done && di <= st.d2 + 1);
      curDay = di;

      // new setups: yesterday is the range, today may sweep it
      const prev = days[di - 1];
      if (prev && days[di].t - prev.tEnd < 4 * 86400) {
        funnel.days++;
        const bias = biasByWeek ? biasByWeek[weekOfDay[di]] : 0;
        const today = days[di];
        for (const dir of [1, -1] as Dir[]) {
          const allowed = !biasByWeek || bias === dir;
          const sweptAllDay = dir === 1 ? today.l < prev.l : today.h > prev.h; // only for counting
          if (!allowed) { if (sweptAllDay) funnel.biasBlocked++; continue; }
          if (sweptAllDay) funnel.sweeps++;
          setups.push({
            dir, d1: di - 1, d2: di, rangeHigh: prev.h, rangeLow: prev.l, mid: (prev.h + prev.l) / 2, bias,
            swept: false, sweepT: 0, sweepPrice: 0, sweepHourT: 0, insideClose: null,
            zone: null, zoneCounted: false, touched: false, touchCounted: false, touchT: 0,
            extreme: 0, extremeT: 0, done: false
          });
        }
      }
    }

    // ---- 1-hour candles ----
    const hourT = t - (t % 3600);
    if (bar && bar.t !== hourT) closeHour();
    if (!bar) bar = { t: hourT, o, h: hi, l: lo, c };
    else { if (hi > bar.h) bar.h = hi; if (lo < bar.l) bar.l = lo; bar.c = c; }

    // ---- 15-minute swings, confirmed k candles later ----
    const j = i - k;
    if (j >= k) {
      let isHigh = true, isLow = true;
      for (let x = j - k; x <= j + k; x++) {
        if (x === j) continue;
        if (x < j ? s.h[x] >= s.h[j] : s.h[x] > s.h[j]) isHigh = false;
        if (x < j ? s.l[x] <= s.l[j] : s.l[x] < s.l[j]) isLow = false;
      }
      if (isHigh) highs.push({ t: s.t[j], price: s.h[j] });
      if (isLow) lows.push({ t: s.t[j], price: s.l[j] });
    }

    // ---- manage open trades (entered on earlier candles) ----
    if (open.length) {
      open = open.filter((op) => {
        const tr = op.trade;
        const long = tr.dir === 1;
        const bidStopHit = long ? lo <= op.stop : hi + sp >= op.stop;
        if (bidStopHit) {
          const gapped = long ? o <= op.stop : o + sp >= op.stop;
          const px = gapped ? (long ? o : o + sp) : op.stop;
          closeTrade(op, t, px, op.half ? "breakeven" : "stop");
          return false;
        }
        const reached = (level: number) => (long ? hi >= level : lo + sp <= level);
        const fill = (level: number) => {
          const gapped = long ? o >= level : o + sp <= level;
          return gapped ? (long ? o : o + sp) : level;
        };
        if (cfg.partialAtTp1 && !op.half && reached(tr.tp1)) {
          const px = fill(tr.tp1);
          op.half = true;
          op.realized = 0.5 * ((long ? px - tr.entry : tr.entry - px) / tr.risk);
          op.stop = tr.entry; // the rest runs risk-free
          tr.partialT = t;
          // worst case: the same candle came back to the entry after the target
          if (long ? lo <= op.stop : hi + sp >= op.stop) {
            closeTrade(op, t, op.stop, "breakeven");
            return false;
          }
        }
        if (reached(tr.tp2)) {
          closeTrade(op, t, fill(tr.tp2), "tp2");
          return false;
        }
        return true;
      });
    }

    // ---- setups: sweep, zone touch, structure shift, entry ----
    for (const st of setups) {
      if (st.done) continue;
      const long = st.dir === 1;
      const onSweepDay = di === st.d2;
      if (di > st.d2 + 1) { st.done = true; continue; }

      if (onSweepDay) {
        const through = long ? lo < st.rangeLow : hi > st.rangeHigh;
        if (through) {
          const further = !st.swept || (long ? lo < st.sweepPrice : hi > st.sweepPrice);
          if (further) {
            if (st.swept && st.zone && t >= st.zone.t) { st.zone = null; st.touched = false; } // a new extreme after the zone kills it
            st.swept = true;
            st.sweepPrice = long ? lo : hi;
            st.sweepT = t;
            st.sweepHourT = t - (t % 3600);
          }
        }
      } else if (st.swept && (long ? lo < st.sweepPrice : hi > st.sweepPrice)) {
        st.done = true; // the next day took out the sweep: the CRT failed
        continue;
      }
      if (!st.swept) continue;

      // price got to the 50% level before we were in: the move happened without us
      if (long ? hi >= st.mid : lo <= st.mid) { st.done = true; continue; }

      // zone touch and zone failure
      if (cfg.zone === "off") {
        if (!st.touched) { st.touched = true; st.touchT = st.sweepT; st.extreme = st.sweepPrice; st.extremeT = st.sweepT; }
      } else if (st.zone && t >= st.zone.t) {
        if (long ? c < st.zone.bottom : c > st.zone.top) { st.zone = null; st.touched = false; continue; }
        if (!st.touched && (long ? lo <= st.zone.top : hi >= st.zone.bottom)) {
          st.touched = true;
          st.touchT = t;
          st.extreme = long ? lo : hi;
          st.extremeT = t;
          if (!st.touchCounted) { st.touchCounted = true; funnel.touches++; }
        }
      }
      if (!st.touched) continue;
      if (long ? lo < st.extreme : hi > st.extreme) { st.extreme = long ? lo : hi; st.extremeT = t; }

      // structure shift: a close beyond the last swing made before the turn
      const list = long ? highs : lows;
      let swing: Swing | null = null;
      for (let x = list.length - 1; x >= 0; x--) if (list[x].t < st.extremeT) { swing = list[x]; break; }
      if (!swing || t <= st.extremeT) continue;
      if (long ? c <= swing.price : c >= swing.price) continue;

      // the shift happened: is this a day we may enter?
      const allowedDay = cfg.timing === "either" ? true : cfg.timing === "sameDay" ? onSweepDay : !onSweepDay;
      if (!allowedDay) { st.touched = false; continue; } // wait for a fresh retest on the right day

      st.done = true;
      const entryT = t + 900;
      if (cfg.newsGuard && cfg.usdNews && nfpDays.has(days[di].key)) { funnel.skippedNews++; continue; }
      if (!inSessions(t, cfg.sessions)) { funnel.skippedSession++; continue; }
      const entry = long ? c + sp : c;
      const anchor = cfg.stop === "pullback" ? st.extreme : st.sweepPrice;
      const stop = long ? anchor - cfg.stopBuffer : anchor + sp + cfg.stopBuffer;
      const risk = long ? entry - stop : stop - entry;
      const pastMid = long ? entry >= st.mid : entry <= st.mid;
      if (pastMid || risk <= 0) { funnel.skippedPastMid++; continue; }

      const trade: Trade = {
        id: trades.length + 1, dir: st.dir,
        rangeDayT: days[st.d1].t, sweepDayT: days[st.d2].t,
        rangeHigh: st.rangeHigh, rangeLow: st.rangeLow, mid: st.mid,
        sweepT: st.sweepT, sweepPrice: st.sweepPrice, bias: st.bias,
        zone: st.zone, touchT: cfg.zone === "off" ? null : st.touchT,
        mssLevel: swing.price, mssT: swing.t,
        entryT, entry, stop, tp1: st.mid, tp2: long ? st.rangeHigh : st.rangeLow, risk,
        sameDay: onSweepDay, partialT: null, exitT: 0, exit: 0, reason: "end", r: 0
      };
      trades.push(trade);
      funnel.entries++;
      open.push({ trade, stop, half: false, realized: 0, lastDay: st.d2 + 1 });
    }
    if (setups.some((st) => st.done)) setups = setups.filter((st) => !st.done);

    // the hour may have just finished with this candle
    if ((t + 900) % 3600 === 0) closeHour();
  }

  // the data ends: close what's left at the last price
  if (s.n) {
    const last = s.n - 1;
    for (const op of open) closeTrade(op, s.t[last] + 900, op.trade.dir === 1 ? s.c[last] : s.c[last] + sp, "end");
  }

  const from = s.n ? s.t[0] : 0, to = s.n ? s.t[s.n - 1] + 900 : 0;
  const splitT = from + Math.round((to - from) * 0.7);
  return {
    trades, funnel, splitT, from, to,
    seen: stats(trades.filter((x) => x.entryT < splitT), from, splitT),
    unseen: stats(trades.filter((x) => x.entryT >= splitT), splitT, to),
    all: stats(trades, from, to)
  };
}

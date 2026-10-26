// The backtest: walks through 15-minute candles one at a time, the way a
// trader watching live would, and only ever uses candles that have closed.
//
// The strategy, for a buy (sells are the mirror image):
//  1. The weekly bias says buys are allowed (or the bias is switched off).
//  2. Daily CRT: yesterday's candle is the range. Today trades below its low
//     (the sweep) and into a higher-timeframe key level: a 4-hour, daily or
//     weekly order block, breaker block or fair value gap.
//  3. 1-hour zone: after the sweep, a 1-hour fair value gap and/or order block
//     forms on the way back up.
//  4. Price comes back into the zone, then a 15-minute candle closes above the
//     last 15-minute swing high made before the low (structure shift). That
//     close is the entry.
//  5. The stop goes a pip below the 1-hour order block. The target is the
//     liquidity at the range high, at most 6R away. Under 2R the trade is
//     skipped, and under 3R it needs every confluence. Whatever is left closes
//     at the end of the day after the sweep. At most 3 new trades a day.
// Timing: "sameDay" enters on the sweep day, "nextDay" only after the sweep
// day has closed back inside the range, "either" allows both.
import { biasArray, buildCalendar, weeklyBias, type Calendar } from "./bars";
import { dayKey, inSessions, nfpTimes, usDst } from "./calendar";
import { build4h, structure, type Structure } from "./htf";
import { findLevels, keyLevelFor, levelBook, markTouches, type Level, type LevelBook } from "./levels";
import { stats } from "./stats";
import { CONFLUENCES, type Config, type ConfKey, type Dir, type Funnel, type Grade, type RunResult, type Series, type Trade, type Zone } from "./types";

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
  sweepI: number;
  sweepPrice: number;
  sweepHourT: number;
  insideClose: boolean | null; // did the sweep day close back inside? known after it closes
  keyLevel: Level | null;
  keyChecked: boolean;
  keyCounted: boolean;
  zone: Zone | null;
  zoneCounted: boolean;
  touched: boolean;
  touchCounted: boolean;
  touchT: number;
  extreme: number; // lowest low (buy) / highest high (sell) since the touch
  extremeT: number;
  extremeI: number;
  done: boolean;
}

interface Open { trade: Trade; stop: number; half: boolean; realized: number; lastDay: number; }

export interface Prepared {
  s: Series;
  cal: Calendar;
  bias: ReturnType<typeof weeklyBias>;
  nfpDays: Set<number>; // day keys that hold a US jobs report
  h4Of: Int32Array; // 15-minute candle index -> 4-hour candle index
  structH4: Structure;
  structD: Structure;
  levels: LevelBook;
}

/** The slow, config-independent work, so several runs can share it. */
export function prepare(s: Series, cfg: Pick<Config, "dayStart" | "weekendClosed" | "swingWeekly">): Prepared {
  const cal = buildCalendar(s, cfg);
  const bias = weeklyBias(cal.weeks, cfg.swingWeekly);
  const nfpDays = new Set<number>();
  // the news calendar is known in advance, so include a release later on the last day
  if (s.n) for (const t of nfpTimes(s.t[0], s.t[s.n - 1] + 86400)) nfpDays.add(dayKey(t, cfg.dayStart, cfg.weekendClosed));
  const h4 = build4h(s);
  const byTf = { h4: findLevels(h4.bars, "h4"), d1: findLevels(cal.days, "d1"), w1: findLevels(cal.weeks, "w1") };
  for (const list of Object.values(byTf)) markTouches(list, cal.days);
  return { s, cal, bias, nfpDays, h4Of: h4.of, structH4: structure(h4.bars, 2), structD: structure(cal.days, 2), levels: levelBook(byTf) };
}

const RANK: Record<Grade, number> = { "A+": 3, A: 2, B: 1, C: 0 };
/** All confluences met is A+, missing one or two is A, three or four is B, more is C. */
export function gradeOf(score: number, total = CONFLUENCES.length): Grade {
  return score >= total ? "A+" : score >= total - 2 ? "A" : score >= total - 4 ? "B" : "C";
}
export const gradeAtLeast = (g: Grade, min: Grade | "any") => min === "any" || RANK[g] >= RANK[min];

/** ICT killzones: London 2am to 5am and New York 7am to 10am, New York time. */
export function inKillzone(t: number) {
  const ny = t + (usDst(t) ? -4 : -5) * 3600;
  const h = Math.floor((((ny % 86400) + 86400) % 86400) / 3600);
  return (h >= 2 && h < 5) || (h >= 7 && h < 10);
}

export function runBacktest(p: Prepared, cfg: Config): RunResult {
  const { s, cal, nfpDays } = p;
  const { days, dayOf, weekOfDay } = cal;
  const biasByWeek = biasArray(p.bias, cfg.bias);
  const k = cfg.swing15;
  const sp = cfg.spread;

  const trades: Trade[] = [];
  const funnel: Funnel = {
    days: 0, sweeps: 0, biasBlocked: 0, keyLevels: 0, zones: 0, touches: 0, entries: 0,
    skippedNews: 0, skippedSession: 0, skippedPastMid: 0, skippedLowR: 0, skippedDailyCap: 0
  };
  let setups: Setup[] = [];
  let open: Open[] = [];
  const highs: Swing[] = [], lows: Swing[] = [];
  const h1: H1[] = [];
  let bar: H1 | null = null;
  let curDay = -1;
  let dayTrades = 0;
  const BODY_N = 20;
  const bodies = new Float64Array(BODY_N);
  let bodySum = 0, bodyCount = 0;

  const closeTrade = (o: Open, t: number, price: number, reason: Trade["reason"]) => {
    const tr = o.trade;
    const r = (tr.dir === 1 ? price - tr.entry : tr.entry - price) / tr.risk;
    tr.r = o.half ? o.realized + 0.5 * r : r;
    tr.exitT = t;
    tr.exit = price;
    tr.reason = reason;
  };

  const needsKey = (st: Setup) => cfg.requireKeyLevel && !st.keyLevel;
  // the higher-timeframe level this setup's sweep reached; it may poke through by a tenth of candle 1's range
  const findKey = (st: Setup, now: number) => keyLevelFor(
    p.levels, cfg.keyLevelTfs, cfg.keyLevelKinds, st.dir, st.sweepT, st.sweepPrice,
    st.dir === 1 ? st.rangeLow : st.rangeHigh, days[st.d2].t, now, 0.1 * (st.rangeHigh - st.rangeLow)
  );

  // A 1-hour candle has closed: look for zones on setups that need one.
  const onHour = (doneAt: number) => {
    const n1 = h1.length;
    for (const st of setups) {
      if (st.done || !st.swept || st.zone || cfg.zone === "off" || needsKey(st)) continue;
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

  // The confluences for a trade about to be taken at the close of candle i.
  const confluences = (st: Setup, i: number, entry: number, key: Level | null): Record<ConfKey, boolean> => {
    const long = st.dir === 1, t = s.t[i], di = dayOf[i];
    // the last closed 4-hour and daily candles
    const h4i = p.h4Of[i] - 1, dPrev = di - 1;
    const mtf = h4i >= 0 && dPrev >= 0 && p.structH4.trend[h4i] === st.dir && p.structD.trend[dPrev] === st.dir;
    // premium/discount: the latest daily swing range
    const rh = dPrev >= 0 ? p.structD.rangeHigh[dPrev] : NaN, rl = dPrev >= 0 ? p.structD.rangeLow[dPrev] : NaN;
    const eq = (rh + rl) / 2;
    const discount = rh > rl && (long ? entry < eq : entry > eq);
    const z = st.zone;
    const obFvg = !!(z?.ob && z.fvg && Math.max(z.ob.bottom, z.fvg.bottom) < Math.min(z.ob.top, z.fvg.top));
    // fib: how far the pullback went back into the leg up from the sweep
    let fib = false;
    if (st.extremeI > st.sweepI) {
      let edge = long ? -Infinity : Infinity;
      for (let x = st.sweepI; x <= st.extremeI; x++) edge = long ? Math.max(edge, s.h[x]) : Math.min(edge, s.l[x]);
      const leg = long ? edge - st.sweepPrice : st.sweepPrice - edge;
      const back = long ? edge - st.extreme : st.extreme - edge;
      const ratio = leg > 0 ? back / leg : NaN;
      fib = ratio >= 0.5 && ratio <= 0.786;
    }
    // Gann box: entry in the deepest quarter of candle 1's range
    const range = st.rangeHigh - st.rangeLow;
    const gann = long ? entry <= st.rangeLow + 0.25 * range : entry >= st.rangeHigh - 0.25 * range;
    // IFVG: on the way into the entry, a close went through a gap left by the move against the trade
    let ifvg = false;
    let x0 = st.extremeI;
    while (x0 > 2 && s.t[x0 - 1] >= st.extremeT - 12 * 3600) x0--; // gaps from up to 12 hours before the turn
    for (let x = Math.max(2, x0); x <= i && !ifvg; x++) {
      const gap = long ? s.h[x] < s.l[x - 2] : s.l[x] > s.h[x - 2];
      if (!gap) continue;
      const edge = long ? s.l[x - 2] : s.h[x - 2]; // the far side a close has to pass
      for (let y = x + 1; y <= i; y++) {
        if (long ? s.c[y] > edge : s.c[y] < edge) { ifvg = y >= st.extremeI; break; } // its first close through, after the turn
      }
    }
    // displacement: a strong candle breaks structure
    const body = Math.abs(s.c[i] - s.o[i]);
    const avg = bodyCount ? bodySum / bodyCount : 0;
    const displacement = avg > 0 && body >= 1.5 * avg && (long ? s.c[i] > s.o[i] : s.c[i] < s.o[i]);
    return {
      keyLevel: !!key, weeklyBias: p.bias.majority[weekOfDay[di]] === st.dir, mtf, discount, obFvg,
      fib, gann, killzone: inKillzone(t), ifvg, displacement
    };
  };

  for (let i = 0; i < s.n; i++) {
    const t = s.t[i], o = s.o[i], hi = s.h[i], lo = s.l[i], c = s.c[i];
    const now = t + 900; // this candle's close
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
      dayTrades = 0;

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
            swept: false, sweepT: 0, sweepI: 0, sweepPrice: 0, sweepHourT: 0, insideClose: null,
            keyLevel: null, keyChecked: false, keyCounted: false,
            zone: null, zoneCounted: false, touched: false, touchCounted: false, touchT: 0,
            extreme: 0, extremeT: 0, extremeI: 0, done: false
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
        if (tr.partial && !op.half && reached(tr.tp1)) {
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

    // ---- setups: sweep, key level, zone touch, structure shift, entry ----
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
            st.sweepI = i;
            st.sweepHourT = t - (t % 3600);
            st.keyChecked = false; // a deeper sweep may reach a different level
            st.keyLevel = null;
          }
        }
      } else if (st.swept && (long ? lo < st.sweepPrice : hi > st.sweepPrice)) {
        st.done = true; // the next day took out the sweep: the CRT failed
        continue;
      }
      if (!st.swept) continue;

      // candle 2 has to sweep into a higher-timeframe key level
      if (cfg.requireKeyLevel) {
        if (st.keyLevel && st.keyLevel.brokenAt < now) { st.keyLevel = null; st.keyChecked = false; }
        if (!st.keyChecked) {
          st.keyChecked = true;
          st.keyLevel = findKey(st, now);
          if (st.keyLevel && !st.keyCounted) { st.keyCounted = true; funnel.keyLevels++; }
        }
        if (!st.keyLevel) continue;
      }

      // price got to the 50% level before we were in: the move happened without us
      if (long ? hi >= st.mid : lo <= st.mid) { st.done = true; continue; }

      // zone touch and zone failure
      if (cfg.zone === "off") {
        if (!st.touched) { st.touched = true; st.touchT = st.sweepT; st.extreme = st.sweepPrice; st.extremeT = st.sweepT; st.extremeI = st.sweepI; }
      } else if (st.zone && t >= st.zone.t) {
        if (long ? c < st.zone.bottom : c > st.zone.top) { st.zone = null; st.touched = false; continue; }
        if (!st.touched && (long ? lo <= st.zone.top : hi >= st.zone.bottom)) {
          st.touched = true;
          st.touchT = t;
          st.extreme = long ? lo : hi;
          st.extremeT = t;
          st.extremeI = i;
          if (!st.touchCounted) { st.touchCounted = true; funnel.touches++; }
        }
      }
      if (!st.touched) continue;
      if (long ? lo < st.extreme : hi > st.extreme) { st.extreme = long ? lo : hi; st.extremeT = t; st.extremeI = i; }

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
      if (cfg.newsGuard && cfg.usdNews && nfpDays.has(days[di].key)) { funnel.skippedNews++; continue; }
      if (!inSessions(t, cfg.sessions)) { funnel.skippedSession++; continue; }
      if (cfg.maxPerDay > 0 && dayTrades >= cfg.maxPerDay) { funnel.skippedDailyCap++; continue; }

      const entry = long ? c + sp : c;
      const z = st.zone;
      const anchor =
        cfg.stop === "pullback" ? st.extreme
        : cfg.stop === "ob" ? (z?.ob ? (long ? z.ob.bottom : z.ob.top) : z ? (long ? z.bottom : z.top) : st.sweepPrice)
        : st.sweepPrice;
      const stop = long ? anchor - cfg.stopBuffer : anchor + sp + cfg.stopBuffer;
      const risk = long ? entry - stop : stop - entry;
      const pastMid = long ? entry >= st.mid : entry <= st.mid;
      if (pastMid || risk <= 0) { funnel.skippedPastMid++; continue; }

      const key = cfg.requireKeyLevel ? st.keyLevel : findKey(st, now);
      const conf = confluences(st, i, entry, key);
      const score = CONFLUENCES.filter((x) => conf[x]).length;
      const grade = gradeOf(score);

      // the target: the liquidity at the far end of candle 1, within the R limits
      let target = long ? st.rangeHigh : st.rangeLow;
      let plannedR = (long ? target - entry : entry - target) / risk;
      if (plannedR > cfg.maxR) { target = long ? entry + cfg.maxR * risk : entry - cfg.maxR * risk; plannedR = cfg.maxR; }
      if (plannedR < cfg.minR || (plannedR < cfg.fullR && !gradeAtLeast(grade, cfg.lowRGrade))) { funnel.skippedLowR++; continue; }
      const partial = cfg.partialAtTp1 && (long ? st.mid > entry && st.mid < target : st.mid < entry && st.mid > target);

      const trade: Trade = {
        id: trades.length + 1, dir: st.dir,
        rangeDayT: days[st.d1].t, sweepDayT: days[st.d2].t,
        rangeHigh: st.rangeHigh, rangeLow: st.rangeLow, mid: st.mid,
        sweepT: st.sweepT, sweepPrice: st.sweepPrice, bias: st.bias,
        zone: st.zone, touchT: cfg.zone === "off" ? null : st.touchT,
        mssLevel: swing.price, mssT: swing.t,
        entryT: now, entry, stop, tp1: st.mid, tp2: target, partial, risk, plannedR,
        sameDay: onSweepDay,
        keyLevel: key ? { tf: key.tf, kind: key.kind, top: key.top, bottom: key.bottom, t: key.t } : null,
        conf, score, grade,
        partialT: null, exitT: 0, exit: 0, reason: "end", r: 0
      };
      trades.push(trade);
      funnel.entries++;
      dayTrades++;
      open.push({ trade, stop, half: false, realized: 0, lastDay: st.d2 + 1 });
    }
    if (setups.some((st) => st.done)) setups = setups.filter((st) => !st.done);

    // this candle's body joins the average for the next one
    const body = Math.abs(c - o);
    const slot = i % BODY_N;
    if (bodyCount === BODY_N) bodySum -= bodies[slot]; else bodyCount++;
    bodies[slot] = body;
    bodySum += body;

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

// Model 1: the three-candle CRT with a lower-timeframe entry. For a sell (buys are the mirror image):
//
//  1. Candle 1 sets the range (a 4-hour candle, a day or a week). One or more inside candles follow:
//     none of them takes candle 1's high or its low. When candle 1 is itself inside the candle
//     before it, that bigger candle is the range.
//  2. The weekly and daily structure agree: lower highs and lower lows for sells (see `bias`).
//  3. A later candle takes the range high into a key level that fits the structure (keys.ts). It can
//     be the candle right after the inside candles, or any candle after it while the candles keep
//     closing inside the range (`sweepWindow`).
//  4. On the entry chart (5-minute for 4-hour ranges, 15-minute for daily, 30-minute for weekly),
//     after the sweep's tip: a close below the last swing low before it (the MSS). The order block
//     is the last up candle at or before the tip.
//  5. The first pullback after the MSS leaves a swing high: the inducement. A sell limit waits at
//     the order block, no lower than the inducement, so it only fills once the inducement is taken.
//     The entry has to be inside the key level.
//  6. The stop goes just above the order block (past the tip). Half comes off at the range's 50%
//     level and the stop moves to the entry; the rest goes to the range low.
import { aggregate, weekDate, type Candles, type Prepared } from "./backtest";
import { inSessions } from "./calendar";
import { KEY_TFS, keyBook, structureKeyFor, type KeyHit } from "./keys";
import {
  CONFLUENCES, type Bar, type Checklist, type Config, type CrtTf, type Dir, type EntryChart, type Funnel,
  type KeyLevelInfo, type LiveSetup, type Trade
} from "./types";

interface Swing { t: number; price: number; i: number }

/** The most inside candles looked back over for one range. */
export const MAX_INSIDE = 5;

/**
 * Structure from swings (k candles each side): -1 after lower highs and lower lows, 1 after higher
 * highs and higher lows, 0 when mixed. A close past the last swing the other way (above the last
 * lower high, say) makes it mixed until the next swing. Read bar i's value once bar i has closed.
 */
export function swingBias(bars: Bar[], k: number): Int8Array {
  const n = bars.length, out = new Int8Array(n);
  let h1 = NaN, h2 = NaN, l1 = NaN, l2 = NaN, brokeUp = false, brokeDown = false;
  for (let i = 0; i < n; i++) {
    const j = i - k;
    if (j >= k) {
      let isHigh = true, isLow = true;
      for (let x = j - k; x <= j + k; x++) {
        if (x === j) continue;
        if (x < j ? bars[x].h >= bars[j].h : bars[x].h > bars[j].h) isHigh = false;
        if (x < j ? bars[x].l <= bars[j].l : bars[x].l < bars[j].l) isLow = false;
      }
      if (isHigh) { h1 = h2; h2 = bars[j].h; brokeUp = false; }
      if (isLow) { l1 = l2; l2 = bars[j].l; brokeDown = false; }
    }
    const c = bars[i].c;
    if (c > h2) brokeUp = true;
    if (c < l2) brokeDown = true;
    out[i] = h2 < h1 && l2 < l1 && !brokeUp ? -1 : h2 > h1 && l2 > l1 && !brokeDown ? 1 : 0;
  }
  return out;
}

const swingCache = new WeakMap<Prepared, { weekly: Int8Array; daily: Int8Array }>();
/** The weekly and daily structure from swings, worked out once per prepared prices. */
export function swingsOf(p: Prepared) {
  let s = swingCache.get(p);
  if (!s) { s = { weekly: swingBias(p.cal.weeks, 2), daily: swingBias(p.cal.days, 2) }; swingCache.set(p, s); }
  return s;
}

/** Whether the structure allows trading this way, given the weekly and daily structure. */
export function structureAllows(mode: Config["bias"], dir: Dir, weekly: number, daily: number) {
  if (mode === "weeklyDaily") return weekly === dir && daily === dir;
  if (mode === "weeklySwings") return weekly === dir;
  if (mode === "dailySwings") return daily === dir;
  return true;
}

/** Seconds per candle on the entry chart for each range. */
export function entrySeconds(chart: EntryChart, tf: CrtTf) {
  if (chart === "m5") return 300;
  if (chart === "m15") return 900;
  if (chart === "m30") return 1800;
  return tf === "h4" ? 300 : tf === "day" ? 900 : 1800;
}

const chartCache = new WeakMap<Prepared, Map<number, Candles>>();
/** The entry chart's candles: the loaded ones, or bigger candles built from them. */
function entryCandles(p: Prepared, step: number): Candles {
  if (step <= p.dt) return p.base;
  if (step === 900) return p.m15;
  let m = chartCache.get(p);
  if (!m) { m = new Map(); chartCache.set(p, m); }
  let c = m.get(step);
  if (!c) { c = aggregate(p.s, p.cal, step, p.dt); m.set(step, c); }
  return c;
}

interface Setup {
  dir: Dir;
  p1: number; // the range candle's index among the periods
  p2: number; // the candle after the inside candles: the first one that can sweep
  inside: number; // inside candles between them
  blocked: boolean; // the structure ruled this direction out (kept for the live view)
  rangeHigh: number;
  rangeLow: number;
  mid: number;
  bodyEdge: number;
  bias: number; // the weekly structure from swings when it started
  swept: boolean;
  sweepCounted: boolean;
  tip: number;
  tipI: number;
  tipT: number;
  key: KeyHit | null;
  keyChecked: boolean;
  keyCounted: boolean;
  mss: { level: number; t: number; i: number; from: number } | null;
  ob: { top: number; bottom: number; t: number } | null;
  idm: { price: number; t: number; knownI: number } | null;
  limit: number;
  touched: boolean;
  done: boolean;
  why: string | null;
  skipR: number | null;
  trade: Trade | null;
}

interface Open { trade: Trade; stop: number; half: boolean; realized: number }

const NO_CHECKS = Object.fromEntries(CONFLUENCES.map((k) => [k, null])) as Checklist;

function emptyFunnel(): Funnel {
  return {
    days: 0, sweeps: 0, biasBlocked: 0, keyLevels: 0, closedInside: 0, zones: 0, touches: 0, entries: 0,
    skippedNews: 0, skippedSession: 0, skippedPastMid: 0, skippedLowR: 0, skippedDailyCap: 0, skippedOverlap: 0, skippedChecks: 0
  };
}

const keyInfo = (k: KeyHit | null): KeyLevelInfo | null =>
  k ? { tf: k.level.tf, kind: k.level.kind, top: k.level.top, bottom: k.level.bottom, t: k.level.t, fit: k.fit } : null;

/**
 * One pass over the entry chart for one size of range. The funnel reuses the shared counters:
 * `days` ranges with inside candles, `sweeps`, `keyLevels`, `closedInside` the MSS, `zones` the
 * inducement and limit, `touches` price reaching the limit.
 */
export function runModel1Pass(p: Prepared, cfg: Config, tf: CrtTf, capByDay: Map<number, number>) {
  const { cal, nfpDays } = p;
  const kb = keyBook(p);
  const sw = swingsOf(p);
  const E = entryCandles(p, entrySeconds(cfg.entryChart, tf));
  const dt = E.dt, sp = cfg.spread, k = cfg.swing15;
  const periods: Bar[] = tf === "week" ? cal.weeks : tf === "h4" ? kb.h4.bars : cal.days;
  const periodOf = (i: number) => (tf === "week" ? cal.weekOfDay[E.day[i]] : tf === "h4" ? kb.h4.of[E.ib[i]] : E.day[i]);
  const maxGap = tf === "week" ? 10 * 86400 : tf === "h4" ? 3 * 86400 : 4 * 86400;
  /** The day a period starts in. */
  const dayOfPeriod = (pi: number) => (tf === "day" ? pi : cal.dayOf[periods[pi].i0]);
  /** A period's date for the page: the start of a 4-hour candle, a day's date, a week's Monday. */
  const dateOf = (pi: number) => (tf === "h4" ? periods[pi].t : tf === "day" ? periods[pi].key * 86400 : weekDate(periods[pi].key));
  const side = (dir: Dir) => {
    const s = cfg.side === "auto" ? (cfg.driftUp ? "buys" : "both") : cfg.side;
    return s === "both" || (s === "buys" ? dir === 1 : dir === -1);
  };

  const trades: Trade[] = [];
  const funnel = emptyFunnel();
  let setups: Setup[] = [];
  let recent: Setup[] = []; // for the live view, ended or not
  let open: Open[] = [];
  const highs: Swing[] = [], lows: Swing[] = [];
  let curP = -1;

  const closeTrade = (o: Open, t: number, price: number, reason: Trade["reason"]) => {
    const tr = o.trade;
    const r = (tr.dir === 1 ? price - tr.entry : tr.entry - price) / tr.risk;
    tr.r = o.half ? o.realized + 0.5 * r : r;
    tr.exitT = t;
    tr.exit = price;
    tr.reason = reason;
  };

  const findKey = (st: Setup, now: number) => structureKeyFor(kb, KEY_TFS[tf], cfg.keyLevelKinds, cfg.keyFit, {
    dir: st.dir, sweepT: st.tipT, sweepPrice: st.tip,
    edge: st.dir === 1 ? st.rangeLow : st.rangeHigh, bodyEdge: st.bodyEdge,
    freshFrom: periods[cfg.freshFrom === "candle1" ? st.p1 : st.p2].t, now,
    slack: 0.1 * (st.rangeHigh - st.rangeLow)
  });
  /** The entry sits inside the key level, give or take a tenth of the range. */
  const inKey = (st: Setup, price: number) => {
    const z = st.key?.level;
    if (!z) return false;
    const tol = 0.1 * (st.rangeHigh - st.rangeLow);
    return price >= z.bottom - tol && price <= z.top + tol;
  };
  const stopOf = (st: Setup) => {
    const ob = st.ob!;
    return st.dir === 1 ? ob.bottom - cfg.stopBuffer : ob.top + sp + cfg.stopBuffer;
  };

  const enter = (st: Setup, i: number, entry: number): Open | null => {
    const long = st.dir === 1, t = E.t[i], now = t + dt, pi = periodOf(i);
    st.done = true;
    const dk = cal.days[E.day[i]].key;
    if (cfg.newsGuard && cfg.usdNews && nfpDays.has(dk)) { funnel.skippedNews++; st.why = "news"; return null; }
    if (!inSessions(t, cfg.sessions)) { funnel.skippedSession++; st.why = "session"; return null; }
    if (cfg.maxPerDay > 0 && (capByDay.get(dk) ?? 0) >= cfg.maxPerDay) { funnel.skippedDailyCap++; st.why = "dailyCap"; return null; }
    if (open.some((op) => op.trade.dir === st.dir)) { funnel.skippedOverlap++; st.why = "alreadyIn"; return null; }
    const stop = stopOf(st);
    const risk = long ? entry - stop : stop - entry;
    if ((long ? entry >= st.mid : entry <= st.mid) || risk <= 0) { funnel.skippedPastMid++; st.why = "pastMid"; return null; }
    let target = long ? st.rangeHigh : st.rangeLow;
    let plannedR = (long ? target - entry : entry - target) / risk;
    if (plannedR > cfg.maxR) { target = long ? entry + cfg.maxR * risk : entry - cfg.maxR * risk; plannedR = cfg.maxR; }
    if (plannedR < cfg.minR) { funnel.skippedLowR++; st.why = "lowR"; st.skipR = plannedR; return null; }
    const partial = cfg.partialAtTp1 && (long ? st.mid > entry && st.mid < target : st.mid < entry && st.mid > target);
    const idm = st.idm!, mss = st.mss!, ob = st.ob!;
    const trade: Trade = {
      id: trades.length + 1, dir: st.dir, tf, model: "model1",
      rangeDayT: periods[st.p1].t, sweepDayT: periods[st.p2].t,
      rangeHigh: st.rangeHigh, rangeLow: st.rangeLow, mid: st.mid, bodyEdge: st.bodyEdge,
      sweepT: st.tipT, sweepPrice: st.tip, bias: st.bias,
      zone: { top: ob.top, bottom: ob.bottom, t: mss.t, ob: { ...ob } }, touchT: null,
      mssLevel: mss.level, mssT: mss.t, qm: null, retest: null,
      m1: { inside: st.inside, entryDt: dt, mssFrom: mss.from, idm: idm.price, idmT: idm.t, limit: st.limit, after: pi - st.p2 },
      entryT: now, entry, stop, tp1: st.mid, tp2: target, partial, risk, plannedR,
      sameDay: pi === st.p2, entryCandle: pi - st.p2 + 2,
      keyLevel: keyInfo(st.key),
      conf: { ...NO_CHECKS }, points: 0, maxPoints: 0, pct: 0,
      partialT: null, exitT: 0, exit: 0, reason: "end", r: 0
    };
    trades.push(trade);
    st.why = "entered";
    st.trade = trade;
    funnel.entries++;
    capByDay.set(dk, (capByDay.get(dk) ?? 0) + 1);
    const op: Open = { trade, stop, half: false, realized: 0 };
    open.push(op);
    return op;
  };

  for (let i = 0; i < E.n; i++) {
    const t = E.t[i], o = E.o[i], hi = E.h[i], lo = E.l[i], c = E.c[i];
    const now = t + dt;
    const pi = periodOf(i);

    // ---- a new range candle period ----
    if (pi !== curP) {
      if (curP >= 0) {
        const P = periods[curP];
        for (const st of setups) {
          if (st.done) continue;
          const inside = P.c > st.rangeLow && P.c < st.rangeHigh;
          if (st.p2 === curP && !st.swept) { st.done = true; st.why = "noSweep"; }
          else if (!inside) { st.done = true; st.why = "closedOutside"; }
        }
      }
      for (const st of setups) if (!st.done && pi > st.p2 + cfg.sweepWindow) { st.done = true; st.why = "expired"; }
      setups = setups.filter((st) => !st.done);
      recent = recent.filter((st) => st.p2 >= pi - cfg.sweepWindow - 1);
      curP = pi;

      // the candle before this one is inside an earlier candle (or several are): a range to sweep
      const near = (a: number, b: number) => periods[b].t - periods[a].tEnd < maxGap;
      const contains = (a: number, b: number) => periods[b].h <= periods[a].h && periods[b].l >= periods[a].l;
      if (pi >= 2 && near(pi - 1, pi) && near(pi - 2, pi - 1) && contains(pi - 2, pi - 1)) {
        let m = pi - 2;
        while (m >= 1 && pi - m <= MAX_INSIDE && near(m - 1, m) && contains(m - 1, m)) m--;
        funnel.days++;
        const R = periods[m], d0 = dayOfPeriod(pi);
        const daily = d0 >= 1 ? sw.daily[d0 - 1] : 0; // the last finished day
        const w0 = cal.weekOfDay[d0];
        const weekly = w0 >= 1 ? sw.weekly[w0 - 1] : 0; // the last finished week
        for (const dir of [1, -1] as Dir[]) {
          if (!side(dir)) continue;
          const blocked = !structureAllows(cfg.bias, dir, weekly, daily);
          if (blocked) funnel.biasBlocked++;
          const st: Setup = {
            dir, p1: m, p2: pi, inside: pi - 1 - m, blocked, rangeHigh: R.h, rangeLow: R.l, mid: (R.h + R.l) / 2,
            bodyEdge: dir === 1 ? Math.min(R.o, R.c) : Math.max(R.o, R.c), bias: weekly,
            swept: false, sweepCounted: false, tip: 0, tipI: 0, tipT: 0,
            key: null, keyChecked: false, keyCounted: false,
            mss: null, ob: null, idm: null, limit: NaN, touched: false,
            done: blocked, why: blocked ? "bias" : null, skipR: null, trade: null
          };
          recent.push(st);
          if (!blocked) setups.push(st);
        }
      }
    }

    // ---- swings on the entry chart, confirmed k candles later ----
    const j = i - k;
    if (j >= k) {
      let isHigh = true, isLow = true;
      for (let x = j - k; x <= j + k; x++) {
        if (x === j) continue;
        if (x < j ? E.h[x] >= E.h[j] : E.h[x] > E.h[j]) isHigh = false;
        if (x < j ? E.l[x] <= E.l[j] : E.l[x] < E.l[j]) isLow = false;
      }
      if (isHigh) highs.push({ t: E.t[j], price: E.h[j], i: j });
      if (isLow) lows.push({ t: E.t[j], price: E.l[j], i: j });
    }

    // ---- open trades ----
    if (open.length) {
      open = open.filter((op) => {
        const tr = op.trade;
        const long = tr.dir === 1;
        if (long ? lo <= op.stop : hi + sp >= op.stop) {
          const gapped = long ? o <= op.stop : o + sp >= op.stop;
          closeTrade(op, t, gapped ? (long ? o : o + sp) : op.stop, op.half ? "breakeven" : "stop");
          return false;
        }
        const reached = (level: number) => (long ? hi >= level : lo + sp <= level);
        const fill = (level: number) => ((long ? o >= level : o + sp <= level) ? (long ? o : o + sp) : level);
        if (tr.partial && !op.half && reached(tr.tp1)) {
          const px = fill(tr.tp1);
          op.half = true;
          op.realized = 0.5 * ((long ? px - tr.entry : tr.entry - px) / tr.risk);
          op.stop = tr.entry;
          tr.partialT = t;
          if (long ? lo <= op.stop : hi + sp >= op.stop) { closeTrade(op, t, op.stop, "breakeven"); return false; }
        }
        if (reached(tr.tp2)) { closeTrade(op, t, fill(tr.tp2), "tp2"); return false; }
        return true;
      });
    }

    // ---- setups: sweep, key level, MSS, inducement, then the limit ----
    for (const st of setups) {
      if (st.done) continue;
      const long = st.dir === 1;

      // the sweep, and deeper sweeps: a new tip starts the entry over
      const through = long ? lo < st.rangeLow : hi > st.rangeHigh;
      if (through && (!st.swept || (long ? lo < st.tip : hi > st.tip))) {
        st.swept = true;
        st.tip = long ? lo : hi;
        st.tipI = i;
        st.tipT = t;
        st.key = null;
        st.keyChecked = false;
        st.mss = null;
        st.ob = null;
        st.idm = null;
        st.limit = NaN;
        if (!st.sweepCounted) { st.sweepCounted = true; funnel.sweeps++; }
      }
      if (!st.swept) continue;

      // into a fresh key level that fits the structure
      if (st.key && st.key.level.brokenAt < now) { st.key = null; st.keyChecked = false; }
      if (!st.keyChecked) {
        st.keyChecked = true;
        st.key = findKey(st, now);
        if (st.key && !st.keyCounted) { st.keyCounted = true; funnel.keyLevels++; }
      }
      if (cfg.requireKeyLevel && !st.key) continue;

      // the move played out before we were in
      if (long ? hi >= st.rangeHigh : lo <= st.rangeLow) { st.done = true; st.why = "targetHit"; continue; }
      if (cfg.midCancels && st.mss && (long ? hi >= st.mid : lo <= st.mid)) { st.done = true; st.why = "mid"; continue; }

      // the MSS: a close past the last swing before the tip
      if (!st.mss) {
        if (i <= st.tipI) continue;
        const list = long ? highs : lows;
        let swing: Swing | null = null;
        for (let x = list.length - 1; x >= 0; x--) if (list[x].t < st.tipT) { swing = list[x]; break; }
        if (!swing || (long ? c <= swing.price : c >= swing.price)) continue;
        st.mss = { level: swing.price, t: now, i, from: swing.t };
        // the order block: the last down candle (up for sells) at or before the tip, out to the tip
        let ob = st.tipI;
        for (let y = st.tipI; y >= Math.max(0, st.tipI - 12); y--) if (long ? E.c[y] < E.o[y] : E.c[y] > E.o[y]) { ob = y; break; }
        st.ob = long
          ? { top: E.h[ob], bottom: cfg.obStop === "candle" ? E.l[ob] : st.tip, t: E.t[ob] }
          : { top: cfg.obStop === "candle" ? E.h[ob] : st.tip, bottom: E.l[ob], t: E.t[ob] };
        funnel.closedInside++;
        continue;
      }

      // the inducement: the first swing the other way after the MSS (a swing high for sells)
      if (!st.idm) {
        const list = long ? lows : highs;
        let first: Swing | null = null;
        for (let x = list.length - 1; x >= 0 && list[x].i > st.mss.i; x--) first = list[x];
        if (!first) continue;
        st.idm = { price: first.price, t: first.t, knownI: i };
        const ob = st.ob!;
        st.limit = long ? Math.min(ob.top, first.price) : Math.max(ob.bottom, first.price);
        if (cfg.keyInside && cfg.requireKeyLevel && !inKey(st, st.limit)) { st.done = true; st.why = "notInKey"; continue; }
        funnel.zones++;
        continue;
      }

      // the limit
      if (i <= st.idm.knownI) continue;
      if (!(long ? lo + sp <= st.limit : hi >= st.limit)) continue;
      if (!st.touched) { st.touched = true; funnel.touches++; }
      const entry = long ? Math.min(st.limit, o + sp) : Math.max(st.limit, o);
      const op = enter(st, i, entry);
      // worst case: the candle that filled the limit also reached the stop
      if (op && (long ? lo <= op.stop : hi + sp >= op.stop)) {
        closeTrade(op, now, op.stop, "stop");
        open = open.filter((x) => x !== op);
      }
    }
    if (setups.some((st) => st.done)) setups = setups.filter((st) => !st.done);
  }

  // ---- the live view: where each setup stands at the last closed candle ----
  const lastI = E.n - 1;
  const describe = (st: Setup): LiveSetup => {
    const long = st.dir === 1;
    const lv: LiveSetup = {
      tf, dir: st.dir, fromYesterday: st.p2 < curP, age: curP - st.p2, stage: "waiting",
      rangeDate: dateOf(st.p1), sweepDate: dateOf(st.p2), why: st.why,
      rangeHigh: st.rangeHigh, rangeLow: st.rangeLow, mid: st.mid, bodyEdge: st.bodyEdge,
      sweepPrice: st.swept ? st.tip : null, keyLevel: keyInfo(st.key),
      zone: st.ob ? { top: st.ob.top, bottom: st.ob.bottom, t: st.mss?.t ?? st.ob.t, ob: { ...st.ob } } : null,
      level: null, order: null, pending: null, call: null, skipR: st.skipR, trade: st.trade,
      m1: { inside: st.inside, entryDt: dt, mss: st.mss?.level ?? null, ob: st.ob ? { top: st.ob.top, bottom: st.ob.bottom } : null, idm: st.idm?.price ?? null }
    };
    if (st.blocked) return { ...lv, stage: "blocked" };
    if (st.done) return { ...lv, stage: st.trade ? "entered" : "ended" };
    if (!st.swept) return lv;
    if (cfg.requireKeyLevel && !st.key) return { ...lv, stage: "noKey" };
    if (!st.mss) {
      // the close that would be the MSS
      const list = long ? highs : lows;
      for (let x = list.length - 1; x >= 0; x--) if (list[x].t < st.tipT) { lv.level = list[x].price; break; }
      return { ...lv, stage: "key" };
    }
    if (!st.idm) return { ...lv, stage: "mss", level: st.mss.level };
    const stop = stopOf(st), target = long ? st.rangeHigh : st.rangeLow, risk = long ? st.limit - stop : stop - st.limit;
    return { ...lv, stage: "limit", order: { level: st.limit, stop, target, r: risk > 0 ? (long ? target - st.limit : st.limit - target) / risk : 0 } };
  };
  const live: LiveSetup[] = [];
  if (E.n && curP >= 0) {
    const curStart = periods[curP].t;
    for (const st of recent) {
      const running = !!st.trade && open.some((op) => op.trade === st.trade);
      const enteredNow = !!st.trade && st.trade.entryT - dt >= curStart;
      if (st.p2 === curP || !st.done || running || enteredNow) live.push(describe(st));
    }
  }

  // the data ends: close what's left at the last price
  if (E.n) for (const op of open) closeTrade(op, E.t[lastI] + dt, op.trade.dir === 1 ? E.c[lastI] : E.c[lastI] + sp, "end");
  return { trades, funnel, live };
}

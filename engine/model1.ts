// Model 1: the CRT into a key level, with a lower-timeframe entry. For a buy (sells are the mirror image):
//
//  1. The range: candle 1 is a 4-hour candle, a day or a week. Candle 2 can take its low straight away
//     (a 2-candle CRT), or after one or more inside candles that take neither its high nor its low
//     (a 3-candle CRT, where the bigger candle around the inside ones is the range). `crtKind` picks.
//  2. The structure allows buys: by default the daily structure isn't bearish (see `bias`).
//  3. A candle takes the range low into a key level that fits the structure (keys.ts): the candle
//     right after, or a later one while the candles keep closing inside the range (`sweepWindow`).
//  4. The entry, on the entry chart (`entryChart`):
//     - QM (the default): the sweep's lowest low is the Apex. The last swing low before it, above it,
//       is the QM line, and the highest high between them is the breakout level. Once a candle closes
//       above the breakout level, a buy limit waits at the QM line, or the entry is an engulfing candle
//       near it, whichever comes first. A limit at the breakout level (the retest) is the other choice
//       (`qmEntry`). The stop goes below the Apex.
//     - Order block: a close above the last swing high before the sweep's tip (the MSS), the first
//       pullback (the inducement), then a buy limit at the order block. The stop goes below it.
//  5. Half comes off at the range's 50% level and the stop moves to the entry; the rest goes to the
//     range high.
import { aggregate, weekDate, type Candles, type Prepared } from "./backtest";
import { inSessions } from "./calendar";
import { KEY_TFS, keyBook, structureKeyFor, type KeyHit } from "./keys";
import {
  CONFLUENCES, type Bar, type Checklist, type Config, type CrtTf, type Dir, type EntryChart, type Funnel,
  type KeyLevelInfo, type LiveSetup, type M1Info, type Trade
} from "./types";

interface Swing { t: number; price: number; i: number }

/** The most inside candles looked back over for one range. */
export const MAX_INSIDE = 5;

/** How near the QM line an engulfing entry has to start: within this share of the way up to the breakout level. */
export const QM_ZONE = 0.25;

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

export interface Swings {
  /** On the history's weeks and days (see Prepared.hist). */
  weekly: Int8Array;
  daily: Int8Array;
  /** The structure as of the last finished week before loaded week `w`, and the last finished day before loaded day `d`. */
  weeklyBefore: (w: number) => number;
  dailyBefore: (d: number) => number;
}
const swingCache = new WeakMap<Prepared, Swings>();
/** The weekly and daily structure from swings, read on the history, worked out once per prepared prices. */
export function swingsOf(p: Prepared): Swings {
  let s = swingCache.get(p);
  if (!s) {
    const { days, weeks, dOff, wOff } = p.hist;
    const weekly = swingBias(weeks, 2), daily = swingBias(days, 2);
    s = {
      weekly, daily,
      weeklyBefore: (w) => (wOff + w - 1 >= 0 ? weekly[wOff + w - 1] : 0),
      dailyBefore: (d) => (dOff + d - 1 >= 0 ? daily[dOff + d - 1] : 0)
    };
    swingCache.set(p, s);
  }
  return s;
}

/** Whether the structure allows trading this way, given the weekly and daily structure. */
export function structureAllows(mode: Config["bias"], dir: Dir, weekly: number, daily: number) {
  if (mode === "weeklyDaily") return weekly === dir && daily === dir;
  if (mode === "weeklyLead") return weekly === dir && daily !== -dir;
  if (mode === "weeklySwings") return weekly === dir;
  if (mode === "dailySwings") return daily === dir;
  if (mode === "dailyNotAgainst") return daily !== -dir;
  return true;
}

const STEP: Record<Exclude<EntryChart, "auto">, number> = { m5: 300, m15: 900, m30: 1800, h1: 3600, h4: 14400 };
/** Seconds per candle on the entry chart for a range size and entry. */
export function entrySeconds(chart: EntryChart, tf: CrtTf, entry: Config["m1Entry"] = "qm") {
  if (chart !== "auto") return STEP[chart];
  if (entry === "qm") return tf === "h4" ? 900 : tf === "day" ? 3600 : 14400;
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

interface Qm {
  line: number; // the QM line: the last swing low before the Apex (high for sells)
  lineT: number;
  breakout: number; // the highest high between the QM line and the Apex (lowest low for sells)
  breakoutT: number;
}

interface Setup {
  dir: Dir;
  p1: number; // the range candle's index among the periods
  p2: number; // the first candle that can sweep it
  inside: number; // inside candles between them (0 for a 2-candle CRT)
  blocked: boolean; // the structure ruled this direction out (kept for the live view)
  rangeHigh: number;
  rangeLow: number;
  mid: number;
  bodyEdge: number;
  bias: number; // the weekly structure from swings when it started
  swept: boolean;
  sweepCounted: boolean;
  tip: number; // the sweep's furthest point: the Apex
  tipI: number;
  tipT: number;
  key: KeyHit | null;
  keyChecked: boolean;
  keyCounted: boolean;
  // order block entry
  mss: { level: number; t: number; i: number; from: number } | null;
  ob: { top: number; bottom: number; t: number } | null;
  idm: { price: number; t: number; knownI: number } | null;
  limit: number;
  // QM entries
  qm: Qm | null;
  qmLooked: boolean; // looked for the QM shape for this Apex
  broke: { t: number; i: number } | null; // the close past the breakout level
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
 * One pass over the entry chart for one size of range. The funnel reuses the shared counters: `days`
 * ranges looked at, `sweeps`, `keyLevels`, `closedInside` the break (QM) or the MSS (order block),
 * `zones` the order set, `touches` price reaching it.
 */
export function runModel1Pass(p: Prepared, cfg: Config, tf: CrtTf, capByDay: Map<number, number>) {
  const { cal, nfpDays } = p;
  const kb = keyBook(p);
  const sw = swingsOf(p);
  const qmEntry = cfg.m1Entry === "qm";
  const E = entryCandles(p, entrySeconds(cfg.entryChart, tf, cfg.m1Entry));
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
  /** Where the stop goes: past the Apex (QM) or past the order block. */
  const stopOf = (st: Setup) => {
    const long = st.dir === 1;
    const anchor = qmEntry ? st.tip : long ? st.ob!.bottom : st.ob!.top;
    return long ? anchor - cfg.stopBuffer : anchor + sp + cfg.stopBuffer;
  };

  const enter = (st: Setup, i: number, entry: number, how: M1Info["how"]): Open | null => {
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
    const q = st.qm, b = st.broke, mss = st.mss, ob = st.ob, idm = st.idm;
    const trade: Trade = {
      id: trades.length + 1, dir: st.dir, tf, model: "model1",
      rangeDayT: periods[st.p1].t, sweepDayT: periods[st.p2].t,
      rangeHigh: st.rangeHigh, rangeLow: st.rangeLow, mid: st.mid, bodyEdge: st.bodyEdge,
      sweepT: st.tipT, sweepPrice: st.tip, bias: st.bias,
      zone: ob && mss ? { top: ob.top, bottom: ob.bottom, t: mss.t, ob: { ...ob } } : null, touchT: null,
      mssLevel: q ? q.breakout : mss!.level, mssT: q ? b!.t : mss!.t,
      qm: q ? { level: q.line, shoulderT: q.lineT, head: st.tip, headT: st.tipT, smsLevel: q.breakout, smsT: b!.t } : null,
      retest: null,
      m1: {
        inside: st.inside, entryDt: dt, mssFrom: q ? q.breakoutT : mss!.from,
        idm: q ? q.breakout : idm!.price, idmT: q ? q.breakoutT : idm!.t,
        limit: q ? (how === "retest" ? q.breakout : how === "line" ? q.line : entry) : st.limit, after: pi - st.p2, how
      },
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

  const newSetup = (dir: Dir, m: number, pi: number, R: Bar, blocked: boolean, weekly: number): Setup => ({
    dir, p1: m, p2: pi, inside: pi - 1 - m, blocked, rangeHigh: R.h, rangeLow: R.l, mid: (R.h + R.l) / 2,
    bodyEdge: dir === 1 ? Math.min(R.o, R.c) : Math.max(R.o, R.c), bias: weekly,
    swept: false, sweepCounted: false, tip: 0, tipI: 0, tipT: 0,
    key: null, keyChecked: false, keyCounted: false,
    mss: null, ob: null, idm: null, limit: NaN,
    qm: null, qmLooked: false, broke: null, touched: false,
    done: blocked, why: blocked ? "bias" : null, skipR: null, trade: null
  });

  for (let i = 0; i < E.n; i++) {
    const t = E.t[i], o = E.o[i], hi = E.h[i], lo = E.l[i], c = E.c[i];
    const now = t + dt;
    const pi = periodOf(i);

    // ---- a new range-candle period ----
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

      // the ranges this candle can sweep: the candle before it (2-candle CRT), and the bigger candle
      // around one or more inside candles (3-candle CRT)
      const near = (a: number, b: number) => periods[b].t - periods[a].tEnd < maxGap;
      const contains = (a: number, b: number) => periods[b].h <= periods[a].h && periods[b].l >= periods[a].l;
      const ranges: number[] = [];
      if (cfg.crtKind !== "three" && pi >= 1 && near(pi - 1, pi)) ranges.push(pi - 1);
      if (cfg.crtKind !== "two" && pi >= 2 && near(pi - 1, pi) && near(pi - 2, pi - 1) && contains(pi - 2, pi - 1)) {
        let m = pi - 2;
        while (m >= 1 && pi - m <= MAX_INSIDE && near(m - 1, m) && contains(m - 1, m)) m--;
        ranges.push(m);
      }
      if (ranges.length) {
        const d0 = dayOfPeriod(pi);
        const daily = sw.dailyBefore(d0); // the last finished day
        const weekly = sw.weeklyBefore(cal.weekOfDay[d0]); // the last finished week
        for (const m of ranges) {
          funnel.days++;
          for (const dir of [1, -1] as Dir[]) {
            if (!side(dir)) continue;
            const blocked = !structureAllows(cfg.bias, dir, weekly, daily);
            if (blocked) funnel.biasBlocked++;
            const st = newSetup(dir, m, pi, periods[m], blocked, weekly);
            recent.push(st);
            if (!blocked) setups.push(st);
          }
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

    // ---- setups: sweep, key level, then the entry ----
    for (const st of setups) {
      if (st.done) continue;
      const long = st.dir === 1;

      // the sweep, and deeper sweeps: a new tip (Apex) starts the entry over
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
        st.qm = null;
        st.qmLooked = false;
        st.broke = null;
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
      if (cfg.midCancels && (st.mss || st.broke) && (long ? hi >= st.mid : lo <= st.mid)) { st.done = true; st.why = "mid"; continue; }

      if (qmEntry) {
        // ---- QM: the QM line, the breakout level, the break, then the retest or an engulfing candle ----
        if (!st.qm) {
          if (i <= st.tipI || st.qmLooked) continue;
          st.qmLooked = true; // every swing before the Apex is confirmed by now
          const list = long ? lows : highs;
          const from = periods[st.p1].t;
          let sh: Swing | null = null;
          for (let x = list.length - 1; x >= 0; x--) {
            const s = list[x];
            if (s.t >= st.tipT) continue;
            if (s.t < from) break;
            if (long ? s.price > st.tip : s.price < st.tip) { sh = s; break; }
          }
          if (!sh) continue; // no QM shape for this Apex: wait for a deeper sweep
          let lvl = long ? -Infinity : Infinity, at = -1;
          for (let x = sh.i + 1; x < st.tipI; x++) if (long ? E.h[x] > lvl : E.l[x] < lvl) { lvl = long ? E.h[x] : E.l[x]; at = x; }
          if (at < 0) continue;
          st.qm = { line: sh.price, lineT: sh.t, breakout: lvl, breakoutT: E.t[at] };
        }
        const q = st.qm;
        if (!st.broke) {
          if (long ? c > q.breakout : c < q.breakout) {
            st.broke = { t: now, i };
            funnel.closedInside++;
            funnel.zones++;
          }
          continue;
        }
        if (i <= st.broke.i) continue;
        let how: M1Info["how"] | null = null, entry = NaN;
        const mode = cfg.qmEntry;
        /** A limit at `level` fills at its price, or at the open if price jumped past it. */
        const limitAt = (level: number) => (long ? lo + sp <= level : hi >= level) ? (long ? Math.min(level, o + sp) : Math.max(level, o)) : NaN;
        if (mode === "line" || mode === "lineEngulf") {
          entry = limitAt(q.line);
          if (!Number.isNaN(entry)) how = "line";
        } else if (mode === "both" || mode === "retest") {
          entry = limitAt(q.breakout);
          if (!Number.isNaN(entry)) how = "retest";
        }
        if (!how && (mode === "lineEngulf" || mode === "engulf" || mode === "both")) {
          // an engulfing candle back at the QM line: it or the candle before reached the QM zone
          const zone = long ? q.line + QM_ZONE * (q.breakout - q.line) : q.line - QM_ZONE * (q.line - q.breakout);
          const pc = E.c[i - 1], po = E.o[i - 1];
          const reached = long ? Math.min(lo, E.l[i - 1]) <= zone : Math.max(hi, E.h[i - 1]) >= zone;
          const engulf = long ? c > o && pc < po && c >= po : c < o && pc > po && c <= po;
          if (reached && engulf) { how = "engulf"; entry = long ? c + sp : c; }
        }
        if (!how) continue;
        if (!st.touched) { st.touched = true; funnel.touches++; }
        const op = enter(st, i, entry, how);
        // worst case: the candle that filled the limit also reached the stop
        if (op && how !== "engulf" && (long ? lo <= op.stop : hi + sp >= op.stop)) {
          closeTrade(op, now, op.stop, "stop");
          open = open.filter((x) => x !== op);
        }
        continue;
      }

      // ---- order block: the MSS, the inducement, then the limit ----
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
      if (i <= st.idm.knownI) continue;
      if (!(long ? lo + sp <= st.limit : hi >= st.limit)) continue;
      if (!st.touched) { st.touched = true; funnel.touches++; }
      const entry = long ? Math.min(st.limit, o + sp) : Math.max(st.limit, o);
      const op = enter(st, i, entry, "ob");
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
      m1: {
        inside: st.inside, entryDt: dt, mss: st.mss?.level ?? null, ob: st.ob ? { top: st.ob.top, bottom: st.ob.bottom } : null, idm: st.idm?.price ?? null,
        qm: st.qm ? { line: st.qm.line, breakout: st.qm.breakout, apex: st.tip, broke: !!st.broke } : null
      }
    };
    if (st.blocked) return { ...lv, stage: "blocked" };
    if (st.done) return { ...lv, stage: st.trade ? "entered" : "ended" };
    if (!st.swept) return lv;
    if (cfg.requireKeyLevel && !st.key) return { ...lv, stage: "noKey" };
    const stop = stopOf, target = long ? st.rangeHigh : st.rangeLow;
    const orderAt = (level: number) => {
      const s = qmEntry || st.ob ? stop(st) : NaN, risk = long ? level - s : s - level;
      return { level, stop: s, target, r: risk > 0 ? (long ? target - level : level - target) / risk : 0 };
    };
    if (qmEntry) {
      if (!st.qm) return { ...lv, stage: "key" };
      if (!st.broke) return { ...lv, stage: "key", level: st.qm.breakout };
      // a limit at the QM line or the breakout level, or an engulfing candle near the QM line
      return { ...lv, stage: "limit", order: orderAt(cfg.qmEntry === "both" || cfg.qmEntry === "retest" ? st.qm.breakout : st.qm.line) };
    }
    if (!st.mss) {
      const list = long ? highs : lows;
      for (let x = list.length - 1; x >= 0; x--) if (list[x].t < st.tipT) { lv.level = list[x].price; break; }
      return { ...lv, stage: "key" };
    }
    if (!st.idm) return { ...lv, stage: "mss", level: st.mss.level };
    return { ...lv, stage: "limit", order: orderAt(st.limit) };
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

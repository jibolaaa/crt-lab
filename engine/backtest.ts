// The backtest: walks through candles one at a time, the way a trader
// watching live would, and only ever uses candles that have closed.
//
// A CRT, for a sell (buys are the mirror image):
//  1. Candle 1 is a finished day (or week). Candle 2 trades above its high
//     (the sweep) into a higher-timeframe key level, and closes back inside
//     candle 1's range.
//  2. Later candles may sweep further. The range holds until a candle closes
//     outside it, for up to `entryWindow` candles after candle 2.
//  3. From candle 3, the entry comes in the killer zone, between candle 1's
//     body top and the sweep's tip:
//     - QM: an A-shape top beyond the high before it (the shoulder), then a
//       close below the low between them (the shift), then a sell limit at
//       the shoulder: the QM line.
//     - Shift: price comes back into a 1-hour zone, then a close below the
//       last swing low.
//     Daily CRTs use 15-minute candles for this and 1-hour zones; weekly CRTs
//     use 1-hour candles and 4-hour zones.
//  4. The stop goes beyond the order block on the zone chart. The target is
//     candle 1's low. Under `minR` the trade is skipped, and under `fullR` it
//     needs at least `lowRPct` of the checklist.
import { biasArray, buildCalendar, weeklyBias, type Calendar, type WeeklyBias } from "./bars";
import { dayKey, inSessions, nfpTimes, usDst } from "./calendar";
import { build4h, structure, type Structure } from "./htf";
import { findLevels, keyLevelFor, levelBook, markTouches, type Level, type LevelBook } from "./levels";
import { stats } from "./stats";
import {
  CONFLUENCES, WEIGHT,
  type Bar, type Call, type Checklist, type Config, type CrtTf, type Dir, type Funnel, type Live, type LiveSetup,
  type QmInfo, type RunResult, type Series, type Trade, type Zone
} from "./types";

interface Swing { t: number; price: number; i: number }
interface ZBar { t: number; o: number; h: number; l: number; c: number }
interface ZSwing { t: number; price: number; knownAt: number; takenAt: number }

/** Candles the entry is looked for on. */
export interface Candles {
  n: number;
  t: ArrayLike<number>;
  o: ArrayLike<number>;
  h: ArrayLike<number>;
  l: ArrayLike<number>;
  c: ArrayLike<number>;
  dt: number; // seconds per candle
  day: Int32Array; // day index of each candle
  i15: Int32Array; // index of each candle's first 15-minute candle
}

/** A possible A-shape top (bottom for buys) waiting for its shift. */
interface Head { t: number; i: number; price: number; shoulder: number; shoulderT: number; level: number; scan: number }
interface Qm extends QmInfo { headI: number; smsI: number; displaced: boolean; ob: { top: number; bottom: number; t: number } | null }

interface Setup {
  dir: Dir;
  p1: number; // candle 1's index among the days (or weeks)
  p2: number; // candle 2's
  rangeHigh: number;
  rangeLow: number;
  mid: number;
  bodyEdge: number;
  bias: number;
  swept: boolean;
  sweepT: number;
  sweepI: number;
  sweepPrice: number;
  sweepZoneT: number;
  keyLevel: Level | null;
  keyChecked: boolean;
  keyCounted: boolean;
  insideCounted: boolean;
  // shift entry
  zone: Zone | null;
  zoneCounted: boolean;
  touched: boolean;
  touchCounted: boolean;
  touchT: number;
  extreme: number; // lowest low (buy) / highest high (sell) since the touch
  extremeT: number;
  extremeI: number;
  // QM entry
  heads: Head[];
  qm: Qm | null;
  qmCounted: boolean;
  fillCounted: boolean;
  done: boolean;
  why: string | null; // why it ended
  skipR: number | null;
  trade: Trade | null;
}

interface Open { trade: Trade; stop: number; half: boolean; realized: number; lastP: number }

interface Partner { s: Series; day: Map<number, { h: number; l: number }>; week: Map<number, { h: number; l: number }> }

export interface Prepared {
  s: Series;
  cal: Calendar;
  bias: WeeklyBias;
  nfpDays: Set<number>; // day keys that hold a US jobs report
  h4Of: Int32Array; // 15-minute candle index -> 4-hour candle index
  structH4: Structure;
  structD: Structure;
  structW: Structure;
  levels: LevelBook;
  m15: Candles;
  h1: Candles;
  /** A related market for the SMT check, if one was loaded. */
  partner: Partner | null;
}

/** 1-hour candles from 15-minute ones. The last hour only counts once its last quarter is in. */
function hourly(s: Series, cal: Calendar): Candles {
  const t: number[] = [], o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], day: number[] = [], i15: number[] = [];
  for (let i = 0; i < s.n; i++) {
    const ht = s.t[i] - (s.t[i] % 3600), k = t.length - 1;
    if (k < 0 || t[k] !== ht || day[k] !== cal.dayOf[i]) {
      t.push(ht); o.push(s.o[i]); h.push(s.h[i]); l.push(s.l[i]); c.push(s.c[i]); day.push(cal.dayOf[i]); i15.push(i);
    } else {
      if (s.h[i] > h[k]) h[k] = s.h[i];
      if (s.l[i] < l[k]) l[k] = s.l[i];
      c[k] = s.c[i];
    }
  }
  let n = t.length;
  if (n && s.t[s.n - 1] % 3600 !== 2700) n--;
  const f = (a: number[]) => Float64Array.from(a.slice(0, n));
  return { n, t: f(t), o: f(o), h: f(h), l: f(l), c: f(c), dt: 3600, day: Int32Array.from(day.slice(0, n)), i15: Int32Array.from(i15.slice(0, n)) };
}

/** The slow, rule-independent work, so several runs can share it. */
export function prepare(s: Series, cfg: Pick<Config, "dayStart" | "weekendClosed" | "swingWeekly">, partner: Series | null = null): Prepared {
  const cal = buildCalendar(s, cfg);
  const bias = weeklyBias(cal.weeks, cfg.swingWeekly);
  const nfpDays = new Set<number>();
  // the news calendar is known in advance, so include a release later on the last day
  if (s.n) for (const t of nfpTimes(s.t[0], s.t[s.n - 1] + 86400)) nfpDays.add(dayKey(t, cfg.dayStart, cfg.weekendClosed));
  const h4 = build4h(s);
  const byTf = { h4: findLevels(h4.bars, "h4"), d1: findLevels(cal.days, "d1"), w1: findLevels(cal.weeks, "w1") };
  for (const list of Object.values(byTf)) markTouches(list, cal.days);
  const i15 = new Int32Array(s.n);
  for (let i = 0; i < s.n; i++) i15[i] = i;
  let pp: Partner | null = null;
  if (partner && partner.n) {
    const pc = buildCalendar(partner, cfg);
    pp = { s: partner, day: new Map(pc.days.map((d) => [d.key, { h: d.h, l: d.l }])), week: new Map(pc.weeks.map((w) => [w.key, { h: w.h, l: w.l }])) };
  }
  return {
    s, cal, bias, nfpDays, h4Of: h4.of,
    structH4: structure(h4.bars, 2), structD: structure(cal.days, 2), structW: structure(cal.weeks, 2),
    levels: levelBook(byTf),
    m15: { n: s.n, t: s.t, o: s.o, h: s.h, l: s.l, c: s.c, dt: 900, day: cal.dayOf, i15 },
    h1: hourly(s, cal),
    partner: pp
  };
}

/** Points for the checks that were met, out of the checks that apply. Direction checks count double. */
export function scoreOf(conf: Checklist) {
  let points = 0, maxPoints = 0;
  for (const k of CONFLUENCES) {
    const v = conf[k];
    if (v === null) continue;
    maxPoints += WEIGHT[k];
    if (v) points += WEIGHT[k];
  }
  return { points, maxPoints, pct: maxPoints ? (points / maxPoints) * 100 : 0 };
}

/** ICT killzones: London 2am to 5am and New York 7am to 10am, New York time. */
export function inKillzone(t: number) {
  const ny = t + (usDst(t) ? -4 : -5) * 3600;
  const h = Math.floor((((ny % 86400) + 86400) % 86400) / 3600);
  return (h >= 2 && h < 5) || (h >= 7 && h < 10);
}

/** A week's Monday as midnight UTC, from its week number. */
export const weekDate = (key: number) => (7 * key - 3) * 86400;

function emptyFunnel(): Funnel {
  return {
    days: 0, sweeps: 0, biasBlocked: 0, keyLevels: 0, closedInside: 0, zones: 0, touches: 0, entries: 0,
    skippedNews: 0, skippedSession: 0, skippedPastMid: 0, skippedLowR: 0, skippedDailyCap: 0, skippedOverlap: 0
  };
}

/** SMT: while this market swept candle 1, did the partner hold its own candle 1? null when it can't be told. */
function smtCheck(p: Prepared, tf: CrtTf, key1: number, from: number, to: number, dir: Dir): boolean | null {
  const P = p.partner;
  if (!P) return null;
  const c1 = (tf === "week" ? P.week : P.day).get(key1);
  if (!c1) return null;
  const t = P.s.t;
  let lo = 0, hi = P.s.n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < from) lo = m + 1; else hi = m; }
  let seen = false, ext = dir === 1 ? Infinity : -Infinity;
  for (let x = lo; x < P.s.n && t[x] + 900 <= to; x++) {
    seen = true;
    ext = dir === 1 ? Math.min(ext, P.s.l[x]) : Math.max(ext, P.s.h[x]);
  }
  if (!seen) return null;
  return dir === 1 ? ext >= c1.l : ext <= c1.h;
}

function inDiscount(st: Structure, idx: number, entry: number, long: boolean) {
  if (idx < 0) return false;
  const rh = st.rangeHigh[idx], rl = st.rangeLow[idx];
  const eq = (rh + rl) / 2;
  return rh > rl && (long ? entry < eq : entry > eq);
}

export function runBacktest(p: Prepared, cfg: Config): RunResult {
  const s = p.s;
  const capByDay = new Map<number, number>();
  const tfs = (["week", "day"] as CrtTf[]).filter((x) => cfg.crt.includes(x));
  const passes = tfs.map((tf) => runPass(p, cfg, tf, capByDay));
  const trades = passes.flatMap((x) => x.trades).sort((a, b) => a.entryT - b.entryT || (a.tf === b.tf ? 0 : a.tf === "week" ? -1 : 1));
  trades.forEach((tr, k) => { tr.id = k + 1; });
  const funnel = emptyFunnel();
  for (const x of passes) for (const k of Object.keys(funnel) as (keyof Funnel)[]) funnel[k] += x.funnel[k];

  let live: Live | null = null;
  if (s.n) {
    const di = p.cal.dayOf[s.n - 1], wi = p.cal.weekOfDay[di];
    if (di > 0) {
      live = {
        asOf: s.t[s.n - 1] + 900, dayStart: p.cal.days[di].t, date: p.cal.days[di].key * 86400, weekDate: weekDate(p.cal.weeks[wi].key),
        bias: p.bias.structure[wi], biasGate: cfg.bias === "off" ? null : cfg.bias,
        setups: passes.flatMap((x) => x.live)
      };
    }
  }

  const from = s.n ? s.t[0] : 0, to = s.n ? s.t[s.n - 1] + 900 : 0;
  const splitT = from + Math.round((to - from) * 0.7);
  return {
    trades, funnel, live, splitT, from, to, smt: !!p.partner,
    seen: stats(trades.filter((x) => x.entryT < splitT), from, splitT),
    unseen: stats(trades.filter((x) => x.entryT >= splitT), splitT, to),
    all: stats(trades, from, to)
  };
}

function runPass(p: Prepared, cfg: Config, tf: CrtTf, capByDay: Map<number, number>) {
  const { cal, nfpDays } = p;
  const weekly = tf === "week";
  const E = weekly ? p.h1 : p.m15;
  const dt = E.dt;
  const zoneDt = weekly ? 4 * 3600 : 3600;
  const periods: Bar[] = weekly ? cal.weeks : cal.days;
  const periodOf = (i: number) => (weekly ? cal.weekOfDay[E.day[i]] : E.day[i]);
  const periodDate = (b: Bar) => (weekly ? weekDate(b.key) : b.key * 86400);
  const maxGap = weekly ? 10 * 86400 : 4 * 86400;
  const levelTfs = weekly ? cfg.keyLevelTfs.filter((x) => x !== "h4") : cfg.keyLevelTfs;
  const biasByWeek = biasArray(p.bias, cfg.bias);
  const gateOf = (pi: number) => (biasByWeek ? biasByWeek[weekly ? pi : cal.weekOfDay[pi]] : 0);
  const k = cfg.swing15;
  const sp = cfg.spread;

  const trades: Trade[] = [];
  const funnel = emptyFunnel();
  let setups: Setup[] = [];
  let recent: Setup[] = []; // setups whose candle 2 is recent, ended or not, for the live view
  let open: Open[] = [];
  const highs: Swing[] = [], lows: Swing[] = [];
  const zb: ZBar[] = [];
  let bar: ZBar | null = null;
  const zHighs: ZSwing[] = [], zLows: ZSwing[] = [];
  let curP = -1;
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
  // the higher-timeframe level this setup's sweep reached; it may poke through a zone by a tenth of candle 1's range
  const findKey = (st: Setup, now: number) => keyLevelFor(p.levels, levelTfs, cfg.keyLevelKinds, {
    dir: st.dir, sweepT: st.sweepT, sweepPrice: st.sweepPrice,
    edge: st.dir === 1 ? st.rangeLow : st.rangeHigh, bodyEdge: st.bodyEdge,
    freshFrom: periods[cfg.freshFrom === "candle1" ? st.p1 : st.p2].t, now,
    slack: 0.1 * (st.rangeHigh - st.rangeLow)
  });

  /** A strong candle in the trade's direction: its body is at least 1.5 times the average of the 20 before it. */
  const displacedAt = (x: number, dir: Dir) => {
    let sum = 0, n = 0;
    for (let y = x - 1; y >= 0 && n < BODY_N; y--, n++) sum += Math.abs(E.c[y] - E.o[y]);
    const avg = n ? sum / n : 0;
    return avg > 0 && Math.abs(E.c[x] - E.o[x]) >= 1.5 * avg && (dir === 1 ? E.c[x] > E.o[x] : E.c[x] < E.o[x]);
  };

  /** Last week's (last month's, for weekly CRTs) high or low, or equal highs or lows on the zone chart, taken by the sweep. */
  const oldLiquidity = (st: Setup): boolean => {
    const long = st.dir === 1;
    let lvl = NaN;
    if (!weekly) {
      const w = cal.weekOfDay[st.p2] - 1;
      if (w >= 0) lvl = long ? cal.weeks[w].l : cal.weeks[w].h;
    } else if (st.p1 >= 1) {
      let ext = long ? Infinity : -Infinity;
      for (let w = Math.max(0, st.p1 - 4); w < st.p1; w++) ext = long ? Math.min(ext, cal.weeks[w].l) : Math.max(ext, cal.weeks[w].h);
      lvl = ext;
    }
    if (Number.isFinite(lvl) && (long ? lvl <= st.rangeLow && lvl >= st.sweepPrice : lvl >= st.rangeHigh && lvl <= st.sweepPrice)) return true;
    const list = long ? zLows : zHighs;
    const from = periods[st.p1].t, oldest = from - (weekly ? 140 : 20) * 86400, tol = 0.05 * (st.rangeHigh - st.rangeLow);
    const prices: number[] = [];
    for (let x = list.length - 1; x >= 0 && prices.length < 30; x--) {
      const z = list[x];
      if (z.t < oldest) break;
      if (z.knownAt > st.sweepT || z.takenAt < from) continue;
      if (long ? z.price <= st.bodyEdge && z.price >= st.sweepPrice : z.price >= st.bodyEdge && z.price <= st.sweepPrice) prices.push(z.price);
    }
    prices.sort((a, b) => a - b);
    for (let x = 1; x < prices.length; x++) if (prices[x] - prices[x - 1] <= tol) return true;
    return false;
  };

  /** The checklist for an entry at `entry` on candle i. */
  const checklist = (st: Setup, i: number, entry: number, key: Level | null, fib: boolean, displacement: boolean, turnI: number): Checklist => {
    const long = st.dir === 1, di = E.day[i], wi = cal.weekOfDay[di];
    const weeklyBiasOk = p.bias.structure[wi] === st.dir;
    let weeklyCrt: boolean | null = null;
    if (!weekly) {
      weeklyCrt = p.bias.weeklyCrt[wi] === st.dir;
      const last = cal.weeks[wi - 1];
      if (!weeklyCrt && last) {
        // this week so far has taken last week's low (high) and is back inside
        const end = Math.min(E.i15[i] + dt / 900 - 1, p.s.n - 1);
        let ext = long ? Infinity : -Infinity;
        for (let x = cal.weeks[wi].i0; x <= end; x++) ext = long ? Math.min(ext, p.s.l[x]) : Math.max(ext, p.s.h[x]);
        weeklyCrt = long ? ext < last.l && entry > last.l : ext > last.h && entry < last.h;
      }
    }
    let mtf: boolean, discount: boolean;
    if (!weekly) {
      const h4i = p.h4Of[E.i15[i]] - 1, dPrev = di - 1;
      mtf = h4i >= 0 && dPrev >= 0 && p.structH4.trend[h4i] === st.dir && p.structD.trend[dPrev] === st.dir;
      discount = inDiscount(p.structD, dPrev, entry, long);
    } else {
      const dPrev = di - 1, wPrev = wi - 1;
      mtf = dPrev >= 0 && wPrev >= 0 && p.structD.trend[dPrev] === st.dir && p.structW.trend[wPrev] === st.dir;
      discount = inDiscount(p.structW, wPrev, entry, long);
    }
    const strongKey = !!key && (weekly ? key.tf === "w1" : key.tf !== "h4");
    const z = st.zone;
    const obFvg = !!(z?.ob && z.fvg && Math.max(z.ob.bottom, z.fvg.bottom) < Math.min(z.ob.top, z.fvg.top));
    const range = st.rangeHigh - st.rangeLow;
    const gann = long ? entry <= st.rangeLow + 0.25 * range : entry >= st.rangeHigh - 0.25 * range;
    // IFVG: on the way in, a close went through a gap left by the move against the trade
    let ifvg = false;
    let x0 = turnI;
    while (x0 > 2 && E.t[x0 - 1] >= E.t[turnI] - 48 * dt) x0--; // gaps from up to 48 candles before the turn
    for (let x = Math.max(2, x0); x <= i && !ifvg; x++) {
      const gap = long ? E.h[x] < E.l[x - 2] : E.l[x] > E.h[x - 2];
      if (!gap) continue;
      const edge = long ? E.l[x - 2] : E.h[x - 2]; // the far side a close has to pass
      for (let y = x + 1; y <= i; y++) {
        if (long ? E.c[y] > edge : E.c[y] < edge) { ifvg = y >= turnI; break; } // its first close through, after the turn
      }
    }
    return {
      weeklyBias: weeklyBiasOk, weeklyCrt, mtf, discount, strongKey, obFvg, fib, gann, ifvg,
      killzone: inKillzone(E.t[i]), displacement,
      smt: smtCheck(p, tf, periods[st.p1].key, periods[st.p2].t, E.t[i] + dt, st.dir),
      oldLiquidity: oldLiquidity(st)
    };
  };

  /** QM: where the stop goes beyond. The last up candle (down for buys) on the zone chart at or before the top. */
  const qmOb = (dir: Dir, headT: number) => {
    const want = (b: ZBar) => (dir === -1 ? b.c > b.o : b.c < b.o);
    const zh = headT - (headT % zoneDt);
    if (bar && bar.t === zh && want(bar)) return { top: bar.h, bottom: bar.l, t: bar.t };
    let seen = 0;
    for (let x = zb.length - 1; x >= 0 && seen < 4; x--) {
      if (zb[x].t > zh) continue;
      seen++;
      if (want(zb[x])) return { top: zb[x].h, bottom: zb[x].l, t: zb[x].t };
    }
    return null;
  };
  const qmAnchor = (st: Setup, q: Qm) => {
    const long = st.dir === 1;
    if (cfg.stop === "sweep") return st.sweepPrice;
    if (cfg.stop === "pullback" || !q.ob) return q.head;
    const a = long ? q.ob.bottom : q.ob.top;
    return long ? (a < q.level ? a : q.head) : a > q.level ? a : q.head;
  };
  /** QM: how far price came back up (down) into the drop from the top, as a share of it. */
  const qmFib = (q: Qm, i: number, entry: number, long: boolean) => {
    let far = long ? -Infinity : Infinity;
    for (let x = q.headI + 1; x <= i; x++) far = long ? Math.max(far, E.h[x]) : Math.min(far, E.l[x]);
    const leg = long ? far - q.head : q.head - far;
    const back = long ? far - entry : entry - far;
    const ratio = leg > 0 ? back / leg : NaN;
    return ratio >= 0.5 && ratio <= 0.786;
  };

  // Try to take a trade: the filters, the stop, the checklist and the R rules.
  const enter = (
    st: Setup, i: number, entry: number, broke: { level: number; t: number },
    o: { qm: Qm | null; fib: boolean; displacement: boolean; turnI: number; anchor: number; touchT: number | null }
  ): Open | null => {
    const long = st.dir === 1, t = E.t[i], now = t + dt, pi = periodOf(i);
    st.done = true;
    const dk = cal.days[E.day[i]].key;
    if (cfg.newsGuard && cfg.usdNews && nfpDays.has(dk)) { funnel.skippedNews++; st.why = "news"; return null; }
    if (!inSessions(t, cfg.sessions)) { funnel.skippedSession++; st.why = "session"; return null; }
    if (cfg.maxPerDay > 0 && (capByDay.get(dk) ?? 0) >= cfg.maxPerDay) { funnel.skippedDailyCap++; st.why = "dailyCap"; return null; }
    if (open.some((op) => op.trade.dir === st.dir)) { funnel.skippedOverlap++; st.why = "alreadyIn"; return null; }

    const stop = long ? o.anchor - cfg.stopBuffer : o.anchor + sp + cfg.stopBuffer;
    const risk = long ? entry - stop : stop - entry;
    const pastMid = long ? entry >= st.mid : entry <= st.mid;
    if (pastMid || risk <= 0) { funnel.skippedPastMid++; st.why = "pastMid"; return null; }

    const key = cfg.requireKeyLevel ? st.keyLevel : findKey(st, now);
    const conf = checklist(st, i, entry, key, o.fib, o.displacement, o.turnI);
    const sc = scoreOf(conf);

    // the target: the liquidity at the far end of candle 1, within the R limits
    let target = long ? st.rangeHigh : st.rangeLow;
    let plannedR = (long ? target - entry : entry - target) / risk;
    if (plannedR > cfg.maxR) { target = long ? entry + cfg.maxR * risk : entry - cfg.maxR * risk; plannedR = cfg.maxR; }
    if (plannedR < cfg.minR || (plannedR < cfg.fullR && sc.pct < cfg.lowRPct - 1e-9)) {
      funnel.skippedLowR++;
      st.why = plannedR < cfg.minR ? "lowR" : "lowRPct";
      st.skipR = plannedR;
      return null;
    }
    const partial = cfg.partialAtTp1 && (long ? st.mid > entry && st.mid < target : st.mid < entry && st.mid > target);
    const q = o.qm;
    const trade: Trade = {
      id: trades.length + 1, dir: st.dir, tf, model: q ? "qm" : "shift",
      rangeDayT: periods[st.p1].t, sweepDayT: periods[st.p2].t,
      rangeHigh: st.rangeHigh, rangeLow: st.rangeLow, mid: st.mid, bodyEdge: st.bodyEdge,
      sweepT: st.sweepT, sweepPrice: st.sweepPrice, bias: st.bias,
      zone: st.zone, touchT: o.touchT,
      mssLevel: broke.level, mssT: broke.t,
      qm: q ? { level: q.level, shoulderT: q.shoulderT, head: q.head, headT: q.headT, smsLevel: q.smsLevel, smsT: q.smsT } : null,
      entryT: now, entry, stop, tp1: st.mid, tp2: target, partial, risk, plannedR,
      sameDay: pi === st.p2, entryCandle: pi - st.p2 + 2,
      keyLevel: key ? { tf: key.tf, kind: key.kind, top: key.top, bottom: key.bottom, t: key.t } : null,
      conf, points: sc.points, maxPoints: sc.maxPoints, pct: sc.pct,
      partialT: null, exitT: 0, exit: 0, reason: "end", r: 0
    };
    trades.push(trade);
    st.why = "entered";
    st.trade = trade;
    funnel.entries++;
    capByDay.set(dk, (capByDay.get(dk) ?? 0) + 1);
    const op: Open = { trade, stop, half: false, realized: 0, lastP: pi + 1 };
    open.push(op);
    return op;
  };

  // ---- the live view: where each setup stands at the last closed candle ----
  const callFor = (st: Setup, i: number, entry: number, q: Qm): Call => {
    const conf = checklist(st, i, entry, st.keyLevel, qmFib(q, i, entry, st.dir === 1), q.displaced, q.headI);
    return { ...scoreOf(conf), conf };
  };

  function describe(st: Setup, lastI: number): LiveSetup {
    const long = st.dir === 1;
    const lv: LiveSetup = {
      tf, dir: st.dir, fromYesterday: st.p2 < curP, age: curP - st.p2, stage: "waiting",
      rangeDate: periodDate(periods[st.p1]), sweepDate: periodDate(periods[st.p2]),
      why: st.why, rangeHigh: st.rangeHigh, rangeLow: st.rangeLow, mid: st.mid, bodyEdge: st.bodyEdge,
      sweepPrice: st.swept ? st.sweepPrice : null,
      keyLevel: st.keyLevel ? { tf: st.keyLevel.tf, kind: st.keyLevel.kind, top: st.keyLevel.top, bottom: st.keyLevel.bottom, t: st.keyLevel.t } : null,
      zone: st.zone, level: null, qm: null, pending: null, call: null, skipR: st.skipR, trade: st.trade
    };
    if (st.done) return { ...lv, stage: st.trade ? "entered" : "ended", call: st.trade ? { pct: st.trade.pct, points: st.trade.points, maxPoints: st.trade.maxPoints, conf: st.trade.conf } : null };
    if (!st.swept) return lv;
    if (needsKey(st)) return { ...lv, stage: "noKey" };
    if (cfg.entry === "qm") {
      const q = st.qm;
      if (q) {
        const anchor = qmAnchor(st, q);
        const stop = long ? anchor - cfg.stopBuffer : anchor + sp + cfg.stopBuffer;
        const entry = q.level; // a buy limit fills when the ask reaches the line, a sell limit when the bid does
        const target = long ? st.rangeHigh : st.rangeLow;
        const risk = long ? entry - stop : stop - entry;
        return {
          ...lv, stage: "limit",
          qm: { level: q.level, stop, target, r: risk > 0 ? (long ? target - entry : entry - target) / risk : 0 },
          call: callFor(st, lastI, entry, q)
        };
      }
      const h = st.heads[st.heads.length - 1];
      return {
        ...lv, stage: st.p2 === curP && cfg.timing === "nextDay" ? "swept" : "armed",
        pending: h ? { head: h.price, sms: h.level, qm: h.shoulder } : null
      };
    }
    if (cfg.zone !== "off" && !st.zone) return { ...lv, stage: "key" };
    if (!st.touched) return { ...lv, stage: "zone" };
    const list = long ? highs : lows;
    for (let x = list.length - 1; x >= 0; x--) if (list[x].t < st.extremeT) { lv.level = list[x].price; break; }
    return { ...lv, stage: "touched" };
  }

  function liveView(lastI: number): LiveSetup[] {
    const out: LiveSetup[] = [];
    const cur = periods[curP], prev = periods[curP - 1];
    const gate = gateOf(curP);
    for (const dir of [1, -1] as Dir[]) {
      const st = recent.find((x) => x.p2 === curP && x.dir === dir);
      if (st) { out.push(describe(st, lastI)); continue; }
      if (prev && biasByWeek && gate !== dir) {
        out.push({
          tf, dir, fromYesterday: false, age: 0, stage: "blocked", rangeDate: periodDate(prev), sweepDate: periodDate(cur),
          why: null, rangeHigh: prev.h, rangeLow: prev.l, mid: (prev.h + prev.l) / 2,
          bodyEdge: dir === 1 ? Math.min(prev.o, prev.c) : Math.max(prev.o, prev.c),
          sweepPrice: null, keyLevel: null, zone: null, level: null, qm: null, pending: null, call: null, skipR: null, trade: null
        });
      }
    }
    // earlier sweeps that can still give an entry, and trades still running
    for (const st of recent) {
      if (st.p2 >= curP) continue;
      const running = !!st.trade && open.some((op) => op.trade === st.trade);
      const enteredNow = !!st.trade && st.trade.entryT - dt >= cur.t;
      const alive = !st.done && !needsKey(st);
      if (alive || running || enteredNow) out.push(describe(st, lastI));
    }
    return out;
  }

  // ---- the zone chart (1-hour, or 4-hour for weekly CRTs) ----
  const onZone = (doneAt: number) => {
    const n1 = zb.length, b = zb[n1 - 1];
    // swings on the zone chart, confirmed two candles later, for equal highs and lows
    const j = n1 - 3;
    if (j >= 2) {
      let isH = true, isL = true;
      for (let x = j - 2; x <= j + 2; x++) {
        if (x === j) continue;
        if (x < j ? zb[x].h >= zb[j].h : zb[x].h > zb[j].h) isH = false;
        if (x < j ? zb[x].l <= zb[j].l : zb[x].l < zb[j].l) isL = false;
      }
      if (isH) zHighs.push({ t: zb[j].t, price: zb[j].h, knownAt: doneAt, takenAt: Infinity });
      if (isL) zLows.push({ t: zb[j].t, price: zb[j].l, knownAt: doneAt, takenAt: Infinity });
    }
    for (let x = zHighs.length - 1; x >= Math.max(0, zHighs.length - 80); x--) {
      const z = zHighs[x];
      if (z.takenAt === Infinity && z.t < b.t && b.h > z.price) z.takenAt = b.t;
    }
    for (let x = zLows.length - 1; x >= Math.max(0, zLows.length - 80); x--) {
      const z = zLows[x];
      if (z.takenAt === Infinity && z.t < b.t && b.l < z.price) z.takenAt = b.t;
    }
    // zones for the shift entry (and the OB and FVG check for both)
    for (const st of setups) {
      if (st.done || !st.swept || st.zone || cfg.zone === "off" || needsKey(st)) continue;
      let zone: Zone | null = null;
      if (cfg.zone === "ob") {
        // the last opposite candle since the sweep, once a close goes beyond it
        for (let x = n1 - 2; x >= 0 && zb[x].t >= st.sweepZoneT; x--) {
          const ob = zb[x];
          const opposite = st.dir === 1 ? ob.c < ob.o : ob.c > ob.o;
          if (!opposite) continue;
          if (st.dir === 1 ? b.c > ob.h : b.c < ob.l) zone = { top: ob.h, bottom: ob.l, t: doneAt, ob: { top: ob.h, bottom: ob.l, t: ob.t } };
          break;
        }
      } else if (n1 >= 3 && zb[n1 - 3].t >= st.sweepZoneT) {
        const a = zb[n1 - 3];
        const gap = st.dir === 1 ? b.l > a.h : b.h < a.l;
        if (gap) {
          const fvg = st.dir === 1 ? { top: b.l, bottom: a.h, t: a.t } : { top: a.l, bottom: b.h, t: a.t };
          if (cfg.zone === "fvg") zone = { top: fvg.top, bottom: fvg.bottom, t: doneAt, fvg };
          else {
            // order block: the last opposite candle before the move that left the gap
            for (let x = n1 - 3; x >= 0 && zb[x].t >= st.sweepZoneT; x--) {
              const ob = zb[x];
              if (st.dir === 1 ? ob.c < ob.o : ob.c > ob.o) {
                zone = { top: Math.max(fvg.top, ob.h), bottom: Math.min(fvg.bottom, ob.l), t: doneAt, fvg, ob: { top: ob.h, bottom: ob.l, t: ob.t } };
                break;
              }
            }
          }
        }
      }
      if (zone) {
        st.zone = zone;
        if (!st.zoneCounted && cfg.entry === "shift") { st.zoneCounted = true; funnel.zones++; }
      }
    }
  };
  const closeZone = () => {
    if (!bar) return;
    zb.push(bar);
    const doneAt = bar.t + zoneDt;
    bar = null;
    onZone(doneAt);
  };

  for (let i = 0; i < E.n; i++) {
    const t = E.t[i], o = E.o[i], hi = E.h[i], lo = E.l[i], c = E.c[i];
    const now = t + dt; // this candle's close
    const pi = periodOf(i);

    // ---- a new day (or week) ----
    if (pi !== curP) {
      // time stops
      if (i > 0) {
        open = open.filter((op) => {
          if (pi <= op.lastP || !cfg.timeStop) return true;
          const px = op.trade.dir === 1 ? E.c[i - 1] : E.c[i - 1] + sp;
          closeTrade(op, E.t[i - 1] + dt, px, "time");
          return false;
        });
      }
      // the candle that just closed
      if (curP >= 0) {
        const P = periods[curP];
        for (const st of setups) {
          if (st.done) continue;
          const inside = P.c > st.rangeLow && P.c < st.rangeHigh;
          if (st.p2 === curP) {
            const canNext = cfg.timing !== "sameDay" && st.swept && inside;
            if (!canNext) { st.done = true; st.why = !st.swept ? "noSweep" : cfg.timing === "sameDay" ? "sameDayOnly" : "closedOutside"; continue; }
            if (!cfg.deeperSweeps && needsKey(st)) { st.done = true; st.why = "noKey"; continue; }
            if (!st.insideCounted && !needsKey(st)) { st.insideCounted = true; funnel.closedInside++; }
            if (cfg.timing === "nextDay") st.touched = false; // the shift entry waits for a fresh retest
          } else if (st.p2 < curP && !inside) { st.done = true; st.why = "closedOutside"; }
        }
      }
      for (const st of setups) if (!st.done && pi > st.p2 + cfg.entryWindow) { st.done = true; st.why = "expired"; }
      setups = setups.filter((st) => !st.done);
      recent = recent.filter((st) => st.p2 >= pi - cfg.entryWindow - 1);
      curP = pi;

      // new setups: the candle before is the range, this one may sweep it
      const prev = periods[pi - 1];
      if (prev && periods[pi].t - prev.tEnd < maxGap) {
        funnel.days++;
        const gate = gateOf(pi);
        const cur = periods[pi];
        const struct = p.bias.structure[weekly ? pi : cal.weekOfDay[pi]];
        for (const dir of [1, -1] as Dir[]) {
          const allowed = !biasByWeek || gate === dir;
          const sweptAll = dir === 1 ? cur.l < prev.l : cur.h > prev.h; // only for counting
          if (!allowed) { if (sweptAll) funnel.biasBlocked++; continue; }
          if (sweptAll) funnel.sweeps++;
          const st: Setup = {
            dir, p1: pi - 1, p2: pi, rangeHigh: prev.h, rangeLow: prev.l, mid: (prev.h + prev.l) / 2,
            bodyEdge: dir === 1 ? Math.min(prev.o, prev.c) : Math.max(prev.o, prev.c), bias: struct,
            swept: false, sweepT: 0, sweepI: 0, sweepPrice: 0, sweepZoneT: 0,
            keyLevel: null, keyChecked: false, keyCounted: false, insideCounted: false,
            zone: null, zoneCounted: false, touched: false, touchCounted: false, touchT: 0,
            extreme: 0, extremeT: 0, extremeI: 0,
            heads: [], qm: null, qmCounted: false, fillCounted: false,
            done: false, why: null, skipR: null, trade: null
          };
          setups.push(st);
          recent.push(st);
        }
      }
    }

    // ---- zone-chart candles ----
    const zt = t - (t % zoneDt);
    if (bar && bar.t !== zt) closeZone();
    if (!bar) bar = { t: zt, o, h: hi, l: lo, c };
    else { if (hi > bar.h) bar.h = hi; if (lo < bar.l) bar.l = lo; bar.c = c; }

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
      // QM: a new swing beyond the one before it, inside the killer zone, is a possible A-shape top (bottom)
      if (cfg.entry === "qm" && (isHigh || isLow)) {
        for (const st of setups) {
          if (st.done || !st.swept || st.qm) continue;
          const list = st.dir === 1 ? lows : highs;
          if (!(st.dir === 1 ? isLow : isHigh) || list.length < 2) continue;
          const hd = list[list.length - 1], sh = list[list.length - 2];
          if (hd.t < st.sweepT) continue;
          const beyond = st.dir === 1 ? hd.price < sh.price : hd.price > sh.price;
          const inZone = (x: number) => (st.dir === 1 ? x <= st.bodyEdge : x >= st.bodyEdge);
          if (!beyond || !inZone(hd.price) || !inZone(sh.price)) continue;
          let lvl = st.dir === 1 ? -Infinity : Infinity;
          for (let x = sh.i + 1; x < hd.i; x++) lvl = st.dir === 1 ? Math.max(lvl, E.h[x]) : Math.min(lvl, E.l[x]);
          if (!Number.isFinite(lvl)) continue;
          st.heads.push({ t: hd.t, i: hd.i, price: hd.price, shoulder: sh.price, shoulderT: sh.t, level: lvl, scan: hd.i + 1 });
        }
      }
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

    // ---- setups: sweep, key level, then the entry ----
    for (const st of setups) {
      if (st.done) continue;
      const long = st.dir === 1;
      const inC2 = pi === st.p2;
      if (pi > st.p2 + cfg.entryWindow) { st.done = true; st.why = "expired"; continue; }

      // the sweep, and deeper sweeps later
      const through = long ? lo < st.rangeLow : hi > st.rangeHigh;
      if (through && (!st.swept || (long ? lo < st.sweepPrice : hi > st.sweepPrice))) {
        if (!inC2 && !cfg.deeperSweeps) { st.done = true; st.why = "brokeSweep"; continue; } // the CRT failed
        if (st.swept && st.zone && t >= st.zone.t) { st.zone = null; st.touched = false; } // a new extreme after the zone kills it
        st.swept = true;
        st.sweepPrice = long ? lo : hi;
        st.sweepT = t;
        st.sweepI = i;
        st.sweepZoneT = zt;
        st.keyChecked = false; // a deeper sweep may reach a different level
        st.keyLevel = null;
        st.qm = null; // a new tip cancels a waiting limit
        st.heads = [];
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

      // the move played out before we were in
      if (cfg.midCancels && (long ? hi >= st.mid : lo <= st.mid)) { st.done = true; st.why = "mid"; continue; }
      if (long ? hi >= st.rangeHigh : lo <= st.rangeLow) { st.done = true; st.why = "targetHit"; continue; }

      const mayEnter = cfg.timing === "either" || (cfg.timing === "sameDay" ? inC2 : !inC2);

      if (cfg.entry === "qm") {
        // a waiting limit is cancelled when price goes past its top
        if (st.qm && (long ? lo < st.qm.head : hi > st.qm.head)) st.qm = null;
        if (st.qm) {
          const q = st.qm;
          if (!mayEnter || i <= q.smsI) continue;
          if (!(long ? lo + sp <= q.level : hi >= q.level)) continue;
          if (!st.fillCounted) { st.fillCounted = true; funnel.touches++; }
          // a limit fills at its price, or at the open if price jumped past it
          const entry = long ? Math.min(q.level, o + sp) : Math.max(q.level, o);
          const op = enter(st, i, entry, { level: q.smsLevel, t: q.smsT }, {
            qm: q, fib: qmFib(q, i, entry, long), displacement: q.displaced, turnI: q.headI, anchor: qmAnchor(st, q), touchT: null
          });
          // worst case: the candle that filled the limit also reached the stop
          if (op && (long ? lo <= op.stop : hi + sp >= op.stop)) {
            closeTrade(op, now, op.stop, "stop");
            open = open.filter((x) => x !== op);
          }
          continue;
        }
        // the shift after an A-shape top: a close past the low (high) between the shoulder and the top
        if (st.heads.length) {
          for (let x = st.heads.length - 1; x >= 0; x--) {
            const h = st.heads[x];
            let smsI = -1;
            for (let y = h.scan; y <= i; y++) {
              if (long ? E.l[y] < h.price : E.h[y] > h.price) { smsI = -2; break; }
              if (long ? E.c[y] > h.level : E.c[y] < h.level) { smsI = y; break; }
            }
            h.scan = i + 1;
            if (smsI === -2) { st.heads.splice(x, 1); continue; }
            if (smsI < 0) continue;
            st.qm = {
              level: h.shoulder, shoulderT: h.shoulderT, head: h.price, headT: h.t, headI: h.i,
              smsLevel: h.level, smsT: E.t[smsI] + dt, smsI: i, displaced: displacedAt(smsI, st.dir), ob: qmOb(st.dir, h.t)
            };
            st.heads = [];
            if (!st.qmCounted) { st.qmCounted = true; funnel.zones++; }
            break;
          }
        }
        continue;
      }

      // ---- shift entry: zone touch, zone failure, then a close beyond the last swing ----
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

      const list = long ? highs : lows;
      let swing: Swing | null = null;
      for (let x = list.length - 1; x >= 0; x--) if (list[x].t < st.extremeT) { swing = list[x]; break; }
      if (!swing || t <= st.extremeT) continue;
      if (long ? c <= swing.price : c >= swing.price) continue;
      if (!mayEnter) { st.touched = false; continue; } // wait for a fresh retest when entries are allowed

      // fib: how far the pullback went back into the leg from the sweep
      let fib = false;
      if (st.extremeI > st.sweepI) {
        let edge = long ? -Infinity : Infinity;
        for (let x = st.sweepI; x <= st.extremeI; x++) edge = long ? Math.max(edge, E.h[x]) : Math.min(edge, E.l[x]);
        const leg = long ? edge - st.sweepPrice : st.sweepPrice - edge;
        const back = long ? edge - st.extreme : st.extreme - edge;
        const ratio = leg > 0 ? back / leg : NaN;
        fib = ratio >= 0.5 && ratio <= 0.786;
      }
      const z = st.zone;
      const anchor =
        cfg.stop === "pullback" ? st.extreme
        : cfg.stop === "ob" ? (z?.ob ? (long ? z.ob.bottom : z.ob.top) : z ? (long ? z.bottom : z.top) : st.sweepPrice)
        : st.sweepPrice;
      const avg = bodyCount ? bodySum / bodyCount : 0;
      const displacement = avg > 0 && Math.abs(c - o) >= 1.5 * avg && (long ? c > o : c < o);
      enter(st, i, long ? c + sp : c, { level: swing.price, t: swing.t }, {
        qm: null, fib, displacement, turnI: st.extremeI, anchor, touchT: cfg.zone === "off" ? null : st.touchT
      });
    }
    if (setups.some((st) => st.done)) setups = setups.filter((st) => !st.done);

    // this candle's body joins the average for the next one
    const body = Math.abs(c - o);
    const slot = i % BODY_N;
    if (bodyCount === BODY_N) bodySum -= bodies[slot]; else bodyCount++;
    bodies[slot] = body;
    bodySum += body;

    // the zone candle may have just finished with this one
    if (now % zoneDt === 0) closeZone();
  }

  const lastI = E.n - 1;
  const live = E.n && curP > 0 ? liveView(lastI) : [];

  // the data ends: close what's left at the last price
  if (E.n) for (const op of open) closeTrade(op, E.t[lastI] + dt, op.trade.dir === 1 ? E.c[lastI] : E.c[lastI] + sp, "end");

  return { trades, funnel, live };
}

import { describe, expect, it } from "vitest";
import { buildHistory, prepare, runBacktest } from "./backtest";
import { buildCalendar } from "./bars";
import { keyBook } from "./keys";
import { swingsOf } from "./model1";
import { flips, structureKeyFor, type KeyBook } from "./keys";
import { structureAllows, swingBias } from "./model1";
import type { Level } from "./levels";
import { DEFAULT_CONFIG, type Bar, type Config, type Series } from "./types";

// 15-minute candles from Mon 8 Jan 2024 (UTC), flat at the previous close unless listed as
// "day:HH:MM" -> [open, high, low, close].
const MON = Date.UTC(2024, 0, 8) / 1000;
type OHLC = [number, number, number, number];
function make(at: Record<string, OHLC>, days = 2): Series {
  const s = { t: [] as number[], o: [] as number[], h: [] as number[], l: [] as number[], c: [] as number[] };
  let last = 1.105;
  for (let d = 0; d < days; d++) {
    for (let q = 0; q < 96; q++) {
      const hh = String(Math.floor(q / 4)).padStart(2, "0"), mm = String((q % 4) * 15).padStart(2, "0");
      const bar = at[`${d}:${hh}:${mm}`] ?? [last, last, last, last];
      s.t.push(MON + d * 86400 + q * 900);
      s.o.push(bar[0]); s.h.push(bar[1]); s.l.push(bar[2]); s.c.push(bar[3]);
      last = bar[3];
    }
  }
  return { n: s.t.length, ...s };
}
function upTo(s: Series, key: string): Series {
  const [d, hh, mm] = key.split(":").map(Number);
  const n = d * 96 + hh * 4 + mm / 15 + 1;
  const sl = (a: ArrayLike<number>) => Array.from(a).slice(0, n);
  return { n, t: sl(s.t), o: sl(s.o), h: sl(s.h), l: sl(s.l), c: sl(s.c) };
}
const at = (hh: number, mm = 0) => MON + hh * 3600 + mm * 60;

// A 4-hour sell, the mechanics only (no key level, no structure):
// - 00:00 and 04:00 blocks move a little, so neither is inside the other.
// - Range candle, 08:00 to 12:00: high 1.1100, low 1.1000, 50% at 1.1050.
// - Inside candle, 12:00 to 16:00: between 1.1020 and 1.1070.
// - Sweep candle, 16:00 to 20:00: up to a swing low at 1.1065 (17:00), a last up candle (17:30, low
//   1.1080), the tip at 1.1105 (17:45). 18:15 closes below 1.1065: the MSS. The first pullback tops
//   at 1.1078 (19:00): the inducement, confirmed at 19:30. 19:45 takes it and reaches the order
//   block at 1.1080: sold. Then down through 50% to the range low.
const sell: Record<string, OHLC> = {
  "0:00:00": [1.105, 1.106, 1.104, 1.105],
  "0:04:00": [1.105, 1.1065, 1.1035, 1.105],
  "0:08:00": [1.105, 1.11, 1.105, 1.108],
  "0:10:00": [1.108, 1.108, 1.1, 1.102],
  "0:11:45": [1.102, 1.104, 1.102, 1.104],
  "0:13:00": [1.104, 1.107, 1.102, 1.105],
  "0:16:00": [1.105, 1.106, 1.105, 1.1058],
  "0:16:15": [1.1058, 1.107, 1.1056, 1.1068],
  "0:16:30": [1.1068, 1.108, 1.1066, 1.1078],
  "0:16:45": [1.1078, 1.108, 1.107, 1.1072],
  "0:17:00": [1.1072, 1.1074, 1.1065, 1.107],
  "0:17:15": [1.107, 1.1085, 1.1068, 1.1083],
  "0:17:30": [1.1083, 1.1095, 1.108, 1.1092],
  "0:17:45": [1.1092, 1.1105, 1.1088, 1.109],
  "0:18:00": [1.109, 1.1092, 1.107, 1.1072],
  "0:18:15": [1.1072, 1.1074, 1.106, 1.1062],
  "0:18:30": [1.1062, 1.1064, 1.105, 1.1052],
  "0:18:45": [1.1052, 1.1072, 1.105, 1.107],
  "0:19:00": [1.107, 1.1078, 1.1066, 1.1068],
  "0:19:15": [1.1068, 1.107, 1.1055, 1.1058],
  "0:19:30": [1.1058, 1.106, 1.1052, 1.1056],
  "0:19:45": [1.1056, 1.1083, 1.1054, 1.107],
  "0:20:00": [1.107, 1.1072, 1.104, 1.1042],
  "0:20:15": [1.1042, 1.1044, 1.103, 1.1032],
  "0:20:30": [1.1032, 1.1034, 1.0995, 1.0998]
};
// the order block entry on a 3-candle CRT, for the scenario above
const MECHANICS: Partial<Config> = {
  crt: ["h4"], bias: "off", requireKeyLevel: false, newsGuard: false, maxPerDay: 0, stopBuffer: 0, spread: 0.0001,
  weekendClosed: false, entryChart: "m15", crtKind: "three", m1Entry: "ob", minR: 2
};
const cfg = (over: Partial<Config> = {}): Config => ({ ...DEFAULT_CONFIG, ...MECHANICS, ...over });
const run = (s: Series, c: Config) => runBacktest(prepare(s, c), c);

describe("Model 1 is the page's rules", () => {
  it("defaults to 4-hour and daily ranges, 2 or 3 candles, the daily structure, either QM entry, and no target cap", () => {
    expect(DEFAULT_CONFIG).toMatchObject({
      entry: "model1", crt: ["h4", "day"], crtKind: "both", bias: "dailySwings", m1Entry: "qm", qmEntry: "both",
      minR: 1, maxR: 1000, keyFit: true, entryChart: "auto"
    });
    expect(DEFAULT_CONFIG.keyLevelKinds).not.toContain("old"); // a swing high as a line isn't a key level for it
  });
});

describe("a Model 1 sell on a 4-hour range", () => {
  const res = run(make(sell), cfg());
  const tr = res.trades[0];
  it("takes one trade, on the sweep candle", () => {
    expect(res.trades.length).toBe(1);
    expect(tr).toMatchObject({ dir: -1, tf: "h4", model: "model1" });
    expect(tr.rangeDayT).toBe(at(8));
    expect(tr.sweepDayT).toBe(at(16));
    expect(tr.m1).toMatchObject({ inside: 1, after: 0, entryDt: 900 });
    expect(tr.entryT).toBe(at(20)); // the 19:45 candle's close
  });
  it("finds the MSS, the order block and the inducement", () => {
    expect(tr.sweepPrice).toBeCloseTo(1.1105, 6);
    expect(tr.mssLevel).toBeCloseTo(1.1065, 6);
    expect(tr.m1!.mssFrom).toBe(at(17));
    expect(tr.mssT).toBe(at(18, 30));
    expect(tr.zone!.ob).toMatchObject({ t: at(17, 30) });
    expect(tr.zone!.ob!.bottom).toBeCloseTo(1.108, 6);
    expect(tr.zone!.ob!.top).toBeCloseTo(1.1105, 6);
    expect(tr.m1!.idm).toBeCloseTo(1.1078, 6);
    expect(tr.m1!.idmT).toBe(at(19));
  });
  it("sells at the order block, stops past the tip, half at 50% and the rest at the range low", () => {
    expect(tr.entry).toBeCloseTo(1.108, 6);
    expect(tr.stop).toBeCloseTo(1.1105 + 0.0001, 6);
    expect(tr.tp1).toBeCloseTo(1.105, 6);
    expect(tr.tp2).toBeCloseTo(1.1, 6);
    expect(tr.plannedR).toBeCloseTo(0.008 / 0.0026, 6);
    expect(tr.reason).toBe("tp2");
    expect(tr.r).toBeCloseTo(0.5 * (0.003 / 0.0026) + 0.5 * (0.008 / 0.0026), 6);
  });
  it("leaves the checklist out", () => {
    expect(tr.maxPoints).toBe(0);
    expect(Object.values(tr.conf).every((v) => v === null)).toBe(true);
  });
  it("counts the steps", () => {
    expect(res.funnel).toMatchObject({ sweeps: 1, closedInside: 1, zones: 1, touches: 1, entries: 1 });
  });
});

describe("what stops a Model 1 trade", () => {
  it("needs an inside candle", () => {
    expect(run(make({ ...sell, "0:13:00": [1.104, 1.1102, 1.102, 1.105] }), cfg()).trades.length).toBe(0);
  });
  it("waits for the inducement to be taken", () => {
    const s = make({ ...sell, "0:19:45": [1.1056, 1.1076, 1.1054, 1.107], "0:20:30": [1.1032, 1.1034, 1.0995, 1.0998] });
    const r = run(s, cfg());
    expect(r.trades.length).toBe(0);
    expect(r.funnel.zones).toBe(1);
  });
  it("starts over when price goes past the tip before the entry", () => {
    // a new high at 19:15 cancels the first MSS and its limit; the next one comes too late
    const s = make({ ...sell, "0:19:15": [1.1068, 1.1108, 1.1055, 1.1058] });
    const r = run(s, cfg());
    expect(r.trades.length).toBe(0);
    expect(r.funnel.closedInside).toBe(2);
  });
  it("follows the structure", () => {
    // two days of prices have no weekly swings yet, so the weekly and daily structure rule it out
    const r = run(make(sell), cfg({ bias: "weeklyDaily" }));
    expect(r.trades.length).toBe(0);
    expect(r.funnel.biasBlocked).toBeGreaterThan(0);
  });
});

/** Move a pattern later by whole days. */
const later = (rec: Record<string, OHLC>, days: number) =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => { const [d, ...rest] = k.split(":"); return [[Number(d) + days, ...rest].join(":"), v]; }));

describe("Model 1 right now", () => {
  // the same sell a day later, so there's a finished day before it
  const s2 = make(later(sell, 1), 3);
  it("shows the limit once the inducement is in", () => {
    const l = run(upTo(s2, "1:19:30"), cfg()).live!;
    const s = l.setups.find((x) => x.tf === "h4" && x.dir === -1)!;
    expect(s.stage).toBe("limit");
    expect(s.order!.level).toBeCloseTo(1.108, 6);
    expect(s.order!.stop).toBeCloseTo(1.1106, 6);
    expect(s.order!.target).toBeCloseTo(1.1, 6);
    expect(s.m1).toMatchObject({ inside: 1 });
    expect(s.m1!.idm).toBeCloseTo(1.1078, 6);
  });
  it("waits for the inducement after the MSS", () => {
    const s = run(upTo(s2, "1:18:45"), cfg()).live!.setups.find((x) => x.tf === "h4" && x.dir === -1)!;
    expect(s.stage).toBe("mss");
    expect(s.level).toBeCloseTo(1.1065, 6);
  });
  it("names the close that would be the MSS", () => {
    const s = run(upTo(s2, "1:18:00"), cfg()).live!.setups.find((x) => x.tf === "h4" && x.dir === -1)!;
    expect(s.stage).toBe("key");
    expect(s.level).toBeCloseTo(1.1065, 6);
  });
  it("waits for a sweep while the range holds", () => {
    const s = run(upTo(s2, "1:16:00"), cfg()).live!.setups.find((x) => x.tf === "h4" && x.dir === -1)!;
    expect(s.stage).toBe("waiting");
    expect(s.rangeHigh).toBeCloseTo(1.11, 6);
  });
});

describe("structure from swings", () => {
  const bar = (h: number, l: number, c = (h + l) / 2): Bar => ({ key: 0, t: 0, tEnd: 0, o: c, h, l, c, i0: 0, i1: 0 });
  // highs 10, 8 and lows 5, 3: lower highs and lower lows
  const down = [bar(9, 7), bar(9.5, 7.5), bar(10, 8), bar(9, 6), bar(8, 5), bar(8.5, 6), bar(9, 6.5), bar(8, 6), bar(7, 4), bar(6, 3), bar(6.5, 3.5), bar(7, 4)];
  it("reads lower highs and lower lows as bearish", () => {
    const b = swingBias(down, 2);
    expect(b[b.length - 1]).toBe(-1);
  });
  it("needs both charts to agree, or the one asked for", () => {
    expect(structureAllows("weeklyDaily", -1, -1, -1)).toBe(true);
    expect(structureAllows("weeklyDaily", -1, -1, 0)).toBe(false);
    expect(structureAllows("weeklySwings", -1, -1, 1)).toBe(true);
    expect(structureAllows("dailySwings", 1, -1, 1)).toBe(true);
    expect(structureAllows("off", 1, -1, -1)).toBe(true);
  });
});

describe("Model 1's key levels", () => {
  const D = 86400;
  const bar = (i: number, h: number, l: number, c: number): Bar => ({ key: i, t: i * D, tEnd: i * D, o: c, h, l, c, i0: 0, i1: 0 });
  it("turns a broken swing low into resistance, until a close goes back above it", () => {
    // a swing low at 5 (day 2), closed below on day 5, closed back above on day 8
    const bars = [bar(0, 9, 7, 8), bar(1, 8, 6, 7), bar(2, 7, 5, 6), bar(3, 8, 6, 7), bar(4, 8, 6, 7), bar(5, 6, 4, 4.5), bar(6, 5, 3, 4), bar(7, 5, 3.5, 4.5), bar(8, 6, 4, 5.5), bar(9, 6, 5, 5.5)];
    const ct = Float64Array.from(bars, (b, i) => (i === bars.length - 1 ? Infinity : b.t + D));
    const f = flips(bars, "d1", ct).filter((z) => z.side === -1);
    expect(f.length).toBe(1);
    expect(f[0]).toMatchObject({ kind: "flip", top: 5, bottom: 5, t: 2 * D, knownAt: 6 * D, brokenAt: 9 * D });
  });

  // One chart (daily) with a swing range from 10 (high) to 4 (low): the middle is 7.
  const lv = (kind: Level["kind"], top: number, bottom: number, t: number, knownAt: number, touchedAt = Infinity): Level =>
    ({ tf: "d1", kind, side: -1, top, bottom, t, knownAt, brokenAt: Infinity, touchedAt });
  const bookWith = (res: Level[], legFrom = 5 * D): KeyBook => {
    const n = 20;
    const ct = Float64Array.from({ length: n }, (_, i) => (i + 1) * D);
    const fill = (v: number) => new Float64Array(n).fill(v);
    const tf = { bars: [], ct, hiP: fill(10), hiT: fill(legFrom), loP: fill(4), loT: fill(8 * D), support: [], resistance: res.sort((a, b) => a.knownAt - b.knownAt) };
    return { h4: { bars: [], of: new Int32Array(0) }, byTf: { h4: { ...tf, resistance: [] }, d1: tf, w1: { ...tf, resistance: [] } } };
  };
  const sweep = (price: number, over = {}) => ({ dir: -1 as const, sweepT: 15 * D, sweepPrice: price, edge: 6, bodyEdge: 5.8, freshFrom: 12 * D, now: 15 * D + 900, slack: 0.1, ...over });
  const ALL: Level["kind"][] = ["ob", "fvg", "rb", "breaker", "flip"];

  it("takes the supply of the last lower high", () => {
    const ob = lv("ob", 6.5, 6.2, 9 * D, 10 * D);
    const hit = structureKeyFor(bookWith([ob]), ["d1"], ALL, true, sweep(6.4));
    expect(hit).toMatchObject({ fit: "supply" });
    expect(hit!.level).toBe(ob);
  });
  it("takes where price broke down from", () => {
    const flip = lv("flip", 6.3, 6.3, 3 * D, 9 * D);
    expect(structureKeyFor(bookWith([flip]), ["d1"], ALL, true, sweep(6.35))).toMatchObject({ fit: "flip" });
    expect(structureKeyFor(bookWith([flip]), ["d1"], ALL, true, sweep(6.25))).toBeNull(); // the sweep didn't reach it
  });
  it("takes a gap the latest drop left, and any zone in premium", () => {
    const gap = lv("fvg", 6.4, 6.1, 6 * D, 7 * D); // formed after the last swing high (day 5)
    expect(structureKeyFor(bookWith([gap]), ["d1"], ALL, true, sweep(6.3))).toMatchObject({ fit: "leg" });
    const rb = lv("rb", 7.6, 7.2, 2 * D, 3 * D); // above the middle, 7
    expect(structureKeyFor(bookWith([rb]), ["d1"], ALL, true, sweep(7.3, { edge: 7, bodyEdge: 6.9 }))).toMatchObject({ fit: "premium" });
  });
  it("skips a level that doesn't fit the structure, unless asked not to check", () => {
    const old = lv("fvg", 6.4, 6.1, 2 * D, 3 * D); // an old gap in discount, from before the drop
    const book = bookWith([old, lv("ob", 9.5, 9, 4 * D, 5 * D)]); // the newest order block is elsewhere
    expect(structureKeyFor(book, ["d1"], ALL, true, sweep(6.3))).toBeNull();
    expect(structureKeyFor(book, ["d1"], ALL, false, sweep(6.3))).toMatchObject({ fit: "any" });
  });
  it("needs the level fresh since the range candle", () => {
    const ob = lv("ob", 6.5, 6.2, 9 * D, 10 * D, 11 * D); // touched on day 11, the range began on day 12
    expect(structureKeyFor(bookWith([ob]), ["d1"], ALL, true, sweep(6.4))).toBeNull();
    const ok = lv("ob", 6.5, 6.2, 9 * D, 10 * D, 13 * D); // touched by the range candle itself
    expect(structureKeyFor(bookWith([ok]), ["d1"], ALL, true, sweep(6.4))).not.toBeNull();
  });
});

// A QM sell on a 2-candle 4-hour CRT (the mechanics only: no key level, no structure).
// - Range candle, 08:00 to 12:00: high 1.1100, low 1.1000, 50% at 1.1050.
// - Candle 2, 12:00 to 16:00: a swing high at 1.1085 (12:30): the QM line. A dip to 1.1070 (13:00):
//   the breakout level. The Apex at 1.1110 (13:45), above the range high. 14:30 closes below 1.1070:
//   the break. 15:00 comes back up to 1.1072: sold at the breakout level, 1.1070. Then down to the
//   50% (15:30) and through the range low (16:00).
const qmSell: Record<string, OHLC> = {
  "0:00:00": [1.105, 1.106, 1.104, 1.105],
  "0:04:00": [1.105, 1.1065, 1.1035, 1.105],
  "0:08:00": [1.105, 1.11, 1.105, 1.108],
  "0:10:00": [1.108, 1.108, 1.1, 1.102],
  "0:11:45": [1.102, 1.104, 1.102, 1.104],
  "0:12:00": [1.104, 1.1075, 1.1038, 1.1072],
  "0:12:15": [1.1072, 1.108, 1.1068, 1.1078],
  "0:12:30": [1.1078, 1.1085, 1.1074, 1.1076],
  "0:12:45": [1.1076, 1.1079, 1.1071, 1.1073],
  "0:13:00": [1.1073, 1.1075, 1.107, 1.1074],
  "0:13:15": [1.1074, 1.109, 1.1073, 1.1088],
  "0:13:30": [1.1088, 1.1098, 1.1086, 1.1096],
  "0:13:45": [1.1096, 1.111, 1.1094, 1.1097],
  "0:14:00": [1.1097, 1.1099, 1.108, 1.1082],
  "0:14:15": [1.1082, 1.1084, 1.1072, 1.1074],
  "0:14:30": [1.1074, 1.1076, 1.1062, 1.1065],
  "0:14:45": [1.1065, 1.1067, 1.1058, 1.106],
  "0:15:00": [1.106, 1.1072, 1.1059, 1.1066],
  "0:15:15": [1.1066, 1.1067, 1.105, 1.1052],
  "0:15:30": [1.1052, 1.1053, 1.104, 1.1042],
  "0:15:45": [1.1042, 1.1044, 1.103, 1.1035],
  "0:16:00": [1.1035, 1.1036, 1.0995, 1.0998]
};
const QM: Partial<Config> = {
  crt: ["h4"], bias: "off", requireKeyLevel: false, newsGuard: false, maxPerDay: 0, stopBuffer: 0, spread: 0.0001,
  weekendClosed: false, entryChart: "m15", crtKind: "both", m1Entry: "qm", qmEntry: "retest", minR: 1
};
const qcfg = (over: Partial<Config> = {}): Config => ({ ...DEFAULT_CONFIG, ...QM, ...over });

describe("a QM sell on a 2-candle 4-hour CRT", () => {
  const res = run(make(qmSell), qcfg());
  const tr = res.trades[0];
  it("takes one trade, on candle 2, at the breakout retest", () => {
    expect(res.trades.length).toBe(1);
    expect(tr).toMatchObject({ dir: -1, tf: "h4", model: "model1" });
    expect(tr.m1).toMatchObject({ inside: 0, after: 0, how: "retest", entryDt: 900 });
    expect(tr.rangeDayT).toBe(at(8));
    expect(tr.entryT).toBe(at(15, 15)); // the 15:00 candle's close
  });
  it("finds the QM line, the breakout level, the Apex and the break", () => {
    expect(tr.qm!.level).toBeCloseTo(1.1085, 6);
    expect(tr.qm!.shoulderT).toBe(at(12, 30));
    expect(tr.qm!.smsLevel).toBeCloseTo(1.107, 6);
    expect(tr.m1!.idmT).toBe(at(13));
    expect(tr.qm!.head).toBeCloseTo(1.111, 6);
    expect(tr.qm!.headT).toBe(at(13, 45));
    expect(tr.qm!.smsT).toBe(at(14, 45)); // the 14:30 candle's close
  });
  it("sells at the breakout level with the stop above the Apex, half at 50% and the rest at the range low", () => {
    expect(tr.entry).toBeCloseTo(1.107, 6);
    expect(tr.stop).toBeCloseTo(1.111 + 0.0001, 6);
    expect(tr.tp1).toBeCloseTo(1.105, 6);
    expect(tr.tp2).toBeCloseTo(1.1, 6);
    expect(tr.reason).toBe("tp2");
    expect(tr.r).toBeCloseTo(0.5 * (0.002 / 0.0041) + 0.5 * (0.007 / 0.0041), 6);
  });
  it("counts the steps", () => {
    expect(res.funnel).toMatchObject({ closedInside: 1, zones: 1, touches: 1, entries: 1 });
  });
  it("needs candle 2 to take the range, so a 3-candle-only rule skips it", () => {
    expect(run(make(qmSell), qcfg({ crtKind: "three" })).trades.length).toBe(0);
  });
  it("skips it under the minimum R", () => {
    const r = run(make(qmSell), qcfg({ minR: 2 }));
    expect(r.trades.length).toBe(0);
    expect(r.funnel.skippedLowR).toBe(1);
  });
});

describe("a QM sell on an engulfing candle at the QM line", () => {
  // the pullback reaches the QM line at 15:00, and 15:15 engulfs it
  const s = make({ ...qmSell, "0:15:00": [1.106, 1.1084, 1.1059, 1.1082], "0:15:15": [1.1082, 1.1083, 1.1056, 1.1058] });
  it("sells at the engulfing candle's close", () => {
    const tr = run(s, qcfg({ qmEntry: "engulf" })).trades[0];
    expect(tr.m1).toMatchObject({ how: "engulf" });
    expect(tr.entry).toBeCloseTo(1.1058, 6);
    expect(tr.entryT).toBe(at(15, 30));
    expect(tr.stop).toBeCloseTo(1.1111, 6);
  });
  it("the retest fills first when both are allowed", () => {
    const tr = run(s, qcfg({ qmEntry: "both" })).trades[0];
    expect(tr.m1).toMatchObject({ how: "retest" });
    expect(tr.entry).toBeCloseTo(1.107, 6);
  });
  it("takes nothing without the engulfing candle", () => {
    expect(run(make(qmSell), qcfg({ qmEntry: "engulf" })).trades.length).toBe(0);
  });
});

describe("a QM setup right now", () => {
  const s2 = make(later(qmSell, 1), 3);
  it("names the breakout level before the break", () => {
    const st = run(upTo(s2, "1:14:15"), qcfg()).live!.setups.find((x) => x.tf === "h4" && x.dir === -1 && x.age === 0)!;
    expect(st.stage).toBe("key");
    expect(st.level).toBeCloseTo(1.107, 6);
    expect(st.m1!.qm).toMatchObject({ broke: false });
    expect(st.m1!.qm!.line).toBeCloseTo(1.1085, 6);
  });
  it("shows the sell limit at the breakout level after the break", () => {
    const st = run(upTo(s2, "1:14:45"), qcfg()).live!.setups.find((x) => x.tf === "h4" && x.dir === -1 && x.age === 0)!;
    expect(st.stage).toBe("limit");
    expect(st.order!.level).toBeCloseTo(1.107, 6);
    expect(st.order!.stop).toBeCloseTo(1.1111, 6);
    expect(st.order!.target).toBeCloseTo(1.1, 6);
    expect(st.m1!.qm).toMatchObject({ broke: true });
  });
});

describe("the weekly structure leading", () => {
  it("needs the weekly the trade's way, and the daily not the other way", () => {
    expect(structureAllows("weeklyLead", -1, -1, 0)).toBe(true);
    expect(structureAllows("weeklyLead", -1, -1, -1)).toBe(true);
    expect(structureAllows("weeklyLead", -1, -1, 1)).toBe(false);
    expect(structureAllows("weeklyLead", -1, 0, -1)).toBe(false);
  });
});

describe("structure and key levels read on years of daily candles", () => {
  // 40 weeks of daily candles falling in waves (lower highs and lower lows), then 3 days of 15-minute candles
  const DAY = 86400;
  const start = MON - 40 * 7 * DAY; // a Monday
  const daily = { t: [] as number[], o: [] as number[], h: [] as number[], l: [] as number[], c: [] as number[] };
  for (let d = 0; d < 40 * 7; d++) {
    const wd = (d % 7); // 0 = Monday
    if (wd >= 5) continue; // weekends closed
    const wave = Math.sin(d / 11) * 0.01; // a swing about every 10 weeks
    const base = 1.2 - d * 0.0004 + wave;
    daily.t.push(start + d * DAY); daily.o.push(base); daily.h.push(base + 0.003); daily.l.push(base - 0.003); daily.c.push(base - 0.0005);
  }
  const dailySeries = { n: daily.t.length, ...daily };
  const s = make({}, 3);
  const c = cfg({ weekendClosed: true });
  it("puts the daily candles before the loaded days, and the weeks the same way", () => {
    const cal = buildCalendar(s, c);
    const h = buildHistory(cal, dailySeries, c, 900);
    expect(h.dOff).toBe(200); // 40 weeks of 5 days
    expect(h.days.length).toBe(200 + cal.days.length);
    expect(h.days[h.dOff]).toBe(cal.days[0]);
    expect(h.weeks.length).toBe(40 + cal.weeks.length);
    expect(h.days[0].tEnd + 900).toBe(start + DAY); // a daily candle closes at the end of its day
  });
  it("reads the weekly and daily structure from them, not just the loaded days", () => {
    const withHistory = swingsOf(prepare(s, c, null, dailySeries));
    expect(withHistory.weeklyBefore(0)).toBe(-1);
    expect(withHistory.dailyBefore(0)).toBe(-1);
    const without = swingsOf(prepare(s, c));
    expect(without.weeklyBefore(0)).toBe(0);
  });
  it("finds daily and weekly key levels in them", () => {
    const kb = keyBook(prepare(s, c, null, dailySeries));
    expect(kb.byTf.d1.bars.length).toBeGreaterThan(200);
    expect(kb.byTf.d1.resistance.some((z) => z.knownAt < MON)).toBe(true);
    expect(kb.byTf.w1.resistance.length + kb.byTf.w1.support.length).toBeGreaterThan(0);
  });
  it("ignores them on 5pm New York days", () => {
    const cal = buildCalendar(s, { dayStart: "nyClose", weekendClosed: true });
    expect(buildHistory(cal, dailySeries, { dayStart: "nyClose", weekendClosed: true }, 900).dOff).toBe(0);
  });
});

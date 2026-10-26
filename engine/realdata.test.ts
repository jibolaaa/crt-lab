// Checks on 8 years of real EURUSD candles (2014 to 2021).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, prepare, runBacktest, seriesFromBuffer, type Config, type Series, type Trade } from "./index";
import { gradeAtLeast } from "./backtest";

const buf = readFileSync(new URL("../public/data/eurusd-15m.bin", import.meta.url));
const full = seriesFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

/** The first n candles only, as if the data stopped there. */
const cut = (s: Series, n: number): Series => ({
  n,
  t: (s.t as Uint32Array).subarray(0, n),
  o: (s.o as Float32Array).subarray(0, n),
  h: (s.h as Float32Array).subarray(0, n),
  l: (s.l as Float32Array).subarray(0, n),
  c: (s.c as Float32Array).subarray(0, n)
});

function indexOf(s: Series, t: number) {
  let lo = 0, hi = s.n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s.t[mid] === t) return mid;
    if (s.t[mid] < t) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

const CLASSIC: Partial<Config> = { requireKeyLevel: false, stop: "sweep", stopBuffer: 0, partialAtTp1: true, minR: 0, fullR: 0, maxR: 1000, maxPerDay: 0 };

const CONFIGS: [string, Partial<Config>][] = [
  ["default", {}],
  ["default, 1 trade a day, any grade", { maxPerDay: 1, lowRGrade: "any" }],
  ["first version's rules", CLASSIC],
  ["no bias, no zone", { bias: "off", zone: "off" }],
  ["gap only, next day", { ...CLASSIC, bias: "weeklyCrt", zone: "fvg", timing: "nextDay" }],
  ["order block, same day", { ...CLASSIC, bias: "structure", zone: "ob", timing: "sameDay", partialAtTp1: false }],
  ["pullback stop, London and New York", { ...CLASSIC, stop: "pullback", sessions: ["london", "newyork"], timeStop: false }],
  ["no bias, daily key levels only", { bias: "off", keyLevelTfs: ["d1"], partialAtTp1: true }]
];

const entryFields = (x: Trade) => ({
  dir: x.dir, entryT: x.entryT, entry: x.entry, stop: x.stop, tp1: x.tp1, tp2: x.tp2, partial: x.partial,
  sweepT: x.sweepT, sweepPrice: x.sweepPrice, mssLevel: x.mssLevel, mssT: x.mssT, plannedR: x.plannedR,
  touchT: x.touchT, zone: x.zone, bias: x.bias, sameDay: x.sameDay,
  keyLevel: x.keyLevel, conf: x.conf, score: x.score, grade: x.grade
});

describe.each(CONFIGS)("real EURUSD, %s", (_name, over) => {
  const cfg: Config = { ...DEFAULT_CONFIG, ...over };
  const res = runBacktest(prepare(full, cfg), cfg);

  it("finds trades", () => expect(res.trades.length).toBeGreaterThan(5));

  it("would have taken every trade with the data cut off at the entry candle", () => {
    const pick = res.trades.filter((_, i) => i % Math.ceil(res.trades.length / 15) === 0);
    for (const tr of pick) {
      const i = indexOf(full, tr.entryT - 900);
      expect(i).toBeGreaterThan(0);
      const part = cut(full, i + 1);
      const again = runBacktest(prepare(part, cfg), cfg).trades.find((x) => x.entryT === tr.entryT && x.dir === tr.dir);
      expect(again, `trade ${tr.id}`).toBeDefined();
      expect(entryFields(again!)).toEqual(entryFields(tr));
    }
  }, 120_000);

  it("keeps every trade's prices and times in order", () => {
    for (const tr of res.trades) {
      const d = tr.dir;
      expect(d * (tr.entry - tr.stop), `risk ${tr.id}`).toBeGreaterThan(0);
      expect(d * (tr.tp1 - tr.entry), `tp1 ${tr.id}`).toBeGreaterThan(0);
      expect(d * (tr.tp2 - tr.entry), `tp2 ${tr.id}`).toBeGreaterThan(0);
      expect(tr.plannedR).toBeGreaterThanOrEqual(cfg.minR - 1e-9);
      expect(tr.plannedR).toBeLessThanOrEqual(cfg.maxR + 1e-9);
      if (tr.plannedR < cfg.fullR - 1e-9) expect(gradeAtLeast(tr.grade, cfg.lowRGrade)).toBe(true);
      if (cfg.requireKeyLevel) expect(tr.keyLevel).not.toBeNull();
      expect(tr.sweepDayT).toBeLessThanOrEqual(tr.sweepT);
      expect(tr.sweepT).toBeLessThan(tr.entryT);
      expect(tr.mssT).toBeLessThan(tr.entryT);
      expect(tr.exitT).toBeGreaterThanOrEqual(tr.entryT);
      if (tr.zone) expect(tr.zone.t).toBeLessThan(tr.entryT);
      if (tr.reason === "stop") expect(tr.r).toBeLessThanOrEqual(-0.999);
      if (tr.reason === "tp2" || tr.reason === "breakeven") expect(tr.r).toBeGreaterThan(0);
      expect(tr.r).toBeGreaterThan(-4);
      // the entry is the close of the candle that broke structure (plus spread on buys)
      const i = indexOf(full, tr.entryT - 900);
      expect(tr.entry).toBeCloseTo(full.c[i] + (d === 1 ? cfg.spread : 0), 7);
      expect(d * (full.c[i] - tr.mssLevel)).toBeGreaterThan(0);
    }
  });

  it("keeps to the most trades a day", () => {
    if (!cfg.maxPerDay) return;
    const perDay = new Map<number, number>();
    for (const tr of res.trades) {
      const day = Math.floor((tr.entryT - 900) / 86400);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(cfg.maxPerDay);
  });

  it("adds up", () => {
    const f = res.funnel;
    expect(f.entries).toBe(res.trades.length);
    expect(res.seen.trades + res.unseen.trades).toBe(res.trades.length);
    expect(res.seen.totalR + res.unseen.totalR).toBeCloseTo(res.all.totalR, 6);
    if (cfg.requireKeyLevel) expect(f.keyLevels).toBeLessThanOrEqual(f.sweeps);
    if (cfg.zone !== "off") {
      expect(f.zones).toBeLessThanOrEqual(cfg.requireKeyLevel ? f.keyLevels : f.sweeps);
      expect(f.touches).toBeLessThanOrEqual(f.zones);
      expect(f.entries + f.skippedNews + f.skippedSession + f.skippedPastMid + f.skippedLowR + f.skippedDailyCap).toBeLessThanOrEqual(f.touches);
    }
  });
});

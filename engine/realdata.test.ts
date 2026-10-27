// Checks on 8 years of real EURUSD candles (2014 to 2021).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, prepare, runBacktest, seriesFromBuffer, type Config, type Series, type Trade } from "./index";

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

/** Index of the last 15-minute candle that starts before t. */
function lastBefore(s: Series, t: number) {
  let lo = 0, hi = s.n - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s.t[mid] < t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

// The first version's rules, spelled out
const CLASSIC: Partial<Config> = {
  crt: ["day"], entry: "shift", timing: "either", entryWindow: 1, deeperSweeps: false, midCancels: true, freshFrom: "candle2",
  keyLevelKinds: ["ob", "breaker", "fvg"], zone: "obFvg", zoneInKiller: false, bias: "majority",
  requireKeyLevel: false, stop: "sweep", stopBuffer: 0, partialAtTp1: true, minR: 0, fullR: 0, lowRPct: 0, maxR: 1000, maxPerDay: 0
};

const CONFIGS: [string, Partial<Config>][] = [
  ["today's rules", {}],
  ["retest entry", { entry: "retest" }],
  ["QM entry", { entry: "qm" }],
  ["daily CRTs only", { crt: ["day"] }],
  ["weekly CRTs only", { crt: ["week"] }],
  ["1 trade a day, 2R to 3R needs 75%", { maxPerDay: 1, lowRPct: 75 }],
  ["no key level, candle 2 or 3", { requireKeyLevel: false, timing: "either" }],
  ["6R cap, stop beyond the sweep, weekly structure as a gate", { maxR: 6, stop: "sweep", bias: "structure" }],
  ["first version's rules", CLASSIC],
  ["gap only, next day", { ...CLASSIC, bias: "weeklyCrt", zone: "fvg", timing: "nextDay" }],
  ["pullback stop, London and New York", { ...CLASSIC, stop: "pullback", sessions: ["london", "newyork"], timeStop: false }]
];

const entryFields = (x: Trade) => ({
  dir: x.dir, tf: x.tf, model: x.model, entryT: x.entryT, entry: x.entry, stop: x.stop, tp1: x.tp1, tp2: x.tp2, partial: x.partial,
  sweepT: x.sweepT, sweepPrice: x.sweepPrice, mssLevel: x.mssLevel, mssT: x.mssT, qm: x.qm, retest: x.retest, plannedR: x.plannedR,
  touchT: x.touchT, zone: x.zone, bias: x.bias, sameDay: x.sameDay, entryCandle: x.entryCandle,
  keyLevel: x.keyLevel, conf: x.conf, points: x.points, maxPoints: x.maxPoints, pct: x.pct
});

describe.each(CONFIGS)("real EURUSD, %s", (_name, over) => {
  const cfg: Config = { ...DEFAULT_CONFIG, ...over };
  const res = runBacktest(prepare(full, cfg), cfg);

  it("finds trades", () => expect(res.trades.length).toBeGreaterThan(3));

  it("would have taken every trade with the data cut off at the entry candle", () => {
    const pick = res.trades.filter((_, i) => i % Math.ceil(res.trades.length / 15) === 0);
    for (const tr of pick) {
      const i = lastBefore(full, tr.entryT);
      expect(i).toBeGreaterThan(0);
      const part = cut(full, i + 1);
      const again = runBacktest(prepare(part, cfg), cfg).trades.find((x) => x.entryT === tr.entryT && x.dir === tr.dir && x.tf === tr.tf);
      expect(again, `trade ${tr.id}`).toBeDefined();
      expect(entryFields(again!)).toEqual(entryFields(tr));
    }
  }, 180_000);

  it("keeps every trade's prices and times in order", () => {
    for (const tr of res.trades) {
      const d = tr.dir;
      expect(cfg.crt).toContain(tr.tf);
      expect(tr.model).toBe(cfg.entry);
      expect(d * (tr.entry - tr.stop), `risk ${tr.id}`).toBeGreaterThan(0);
      expect(d * (tr.tp1 - tr.entry), `tp1 ${tr.id}`).toBeGreaterThan(0);
      expect(d * (tr.tp2 - tr.entry), `tp2 ${tr.id}`).toBeGreaterThan(0);
      expect(tr.plannedR).toBeGreaterThanOrEqual(cfg.minR - 1e-9);
      expect(tr.plannedR).toBeLessThanOrEqual(cfg.maxR + 1e-9);
      if (tr.plannedR < cfg.fullR - 1e-9) expect(tr.pct).toBeGreaterThanOrEqual(cfg.lowRPct - 1e-9);
      expect(tr.pct).toBeCloseTo((tr.points / tr.maxPoints) * 100, 9);
      if (cfg.requireKeyLevel) expect(tr.keyLevel).not.toBeNull();
      if (cfg.timing === "nextDay") expect(tr.entryCandle).toBeGreaterThanOrEqual(3);
      expect(tr.entryCandle).toBeLessThanOrEqual(2 + cfg.entryWindow);
      expect(tr.sweepDayT).toBeLessThanOrEqual(tr.sweepT);
      expect(tr.sweepT).toBeLessThan(tr.entryT);
      expect(tr.mssT).toBeLessThanOrEqual(tr.entryT);
      expect(tr.exitT).toBeGreaterThanOrEqual(tr.entryT);
      if (tr.zone) expect(tr.zone.t).toBeLessThan(tr.entryT);
      if (tr.reason === "stop") expect(tr.r).toBeLessThanOrEqual(-0.999);
      if (tr.reason === "tp2" || tr.reason === "breakeven") expect(tr.r).toBeGreaterThan(0);
      const i = lastBefore(full, tr.entryT);
      if (cfg.zoneInKiller && tr.zone) expect(d * (tr.bodyEdge - (d === 1 ? tr.zone.top : tr.zone.bottom))).toBeGreaterThanOrEqual(-1e-9);
      if (tr.model === "shift") {
        // the entry is the close of the candle that broke structure (plus spread on buys)
        expect(tr.entry).toBeCloseTo(full.c[i] + (d === 1 ? cfg.spread : 0), 7);
        expect(d * (full.c[i] - tr.mssLevel)).toBeGreaterThan(0);
      } else if (tr.model === "retest") {
        // a limit at the order block the BOS left, or better if price jumped past it
        expect(tr.retest).not.toBeNull();
        expect(d * (tr.retest!.level - tr.entry)).toBeGreaterThanOrEqual(-1e-9);
        expect(tr.retest!.bosT).toBeLessThan(tr.entryT);
      } else {
        // a limit at the QM line, or better if price jumped past it
        expect(tr.qm).not.toBeNull();
        expect(d * (tr.qm!.level - tr.entry)).toBeGreaterThanOrEqual(-1e-9);
        expect(d * (tr.qm!.head - tr.qm!.level)).toBeLessThan(0); // the top is beyond the line
        expect(tr.qm!.smsT).toBeLessThan(tr.entryT);
        // the QM line sits in the killer zone
        expect(d * (tr.bodyEdge - tr.qm!.level)).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it("is never in two trades the same way on the same CRT at once", () => {
    for (const tf of cfg.crt) for (const dir of [1, -1]) {
      const list = res.trades.filter((x) => x.tf === tf && x.dir === dir).sort((a, b) => a.entryT - b.entryT);
      for (let k = 1; k < list.length; k++) expect(list[k].entryT, `trade ${list[k].id}`).toBeGreaterThanOrEqual(list[k - 1].exitT);
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
    if (cfg.requireKeyLevel) {
      expect(f.keyLevels).toBeLessThanOrEqual(f.sweeps);
      expect(f.closedInside).toBeLessThanOrEqual(f.keyLevels);
    }
    if (cfg.entry === "qm" || cfg.zone !== "off") {
      expect(f.touches).toBeLessThanOrEqual(f.zones);
      if (cfg.timing === "nextDay") expect(f.zones).toBeLessThanOrEqual(f.closedInside);
      const after = f.entries + f.skippedNews + f.skippedSession + f.skippedPastMid + f.skippedLowR + f.skippedDailyCap + f.skippedOverlap;
      expect(after).toBeLessThanOrEqual(f.touches);
    }
  });
});

import { describe, expect, it } from "vitest";
import { prepare, runBacktest } from "./backtest";
import { CLASSIC_CONFIG, type Config, type Series } from "./types";

// Same building blocks as backtest.test.ts: days of 15-minute candles from
// Mon 8 Jan 2024, flat unless listed as "day:HH:MM" -> [open, high, low, close].
const MON = Date.UTC(2024, 0, 8) / 1000;
type OHLC = [number, number, number, number];
function make(at: Record<string, OHLC>, days = 3): Series {
  const s = { t: [] as number[], o: [] as number[], h: [] as number[], l: [] as number[], c: [] as number[] };
  let last = at["0:00:00"]?.[0] ?? 1.105;
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
/** The prices as they stood once the candle at "day:HH:MM" had closed. */
function upTo(s: Series, key: string): Series {
  const [d, hh, mm] = key.split(":").map(Number);
  const n = d * 96 + hh * 4 + mm / 15 + 1;
  const sl = (a: ArrayLike<number>) => Array.from(a).slice(0, n);
  return { n, t: sl(s.t), o: sl(s.o), h: sl(s.h), l: sl(s.l), c: sl(s.c) };
}
const CLASSIC: Partial<Config> = {
  crt: ["day"], entry: "shift", timing: "either", entryWindow: 1, deeperSweeps: false, midCancels: true,
  freshFrom: "candle2", keyLevelKinds: ["ob", "breaker", "fvg"], zone: "obFvg", zoneInKiller: false,
  bias: "off", newsGuard: false, requireKeyLevel: false, stop: "sweep", stopBuffer: 0,
  partialAtTp1: true, minR: 0, fullR: 0, lowRPct: 0, maxR: 1000, maxPerDay: 0, timeStop: true, minPct: 0
};
const cfg = (over: Partial<Config> = {}): Config => ({ ...CLASSIC_CONFIG, ...CLASSIC, ...over });
const live = (s: Series, c: Config) => runBacktest(prepare(s, c), c).live!;
const buy = (l: ReturnType<typeof live>) => l.setups.find((x) => x.dir === 1 && !x.fromYesterday);

const rangeDay: Record<string, OHLC> = {
  "0:00:00": [1.105, 1.105, 1.105, 1.105],
  "0:03:00": [1.105, 1.11, 1.105, 1.105],
  "0:15:00": [1.105, 1.105, 1.1, 1.105]
};
const simpleBuy: Record<string, OHLC> = {
  ...rangeDay,
  "1:00:00": [1.104, 1.104, 1.104, 1.104],
  "1:06:00": [1.104, 1.1045, 1.104, 1.104],
  "1:06:15": [1.104, 1.104, 1.103, 1.103],
  "1:08:00": [1.103, 1.103, 1.098, 1.099],
  "1:08:15": [1.099, 1.1, 1.0985, 1.0998],
  "1:08:30": [1.0998, 1.102, 1.0995, 1.1018],
  "1:08:45": [1.1018, 1.1048, 1.1015, 1.1046],
  "1:09:00": [1.1048, 1.1055, 1.1048, 1.1052],
  "1:12:00": [1.1052, 1.1105, 1.105, 1.11]
};

describe("where today's setup stands", () => {
  const full = make(simpleBuy);
  it("waits for the sweep before it happens", () => {
    const l = live(upTo(full, "1:07:45"), cfg({ zone: "off" }));
    expect(l.dayStart).toBe(MON + 86400);
    expect(l.date).toBe(MON + 86400);
    expect(buy(l)).toMatchObject({ stage: "waiting", rangeLow: 1.1, rangeHigh: 1.11, mid: 1.105, rangeDate: MON, sweepDate: MON + 86400 });
  });
  it("names the level a 15-minute close has to break after the sweep", () => {
    const l = live(upTo(full, "1:08:15"), cfg({ zone: "off" }));
    expect(buy(l)).toMatchObject({ stage: "touched", sweepPrice: 1.098, level: 1.1045 });
  });
  it("shows the trade once it's taken", () => {
    const l = live(upTo(full, "1:09:00"), cfg({ zone: "off" }));
    const b = buy(l)!;
    expect(b.stage).toBe("entered");
    expect(b.trade?.entry).toBeCloseTo(1.1047, 6);
    expect(l.asOf).toBe(MON + 86400 + 9 * 3600 + 900);
  });
  it("says why a setup was cancelled", () => {
    const s = make({ ...simpleBuy, "1:08:30": [1.0998, 1.1052, 1.0995, 1.1018] });
    expect(buy(live(upTo(s, "1:08:30"), cfg({ zone: "off" })))).toMatchObject({ stage: "ended", why: "mid" });
  });
  it("shows a direction the weekly bias rules out", () => {
    const l = live(upTo(full, "1:07:45"), cfg({ zone: "off", bias: "majority" })); // no finished weeks yet, so no bias
    expect(l.bias).toBe(0);
    expect(l.setups.map((x) => x.stage)).toEqual(["blocked", "blocked"]);
  });
});

describe("the 1-hour zone stages", () => {
  const zoneBuy: Record<string, OHLC> = {
    ...rangeDay,
    "1:00:00": [1.103, 1.103, 1.103, 1.103],
    "1:08:00": [1.103, 1.103, 1.098, 1.099],
    "1:09:00": [1.099, 1.1005, 1.099, 1.1005],
    "1:09:15": [1.1005, 1.102, 1.1005, 1.102],
    "1:10:00": [1.1035, 1.1042, 1.1035, 1.104],
    "1:11:00": [1.104, 1.104, 1.1032, 1.1033],
    "1:11:15": [1.1033, 1.1046, 1.1033, 1.1045],
    "1:12:00": [1.1047, 1.1101, 1.1047, 1.11]
  };
  const full = make(zoneBuy);
  it("waits for a zone after the sweep", () => expect(buy(live(upTo(full, "1:09:45"), cfg()))?.stage).toBe("key"));
  it("waits for the retest once the zone is ready", () => {
    const b = buy(live(upTo(full, "1:10:45"), cfg()))!;
    expect(b.stage).toBe("zone");
    expect(b.zone?.top).toBeCloseTo(1.1035, 6);
  });
  it("waits for the shift once price is back in the zone", () => {
    expect(buy(live(upTo(full, "1:11:00"), cfg()))).toMatchObject({ stage: "touched", level: 1.1042 });
  });
  it("says when the sweep didn't reach a key level", () => {
    expect(buy(live(upTo(full, "1:09:45"), cfg({ requireKeyLevel: true })))?.stage).toBe("noKey");
  });
});

describe("a sweep from yesterday", () => {
  const noShift = make({
    ...simpleBuy,
    "1:08:45": [1.1018, 1.103, 1.1015, 1.1025],
    "1:09:00": [1.1025, 1.1028, 1.102, 1.1025],
    "1:12:00": [1.1025, 1.1025, 1.1025, 1.1025]
  });
  it("is still shown while it can enter today", () => {
    const l = live(upTo(noShift, "2:03:00"), cfg({ zone: "off" }));
    expect(l.setups.find((x) => x.fromYesterday && x.dir === 1)).toMatchObject({ stage: "touched", level: 1.1045, rangeDate: MON, sweepDate: MON + 86400 });
  });
  it("is dropped once it can't reach a key level any more", () => {
    const l = live(upTo(noShift, "2:03:00"), cfg({ zone: "off", requireKeyLevel: true }));
    expect(l.setups.filter((x) => x.fromYesterday)).toEqual([]);
  });
  it("keeps showing its trade while it runs", () => {
    const s = make({ ...simpleBuy, "1:12:00": [1.1052, 1.1052, 1.1052, 1.1052] });
    const l = live(upTo(s, "2:03:00"), cfg({ zone: "off" }));
    const y = l.setups.find((x) => x.fromYesterday && x.dir === 1)!;
    expect(y.stage).toBe("entered");
    expect(y.trade?.entry).toBeCloseTo(1.1047, 6);
    expect(y.trade?.reason).toBe("end"); // still open at the last candle
  });
  it("is not shown once its trade has closed", () => {
    const l = live(upTo(make(simpleBuy), "2:03:00"), cfg({ zone: "off" }));
    expect(l.setups.filter((x) => x.fromYesterday)).toEqual([]);
  });
});

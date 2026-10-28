import { describe, expect, it } from "vitest";
import { prepare, runBacktest } from "./backtest";
import { CONFLUENCES, DEFAULT_CONFIG, type Config, type Series } from "./types";

// Days of 15-minute candles from Mon 8 Jan 2024 (UTC), flat at the previous
// close unless listed as "day:HH:MM" -> [open, high, low, close].
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
/** Move a pattern later by whole days. */
const later = (rec: Record<string, OHLC>, days: number) =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => { const [d, ...rest] = k.split(":"); return [[Number(d) + days, ...rest].join(":"), v]; }));
const iso = (t: number) => new Date(t * 1000).toISOString();

// Today's rules, without the key level, the news rest or the R percent, so each test can switch one on.
const NEW: Partial<Config> = { crt: ["day"], entry: "qm", requireKeyLevel: false, newsGuard: false, maxPerDay: 0, lowRPct: 0, stopBuffer: 0, spread: 0.0001, weekendClosed: false, timeStop: true, minPct: 0, partialAtTp1: false, timing: "nextDay" };
const cfg = (over: Partial<Config> = {}): Config => ({ ...DEFAULT_CONFIG, ...NEW, ...over });
const run = (s: Series, c: Config, partner: Series | null = null) => runBacktest(prepare(s, c, partner), c);
const live = (s: Series, c: Config) => runBacktest(prepare(s, c), c).live!;

// Candle 1 (day 0): open 1.1050, high 1.1100, low 1.1000, close 1.1080, so the killer zone for sells starts at 1.1080.
// Candle 2 (day 1): a high at 1.1090 at 06:00 (the shoulder), a dip to 1.1070, the A-shape top at 1.1120 at 08:00
// (the sweep), then 09:00 closes below 1.1070 (the shift). The day closes back inside at 1.1065.
// Candle 3 (day 2): back up to 1.1090 at 03:00, then down to candle 1's low at 06:00.
const qmSell: Record<string, OHLC> = {
  "0:00:00": [1.105, 1.105, 1.105, 1.105],
  "0:03:00": [1.105, 1.11, 1.105, 1.105],
  "0:15:00": [1.105, 1.105, 1.1, 1.105],
  "0:20:00": [1.105, 1.108, 1.105, 1.108],
  "1:06:00": [1.108, 1.109, 1.108, 1.1085],
  "1:06:15": [1.1085, 1.1085, 1.1076, 1.1076],
  "1:07:00": [1.1076, 1.1076, 1.107, 1.1072],
  "1:07:15": [1.1072, 1.1078, 1.1072, 1.1078],
  "1:07:30": [1.1078, 1.1079, 1.1076, 1.1079],
  "1:08:00": [1.1079, 1.112, 1.1079, 1.111],
  "1:08:15": [1.111, 1.1112, 1.1105, 1.1105],
  "1:08:30": [1.1105, 1.1108, 1.1102, 1.1102],
  "1:08:45": [1.1102, 1.1104, 1.11, 1.11],
  "1:09:00": [1.11, 1.11, 1.106, 1.1065],
  "2:03:00": [1.1065, 1.1092, 1.1065, 1.1088],
  "2:06:00": [1.1088, 1.1088, 1.0995, 1.1]
};
const DAY2 = MON + 2 * 86400;

describe("a QM sell on a daily CRT", () => {
  const res = run(make(qmSell), cfg());
  const tr = res.trades[0];
  it("takes one trade, in candle 3", () => {
    expect(res.trades.length).toBe(1);
    expect(tr).toMatchObject({ dir: -1, tf: "day", model: "qm", entryCandle: 3, sameDay: false });
    expect(iso(tr.entryT)).toBe(iso(DAY2 + 3 * 3600 + 900));
  });
  it("sells at the QM line, the shoulder before the A-shape top", () => {
    expect(tr.entry).toBeCloseTo(1.109, 6);
    expect(tr.qm).toMatchObject({ level: 1.109, head: 1.112, smsLevel: 1.107 });
    expect(iso(tr.qm!.smsT)).toBe(iso(MON + 86400 + 9 * 3600 + 900));
  });
  it("puts the stop past the 1-hour order block and targets candle 1's low", () => {
    expect(tr.stop).toBeCloseTo(1.112 + 0.0001, 6); // the 08:00 hour closed up: its high, plus the spread
    expect(tr.tp2).toBeCloseTo(1.1, 6);
    expect(tr.plannedR).toBeCloseTo((1.109 - 1.1) / (1.1121 - 1.109), 6);
    expect(tr.reason).toBe("tp2");
    expect(tr.r).toBeCloseTo(tr.plannedR, 6);
  });
  it("scores the checklist out of 17 with no partner market for SMT", () => {
    expect(tr.conf.smt).toBeNull();
    expect(tr.maxPoints).toBe(17);
    expect(tr.pct).toBeCloseTo((tr.points / 17) * 100, 6);
  });
  it("counts the steps", () => {
    // day 2's own setups are still on their candle 2, so only day 1's sell has closed back inside
    expect(res.funnel).toMatchObject({ closedInside: 1, zones: 1, touches: 1, entries: 1 });
  });
});

describe("when the QM entry is allowed", () => {
  // price comes back to the line later on candle 2 as well
  const back = make({ ...qmSell, "1:12:00": [1.1065, 1.1092, 1.1065, 1.1065] });
  it("waits for candle 3 by default", () => {
    expect(iso(run(back, cfg()).trades[0].entryT)).toBe(iso(DAY2 + 3 * 3600 + 900));
  });
  it("can fill on candle 2 too", () => {
    const tr = run(back, cfg({ timing: "either" })).trades[0];
    expect(iso(tr.entryT)).toBe(iso(MON + 86400 + 12 * 3600 + 900));
    expect(tr.entryCandle).toBe(2);
  });
  it("takes nothing if candle 2 closes outside the range", () => {
    const s = make({ ...qmSell, "1:23:45": [1.1065, 1.1105, 1.1065, 1.1102] });
    expect(run(s, cfg()).trades.length).toBe(0);
  });
  it("takes nothing once price has reached the target first", () => {
    const s = make({ ...qmSell, "1:12:00": [1.1065, 1.1065, 1.0995, 1.1065] });
    expect(run(s, cfg()).trades.length).toBe(0);
  });
  it("keeps the setup past the 50% level unless asked not to", () => {
    const s = make({ ...qmSell, "1:12:00": [1.1065, 1.1065, 1.104, 1.1065] });
    expect(run(s, cfg()).trades.length).toBe(1);
    expect(run(s, cfg({ midCancels: true })).trades.length).toBe(0);
  });
});

describe("a deeper sweep after candle 2", () => {
  const s = make({ ...qmSell, "2:02:00": [1.1065, 1.113, 1.1065, 1.1066] });
  it("cancels the waiting limit but keeps the setup", () => {
    expect(run(s, cfg()).trades.length).toBe(0);
    const sell = live(upTo(s, "2:02:30"), cfg()).setups.find((x) => x.dir === -1 && x.fromYesterday);
    expect(sell).toMatchObject({ stage: "armed", sweepPrice: 1.113 });
  });
  it("ends it when deeper sweeps aren't allowed", () => {
    expect(live(upTo(s, "2:02:30"), cfg({ deeperSweeps: false })).setups.filter((x) => x.dir === -1 && x.fromYesterday)).toEqual([]);
  });
});

describe("the live view for QM", () => {
  it("shows the A-shape top waiting for its shift", () => {
    const sell = live(upTo(make(qmSell), "1:08:45"), cfg()).setups.find((x) => x.dir === -1);
    expect(sell).toMatchObject({ stage: "swept", pending: { head: 1.112, sms: 1.107, qm: 1.109 } });
  });
  it("shows the limit with its stop, target and percent once the shift is in", () => {
    const sell = live(upTo(make(qmSell), "1:23:45"), cfg()).setups.find((x) => x.dir === -1);
    expect(sell?.stage).toBe("limit");
    expect(sell?.order?.level).toBeCloseTo(1.109, 6);
    expect(sell?.order?.stop).toBeCloseTo(1.1121, 6);
    expect(sell?.order?.target).toBeCloseTo(1.1, 6);
    expect(sell?.order?.r).toBeCloseTo(0.009 / 0.0031, 6);
    expect(sell?.call?.maxPoints).toBe(17);
  });
  it("keeps showing the limit on candle 3", () => {
    const sell = live(upTo(make(qmSell), "2:02:45"), cfg()).setups.find((x) => x.dir === -1 && x.fromYesterday);
    expect(sell).toMatchObject({ stage: "limit", age: 1 });
  });
});

describe("SMT with a partner market", () => {
  const s = make(qmSell);
  // the partner stays under its own candle 1 high while this market sweeps
  const held = make({
    ...qmSell,
    "1:08:00": [1.1079, 1.1095, 1.1079, 1.109], "1:08:15": [1.109, 1.1095, 1.109, 1.109],
    "1:08:30": [1.109, 1.1092, 1.109, 1.109], "1:08:45": [1.109, 1.1092, 1.109, 1.109]
  });
  it("is met when the partner didn't sweep", () => {
    const tr = run(s, cfg(), held).trades[0];
    expect(tr.conf.smt).toBe(true);
    expect(tr.maxPoints).toBe(18);
  });
  it("is not met when the partner swept too", () => expect(run(s, cfg(), make(qmSell)).trades[0].conf.smt).toBe(false));
});

describe("key levels for the QM sell", () => {
  // five days that leave a daily swing high at 1.1095 (day 2), then the sell five days later:
  // candle 1 (day 5) trades through the old high, candle 2 (day 6) sweeps, candle 3 (day 7) enters
  const s = make({
    "0:00:00": [1.104, 1.104, 1.104, 1.104],
    "1:12:00": [1.104, 1.106, 1.103, 1.105],
    "2:12:00": [1.105, 1.1095, 1.105, 1.106],
    "3:12:00": [1.106, 1.107, 1.104, 1.105],
    "4:12:00": [1.105, 1.106, 1.103, 1.105],
    ...later(qmSell, 5)
  }, 8);
  const keyCfg = (over: Partial<Config> = {}) => cfg({ requireKeyLevel: true, keyLevelTfs: ["d1"], keyLevelKinds: ["old"], ...over });
  it("finds the old high that candle 1 purged", () => {
    const tr = run(s, keyCfg()).trades[0];
    expect(tr?.keyLevel).toMatchObject({ tf: "d1", kind: "old", top: 1.1095 });
    expect(tr.conf.strongKey).toBe(true);
  });
  it("doesn't count it when only candle 2 may touch the level", () => {
    expect(run(s, keyCfg({ freshFrom: "candle2" })).trades.length).toBe(0);
  });
});

// The same sell a week at a time: week 0 is candle 1, week 1 sweeps it with the daily pattern on
// 15-minute candles (day 8), week 2 comes back to the QM line (day 15).
const wkSell: Record<string, OHLC> = {
  "0:00:00": [1.105, 1.105, 1.105, 1.105],
  "1:03:00": [1.105, 1.11, 1.105, 1.105],
  "2:03:00": [1.105, 1.105, 1.1, 1.105],
  "6:20:00": [1.105, 1.108, 1.105, 1.108],
  ...later(Object.fromEntries(Object.entries(qmSell).filter(([key]) => key.startsWith("1:"))), 7),
  "15:03:00": [1.1065, 1.1092, 1.1065, 1.1088],
  "15:06:00": [1.1088, 1.1088, 1.0995, 1.1]
};

describe("a QM sell on a weekly CRT", () => {
  const res = run(make(wkSell, 21), cfg({ crt: ["week"] }));
  const tr = res.trades[0];
  it("enters in week 3 on the 15-minute chart", () => {
    expect(res.trades.length).toBe(1);
    expect(tr).toMatchObject({ tf: "week", model: "qm", entryCandle: 3 });
    expect(iso(tr.entryT)).toBe(iso(MON + 15 * 86400 + 3 * 3600 + 900));
    expect(iso(tr.rangeDayT)).toBe(iso(MON));
  });
  it("puts the stop past the top when no 4-hour candle closed up there, and targets candle 1's low", () => {
    expect(tr.entry).toBeCloseTo(1.109, 6);
    expect(tr.stop).toBeCloseTo(1.1121, 6);
    expect(tr.tp2).toBeCloseTo(1.1, 6);
    expect(tr.reason).toBe("tp2");
  });
  it("leaves the weekly CRT check out, since it is the setup", () => {
    expect(tr.conf.weeklyCrt).toBeNull();
    expect(tr.maxPoints).toBe(15);
  });
  it("shows up next to daily CRTs when both are on", () => {
    expect(run(make(wkSell, 21), cfg({ crt: ["day", "week"] })).trades.some((x) => x.tf === "week")).toBe(true);
  });
});

// ---------------- BOS entries on 5-minute candles ----------------

function make5(at: Record<string, OHLC>, days = 3): Series {
  const s = { t: [] as number[], o: [] as number[], h: [] as number[], l: [] as number[], c: [] as number[] };
  let last = at["0:00:00"]?.[0] ?? 1.1;
  for (let d = 0; d < days; d++) {
    for (let q = 0; q < 288; q++) {
      const hh = String(Math.floor(q / 12)).padStart(2, "0"), mm = String((q % 12) * 5).padStart(2, "0");
      const bar = at[`${d}:${hh}:${mm}`] ?? [last, last, last, last];
      s.t.push(MON + d * 86400 + q * 300);
      s.o.push(bar[0]); s.h.push(bar[1]); s.l.push(bar[2]); s.c.push(bar[3]);
      last = bar[3];
    }
  }
  return { n: s.t.length, ...s };
}

// Candle 1 (day 0): open 1.0950, high 1.1100, low 1.0900, close 1.1080.
// Candle 2 (day 1): the 08:00 hour sweeps to 1.1120 and closes up; the 09:00 hour closes below its low,
// so 08:00 is a 1-hour order block (1.1085 to 1.1120), above candle 1's body: in the killer zone.
// Candle 3 (day 2): a 5-minute low at 1.1070 (02:50), price back in the block at 03:00, a 5-minute close
// below 1.1070 at 03:10 (the BOS), back up to 1.1078 at 03:20, then down to candle 1's low.
const bosSell: Record<string, OHLC> = {
  "0:00:00": [1.095, 1.095, 1.095, 1.095],
  "0:03:00": [1.095, 1.11, 1.095, 1.1],
  "0:06:00": [1.1, 1.1, 1.09, 1.095],
  "0:20:00": [1.095, 1.108, 1.095, 1.108],
  "1:07:00": [1.108, 1.1085, 1.108, 1.1085],
  "1:08:00": [1.1085, 1.112, 1.1085, 1.111],
  "1:09:00": [1.111, 1.111, 1.1074, 1.1075],
  "2:02:50": [1.1075, 1.1075, 1.107, 1.1072],
  "2:02:55": [1.1072, 1.1075, 1.1072, 1.1075],
  "2:03:00": [1.1075, 1.1095, 1.1075, 1.109],
  "2:03:05": [1.109, 1.109, 1.1085, 1.1086],
  "2:03:10": [1.1086, 1.1086, 1.1065, 1.1066],
  "2:03:20": [1.1066, 1.1078, 1.1066, 1.107],
  "2:06:00": [1.107, 1.107, 1.0895, 1.09]
};

describe("a BOS sell on 5-minute candles in a 1-hour zone", () => {
  const s = make5(bosSell);
  const bos = (over: Partial<Config> = {}) => cfg({ entry: "shift", zone: "any", ...over });
  it("reads the candles as 5-minute ones", () => expect(prepare(s, bos()).dt).toBe(300));
  it("enters on the close that breaks the 5-minute low, inside the zone", () => {
    const res = run(s, bos());
    expect(res.trades.length).toBe(1);
    const tr = res.trades[0];
    expect(tr).toMatchObject({ dir: -1, tf: "day", model: "shift", entryCandle: 3 });
    expect(tr.zone).toMatchObject({ top: 1.112, bottom: 1.1085 });
    expect(tr.entry).toBeCloseTo(1.1066, 6);
    expect(iso(tr.entryT)).toBe(iso(DAY2 + 3 * 3600 + 15 * 60));
    expect(tr.mssLevel).toBeCloseTo(1.107, 6);
    expect(tr.stop).toBeCloseTo(1.1121, 6); // past the 1-hour order block, plus the spread
    expect(tr.tp2).toBeCloseTo(1.09, 6);
    expect(tr.reason).toBe("tp2");
  });
  it("with the retest entry, sells back at the order block the BOS left", () => {
    const res = run(s, bos({ entry: "retest" }));
    expect(res.trades.length).toBe(1);
    const tr = res.trades[0];
    expect(tr.model).toBe("retest");
    expect(tr.retest).toMatchObject({ level: 1.1075, top: 1.1095, bottom: 1.1075 });
    expect(tr.entry).toBeCloseTo(1.1075, 6);
    expect(iso(tr.entryT)).toBe(iso(DAY2 + 3 * 3600 + 25 * 60));
    expect(tr.plannedR).toBeCloseTo((1.1075 - 1.09) / (1.1121 - 1.1075), 6);
  });
  it("shows the retest limit while it waits", () => {
    const l = runBacktest(prepare(upTo5(s, "2:03:15"), bos({ entry: "retest" })), bos({ entry: "retest" })).live!;
    const sell = l.setups.find((x) => x.dir === -1 && x.fromYesterday);
    expect(sell?.stage).toBe("limit");
    expect(sell?.order?.level).toBeCloseTo(1.1075, 6);
  });
  it("skips the trade when a must-have check isn't met, or the percent is under the lowest", () => {
    const tr = run(s, bos()).trades[0];
    const unmet = CONFLUENCES.find((k) => tr.conf[k] === false)!;
    const met = CONFLUENCES.find((k) => tr.conf[k] === true);
    const skipped = run(s, bos({ mustHave: [unmet] }));
    expect(skipped.trades.length).toBe(0);
    expect(skipped.funnel.skippedChecks).toBe(1);
    if (met) expect(run(s, bos({ mustHave: [met] })).trades.length).toBe(1);
    expect(run(s, bos({ mustHave: ["smt"] })).trades.length).toBe(1); // no related market: SMT doesn't apply
    expect(run(s, bos({ minPct: tr.pct + 1 })).trades.length).toBe(0);
    expect(run(s, bos({ minPct: tr.pct })).trades.length).toBe(1);
  });
  it("takes only the directions the rules allow", () => {
    expect(run(s, bos({ side: "buys" })).trades.length).toBe(0);
    expect(run(s, bos({ side: "sells" })).trades.length).toBe(1);
    expect(run(s, bos({ side: "auto", driftUp: true })).trades.length).toBe(0); // a market that drifts up: buys only
    expect(run(s, bos({ side: "auto", driftUp: false })).trades.length).toBe(1);
  });
  it("says why sells are off on a market that drifts up", () => {
    const c = bos({ driftUp: true });
    const l = runBacktest(prepare(s, c), c).live!;
    expect(l.setups.find((x) => x.tf === "day" && x.dir === -1 && x.age === 0)).toMatchObject({ stage: "blocked", why: "side" });
  });
  it("needs the zone inside the killer zone", () => {
    // candle 1 closes at 1.1090, so its body top is above the block's bottom
    const high = make5({ ...bosSell, "0:20:00": [1.095, 1.109, 1.095, 1.109] });
    expect(run(high, bos()).trades.length).toBe(0);
    expect(run(high, bos({ zoneInKiller: false })).trades.length).toBe(1);
  });
});

describe("the candle that made the sweep as the order block", () => {
  const sweep = (over: Partial<Config> = {}) => cfg({ entry: "shift", zone: "sweep", ...over });
  const notDay1 = Object.fromEntries(Object.entries(bosSell).filter(([k]) => !k.startsWith("1:")));
  it("takes the 1-hour up candle that made the high, the whole candle, with the stop past the tip", () => {
    const res = run(make5(bosSell), sweep());
    expect(res.trades.length).toBe(1);
    const tr = res.trades[0];
    expect(tr.zone).toMatchObject({ top: 1.112, bottom: 1.1085, tfH: 1, sweep: true });
    expect(iso(tr.zone!.t)).toBe(iso(DAY2 - 86400 + 9 * 3600)); // known once that hour closed
    expect(tr.entry).toBeCloseTo(1.1066, 6);
    expect(tr.stop).toBeCloseTo(1.1121, 6);
  });
  it("goes up to the 2-hour candle when the 1-hour one that made the high closed down", () => {
    const s = make5({
      ...notDay1,
      "1:07:00": [1.108, 1.1085, 1.108, 1.1085],
      "1:08:00": [1.1085, 1.11, 1.1085, 1.11], // up, no sweep yet
      "1:09:00": [1.11, 1.112, 1.1095, 1.1098], // makes the high, closes down a little
      "1:10:00": [1.1098, 1.1098, 1.1074, 1.1075]
    });
    const tr = run(s, sweep()).trades[0];
    expect(tr.zone).toMatchObject({ top: 1.112, bottom: 1.1085, tfH: 2, sweep: true });
    expect(iso(tr.zone!.t)).toBe(iso(DAY2 - 86400 + 10 * 3600)); // the 8:00 to 10:00 candle
    expect(tr.entry).toBeCloseTo(1.1066, 6);
    expect(tr.stop).toBeCloseTo(1.1121, 6);
  });
  it("uses the last up candle before the high when even the 4-hour one closed down, with the stop still past the tip", () => {
    const s = make5({
      ...notDay1,
      "1:06:00": [1.108, 1.1095, 1.108, 1.1095], // up
      "1:07:00": [1.1095, 1.1095, 1.109, 1.1092], // down a little
      "1:08:00": [1.1092, 1.112, 1.107, 1.1072] // makes the high and closes down: 1, 2 and 4 hours all closed down
    });
    const tr = run(s, sweep()).trades[0];
    expect(tr.zone).toMatchObject({ top: 1.1095, bottom: 1.108, tfH: 1, sweep: true });
    expect(iso(tr.zone!.t)).toBe(iso(DAY2 - 86400 + 12 * 3600)); // decided once the 4-hour candle closed
    expect(tr.stop).toBeCloseTo(1.1121, 6); // past the sweep's tip, not the candle's high
  });
  it("keeps only the part of the candle inside the killer zone, with the stop still past the tip", () => {
    // the 8:00 candle starts below candle 1's body top (1.1080)
    const s = make5({ ...bosSell, "1:08:00": [1.1075, 1.112, 1.1075, 1.111] });
    const tr = run(s, sweep()).trades[0];
    expect(tr.zone).toMatchObject({ top: 1.112, bottom: 1.108, sweep: true });
    expect(tr.stop).toBeCloseTo(1.1121, 6);
    expect(run(s, sweep({ zoneInKiller: false })).trades[0].zone).toMatchObject({ top: 1.112, bottom: 1.1075 });
  });
});

function upTo5(s: Series, key: string): Series {
  const [d, hh, mm] = key.split(":").map(Number);
  const n = d * 288 + hh * 12 + mm / 5 + 1;
  const sl = (a: ArrayLike<number>) => Array.from(a).slice(0, n);
  return { n, t: sl(s.t), o: sl(s.o), h: sl(s.h), l: sl(s.l), c: sl(s.c) };
}

describe("the shift entry under today's rules", () => {
  it("still works, from candle 3", () => {
    // the shift entry needs a fresh 1-hour zone retest in candle 3; with no zone it enters on a close past the last swing low
    const res = run(make(qmSell), cfg({ entry: "shift", zone: "off" }));
    for (const tr of res.trades) {
      expect(tr.model).toBe("shift");
      expect(tr.entryCandle).toBeGreaterThanOrEqual(3);
    }
  });
});

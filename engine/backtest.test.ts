import { describe, expect, it } from "vitest";
import { inKillzone, prepare, runBacktest, scoreOf } from "./backtest";
import { CLASSIC_CONFIG, type Config, type Series } from "./types";

// Build days of 15-minute candles from Mon 8 Jan 2024 (UTC).
// Every candle is flat at the previous close unless listed in `at`:
// key "day:HH:MM" (day 0, 1, 2...) -> [open, high, low, close].
const MON = Date.UTC(2024, 0, 8) / 1000;
const TUE = MON + 86400;
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

// The first version's rules: daily CRTs, entry on the shift close during candle 2 or 3, stop at
// the sweep, half at 50%, no key level or R limits, and a deeper sweep or the 50% level cancels.
const CLASSIC: Partial<Config> = {
  crt: ["day"], entry: "shift", timing: "either", entryWindow: 1, deeperSweeps: false, midCancels: true,
  freshFrom: "candle2", keyLevelKinds: ["ob", "breaker", "fvg"], zone: "obFvg", zoneInKiller: false,
  bias: "off", newsGuard: false, requireKeyLevel: false, stop: "sweep", stopBuffer: 0,
  partialAtTp1: true, minR: 0, fullR: 0, lowRPct: 0, maxR: 1000, maxPerDay: 0, timeStop: true, minPct: 0
};
const cfg = (over: Partial<Config> = {}): Config => ({ ...CLASSIC_CONFIG, ...CLASSIC, ...over });
const run = (s: Series, c: Config) => runBacktest(prepare(s, c), c);
const iso = (t: number) => new Date(t * 1000).toISOString();

// Day 0 (range): high 1.1100, low 1.1000, middle 1.1050.
const rangeDay: Record<string, OHLC> = {
  "0:00:00": [1.105, 1.105, 1.105, 1.105],
  "0:03:00": [1.105, 1.11, 1.105, 1.105],
  "0:15:00": [1.105, 1.105, 1.1, 1.105]
};

// Day 1: swing high 1.1045 at 06:00, sweep to 1.0980 at 08:00, back up,
// close 1.1046 at 08:45 breaks the swing high. Then 50% at 09:00, high at 12:00.
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
const RISK = 1.1047 - 1.098;

describe("a simple CRT buy with no zone filter", () => {
  const res = run(make(simpleBuy), cfg({ zone: "off" }));
  const tr = res.trades[0];
  it("takes exactly one trade", () => expect(res.trades.length).toBe(1));
  it("enters on the close that breaks structure, at the ask", () => {
    expect(tr.dir).toBe(1);
    expect(tr.entry).toBeCloseTo(1.1047, 6);
    expect(iso(tr.entryT)).toBe("2024-01-09T09:00:00.000Z");
    expect(tr.mssLevel).toBeCloseTo(1.1045, 6);
    expect(tr.sameDay).toBe(true);
  });
  it("puts the stop at the sweep and targets at 50% and the range high", () => {
    expect(tr.stop).toBeCloseTo(1.098, 6);
    expect(tr.tp1).toBeCloseTo(1.105, 6);
    expect(tr.tp2).toBeCloseTo(1.11, 6);
  });
  it("takes half at 50% and the rest at the high", () => {
    const want = 0.5 * ((1.105 - 1.1047) / RISK) + 0.5 * ((1.11 - 1.1047) / RISK);
    expect(tr.reason).toBe("tp2");
    expect(iso(tr.partialT ?? 0)).toBe("2024-01-09T09:00:00.000Z");
    expect(tr.r).toBeCloseTo(want, 6);
  });
  it("takes the whole position at the high when partials are off", () => {
    const t2 = run(make(simpleBuy), cfg({ zone: "off", partialAtTp1: false })).trades[0];
    expect(t2.r).toBeCloseTo((1.11 - 1.1047) / RISK, 6);
  });
});

describe("stops and timing", () => {
  it("loses 1R when the sweep low breaks after entry", () => {
    const s = make({ ...simpleBuy, "1:09:00": [1.1046, 1.1046, 1.097, 1.0975], "1:12:00": [1.0975, 1.0975, 1.0975, 1.0975] });
    const tr = run(s, cfg({ zone: "off" })).trades[0];
    expect(tr.reason).toBe("stop");
    expect(tr.r).toBeCloseTo(-1, 6);
  });
  it("fills a stop at the open when price gaps through it", () => {
    const s = make({ ...simpleBuy, "1:09:00": [1.097, 1.097, 1.096, 1.0965], "1:12:00": [1.0965, 1.0965, 1.0965, 1.0965] });
    const tr = run(s, cfg({ zone: "off" })).trades[0];
    expect(tr.reason).toBe("stop");
    expect(tr.r).toBeCloseTo((1.097 - 1.1047) / RISK, 6);
  });
  it("moves the stop to entry after the first target", () => {
    // 09:00 reaches 50%, 09:15 comes back to the entry price
    const s = make({ ...simpleBuy, "1:09:15": [1.1052, 1.1052, 1.1046, 1.1047], "1:12:00": [1.1047, 1.1047, 1.1047, 1.1047] });
    const tr = run(s, cfg({ zone: "off" })).trades[0];
    expect(tr.reason).toBe("breakeven");
    expect(iso(tr.exitT)).toBe("2024-01-09T09:15:00.000Z");
    expect(tr.r).toBeCloseTo(0.5 * ((1.105 - 1.1047) / RISK), 6);
  });
  it("assumes the worst when one candle hits the target and the entry", () => {
    const s = make({ ...simpleBuy, "1:09:00": [1.1046, 1.1055, 1.104, 1.1052] });
    const tr = run(s, cfg({ zone: "off" })).trades[0];
    expect(tr.reason).toBe("breakeven");
    expect(iso(tr.exitT)).toBe("2024-01-09T09:00:00.000Z");
  });
  it("closes what's left at the end of the day after the sweep", () => {
    // four days, so Thursday exists and the time stop fires at its open
    const s = make({ ...simpleBuy, "1:09:00": [1.1046, 1.1048, 1.104, 1.1047], "1:12:00": [1.1047, 1.1047, 1.1047, 1.1047] }, 4);
    const tr = run(s, cfg({ zone: "off" })).trades[0];
    expect(tr.reason).toBe("time");
    expect(iso(tr.exitT)).toBe("2024-01-11T00:00:00.000Z");
    expect(tr.r).toBeCloseTo(0, 6); // bid 1.1047 against an ask entry of 1.1047
  });
  it("keeps the trade open past that day when the time stop is off", () => {
    const s = make({ ...simpleBuy, "1:09:00": [1.1046, 1.1048, 1.104, 1.1047], "1:12:00": [1.1047, 1.1047, 1.1047, 1.1047] }, 4);
    const tr = run(s, cfg({ zone: "off", timeStop: false })).trades[0];
    expect(tr.reason).toBe("end");
    expect(iso(tr.exitT)).toBe("2024-01-12T00:00:00.000Z");
  });
  it("does not enter on the sweep day when timing is next day only", () => {
    expect(run(make(simpleBuy), cfg({ zone: "off", timing: "nextDay" })).trades.length).toBe(0);
  });
  it("enters the next day when the sweep day closed back inside", () => {
    // no shift on the sweep day (it closes at 1.1025), then Wednesday 04:00 breaks 1.1045
    const s = make({
      ...simpleBuy,
      "1:08:45": [1.1018, 1.103, 1.1015, 1.1025],
      "1:09:00": [1.1025, 1.1028, 1.102, 1.1025],
      "1:12:00": [1.1025, 1.1025, 1.1025, 1.1025],
      "2:04:00": [1.1025, 1.1048, 1.1022, 1.1046]
    });
    for (const timing of ["nextDay", "either"] as const) {
      const trs = run(s, cfg({ zone: "off", timing })).trades.filter((x) => x.sweepDayT === TUE);
      expect(trs.length).toBe(1);
      expect(trs[0].sameDay).toBe(false);
      expect(trs[0].mssLevel).toBeCloseTo(1.1045, 6); // still the swing high before the sweep low
      expect(iso(trs[0].entryT)).toBe("2024-01-10T04:15:00.000Z");
    }
    expect(run(s, cfg({ zone: "off", timing: "sameDay" })).trades.filter((x) => x.sweepDayT === TUE).length).toBe(0);
  });
  it("skips the next day if the sweep day closed outside the range", () => {
    const s = make({
      ...simpleBuy,
      "1:08:45": [1.1018, 1.103, 1.1015, 1.1025],
      "1:09:00": [1.1025, 1.1028, 1.102, 1.1025],
      "1:12:00": [1.1025, 1.1025, 1.0985, 1.0990], // Tuesday closes below 1.1000
      "2:04:00": [1.0990, 1.1048, 1.0988, 1.1046]
    });
    expect(run(s, cfg({ zone: "off" })).trades.filter((x) => x.sweepDayT === TUE).length).toBe(0);
  });
  it("skips the trade if structure breaks after price already reached 50%", () => {
    const s = make({ ...simpleBuy, "1:08:30": [1.0998, 1.1052, 1.0995, 1.1018] });
    expect(run(s, cfg({ zone: "off" })).trades.length).toBe(0);
  });
  it("does nothing if the range is never swept", () => {
    // a deeper range low (1.0950) and a day-1 high that stays under 1.1100
    const s = make({ ...simpleBuy, "0:15:00": [1.105, 1.105, 1.095, 1.105], "1:12:00": [1.1052, 1.1095, 1.105, 1.109] });
    const res = run(s, cfg({ zone: "off" }));
    expect(res.trades.length).toBe(0);
    expect(res.funnel.sweeps).toBe(0);
  });
  it("cancels the buy if the next day trades below the sweep low", () => {
    const s = make({
      ...simpleBuy,
      "1:08:45": [1.1018, 1.103, 1.1015, 1.1025],
      "1:09:00": [1.1025, 1.1028, 1.102, 1.1025],
      "1:12:00": [1.1025, 1.1025, 1.1025, 1.1025],
      "2:02:00": [1.1025, 1.1025, 1.097, 1.099], // takes out 1.0980
      "2:04:00": [1.099, 1.1048, 1.099, 1.1046] // would have been an entry
    });
    expect(run(s, cfg({ zone: "off" })).trades.filter((x) => x.sweepDayT === TUE).length).toBe(0);
  });
});

// Day 1 with a proper 1-hour zone: hour 08 sweeps (bearish), hour 09 pushes
// up, hour 10 opens above hour 08's high, leaving a gap (1.1030 to 1.1035).
// Price dips into it at 11:00, then 11:15 closes above the 10:00 swing high.
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

describe("the 1-hour zone", () => {
  it("finds the order block and gap, waits for the retest, then enters on the shift", () => {
    const res = run(make(zoneBuy), cfg({ zone: "obFvg" }));
    const tr = res.trades[0];
    expect(res.trades.length).toBe(1);
    expect(tr.zone?.fvg?.bottom).toBeCloseTo(1.103, 6);
    expect(tr.zone?.fvg?.top).toBeCloseTo(1.1035, 6);
    expect(tr.zone?.ob?.bottom).toBeCloseTo(1.098, 6);
    expect(iso(tr.zone?.t ?? 0)).toBe("2024-01-09T11:00:00.000Z"); // known once hour 10 closed
    expect(iso(tr.touchT ?? 0)).toBe("2024-01-09T11:00:00.000Z"); // earlier visits to that area don't count
    expect(tr.mssLevel).toBeCloseTo(1.1042, 6);
    expect(tr.entry).toBeCloseTo(1.1046, 6);
    expect(tr.reason).toBe("tp2");
  });
  it("can put the stop under the pullback instead of the sweep", () => {
    const tr = run(make(zoneBuy), cfg({ zone: "obFvg", stop: "pullback" })).trades[0];
    expect(tr.stop).toBeCloseTo(1.1032, 6); // the 11:00 dip into the gap
    expect(tr.risk).toBeCloseTo(1.1046 - 1.1032, 6);
    expect(tr.r).toBeCloseTo(0.5 * ((1.105 - 1.1046) / tr.risk) + 0.5 * ((1.11 - 1.1046) / tr.risk), 6);
  });
  it("works with the gap alone", () => {
    expect(run(make(zoneBuy), cfg({ zone: "fvg" })).trades.length).toBe(1);
  });
  it("with the order block alone, needs a deeper retest", () => {
    expect(run(make(zoneBuy), cfg({ zone: "ob" })).trades.length).toBe(0);
  });
  it("needs price to come back into the zone", () => {
    const s = make({ ...zoneBuy, "1:11:00": [1.104, 1.104, 1.1037, 1.1038], "1:11:15": [1.1038, 1.1046, 1.1037, 1.1045] });
    const res = run(s, cfg({ zone: "obFvg" }));
    expect(res.trades.length).toBe(0);
    expect(res.funnel.zones).toBe(1);
    expect(res.funnel.touches).toBe(0);
  });
  it("drops the zone when a candle closes through it", () => {
    const s = make({ ...zoneBuy, "1:11:00": [1.104, 1.104, 1.1, 1.1005] });
    expect(run(s, cfg({ zone: "fvg" })).trades.length).toBe(0);
  });
});

describe("sells mirror buys", () => {
  // flip every price around 1.1050
  const flip = (rec: Record<string, OHLC>) =>
    Object.fromEntries(Object.entries(rec).map(([k, [o, h, l, c]]) => [k, [2.21 - o, 2.21 - l, 2.21 - h, 2.21 - c] as OHLC]));
  it("takes the mirrored sell with spread on the exits", () => {
    const tr = run(make(flip(simpleBuy)), cfg({ zone: "off" })).trades[0];
    expect(tr.dir).toBe(-1);
    expect(tr.entry).toBeCloseTo(2.21 - 1.1046, 6); // sells fill at the bid
    expect(tr.stop).toBeCloseTo(2.21 - 1.098 + 0.0001, 6); // the ask must clear the sweep high
    expect(tr.reason).toBe("tp2");
    expect(tr.r).toBeGreaterThan(0);
  });
  it("finds the mirrored zone trade", () => {
    const tr = run(make(flip(zoneBuy)), cfg({ zone: "obFvg" })).trades[0];
    expect(tr?.dir).toBe(-1);
    expect(tr.zone?.fvg?.top).toBeCloseTo(2.21 - 1.103, 6);
    expect(tr.mssLevel).toBeCloseTo(2.21 - 1.1042, 6);
  });
});

describe("weekly bias and news", () => {
  it("takes no trades while the weekly bias is still unknown", () => {
    // three days hold no finished weeks, so the bias is 0 and both directions are blocked
    const res = run(make(simpleBuy), cfg({ zone: "off", bias: "majority" }));
    expect(res.trades.length).toBe(0);
    expect(res.funnel.biasBlocked).toBeGreaterThan(0);
  });
  it("rests on US jobs report days", () => {
    // Friday 5 Jan 2024 was an NFP day: rebuild the same buy on Thu 4 / Fri 5 Jan
    const shift = -4 * 86400;
    const base = make(simpleBuy);
    const s: Series = { ...base, t: Array.from(base.t, (t) => t + shift) };
    expect(run(s, cfg({ zone: "off", newsGuard: true })).trades.length).toBe(0);
    expect(run(s, cfg({ zone: "off", newsGuard: true })).funnel.skippedNews).toBe(1);
    expect(run(s, cfg({ zone: "off", newsGuard: false })).trades.length).toBe(1);
    expect(run(s, cfg({ zone: "off", newsGuard: true, usdNews: false })).trades.length).toBe(1);
  });
  it("can limit entries to sessions", () => {
    // the entry candle opens at 08:45 UTC, inside London
    expect(run(make(simpleBuy), cfg({ zone: "off", sessions: ["london"] })).trades.length).toBe(1);
    const res = run(make(simpleBuy), cfg({ zone: "off", sessions: ["asian", "newyork"] }));
    expect(res.trades.length).toBe(0);
    expect(res.funnel.skippedSession).toBe(1);
  });
});

// ---------------- the second version's rules ----------------

// Day 0 leaves a 4-hour gap at 1.0980 to 1.0990 on the way up. Day 1 (the
// range, 1.1000 to 1.1100) stays above it. Day 2 sweeps into it, then shifts.
const keyBuy: Record<string, OHLC> = {
  "0:00:00": [1.097, 1.098, 1.096, 1.097],
  "0:04:00": [1.097, 1.1, 1.097, 1.0995],
  "0:08:00": [1.0995, 1.105, 1.099, 1.1045],
  "1:03:00": [1.1045, 1.11, 1.1045, 1.105],
  "1:15:00": [1.105, 1.105, 1.1, 1.104],
  "2:06:00": [1.104, 1.1045, 1.104, 1.104],
  "2:06:15": [1.104, 1.104, 1.103, 1.103],
  "2:08:00": [1.103, 1.103, 1.0985, 1.099],
  "2:08:15": [1.099, 1.1, 1.0986, 1.0998],
  "2:08:30": [1.0998, 1.102, 1.0995, 1.1018],
  "2:08:45": [1.1018, 1.1048, 1.1015, 1.1046],
  "2:09:00": [1.1048, 1.1055, 1.1048, 1.1052],
  "2:12:00": [1.1052, 1.1105, 1.105, 1.11]
};
const WED = MON + 2 * 86400;

describe("the sweep has to reach a higher-timeframe key level", () => {
  const keyCfg = (over: Partial<Config> = {}) => cfg({ zone: "off", requireKeyLevel: true, ...over });
  it("trades when candle 2 sweeps into a fresh 4-hour gap", () => {
    const res = run(make(keyBuy, 4), keyCfg());
    const tr = res.trades.find((x) => x.sweepDayT === WED);
    expect(tr?.keyLevel).toMatchObject({ tf: "h4", kind: "fvg", top: 1.099, bottom: 1.098 });
    expect(tr?.conf.strongKey).toBe(false); // a 4-hour level, not a daily or weekly one
    expect(res.funnel.keyLevels).toBeGreaterThanOrEqual(1);
  });
  it("does nothing when the sweep stops short of it", () => {
    const s = make({ ...keyBuy, "2:08:00": [1.103, 1.103, 1.0995, 1.0997], "2:08:15": [1.0997, 1.1, 1.0996, 1.0998], "2:08:30": [1.0998, 1.102, 1.0996, 1.1018] }, 4);
    expect(run(s, keyCfg()).trades.filter((x) => x.sweepDayT === WED).length).toBe(0);
    expect(run(s, keyCfg({ requireKeyLevel: false })).trades.filter((x) => x.sweepDayT === WED).length).toBe(1);
  });
  it("does nothing when the gap was already touched on an earlier day", () => {
    // day 1 dips to 1.0989 first, so day 2's sweep is not the first visit
    // (its high moves to 1.1120 to keep the 50% level above the entry)
    const s = make({ ...keyBuy, "1:03:00": [1.1045, 1.112, 1.1045, 1.105], "1:15:00": [1.105, 1.105, 1.0989, 1.104] }, 4);
    expect(run(s, keyCfg()).trades.filter((x) => x.sweepDayT === WED).length).toBe(0);
    expect(run(s, keyCfg({ requireKeyLevel: false })).trades.filter((x) => x.sweepDayT === WED).length).toBe(1);
  });
  it("can be limited to the daily and weekly charts", () => {
    expect(run(make(keyBuy, 4), keyCfg({ keyLevelTfs: ["d1", "w1"] })).trades.filter((x) => x.sweepDayT === WED).length).toBe(0);
  });
});

describe("stops beyond the 1-hour order block, and the R limits", () => {
  const rCfg = (over: Partial<Config> = {}) => cfg({ zone: "obFvg", partialAtTp1: false, ...over });
  it("puts the stop a pip under the order block", () => {
    const tr = run(make(zoneBuy), rCfg({ stop: "ob", stopBuffer: 0.0001 })).trades[0];
    expect(tr.stop).toBeCloseTo(1.0979, 6); // hour 08's low 1.0980, less a pip
  });
  it("skips trades whose target is under 2R", () => {
    // stop 1.0979, entry 1.1046, target 1.1100: about 0.8R
    const res = run(make(zoneBuy), rCfg({ stop: "ob", stopBuffer: 0.0001, minR: 2 }));
    expect(res.trades.length).toBe(0);
    expect(res.funnel.skippedLowR).toBe(1);
  });
  it("takes a 3.9R target as it is", () => {
    // stop at the pullback 1.1032: risk 0.0014, target 1.1100 is 3.86R away
    const tr = run(make(zoneBuy), rCfg({ stop: "pullback", minR: 2, fullR: 3, maxR: 6 })).trades[0];
    expect(tr.plannedR).toBeCloseTo((1.11 - 1.1046) / 0.0014, 6);
    expect(tr.tp2).toBeCloseTo(1.11, 6);
    expect(tr.reason).toBe("tp2");
  });
  it("caps the target at the most R allowed", () => {
    const tr = run(make(zoneBuy), rCfg({ stop: "pullback", minR: 2, maxR: 3 })).trades[0];
    expect(tr.plannedR).toBeCloseTo(3, 6);
    expect(tr.tp2).toBeCloseTo(1.1046 + 3 * 0.0014, 6);
    expect(tr.r).toBeCloseTo(3, 6);
  });
  it("needs a high enough percent between 2R and the full R", () => {
    expect(run(make(zoneBuy), rCfg({ stop: "pullback", minR: 2, fullR: 4, lowRPct: 100 })).trades.length).toBe(0);
    expect(run(make(zoneBuy), rCfg({ stop: "pullback", minR: 2, fullR: 4, lowRPct: 0 })).trades.length).toBe(1);
  });
});

describe("the checklist", () => {
  const none = { weeklyBias: false, weeklyCrt: false, mtf: false, discount: false, strongKey: false, obFvg: false, fib: false, gann: false, ifvg: false, killzone: false, displacement: false, smt: false, oldLiquidity: false };
  it("counts direction checks double, out of 18", () => {
    expect(scoreOf(none)).toEqual({ points: 0, maxPoints: 18, pct: 0 });
    expect(scoreOf({ ...none, weeklyBias: true })).toMatchObject({ points: 2, maxPoints: 18 });
    expect(scoreOf({ ...none, fib: true, gann: true })).toMatchObject({ points: 2, maxPoints: 18 });
    expect(scoreOf({ ...none, weeklyBias: true, mtf: true, discount: true, strongKey: true, weeklyCrt: true, obFvg: true, fib: true, gann: true, ifvg: true, killzone: true, displacement: true, smt: true, oldLiquidity: true }).pct).toBe(100);
  });
  it("leaves out checks that can't apply", () => {
    expect(scoreOf({ ...none, smt: null, weeklyBias: true })).toMatchObject({ points: 2, maxPoints: 17 });
    expect(scoreOf({ ...none, smt: null, weeklyCrt: null, killzone: true })).toMatchObject({ points: 1, maxPoints: 15 });
  });
  it("knows the London and New York killzones in New York time", () => {
    const at = (m: number, d: number, h: number, min = 0) => Date.UTC(2024, m, d, h, min) / 1000;
    expect(inKillzone(at(0, 9, 7, 30))).toBe(true); // 2:30am New York in winter
    expect(inKillzone(at(0, 9, 12, 15))).toBe(true); // 7:15am New York
    expect(inKillzone(at(0, 9, 11, 0))).toBe(false); // 6am New York
    expect(inKillzone(at(6, 9, 11, 15))).toBe(true); // 7:15am New York in summer
  });
  it("marks what the zone trade had going for it", () => {
    const tr = run(make(zoneBuy), cfg({ zone: "obFvg" })).trades[0];
    expect(tr.conf).toMatchObject({ displacement: true, obFvg: false, gann: false, fib: false, killzone: false, strongKey: false, smt: null });
    expect(tr.maxPoints).toBe(17); // no partner market, so SMT is left out
    expect(tr.points).toBe(1);
    expect(tr.pct).toBeCloseTo(100 / 17, 6);
  });
  it("sees a pullback into the 50 to 78.6% zone of the leg", () => {
    // leg 1.0980 to 1.1042; a dip to 1.1010 is 52% back
    const s = make({ ...zoneBuy, "1:11:00": [1.104, 1.104, 1.101, 1.1012], "1:11:15": [1.1012, 1.1046, 1.1012, 1.1045] });
    expect(run(s, cfg({ zone: "obFvg" })).trades[0]?.conf.fib).toBe(true);
  });
  it("sees an inverted 15-minute gap on the way into the entry", () => {
    // 10:30 to 11:00 leave a gap down at 1.1034 to 1.1036; 11:15 closes above it
    const s = make({
      ...zoneBuy,
      "1:10:30": [1.104, 1.104, 1.1036, 1.1037],
      "1:10:45": [1.1037, 1.1037, 1.1035, 1.1035],
      "1:11:00": [1.1033, 1.1034, 1.1032, 1.1033]
    });
    const tr = run(s, cfg({ zone: "obFvg" })).trades[0];
    expect(tr?.conf.ifvg).toBe(true);
  });
});

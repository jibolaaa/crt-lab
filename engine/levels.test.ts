import { describe, expect, it } from "vitest";
import { findLevels, keyLevelFor, levelBook, markTouches, MAX_AGE, type Level } from "./levels";
import type { Bar } from "./types";

const DAY = 86400;
// daily candles: [open, high, low, close]
const days = (rows: [number, number, number, number][]): Bar[] =>
  rows.map(([o, h, l, c], i) => ({ key: i, t: i * DAY, tEnd: i * DAY + DAY - 900, o, h, l, c, i0: 0, i1: 0 }));
const closeOf = (i: number) => i * DAY + DAY;

// A swing high at 15 (bar 2), a dip, then bar 6 closes above it. Bar 7 leaves
// a gap above bar 5. Bar 9 closes below the order block, bar 10 back above it.
const bars = days([
  [10, 11, 9, 10.5],
  [10.5, 12, 10, 11.5],
  [11.5, 15, 11, 14],
  [14, 14.5, 12, 12.5],
  [12.5, 13, 11.5, 12],
  [12, 12.5, 10, 10.5],
  [10.5, 16, 10.4, 15.5],
  [15.5, 16.5, 15, 16],
  [16, 16, 12, 12.5],
  [12.5, 12.6, 9, 9.5],
  [9.5, 13, 9.4, 12.8],
  [12.8, 13, 12.7, 12.9]
]);
const levels = findLevels(bars, "d1");
const find = (kind: string, side: number, top: number) => levels.find((z) => z.kind === kind && z.side === side && z.top === top);

describe("higher-timeframe key levels", () => {
  it("finds the order block behind a break of structure", () => {
    const ob = find("ob", 1, 12.5);
    expect(ob).toMatchObject({ bottom: 10, t: 5 * DAY, knownAt: closeOf(6) }); // bar 5, the lowest down candle before the break
    expect(ob?.brokenAt).toBe(closeOf(9)); // bar 9 closed below 10
  });
  it("turns a broken order block into a breaker on the other side", () => {
    const br = find("breaker", -1, 12.5);
    expect(br).toMatchObject({ bottom: 10, knownAt: closeOf(9), brokenAt: closeOf(10) });
  });
  it("finds fair value gaps both ways", () => {
    expect(find("fvg", 1, 15)).toMatchObject({ bottom: 12.5, knownAt: closeOf(7), brokenAt: closeOf(9) });
    expect(find("fvg", -1, 15)).toMatchObject({ bottom: 12.6, knownAt: closeOf(9) });
  });
  it("finds the bearish order block when structure breaks down", () => {
    expect(find("ob", -1, 16.5)).toMatchObject({ bottom: 15, knownAt: closeOf(9) }); // bar 7, the highest up candle
  });
  it("never treats the last candle as closed", () => {
    // the same bars without bar 11: bar 10 is now last, so nothing it completes or breaks counts
    const cut = findLevels(bars.slice(0, 11), "d1");
    expect(cut.find((z) => z.kind === "breaker" && z.side === -1)?.brokenAt).toBe(Infinity);
    expect(cut.every((z) => z.knownAt <= closeOf(9))).toBe(true);
  });
  it("records the first day that traded back into a zone", () => {
    const list = findLevels(bars, "d1");
    markTouches(list, bars);
    expect(list.find((z) => z.kind === "fvg" && z.side === 1)?.touchedAt).toBe(8 * DAY); // bar 8 dipped to 12
  });
});

describe("which key level a sweep reached", () => {
  const L = (over: Partial<Level>): Level => ({ tf: "d1", kind: "ob", side: 1, top: 1.1, bottom: 1.09, t: 0, knownAt: 1000, brokenAt: Infinity, touchedAt: Infinity, ...over });
  const all = { tfs: ["h4", "d1", "w1"] as const, kinds: ["ob", "breaker", "fvg"] as const };
  // a buy: candle 1's low is 1.098, the sweep went to 1.095 at t = 5000 on a day starting at 4000
  const find = (list: Level[], over: { kinds?: Level["kind"][]; tfs?: Level["tf"][]; sweep?: number; now?: number; slack?: number } = {}) => {
    const book = levelBook({ h4: list.filter((z) => z.tf === "h4"), d1: list.filter((z) => z.tf === "d1"), w1: list.filter((z) => z.tf === "w1") });
    return keyLevelFor(book, over.tfs ?? [...all.tfs], over.kinds ?? [...all.kinds], {
      dir: 1, sweepT: 5000, sweepPrice: over.sweep ?? 1.095, edge: 1.098, bodyEdge: 1.099, freshFrom: 4000, now: over.now ?? 6000, slack: over.slack ?? 0
    });
  };
  it("accepts a fresh, unbroken zone past candle 1's low that the sweep reached", () => expect(find([L({})])).not.toBeNull());
  it("ignores a zone that formed after the sweep", () => expect(find([L({ knownAt: 5500 })])).toBeNull());
  it("ignores a zone that broke before the entry", () => expect(find([L({ brokenAt: 5800 })])).toBeNull());
  it("doesn't count a break closing at the same moment as the decision", () => expect(find([L({ brokenAt: 6000 })])).not.toBeNull());
  it("ignores a zone already touched on an earlier day", () => expect(find([L({ touchedAt: 3000 })])).toBeNull());
  it("accepts a zone first touched on the sweep day", () => expect(find([L({ touchedAt: 4000 })])).not.toBeNull());
  it("ignores a zone the sweep didn't reach", () => expect(find([L({ top: 1.094, bottom: 1.09 })])).toBeNull());
  it("ignores a zone the sweep ran straight through", () => {
    // zone 1.0960 to 1.0970 (10 pips): a sweep to 1.0952 pokes 8 pips through, to 1.0940 runs 20 through
    expect(find([L({ top: 1.097, bottom: 1.096 })], { sweep: 1.0952 })).not.toBeNull();
    expect(find([L({ top: 1.097, bottom: 1.096 })], { sweep: 1.094 })).toBeNull();
    expect(find([L({ top: 1.097, bottom: 1.096 })], { sweep: 1.094, slack: 0.003 })).not.toBeNull();
  });
  it("ignores a zone that sits inside candle 1's range", () => expect(find([L({ top: 1.1, bottom: 1.099 })])).toBeNull());
  it("ignores a support zone for buys when it's resistance", () => expect(find([L({ side: -1 })])).toBeNull());
  it("only uses the chosen kinds and charts", () => {
    expect(find([L({})], { kinds: ["fvg"] })).toBeNull();
    expect(find([L({})], { tfs: ["h4", "w1"] })).toBeNull();
  });
  it("lets old zones expire", () => expect(find([L({ tf: "h4", knownAt: 5000 - MAX_AGE.h4 - 1 })])).toBeNull());
  it("prefers the higher timeframe", () => {
    expect(find([L({ tf: "h4" }), L({ tf: "w1", top: 1.097 })])?.tf).toBe("w1");
  });
});

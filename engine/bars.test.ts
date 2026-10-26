import { describe, expect, it } from "vitest";
import { weeklyBias } from "./bars";
import type { Bar } from "./types";

const wk = (h: number, l: number, c: number, i = 0): Bar => ({ key: i, t: 0, tEnd: 0, o: (h + l) / 2, h, l, c, i0: 0, i1: 0 });
const MODES = ["weeklyCrt", "structure", "premiumDiscount", "majority", "allAgree"] as const;

describe("weekly CRT bias", () => {
  const bias = (a: Bar, b: Bar) => weeklyBias([a, b, wk(1, 1, 1)], 2).weeklyCrt[2];
  const a = wk(1.12, 1.1, 1.11);
  it("is bullish when last week took the low and closed back inside", () => expect(bias(a, wk(1.115, 1.095, 1.105))).toBe(1));
  it("is bearish when last week took the high and closed back inside", () => expect(bias(a, wk(1.125, 1.105, 1.115))).toBe(-1));
  it("is neutral when last week closed outside", () => expect(bias(a, wk(1.115, 1.09, 1.095))).toBe(0));
  it("is neutral when last week took both sides", () => expect(bias(a, wk(1.125, 1.095, 1.11))).toBe(0));
  it("is neutral for the first two weeks", () => {
    const b = weeklyBias([a, wk(1.115, 1.095, 1.105)], 2);
    expect([...b.weeklyCrt]).toEqual([0, 0]);
  });
});

describe("structure and premium/discount bias", () => {
  // weekly swings with one week on each side (k = 1)
  const weeks = [
    wk(1.1, 1.05, 1.08),
    wk(1.12, 1.06, 1.11), // swing high 1.12, confirmed when week 2 closes
    wk(1.11, 1.04, 1.05), // swing low 1.04, confirmed when week 3 closes
    wk(1.125, 1.05, 1.122), // closes above 1.12: structure turns bullish from week 4
    wk(1.1, 1.045, 1.07), // takes week 3's low, closes inside, in the lower half
    wk(1.09, 1.06, 1.08)
  ];
  const b = weeklyBias(weeks, 1);
  it("turns bullish only after a weekly close above a confirmed swing high", () => {
    expect([...b.structure]).toEqual([0, 0, 0, 0, 1, 1]);
  });
  it("reads premium and discount from the latest swing range", () => {
    expect(b.premiumDiscount[4]).toBe(-1); // week 3 closed at 1.122, above the middle of 1.04 to 1.12
    expect(b.premiumDiscount[5]).toBe(1); // week 4 closed at 1.07, below the middle of 1.04 to 1.125
  });
  it("combines the three", () => {
    expect(b.weeklyCrt[5]).toBe(1);
    expect(b.majority[4]).toBe(0); // structure up, premium/discount down, CRT neutral
    expect(b.majority[5]).toBe(1);
    expect(b.allAgree[5]).toBe(1);
  });
});

describe("no peeking", () => {
  it("never lets a week's own candle change its bias", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const weeks: Bar[] = [];
    let px = 1.1;
    for (let i = 0; i < 80; i++) {
      const o = px, c = px + (rnd() - 0.5) * 0.03;
      weeks.push(wk(Math.max(o, c) + rnd() * 0.01, Math.min(o, c) - rnd() * 0.01, c, i));
      px = c;
    }
    const full = weeklyBias(weeks, 2);
    for (let w = 0; w < weeks.length; w++) {
      const junk = wk(9, 0.01, rnd() < 0.5 ? 0.02 : 8.9, w); // a wild week in place of week w
      const part = weeklyBias([...weeks.slice(0, w), junk], 2);
      for (const m of MODES) expect(part[m][w], `${m} week ${w}`).toBe(full[m][w]);
    }
  });
});

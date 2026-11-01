import { describe, expect, it } from "vitest";
import type { RunResult, Trade } from "../engine";
import { stats } from "../engine";
import { monthStarts, sliceResult } from "./period";

const T = (y: number, m: number, d = 1) => Date.UTC(y, m - 1, d) / 1000;

describe("From: the start of a month till now", () => {
  it("lists the months that start inside the prices, at most six of the latest", () => {
    const m = monthStarts(T(2026, 5, 15), T(2026, 11, 1) + 72000);
    expect(m.map((x) => x.key)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(m[1].t).toBe(T(2026, 7));
    expect(monthStarts(T(2025, 1, 3), T(2026, 11, 2)).length).toBe(6);
    expect(monthStarts(T(2026, 10, 3), T(2026, 10, 20))).toEqual([]);
  });
  it("keeps the trades entered since then, with that stretch's own first 70% and last 30%", () => {
    const tr = (day: number, r: number) => ({ entryT: T(2026, 6, 1) + day * 86400 + 900, exitT: T(2026, 6, 1) + day * 86400 + 7200, r } as Trade);
    const trades = [tr(5, 1), tr(20, -1), tr(70, 2), tr(120, -1), tr(140, 3)];
    const from = T(2026, 6, 1), to = T(2026, 11, 1);
    const r = { trades, from, to, splitT: 0, all: stats(trades, from, to), seen: stats([], from, to), unseen: stats([], from, to) } as unknown as RunResult;
    const s = sliceResult(r, T(2026, 7, 1));
    expect(s.trades.map((x) => x.r)).toEqual([2, -1, 3]);
    expect(s.all.trades).toBe(3);
    expect(s.all.totalR).toBeCloseTo(4, 9);
    expect(s.from).toBe(T(2026, 7, 1));
    expect(s.seen.trades + s.unseen.trades).toBe(3);
    expect(sliceResult(r, from)).toBe(r);
  });
});

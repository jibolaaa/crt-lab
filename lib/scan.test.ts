import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, prepare, runBacktest, seriesFromBuffer, type LiveSetup } from "../engine";
import { ALL_DEFAULT, MARKETS, marketById } from "./markets";
import { combine, liveList, marketCfg, toScanRow, type ScanRow, type ScanTrade } from "./scan";

const buf = readFileSync(join(__dirname, "../public/data/eurusd-15m.bin"));
const s = seriesFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

describe("markets for All markets", () => {
  it("starts with live markets only, all of them on the list", () => {
    for (const id of ALL_DEFAULT) expect(marketById(id)).toMatchObject({ id, source: "deriv" });
  });
  it("has Volatility 25 to 75 back, marked as made by Deriv's random number generator", () => {
    for (const id of ["R_25", "R_50", "R_75", "1HZ25V", "1HZ50V", "1HZ75V"]) {
      const m = MARKETS.find((x) => x.id === id)!;
      expect(m).toMatchObject({ group: "Synthetic indices", random: true, weekendClosed: false, usdNews: false });
    }
    expect(marketById("R_50").spec.minLot).toBe(4);
  });
});

describe("each market's own rules", () => {
  it("uses the market's spread, stop room and calendar, and keeps the checks", () => {
    const gold = marketById("frxXAUUSD"), v75 = marketById("R_75");
    const cfg = { ...DEFAULT_CONFIG, minPct: 55, spread: 123, weekendClosed: false };
    expect(marketCfg(cfg, gold, 4000)).toMatchObject({ minPct: 55, spread: 0.3, stopBuffer: 0.1, weekendClosed: true, usdNews: true });
    const v = marketCfg(cfg, v75, 400000);
    expect(v).toMatchObject({ minPct: 55, weekendClosed: false, usdNews: false });
    expect(v.spread).toBeCloseTo(40, 6); // a hundredth of a percent of the price
  });
});

describe("a market's compact result", () => {
  const cfg = { ...DEFAULT_CONFIG };
  const r = runBacktest(prepare(s, cfg), cfg);
  const row = toScanRow("eurusd-2014", { count: s.n, dt: 900, from: s.t[0], to: s.t[s.n - 1] + 900, lastClose: s.c[s.n - 1] }, r);
  it("keeps the same trades and totals", () => {
    expect(row.trades).toBe(r.all.trades);
    expect(row.totalR).toBeCloseTo(r.all.totalR, 9);
    expect(row.wins).toBe(r.trades.filter((t) => t.r > 0.005).length);
    expect(row.list.length).toBe(r.trades.length);
    expect(row.list[0]).toMatchObject({ marketId: "eurusd-2014", id: r.trades[0].id, entryT: r.trades[0].entryT, r: r.trades[0].r });
  });
});

const trade = (marketId: string, entryT: number, exitT: number, r: number): ScanTrade => ({ marketId, id: entryT, dir: 1, tf: "day", entryT, exitT, r, pct: 60, reason: r > 0 ? "tp2" : "stop" });
const WEEK = 7 * 86400;
function row(marketId: string, weeks: number, list: ScanTrade[], setups: LiveSetup[] = []): ScanRow {
  return {
    marketId, count: 1000, dt: 300, from: 0, to: weeks * WEEK, lastClose: 1, smt: false,
    trades: list.length, wins: list.filter((t) => t.r > 0).length, totalR: list.reduce((a, t) => a + t.r, 0), maxDrawdownR: 0, list,
    live: setups.length ? { asOf: 100, dayStart: "utc", date: 0, weekDate: 0, bias: 0, biasGate: null, setups } as unknown as ScanRow["live"] : null
  };
}

describe("adding up the markets", () => {
  const a = row("frxEURUSD", 10, [trade("frxEURUSD", 10, 20, 2), trade("frxEURUSD", 30, 40, -1)]);
  const b = row("frxXAUUSD", 20, [trade("frxXAUUSD", 15, 35, -1), trade("frxXAUUSD", 50, 60, -1), trade("frxXAUUSD", 70, 80, 3)]);
  const c = combine([a, b]);
  it("sums trades, wins and R", () => {
    expect(c).toMatchObject({ markets: 2, trades: 5, wins: 2, totalR: 2 });
    expect(c.winRate).toBeCloseTo(0.4, 9);
  });
  it("counts trades a week at each market's own pace", () => {
    expect(c.perWeek).toBeCloseTo(2 / 10 + 3 / 20, 9);
  });
  it("finds the worst run with every trade in the order it closed", () => {
    // closes: +2 (20), -1 (35), -1 (40), -1 (60), +3 (80): peak 2, low -1
    expect(c.maxDrawdownR).toBeCloseTo(3, 9);
  });
  it("lists every trade, newest first", () => {
    expect(c.list.map((t) => t.entryT)).toEqual([70, 50, 30, 15, 10]);
  });
});

describe("right now across markets", () => {
  const setup = (over: Partial<LiveSetup>): LiveSetup => ({
    tf: "day", dir: 1, fromYesterday: false, age: 0, stage: "waiting", rangeDate: 0, sweepDate: 0, why: null,
    rangeHigh: 1.2, rangeLow: 1.1, mid: 1.15, bodyEdge: 1.12, sweepPrice: null, keyLevel: null, zone: null, level: null,
    pending: null, order: null, call: null, skipR: null, trade: null, ...over
  } as LiveSetup);
  const rows = [
    row("frxEURUSD", 10, [], [setup({ stage: "waiting" }), setup({ dir: -1, stage: "zone" })]),
    row("frxXAUUSD", 10, [], [setup({ stage: "limit" }), setup({ tf: "week", dir: -1, stage: "key" })])
  ];
  it("lists setups close to an entry, the most urgent first", () => {
    const l = liveList(rows, ["day", "week"]);
    expect(l.map((x) => `${x.marketId} ${x.setup.stage}`)).toEqual(["frxXAUUSD limit", "frxEURUSD zone", "frxXAUUSD key"]);
  });
  it("only shows the CRTs in the rules", () => {
    expect(liveList(rows, ["day"]).map((x) => x.setup.stage)).toEqual(["limit", "zone"]);
  });
});

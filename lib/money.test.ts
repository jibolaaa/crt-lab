import { describe, expect, it } from "vitest";
import type { Trade } from "../engine";
import { roundLots, simulate, type MoneyCfg } from "./money";

const FX = { contract: 100000, minLot: 0.01, lotStep: 0.01 };
const trade = (id: number, entryT: number, exitT: number, risk: number, r: number, plannedR = 3, entry = 1.1): Trade =>
  ({ id, entryT, exitT, risk, r, plannedR, entry } as unknown as Trade);
const cfg = (over: Partial<MoneyCfg> = {}): MoneyCfg => ({ account: 10, mode: "lots", lots: 0.01, riskPct: 1, leverage: 500, ...over });

describe("dollars for a trade", () => {
  it("prices a 40-pip stop at 0.01 lots of EUR/USD at $4", () => {
    const res = simulate([trade(1, 100, 200, 0.004, -1, 4.175)], FX, cfg());
    const m = res.byId.get(1)!;
    expect(m.riskUsd).toBeCloseTo(4, 9);
    expect(m.targetUsd).toBeCloseTo(16.7, 9);
    expect(m.riskShare).toBeCloseTo(0.4, 9); // 40% of a $10 account
    expect(m.margin).toBeCloseTo((0.01 * 100000 * 1.1) / 500, 9);
    expect(res.final).toBeCloseTo(6, 9);
  });
  it("sizes from a share of the balance, rounded down to the lot step", () => {
    // $1,000 at 1% = $10; a 25-pip stop costs $250 a lot, so 0.04 lots
    const m = simulate([trade(1, 100, 200, 0.0025, 1)], FX, cfg({ account: 1000, mode: "risk", riskPct: 1 })).byId.get(1)!;
    expect(m.lots).toBe(0.04);
    expect(m.riskUsd).toBeCloseTo(10, 9);
    expect(m.minLotTooBig).toBe(false);
  });
  it("flags when even the smallest lot risks more than chosen", () => {
    const m = simulate([trade(1, 100, 200, 0.004, 1)], FX, cfg({ account: 10, mode: "risk", riskPct: 1 })).byId.get(1)!;
    expect(m.lots).toBe(0.01);
    expect(m.minLotTooBig).toBe(true);
  });
  it("sizes each trade from the balance after the trades that had closed", () => {
    const trades = [trade(1, 100, 200, 0.0025, 2), trade(2, 300, 400, 0.0025, -1)];
    const res = simulate(trades, FX, cfg({ account: 1000, mode: "risk", riskPct: 1 }));
    expect(res.byId.get(2)!.balance).toBeCloseTo(1020, 9); // after +2R on $10
    expect(res.final).toBeCloseTo(1020 - 10, 9); // 0.04 lots again: $10 lost
  });
  it("stops trading once the account is empty", () => {
    const trades = [trade(1, 100, 200, 0.004, -1), trade(2, 300, 400, 0.004, -1), trade(3, 500, 600, 0.004, -1), trade(4, 700, 800, 0.004, 3)];
    const res = simulate(trades, FX, cfg({ account: 10 }));
    expect(res.blownAt).toBe(600);
    expect(res.byId.get(4)!.skipped).toBe(true);
    expect(res.final).toBe(0);
    expect(res.maxDrawdownPct).toBeCloseTo(100, 9);
  });
  it("rounds lots down cleanly", () => {
    expect(roundLots(0.0449, 0.01)).toBe(0.04);
    expect(roundLots(0.03, 0.01)).toBe(0.03);
    expect(roundLots(0.0047, 0.001)).toBe(0.004);
  });
});

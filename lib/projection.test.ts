import { describe, expect, it } from "vitest";
import type { Trade } from "../engine";
import { lotsFor, poisson, project, seeded } from "./projection";

const spec = { contract: 100000, minLot: 0.01, lotStep: 0.01 };
// a trade risking 20 pips: $2 a trade at 0.01 lots
const trade = (r: number): Trade => ({ r, risk: 0.002 } as Trade);
const year = 365.25 * 86400;

describe("the account projection", () => {
  it("needs at least 10 past trades", () => {
    expect(project([trade(1)], 0, year, spec, { account: 100, mode: "lots", lots: 0.01, riskPct: 1, leverage: 500 }, 30)).toBeNull();
  });
  it("grows every run when every past trade won", () => {
    const p = project(Array.from({ length: 52 }, () => trade(2)), 0, year, spec, { account: 100, mode: "lots", lots: 0.01, riskPct: 1, leverage: 500 }, 30)!;
    expect(p.tradesPerPeriod).toBeCloseTo((52 / 365.25) * 30, 6); // about one a week, so about 4 in a month
    expect(p.lossChance).toBe(0);
    expect(p.low).toBeGreaterThanOrEqual(100);
    expect(p.mid).toBeGreaterThan(100);
    expect(p.low).toBeLessThanOrEqual(p.mid);
    expect(p.mid).toBeLessThanOrEqual(p.high);
  });
  it("wipes out a small account when the smallest lot risks more than it has", () => {
    // $5 at risk a trade on a $4 account
    const losers = Array.from({ length: 40 }, () => ({ r: -1, risk: 0.005 } as Trade));
    const p = project(losers, 0, year, spec, { account: 4, mode: "lots", lots: 0.01, riskPct: 1, leverage: 500 }, 91.31)!;
    expect(p.wipeChance).toBeGreaterThan(0.95);
    expect(p.low).toBe(0);
  });
  it("sizes by risk, but never under the smallest lot", () => {
    expect(lotsFor(trade(1), 1000, spec, { account: 1000, mode: "risk", lots: 0, riskPct: 1, leverage: 500 })).toBeCloseTo(0.05, 9); // $10 over $2 a 0.01 lot
    expect(lotsFor(trade(1), 10, spec, { account: 10, mode: "risk", lots: 0, riskPct: 1, leverage: 500 })).toBe(0.01);
  });
  it("counts trades a period the way they arrived", () => {
    const rand = seeded(3);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += poisson(4, rand);
    expect(sum / 4000).toBeGreaterThan(3.8);
    expect(sum / 4000).toBeLessThan(4.2);
  });
});

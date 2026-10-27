import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../engine";
import { DEFAULT_MARKET } from "./markets";
import { readHash, writeHash } from "./urlstate";

const write = (over: Partial<typeof DEFAULT_CONFIG>, marketId = DEFAULT_MARKET) =>
  writeHash({ marketId, months: 12, cfg: { ...DEFAULT_CONFIG, ...over }, spreadDefault: DEFAULT_CONFIG.spread, bufferDefault: DEFAULT_CONFIG.stopBuffer });

describe("the address", () => {
  it("stays empty for the default market and rules", () => {
    expect(write({})).toBe("");
  });
  it("opens on live EUR/USD", () => {
    expect(DEFAULT_MARKET).toBe("frxEURUSD");
  });
  it("keeps must-have checks and the lowest percent", () => {
    const hash = write({ mustHave: ["killzone", "discount"], minPct: 70 }, "frxXAUUSD");
    const back = readHash("#" + hash);
    expect(back.marketId).toBe("frxXAUUSD");
    expect(back.cfg.mustHave).toEqual(["killzone", "discount"]);
    expect(back.cfg.minPct).toBe(70);
  });
  it("drops checks it doesn't know", () => {
    expect(readHash("#must=killzone,nope").cfg.mustHave).toEqual(["killzone"]);
  });
});

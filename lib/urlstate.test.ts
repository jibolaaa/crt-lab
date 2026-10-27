import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../engine";
import { DEFAULT_MARKET } from "./markets";
import { readHash, writeHash } from "./urlstate";

const write = (over: Partial<typeof DEFAULT_CONFIG>, marketId = DEFAULT_MARKET) =>
  writeHash({ marketId, cfg: { ...DEFAULT_CONFIG, ...over }, spreadDefault: DEFAULT_CONFIG.spread, bufferDefault: DEFAULT_CONFIG.stopBuffer });

describe("the address", () => {
  it("stays empty for the default market and rules", () => {
    expect(write({})).toBe("");
  });
  it("opens on US Tech 100", () => {
    expect(DEFAULT_MARKET).toBe("OTC_NDX");
  });
  it("keeps the trade direction", () => {
    expect(readHash("#" + write({ side: "both" })).cfg.side).toBe("both");
    expect(write({ side: "auto" })).toBe("");
  });
  it("keeps must-have checks and the lowest percent", () => {
    const hash = write({ mustHave: ["killzone", "discount"], minPct: 70 }, "frxXAUUSD");
    const back = readHash("#" + hash);
    expect(back.marketId).toBe("frxXAUUSD");
    expect(back.cfg.mustHave).toEqual(["killzone", "discount"]);
    expect(back.cfg.minPct).toBe(70);
  });
  it("keeps the All markets view", () => {
    const hash = writeHash({ marketId: DEFAULT_MARKET, view: "all", cfg: DEFAULT_CONFIG, spreadDefault: DEFAULT_CONFIG.spread, bufferDefault: DEFAULT_CONFIG.stopBuffer });
    expect(hash).toBe("v=all");
    expect(readHash("#" + hash).view).toBe("all");
    expect(readHash("#h=6").view).toBeUndefined(); // old links with a history length still open
  });
  it("drops checks it doesn't know", () => {
    expect(readHash("#must=killzone,nope").cfg.mustHave).toEqual(["killzone"]);
  });
});

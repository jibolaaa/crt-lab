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
  it("opens on GBP/JPY", () => {
    expect(DEFAULT_MARKET).toBe("frxGBPJPY");
  });
  it("keeps Model 1's settings, and switching back to the old rules", () => {
    const back = readHash("#" + write({ crt: ["h4"], bias: "weeklySwings", keyFit: false, keyInside: false, sweepWindow: 0, obStop: "candle", entryChart: "m15", keyLevelKinds: ["flip", "ob"] }));
    expect(back.cfg).toMatchObject({ crt: ["h4"], bias: "weeklySwings", keyFit: false, keyInside: false, sweepWindow: 0, obStop: "candle", entryChart: "m15", keyLevelKinds: ["flip", "ob"] });
    expect(readHash("#" + write({ entry: "shift", crt: ["day", "week"], bias: "off" })).cfg).toMatchObject({ entry: "shift", crt: ["day", "week"], bias: "off" });
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

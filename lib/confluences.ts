// How each confluence is described on the page.
import type { ConfKey } from "../engine";

export const CONF_LABEL: Record<ConfKey, string> = {
  keyLevel: "Swept into a higher-timeframe key level",
  weeklyBias: "Weekly bias agrees",
  mtf: "4-hour and daily structure agree",
  discount: "In daily discount (buys) or premium (sells)",
  obFvg: "1-hour order block and gap overlap",
  fib: "Pullback to the 50 to 78.6% fib zone",
  gann: "Entry in the deepest quarter of candle 1 (Gann box)",
  killzone: "London or New York open (killzone)",
  ifvg: "Inverted 15-minute gap on the way in (IFVG)",
  displacement: "Strong shift candle (displacement)"
};

export const TF_LABEL = { h4: "4-hour", d1: "daily", w1: "weekly" } as const;
export const KIND_LABEL = { ob: "order block", breaker: "breaker block", fvg: "fair value gap" } as const;

// How the checklist, key levels and CRTs are described on the page.
import type { ConfKey, CrtTf, Dir, KeyFit, LevelKind } from "../engine";

export const CONF_LABEL: Record<ConfKey, string> = {
  weeklyBias: "Weekly structure agrees",
  weeklyCrt: "Weekly CRT agrees (this week or last swept the other side)",
  mtf: "Higher-timeframe structure agrees",
  discount: "Buying in discount, or selling in premium",
  strongKey: "Swept into a daily or weekly level",
  obFvg: "Order block and gap overlap",
  fib: "Entry in the 50 to 78.6% fib zone",
  gann: "Entry in the deepest quarter of candle 1 (Gann box)",
  ifvg: "Inverted gap on the way in (IFVG)",
  killzone: "London or New York open (killzone)",
  displacement: "Strong shift candle (displacement)",
  smt: "SMT: the related market didn't sweep",
  oldLiquidity: "Took old liquidity: last week's high or low, or equal highs or lows"
};

export const TF_LABEL = { h4: "4-hour", d1: "daily", w1: "weekly" } as const;
export const KIND_LABEL: Record<LevelKind, string> = {
  old: "old high or low", ob: "order block", fvg: "fair value gap", rb: "rejection block", breaker: "breaker block",
  flip: "broken level"
};
/** A key level's name the way a trader says it: an old low for buys, an old high for sells. */
export const kindName = (kind: LevelKind, dir: Dir) =>
  kind === "old" ? (dir === 1 ? "old low" : "old high")
    : kind === "flip" ? (dir === 1 ? "old resistance, now support" : "old support, now resistance")
      : KIND_LABEL[kind];

/** Why a key level fits the structure (Model 1), the way a trader says it. */
export const fitText = (fit: KeyFit | undefined, dir: Dir) => {
  const sell = dir === -1;
  switch (fit) {
    case "supply": return sell ? "the supply of the last lower high" : "the demand of the last higher low";
    case "flip": return sell ? "where price broke down from" : "where price broke up from";
    case "leg": return sell ? "left by the latest drop" : "left by the latest rally";
    case "premium": return sell ? "in premium" : "in discount";
    default: return "";
  }
};

export const CRT_LABEL: Record<CrtTf, string> = { h4: "4H CRT", day: "Daily CRT", week: "Weekly CRT" };
/** What candle 1 is called for each CRT. */
export const CANDLE: Record<CrtTf, string> = { h4: "4-hour candle", day: "day", week: "week" };

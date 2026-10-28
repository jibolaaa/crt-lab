// The markets the page can test, and how each one trades.

export type Group = "Built in" | "Forex" | "Metals" | "US indices" | "Crypto" | "Synthetic indices";

export interface Market {
  id: string;
  name: string;
  group: Group;
  source: "builtin" | "deriv";
  /** Deriv's symbol for live candles. */
  symbol?: string;
  /** A related market for the SMT check: did it sweep too? */
  smt?: { symbol: string; name: string };
  /** Deriv makes this market's prices with a random number generator (its synthetic indices). */
  random?: boolean;
  /** Tends to rise over time (stock indices), so "with the drift" takes buys only. */
  drift?: boolean;
  /** Size of one display unit of price (a pip for forex, 1 for metals, indices, crypto and synthetics). */
  unit: number;
  unitName: string;
  /** Default spread in price units, or as a share of the price for markets quoted in big numbers. */
  spread?: number;
  spreadShare?: number;
  /** Default room beyond the stop level, when a pip or a share of the price doesn't fit. */
  buffer?: number;
  /** Closed at weekends: the short Sunday session joins Monday. */
  weekendClosed: boolean;
  /** Moves on US news, so the jobs-report rest day applies. */
  usdNews: boolean;
  digits: number;
  /** MT5 contract: units per 1.00 lot, the smallest lot and the lot step. Starting values; check them in MT5. */
  spec: Spec;
}

export interface Spec {
  contract: number;
  minLot: number;
  lotStep: number;
  /** Dollars per unit of the quote currency: 1 for prices in dollars, about 1/150 for prices in yen. */
  quoteUsd?: number;
  /** What the quote currency is called, when it isn't the dollar. */
  quoteName?: string;
}

const FX: Spec = { contract: 100000, minLot: 0.01, lotStep: 0.01 };

export const MARKETS: Market[] = [
  { id: "eurusd-2014", name: "EUR/USD 2014 to 2021", group: "Built in", source: "builtin", unit: 0.0001, unitName: "pips", spread: 0.0001, weekendClosed: true, usdNews: true, digits: 5, spec: FX },
  { id: "frxEURUSD", name: "EUR/USD", group: "Forex", source: "deriv", symbol: "frxEURUSD", smt: { symbol: "frxGBPUSD", name: "GBP/USD" }, unit: 0.0001, unitName: "pips", spread: 0.0001, weekendClosed: true, usdNews: true, digits: 5, spec: FX },
  { id: "frxGBPUSD", name: "GBP/USD", group: "Forex", source: "deriv", symbol: "frxGBPUSD", smt: { symbol: "frxEURUSD", name: "EUR/USD" }, unit: 0.0001, unitName: "pips", spread: 0.00015, weekendClosed: true, usdNews: true, digits: 5, spec: FX },
  { id: "frxAUDUSD", name: "AUD/USD", group: "Forex", source: "deriv", symbol: "frxAUDUSD", smt: { symbol: "frxNZDUSD", name: "NZD/USD" }, unit: 0.0001, unitName: "pips", spread: 0.00015, weekendClosed: true, usdNews: true, digits: 5, spec: FX },
  { id: "frxGBPJPY", name: "GBP/JPY", group: "Forex", source: "deriv", symbol: "frxGBPJPY", smt: { symbol: "frxEURJPY", name: "EUR/JPY" }, unit: 0.01, unitName: "pips", spread: 0.03, weekendClosed: true, usdNews: false, digits: 3, spec: { ...FX, quoteUsd: 1 / 150, quoteName: "yen" } },
  { id: "frxAUDJPY", name: "AUD/JPY", group: "Forex", source: "deriv", symbol: "frxAUDJPY", smt: { symbol: "frxNZDJPY", name: "NZD/JPY" }, unit: 0.01, unitName: "pips", spread: 0.03, weekendClosed: true, usdNews: false, digits: 3, spec: { ...FX, quoteUsd: 1 / 150, quoteName: "yen" } },
  { id: "frxCADJPY", name: "CAD/JPY", group: "Forex", source: "deriv", symbol: "frxCADJPY", smt: { symbol: "frxAUDJPY", name: "AUD/JPY" }, unit: 0.01, unitName: "pips", spread: 0.03, weekendClosed: true, usdNews: false, digits: 3, spec: { ...FX, quoteUsd: 1 / 150, quoteName: "yen" } },
  { id: "frxXAUUSD", name: "Gold (XAU/USD)", group: "Metals", source: "deriv", symbol: "frxXAUUSD", smt: { symbol: "frxXAGUSD", name: "silver" }, unit: 1, unitName: "dollars", spread: 0.3, buffer: 0.1, weekendClosed: true, usdNews: true, digits: 2, spec: { contract: 100, minLot: 0.01, lotStep: 0.01 } },
  { id: "frxXAGUSD", name: "Silver (XAG/USD)", group: "Metals", source: "deriv", symbol: "frxXAGUSD", smt: { symbol: "frxXAUUSD", name: "gold" }, unit: 1, unitName: "dollars", spread: 0.03, buffer: 0.01, weekendClosed: true, usdNews: true, digits: 3, spec: { contract: 5000, minLot: 0.01, lotStep: 0.01 } },
  { id: "OTC_NDX", drift: true, name: "US Tech 100", group: "US indices", source: "deriv", symbol: "OTC_NDX", smt: { symbol: "OTC_SPC", name: "US 500" }, unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: true, usdNews: true, digits: 2, spec: { contract: 1, minLot: 0.01, lotStep: 0.01 } },
  { id: "OTC_SPC", drift: true, name: "US 500", group: "US indices", source: "deriv", symbol: "OTC_SPC", smt: { symbol: "OTC_NDX", name: "US Tech 100" }, unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: true, usdNews: true, digits: 2, spec: { contract: 1, minLot: 0.01, lotStep: 0.01 } },
  { id: "OTC_DJI", drift: true, name: "Wall Street 30", group: "US indices", source: "deriv", symbol: "OTC_DJI", smt: { symbol: "OTC_SPC", name: "US 500" }, unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: true, usdNews: true, digits: 2, spec: { contract: 1, minLot: 0.01, lotStep: 0.01 } },
  { id: "cryBTCUSD", name: "BTC/USD", group: "Crypto", source: "deriv", symbol: "cryBTCUSD", smt: { symbol: "cryETHUSD", name: "ETH/USD" }, unit: 1, unitName: "dollars", spreadShare: 0.0002, weekendClosed: false, usdNews: false, digits: 2, spec: { contract: 1, minLot: 0.01, lotStep: 0.01 } },
  // Deriv's synthetic indices. Lot sizes are MT5 starting values; check them in MT5.
  { id: "R_25", name: "Volatility 25", group: "Synthetic indices", source: "deriv", symbol: "R_25", random: true, unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: false, usdNews: false, digits: 3, spec: { contract: 1, minLot: 0.5, lotStep: 0.01 } },
  { id: "R_50", name: "Volatility 50", group: "Synthetic indices", source: "deriv", symbol: "R_50", random: true, unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: false, usdNews: false, digits: 4, spec: { contract: 1, minLot: 4, lotStep: 0.01 } },
  { id: "R_75", name: "Volatility 75", group: "Synthetic indices", source: "deriv", symbol: "R_75", random: true, unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: false, usdNews: false, digits: 4, spec: { contract: 1, minLot: 0.001, lotStep: 0.001 } },
  { id: "1HZ25V", name: "Volatility 25 (1s)", group: "Synthetic indices", source: "deriv", symbol: "1HZ25V", random: true, unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: false, usdNews: false, digits: 2, spec: { contract: 1, minLot: 0.005, lotStep: 0.001 } },
  { id: "1HZ50V", name: "Volatility 50 (1s)", group: "Synthetic indices", source: "deriv", symbol: "1HZ50V", random: true, unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: false, usdNews: false, digits: 2, spec: { contract: 1, minLot: 0.005, lotStep: 0.001 } },
  { id: "1HZ75V", name: "Volatility 75 (1s)", group: "Synthetic indices", source: "deriv", symbol: "1HZ75V", random: true, unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: false, usdNews: false, digits: 2, spec: { contract: 1, minLot: 0.005, lotStep: 0.001 } }
];

/** The page opens on a live market, so "right now" has something to read. */
export const DEFAULT_MARKET = "frxGBPJPY";

/** The markets the All markets view starts with: the four Ibrahim sticks to for now. */
export const ALL_DEFAULT = ["frxCADJPY", "frxXAUUSD", "frxAUDJPY", "frxGBPJPY"];

/**
 * Live prices load as far back as Deriv sends 5-minute candles. This is only the oldest date asked
 * for; Deriv usually stops sooner (about 5 months for gold).
 */
export const MAX_HISTORY_DAYS = 3 * 365;
/** Most 5-minute candles kept for one market, so a phone doesn't run out of memory. */
export const MAX_CANDLES = 150000;

export const marketById = (id: string) => MARKETS.find((m) => m.id === id) ?? MARKETS[0];

const roundNice = (raw: number) => {
  if (!(raw > 0)) return 0;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return Math.round(raw / mag) * mag;
};

/** A starting spread for a market, in price units: a round number near the usual MT5 spread. */
export function defaultSpread(m: Market, lastPrice: number) {
  if (m.spread !== undefined) return m.spread;
  return roundNice((m.spreadShare ?? 0) * lastPrice);
}

/** "A pip or an inch" beyond the order block: a pip on forex, a set amount on metals, a sliver of the price elsewhere. */
export function defaultStopBuffer(m: Market, lastPrice: number) {
  if (m.buffer !== undefined) return m.buffer;
  if (m.unitName === "pips") return m.unit;
  return roundNice(0.00005 * lastPrice);
}

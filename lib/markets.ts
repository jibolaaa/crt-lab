// The markets the page can test, and how each one trades.

export type Group = "Built in" | "Forex" | "Metals" | "US indices" | "Crypto";

export interface Market {
  id: string;
  name: string;
  group: Group;
  source: "builtin" | "deriv";
  /** Deriv's symbol for live candles. */
  symbol?: string;
  /** A related market for the SMT check: did it sweep too? */
  smt?: { symbol: string; name: string };
  /** Size of one display unit of price (a pip for forex, 1 for metals, indices and crypto). */
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
  { id: "frxXAUUSD", name: "Gold (XAU/USD)", group: "Metals", source: "deriv", symbol: "frxXAUUSD", smt: { symbol: "frxXAGUSD", name: "silver" }, unit: 1, unitName: "dollars", spread: 0.3, buffer: 0.1, weekendClosed: true, usdNews: true, digits: 2, spec: { contract: 100, minLot: 0.01, lotStep: 0.01 } },
  { id: "frxXAGUSD", name: "Silver (XAG/USD)", group: "Metals", source: "deriv", symbol: "frxXAGUSD", smt: { symbol: "frxXAUUSD", name: "gold" }, unit: 1, unitName: "dollars", spread: 0.03, buffer: 0.01, weekendClosed: true, usdNews: true, digits: 3, spec: { contract: 5000, minLot: 0.01, lotStep: 0.01 } },
  { id: "OTC_NDX", name: "US Tech 100", group: "US indices", source: "deriv", symbol: "OTC_NDX", smt: { symbol: "OTC_SPC", name: "US 500" }, unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: true, usdNews: true, digits: 2, spec: { contract: 1, minLot: 0.01, lotStep: 0.01 } },
  { id: "OTC_SPC", name: "US 500", group: "US indices", source: "deriv", symbol: "OTC_SPC", smt: { symbol: "OTC_NDX", name: "US Tech 100" }, unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: true, usdNews: true, digits: 2, spec: { contract: 1, minLot: 0.01, lotStep: 0.01 } },
  { id: "OTC_DJI", name: "Wall Street 30", group: "US indices", source: "deriv", symbol: "OTC_DJI", smt: { symbol: "OTC_SPC", name: "US 500" }, unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: true, usdNews: true, digits: 2, spec: { contract: 1, minLot: 0.01, lotStep: 0.01 } },
  { id: "cryBTCUSD", name: "BTC/USD", group: "Crypto", source: "deriv", symbol: "cryBTCUSD", smt: { symbol: "cryETHUSD", name: "ETH/USD" }, unit: 1, unitName: "dollars", spreadShare: 0.0002, weekendClosed: false, usdNews: false, digits: 2, spec: { contract: 1, minLot: 0.01, lotStep: 0.01 } }
];

/**
 * The page opens on a live market, so "right now" has something to read.
 * Deriv's synthetic indices (Volatility 75 and the like) aren't offered: Deriv makes their
 * prices with a random number generator, so there's no liquidity or session for CRT to read.
 */
export const DEFAULT_MARKET = "frxEURUSD";

export const marketById = (id: string) => MARKETS.find((m) => m.id === id) ?? MARKETS[0];

/** History lengths offered for live Deriv candles, in months. They're 5-minute candles, so a year at most. */
export const HISTORY = [
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "1 year" }
];

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

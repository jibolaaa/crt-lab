// The markets the page can test, and how each one trades.

export type Group = "Built in" | "Forex" | "Gold" | "Synthetic indices" | "US indices";

export interface Market {
  id: string;
  name: string;
  group: Group;
  source: "builtin" | "deriv";
  /** Deriv's symbol for live candles. */
  symbol?: string;
  /** Size of one display unit of price (a pip for forex, 1 for gold, indices and synthetics). */
  unit: number;
  unitName: string;
  /** Default spread in price units, or as a share of the price for markets quoted in big numbers. */
  spread?: number;
  spreadShare?: number;
  /** Closed at weekends: the short Sunday session joins Monday. */
  weekendClosed: boolean;
  /** Moves on US news, so the jobs-report rest day applies. */
  usdNews: boolean;
  digits: number;
  /** MT5 contract: units per 1.00 lot, the smallest lot and the lot step. Starting values; check them in MT5. */
  spec: Spec;
}

export interface Spec { contract: number; minLot: number; lotStep: number }

const FX: Spec = { contract: 100000, minLot: 0.01, lotStep: 0.01 };

export const MARKETS: Market[] = [
  { id: "eurusd-2014", name: "EUR/USD 2014 to 2021", group: "Built in", source: "builtin", unit: 0.0001, unitName: "pips", spread: 0.0001, weekendClosed: true, usdNews: true, digits: 5, spec: FX },
  { id: "frxEURUSD", name: "EUR/USD", group: "Forex", source: "deriv", symbol: "frxEURUSD", unit: 0.0001, unitName: "pips", spread: 0.0001, weekendClosed: true, usdNews: true, digits: 5, spec: FX },
  { id: "frxGBPUSD", name: "GBP/USD", group: "Forex", source: "deriv", symbol: "frxGBPUSD", unit: 0.0001, unitName: "pips", spread: 0.00015, weekendClosed: true, usdNews: true, digits: 5, spec: FX },
  { id: "frxXAUUSD", name: "Gold (XAU/USD)", group: "Gold", source: "deriv", symbol: "frxXAUUSD", unit: 1, unitName: "dollars", spread: 0.3, weekendClosed: true, usdNews: true, digits: 2, spec: { contract: 100, minLot: 0.01, lotStep: 0.01 } },
  { id: "R_75", name: "Volatility 75", group: "Synthetic indices", source: "deriv", symbol: "R_75", unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: false, usdNews: false, digits: 2, spec: { contract: 1, minLot: 0.001, lotStep: 0.001 } },
  { id: "1HZ75V", name: "Volatility 75 (1s)", group: "Synthetic indices", source: "deriv", symbol: "1HZ75V", unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: false, usdNews: false, digits: 2, spec: { contract: 1, minLot: 0.005, lotStep: 0.001 } },
  { id: "OTC_NDX", name: "US Tech 100", group: "US indices", source: "deriv", symbol: "OTC_NDX", unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: true, usdNews: true, digits: 2, spec: { contract: 1, minLot: 0.01, lotStep: 0.01 } },
  { id: "OTC_SPC", name: "US 500", group: "US indices", source: "deriv", symbol: "OTC_SPC", unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: true, usdNews: true, digits: 2, spec: { contract: 1, minLot: 0.01, lotStep: 0.01 } },
  { id: "OTC_DJI", name: "Wall Street 30", group: "US indices", source: "deriv", symbol: "OTC_DJI", unit: 1, unitName: "points", spreadShare: 0.0001, weekendClosed: true, usdNews: true, digits: 2, spec: { contract: 1, minLot: 0.01, lotStep: 0.01 } }
];

/** The page opens on a live market, so "right now" has something to read. */
export const DEFAULT_MARKET = "R_75";

export const marketById = (id: string) => MARKETS.find((m) => m.id === id) ?? MARKETS[0];

/** History lengths offered for live Deriv candles, in months. */
export const HISTORY = [
  { months: 3, label: "3 months" },
  { months: 12, label: "1 year" },
  { months: 24, label: "2 years" },
  { months: 60, label: "Up to 5 years" }
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

/** "A pip or an inch" beyond the order block: a pip on forex, 10 cents on gold, a sliver of the price elsewhere. */
export function defaultStopBuffer(m: Market, lastPrice: number) {
  if (m.unitName === "pips") return m.unit;
  if (m.unitName === "dollars") return 0.1;
  return roundNice(0.00005 * lastPrice);
}

// Shared shapes for the CRT Lab engine. Prices in a Series are bid prices;
// the ask is bid + spread.

export type Dir = 1 | -1; // 1 = buy (bullish setup), -1 = sell (bearish setup)

/** 15-minute candles, one array per field, oldest first. */
export interface Series {
  n: number;
  t: ArrayLike<number>; // UTC seconds, start of the candle
  o: ArrayLike<number>;
  h: ArrayLike<number>;
  l: ArrayLike<number>;
  c: ArrayLike<number>;
}

/** A higher-timeframe candle built from 15-minute ones. */
export interface Bar {
  key: number; // day or week number in the chosen calendar
  t: number; // time of its first 15-minute candle
  tEnd: number; // time of its last 15-minute candle
  o: number;
  h: number;
  l: number;
  c: number;
  i0: number; // index of its first 15-minute candle
  i1: number; // index of its last 15-minute candle
}

export type BiasMode = "off" | "weeklyCrt" | "structure" | "premiumDiscount" | "majority" | "allAgree";
export type ZoneMode = "obFvg" | "fvg" | "ob" | "off";
export type Timing = "sameDay" | "nextDay" | "either";
export type Session = "asian" | "london" | "newyork";
export type DayStart = "utc" | "nyClose";
export type StopMode = "sweep" | "pullback" | "ob";
/** Higher timeframes for key levels: 4-hour, daily, weekly. */
export type Tf = "h4" | "d1" | "w1";
export type LevelKind = "ob" | "breaker" | "fvg";
export type Grade = "A+" | "A" | "B" | "C";

/** The confluences a trade is graded on, in display order. */
export const CONFLUENCES = ["keyLevel", "weeklyBias", "mtf", "discount", "obFvg", "fib", "gann", "killzone", "ifvg", "displacement"] as const;
export type ConfKey = (typeof CONFLUENCES)[number];

export interface Config {
  bias: BiasMode;
  zone: ZoneMode;
  timing: Timing;
  /** No new trades on US jobs-report (NFP) days. Only used for markets that move on USD news. */
  newsGuard: boolean;
  /** Empty = any time. Otherwise entries only inside these sessions (Lagos time windows in sessions.ts). */
  sessions: Session[];
  /** Close half at the 50% level and move the stop to the entry price. */
  partialAtTp1: boolean;
  /** Close whatever is left at the end of the day after the sweep day (candle 3). */
  timeStop: boolean;
  /** Spread in price units (EURUSD 1 pip = 0.0001). */
  spread: number;
  /**
   * "ob": beyond the 1-hour order block in the entry zone (the zone's edge if it has no order block, the sweep if there's no zone).
   * "sweep": beyond the sweep's wick. "pullback": beyond the dip into the zone just before the shift.
   */
  stop: StopMode;
  /** Extra room beyond the stop level, in price units (about a pip). */
  stopBuffer: number;
  /** Candle 2's sweep must reach a higher-timeframe key level for the CRT to count. */
  requireKeyLevel: boolean;
  keyLevelTfs: Tf[];
  keyLevelKinds: LevelKind[];
  /** Skip trades whose target is less than this many R away. */
  minR: number;
  /** Trades between minR and this need at least `lowRGrade`. */
  fullR: number;
  lowRGrade: Grade | "any";
  /** The target never sits more than this many R away. */
  maxR: number;
  /** Most new trades in one day (0 = no limit). */
  maxPerDay: number;
  dayStart: DayStart;
  /** Markets that close at weekends: fold the short Sunday session into Monday. */
  weekendClosed: boolean;
  /** Bars on each side that make a swing high or low on the 15-minute chart. */
  swing15: number;
  /** Bars on each side for weekly swings (structure and premium/discount bias). */
  swingWeekly: number;
  /** Whether red folder (USD) news applies to this market. */
  usdNews: boolean;
}

export const DEFAULT_CONFIG: Config = {
  bias: "majority",
  zone: "obFvg",
  timing: "either",
  newsGuard: true,
  sessions: [],
  partialAtTp1: false,
  timeStop: true,
  spread: 0.0001,
  stop: "ob",
  stopBuffer: 0.0001,
  requireKeyLevel: true,
  keyLevelTfs: ["h4", "d1", "w1"],
  keyLevelKinds: ["ob", "breaker", "fvg"],
  minR: 2,
  fullR: 3,
  lowRGrade: "A+",
  maxR: 6,
  maxPerDay: 3,
  dayStart: "utc",
  weekendClosed: true,
  swing15: 2,
  swingWeekly: 2,
  usdNews: true
};

export type ExitReason = "tp2" | "stop" | "breakeven" | "time" | "end";

export interface Zone {
  top: number;
  bottom: number;
  t: number; // when it was formed (end of the 1-hour candle that completed it)
  fvg?: { top: number; bottom: number; t: number };
  ob?: { top: number; bottom: number; t: number };
}

export interface Trade {
  id: number;
  dir: Dir;
  // the CRT
  rangeDayT: number; // start of candle 1 (the range day)
  sweepDayT: number; // start of candle 2 (the sweep day)
  rangeHigh: number;
  rangeLow: number;
  mid: number;
  sweepT: number;
  sweepPrice: number;
  bias: number; // weekly bias that week: 1, -1 or 0
  // the entry
  zone: Zone | null;
  touchT: number | null;
  mssLevel: number;
  mssT: number; // time of the swing that was broken
  entryT: number; // close time of the 15-minute candle that broke structure
  entry: number; // fill price (ask for buys, bid for sells)
  stop: number;
  tp1: number; // the range's 50% level
  tp2: number; // the final target
  partial: boolean; // half comes off at tp1
  risk: number; // entry to stop, in price
  plannedR: number; // how many R the final target was away at entry
  sameDay: boolean; // entered on the sweep day (true) or the day after (false)
  keyLevel: { tf: Tf; kind: LevelKind; top: number; bottom: number; t: number } | null;
  conf: Record<ConfKey, boolean>;
  score: number; // how many confluences were met
  grade: Grade;
  // the result
  partialT: number | null;
  exitT: number;
  exit: number;
  reason: ExitReason;
  r: number; // result in R (multiples of the risk)
}

export interface Stats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number; // 0..1
  avgR: number;
  totalR: number;
  profitFactor: number | null;
  maxDrawdownR: number;
  longestLosingStreak: number;
  tradesPerMonth: number;
  from: number;
  to: number;
}

export interface Funnel {
  days: number; // trading days looked at
  sweeps: number; // days where the range was swept in an allowed direction
  biasBlocked: number; // sweeps skipped because they went against the weekly bias
  keyLevels: number; // sweeps that reached a higher-timeframe key level
  zones: number; // sweeps that formed a 1-hour zone
  touches: number; // zones that price came back into
  entries: number; // trades taken
  skippedNews: number;
  skippedSession: number;
  skippedPastMid: number; // structure broke after price was already at the 50% level
  skippedLowR: number; // the target was too close for the rules
  skippedDailyCap: number; // already at the most trades for the day
}

/** Where a setup stands at the last closed candle. */
export type LiveStage =
  | "blocked" // the weekly bias rules this direction out this week
  | "waiting" // candle 2 hasn't taken candle 1's high or low yet
  | "noKey" // it took it, but not into a fresh key level
  | "key" // swept into a key level; waiting for a 1-hour zone
  | "zone" // zone ready; waiting for price to come back into it
  | "touched" // in the zone; waiting for a 15-minute close beyond `level`
  | "entered"
  | "ended"; // cancelled or skipped: see `why`

export interface LiveSetup {
  dir: Dir;
  fromYesterday: boolean; // swept yesterday, can still enter today (or its trade is still running)
  stage: LiveStage;
  rangeDate: number; // candle 1's trading date, as midnight UTC
  sweepDate: number; // candle 2's trading date, as midnight UTC
  why: string | null;
  rangeHigh: number;
  rangeLow: number;
  mid: number;
  sweepPrice: number | null;
  keyLevel: Trade["keyLevel"];
  zone: Zone | null;
  level: number | null;
  skipR: number | null;
  trade: Trade | null;
}

export interface Live {
  asOf: number; // close time of the last candle
  dayStart: number; // time of today's first candle
  date: number; // today's trading date, as midnight UTC
  bias: number | null; // this week's bias, or null when the bias rule is off
  setups: LiveSetup[];
}

export interface RunResult {
  trades: Trade[];
  funnel: Funnel;
  live: Live | null;
  splitT: number; // first 70% of the period is "seen", the rest "unseen"
  seen: Stats;
  unseen: Stats;
  all: Stats;
  from: number;
  to: number;
}

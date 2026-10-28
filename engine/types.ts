// Shared shapes for the CRT Lab engine. Prices in a Series are bid prices;
// the ask is bid + spread.

export type Dir = 1 | -1; // 1 = buy (bullish setup), -1 = sell (bearish setup)

/** Candles of one size (5 or 15 minutes), one array per field, oldest first. */
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

/**
 * The first six are the old rules' weekly bias. Model 1 reads structure from swings: lower highs and
 * lower lows for sells, higher highs and higher lows for buys. "weeklyDaily": the weekly and the
 * daily both agree. "weeklySwings" or "dailySwings": that chart alone.
 */
export type BiasMode = "off" | "weeklyCrt" | "structure" | "premiumDiscount" | "majority" | "allAgree" | "weeklyDaily" | "weeklySwings" | "dailySwings";
/** "any": an order block or a gap, joined when they overlap. "obFvg": a gap with the order block before it. */
/**
 * "sweep": the order block is the candle that made the sweep (the last up candle at a swept high,
 * the last down candle at a swept low), the whole candle. When that 1-hour candle closed the other
 * way, the 2-hour and then the 4-hour candle that made the sweep is used instead (4-hour, 8-hour and
 * daily for weekly CRTs).
 */
export type ZoneMode = "sweep" | "any" | "obFvg" | "fvg" | "ob" | "off";
export type Timing = "sameDay" | "nextDay" | "either";
export type Session = "asian" | "london" | "newyork";
export type DayStart = "utc" | "nyClose";
export type StopMode = "sweep" | "pullback" | "ob";
/** Higher timeframes for key levels: 4-hour, daily, weekly. */
export type Tf = "h4" | "d1" | "w1";
/**
 * Old high or low purged, order block, fair value gap, rejection block, breaker block, and a flip:
 * an old swing low that price closed below, now resistance (an old swing high closed above, now support).
 */
export type LevelKind = "old" | "ob" | "fvg" | "rb" | "breaker" | "flip";
/** Why a key level fits the structure (Model 1), for a sell (buys are the mirror image). */
export type KeyFit =
  | "supply" // the order block of the last lower high: where the last drop to a lower low started
  | "flip" // where price broke down from: old support, now resistance (or a breaker block)
  | "leg" // an order block or gap the latest drop left on its way down
  | "premium" // any zone above the middle of the latest swing range
  | "any"; // the structure check is off
/** The candle that sets the range: a 4-hour candle (Model 1 only), the day before, or the week before. */
export type CrtTf = "h4" | "day" | "week";
/**
 * Shift: in the zone, a market order on the close that breaks structure (the BOS).
 * Retest: after that BOS, a limit at the order block it left.
 * QM: a limit at the Quasimodo line after the A-shape and the shift.
 * Model 1: the three-candle CRT (range, inside candles, sweep); after the MSS and the inducement,
 * a limit at the order block (see model1.ts).
 */
export type EntryModel = "shift" | "retest" | "qm" | "model1";

/** The checklist behind the percent, in display order. The first five are about direction and count double. */
export const CONFLUENCES = [
  "weeklyBias", "weeklyCrt", "mtf", "discount", "strongKey",
  "obFvg", "fib", "gann", "ifvg", "killzone", "displacement", "smt", "oldLiquidity"
] as const;
export type ConfKey = (typeof CONFLUENCES)[number];
export const WEIGHT: Record<ConfKey, number> = {
  weeklyBias: 2, weeklyCrt: 2, mtf: 2, discount: 2, strongKey: 2,
  obFvg: 1, fib: 1, gann: 1, ifvg: 1, killzone: 1, displacement: 1, smt: 1, oldLiquidity: 1
};
/** A check is true or false, or null when it can't apply (no partner market for SMT, say). */
export type Checklist = Record<ConfKey, boolean | null>;

export interface Config {
  /** Which CRTs to look for. */
  crt: CrtTf[];
  /** How the entry is taken. */
  entry: EntryModel;
  /** The weekly bias as a gate. "off" means it only counts toward the percent. */
  bias: BiasMode;
  /**
   * Which way to trade. "auto": buys only on markets that tend to rise over time (US indices,
   * see `driftUp`), both ways elsewhere.
   */
  side: "auto" | "both" | "buys" | "sells";
  /** This market tends to rise over time (stock indices). Set by the page for each market. */
  driftUp: boolean;
  /** The 1-hour zone for the BOS entries (4-hour for weekly CRTs). */
  zone: ZoneMode;
  /** The zone has to sit in the killer zone, between candle 1's body and the sweep's tip. */
  zoneInKiller: boolean;
  /** "nextDay": from candle 3, once candle 2 closed back inside. "sameDay": during candle 2 only. "either": both. */
  timing: Timing;
  /** How many candles after candle 2 an entry can still come (1 = candle 3 only). */
  entryWindow: number;
  /** A later candle can sweep further without cancelling; the range holds until a candle closes outside it. */
  deeperSweeps: boolean;
  /** Reaching the 50% level before the entry cancels the setup (the first version's rule). */
  midCancels: boolean;
  /** A key level must be untouched before this candle. */
  freshFrom: "candle1" | "candle2";
  /** No new trades on US jobs-report (NFP) days. Only used for markets that move on USD news. */
  newsGuard: boolean;
  /** Empty = any time. Otherwise entries only inside these sessions. */
  sessions: Session[];
  /** Close half at the 50% level and move the stop to the entry price. */
  partialAtTp1: boolean;
  /** Close whatever is left at the end of the candle after the entry's (the next day, or the next week). */
  timeStop: boolean;
  /** Spread in price units (EURUSD 1 pip = 0.0001). */
  spread: number;
  /**
   * "ob": beyond the 1-hour order block (4-hour for weekly CRTs).
   * "sweep": beyond the sweep's wick. "pullback": beyond the last turn before the entry.
   */
  stop: StopMode;
  /** Extra room beyond the stop level, in price units (about a pip). */
  stopBuffer: number;
  /** Candle 2's sweep must reach a higher-timeframe key level for the CRT to count. */
  requireKeyLevel: boolean;
  /** Timeframes for daily CRTs' key levels. Weekly CRTs use the daily and weekly ones among them. */
  keyLevelTfs: Tf[];
  keyLevelKinds: LevelKind[];
  /** Skip trades whose target is less than this many R away. */
  minR: number;
  /** Trades between minR and this need at least `lowRPct` percent. */
  fullR: number;
  lowRPct: number;
  /** The target never sits more than this many R away (1000 or more = no cap). */
  maxR: number;
  /** Checks every trade must meet. A check that doesn't apply (SMT with no related market, say) passes. */
  mustHave: ConfKey[];
  /** The lowest checklist percent for any trade (0 = any percent). */
  minPct: number;
  /** Most new trades in one day (0 = no limit). */
  maxPerDay: number;
  dayStart: DayStart;
  /** Markets that close at weekends: fold the short Sunday session into Monday. */
  weekendClosed: boolean;
  /** Candles on each side that make a swing on the entry chart. */
  swing15: number;
  /** Candles on each side for weekly swings (structure and premium/discount). */
  swingWeekly: number;
  /** Whether red folder (USD) news applies to this market. */
  usdNews: boolean;
  /**
   * Model 1: how many candles after the sweep candle the key level hit and the entry can still come,
   * while the candles keep closing inside the range (0 = the sweep candle only).
   */
  sweepWindow: number;
  /** Model 1: the entry has to sit inside the key level. */
  keyInside: boolean;
  /** Model 1: the key level has to fit the structure (see KeyFit). Off: any fresh level counts. */
  keyFit: boolean;
  /** Model 1: the stop goes past the sweep's tip ("tip") or just past the order block candle ("candle"). */
  obStop: "tip" | "candle";
  /** Model 1: the chart the MSS, inducement and entry are read on. "auto": 5-minute for 4-hour ranges, 15-minute for daily, 30-minute for weekly. */
  entryChart: EntryChart;
}

export type EntryChart = "auto" | "m5" | "m15" | "m30";

/** The old rules: a day or week as candle 1, candle 2 sweeps it, then a 1-hour zone and a 5-minute BOS. */
export const CLASSIC_CONFIG: Config = {
  crt: ["day", "week"],
  entry: "shift",
  bias: "off",
  side: "auto",
  driftUp: false,
  zone: "sweep",
  zoneInKiller: true,
  timing: "either", // entries in candle 2 (after the sweep) or candle 3
  entryWindow: 3,
  deeperSweeps: true,
  midCancels: false,
  freshFrom: "candle1",
  newsGuard: true,
  sessions: [],
  partialAtTp1: true, // TP1: half closes at candle 1's 50% level, then the stop moves to the entry
  timeStop: false, // trades run until the stop or the target
  spread: 0.0001,
  stop: "ob",
  stopBuffer: 0.0001,
  requireKeyLevel: true,
  keyLevelTfs: ["h4", "d1", "w1"],
  keyLevelKinds: ["old", "ob", "fvg", "rb"],
  minR: 2,
  fullR: 3,
  lowRPct: 0,
  maxR: 4, // the best cap on the first 70% of EUR/USD 2014 to 2021 with these rules (see npm run report)
  mustHave: [],
  minPct: 0, // every setup, with its checklist percent. 60% did best on EUR/USD 2014 to 2021 but takes far fewer trades
  maxPerDay: 3,
  dayStart: "utc",
  weekendClosed: true,
  swing15: 2,
  swingWeekly: 2,
  usdNews: true,
  sweepWindow: 2,
  keyInside: true,
  keyFit: true,
  obStop: "tip",
  entryChart: "auto"
};

/** What switching to each model sets. */
export const MODEL_RULES: Record<"model1" | "classic", Partial<Config>> = {
  model1: {
    entry: "model1", crt: ["h4", "day"], bias: "weeklyDaily", keyLevelKinds: ["ob", "fvg", "rb", "breaker", "flip"],
    maxR: 1000, minR: 2, partialAtTp1: true, timeStop: false, mustHave: [], minPct: 0, midCancels: false
  },
  classic: {
    entry: "shift", crt: ["day", "week"], bias: "off", keyLevelKinds: ["old", "ob", "fvg", "rb"],
    maxR: 4, minR: 2, partialAtTp1: true, timeStop: false, mustHave: [], minPct: 0, midCancels: false
  }
};

/**
 * The page's rules: Model 1, the three-candle CRT. For a sell: a range candle (4-hour or daily), one or
 * more inside candles, then a candle that takes the range high into a key level that fits the
 * structure, while the weekly and daily structure are both bearish. Then an MSS, the inducement, and a
 * limit at the order block. See model1.ts.
 */
export const DEFAULT_CONFIG: Config = { ...CLASSIC_CONFIG, ...MODEL_RULES.model1 };

export type ExitReason = "tp2" | "stop" | "breakeven" | "time" | "end";

export interface Zone {
  top: number;
  bottom: number;
  t: number; // when it was formed (end of the candle that completed it)
  fvg?: { top: number; bottom: number; t: number };
  ob?: { top: number; bottom: number; t: number };
  /** Hours per candle of the chart the zone came from. */
  tfH?: number;
  /** The candle that made the sweep. */
  sweep?: boolean;
}

export interface KeyLevelInfo { tf: Tf; kind: LevelKind; top: number; bottom: number; t: number; fit?: KeyFit }

/** The QM entry: the A-shape top (head), the line it came from (shoulder), and the shift. */
export interface QmInfo {
  level: number; // the QM line: the shoulder, where the limit sits
  shoulderT: number;
  head: number; // the A-shape top (bottom for buys)
  headT: number;
  smsLevel: number; // the low (high for buys) a close broke
  smsT: number; // close time of the candle that broke it
}

export interface Trade {
  id: number;
  dir: Dir;
  tf: CrtTf;
  model: EntryModel;
  // the CRT
  rangeDayT: number; // start of candle 1
  sweepDayT: number; // start of candle 2
  rangeHigh: number;
  rangeLow: number;
  mid: number;
  /** Candle 1's body edge on the swept side: the inner edge of the killer zone. */
  bodyEdge: number;
  sweepT: number;
  sweepPrice: number; // the furthest the sweep went before the entry
  bias: number; // weekly structure that week: 1, -1 or 0
  // the entry
  zone: Zone | null;
  touchT: number | null;
  mssLevel: number; // the swing (BOS entries) or low/high (QM) that a close broke
  mssT: number;
  qm: QmInfo | null;
  /** Retest entry: the order block the BOS left, where the limit sat. */
  retest: { level: number; top: number; bottom: number; obT: number; bosT: number } | null;
  /** Model 1: inside candles in the range, the inducement, and where the limit sat. */
  /** Model 1: the details only it has. */
  m1?: M1Info | null;
  entryT: number; // close time of the candle the entry happened in
  entry: number; // fill price (ask for buys, bid for sells)
  stop: number;
  tp1: number; // the range's 50% level
  tp2: number; // the final target
  partial: boolean; // half comes off at tp1
  risk: number; // entry to stop, in price
  plannedR: number; // how many R the final target was away at entry
  sameDay: boolean; // entered during candle 2
  entryCandle: number; // 2 for candle 2, 3 for candle 3, and so on
  keyLevel: KeyLevelInfo | null;
  conf: Checklist;
  points: number;
  maxPoints: number;
  pct: number; // points out of maxPoints, 0 to 100
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
  days: number; // candle 2s looked at (days and weeks)
  sweeps: number; // candle 2 took candle 1's high or low in an allowed direction
  biasBlocked: number; // sweeps skipped because they went against the weekly bias
  keyLevels: number; // sweeps that reached a higher-timeframe key level
  closedInside: number; // candle 2 closed back inside candle 1's range (and the key level was found)
  zones: number; // shift entry: a zone formed. QM entry: an A-shape and shift set a limit
  touches: number; // shift entry: price came back into the zone. QM entry: the limit was reached
  entries: number; // trades taken
  skippedNews: number;
  skippedSession: number;
  skippedPastMid: number; // the entry was already past the 50% level
  skippedLowR: number; // the target was too close for the rules
  skippedDailyCap: number; // already at the most trades for the day
  skippedChecks: number; // short of the must-have checks or the lowest percent
  skippedOverlap: number; // already in a trade the same way on the same CRT
}

/** Where a setup stands at the last closed candle. */
/** Model 1: what a trade or setup holds beyond the shared fields. */
export interface M1Info {
  inside: number; // inside candles after the range candle
  entryDt: number; // seconds per candle on the entry chart
  /** The swing the MSS closed through: its candle's time. */
  mssFrom: number;
  idm: number; // the inducement: the first pullback's high (low for buys) after the MSS
  idmT: number;
  limit: number; // where the order sat: the order block, no closer than the inducement
  after: number; // candles after the sweep candle the entry came in (0 = the sweep candle)
}

export type LiveStage =
  | "blocked" // the bias rules this direction out (the weekly bias; Model 1: the weekly and daily structure)
  | "waiting" // candle 2 hasn't taken candle 1's high or low yet
  | "noKey" // it took it, but not into a fresh key level
  | "swept" // QM: swept into a key level, candle 2 still forming
  | "armed" // QM: waiting for price in the killer zone to make an A-shape and shift
  | "limit" // QM or retest: a limit is waiting
  | "key" // shift: swept into a key level; waiting for a zone
  | "zone" // shift: zone ready; waiting for price to come back into it
  | "touched" // shift: in the zone; waiting for a close beyond `level`
  | "mss" // Model 1: the MSS happened; waiting for the first pullback (the inducement)
  | "entered"
  | "ended"; // cancelled or skipped: see `why`

export interface Call { pct: number; points: number; maxPoints: number; conf: Checklist }

export interface LiveSetup {
  tf: CrtTf;
  dir: Dir;
  /** Candle 2 is an earlier day (or week) than the current one. */
  fromYesterday: boolean;
  /** Candles since candle 2: 0 while candle 2 is still forming. */
  age: number;
  stage: LiveStage;
  rangeDate: number; // candle 1's trading date, as midnight UTC (a week's Monday for weekly CRTs)
  sweepDate: number; // candle 2's trading date
  why: string | null;
  rangeHigh: number;
  rangeLow: number;
  mid: number;
  bodyEdge: number;
  sweepPrice: number | null;
  keyLevel: KeyLevelInfo | null;
  zone: Zone | null;
  level: number | null; // shift: the close that would enter
  /** QM, waiting: the latest A-shape top, the close that would set the limit, and the QM line. */
  pending: { head: number; sms: number; qm: number } | null;
  /** A waiting limit order (QM or retest) with its stop and target. */
  order: { level: number; stop: number; target: number; r: number } | null;
  call: Call | null;
  skipR: number | null;
  trade: Trade | null;
  /** Model 1: how far it got. */
  m1?: {
    inside: number;
    entryDt: number;
    mss: number | null;
    ob: { top: number; bottom: number } | null;
    idm: number | null;
  };
}

export interface Live {
  asOf: number; // close time of the last candle
  dayStart: number; // time of today's first candle
  date: number; // today's trading date, as midnight UTC
  weekDate: number; // this week's Monday, as midnight UTC
  /** This week's weekly structure: 1, -1 or 0. */
  bias: number;
  /** The weekly bias rule in use as a gate, or null when it only counts toward the percent. */
  biasGate: BiasMode | null;
  /** Model 1: the weekly and daily structure from swings, as of the last finished week and day: 1, -1 or 0. */
  swings?: { weekly: number; daily: number };
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
  /** Whether a partner market was there for the SMT check. */
  smt: boolean;
}

// Messages between the page and the engine worker.
import type { Config, RunResult } from "../engine";
import type { ScanRow } from "./scan";

export interface DataInfo {
  marketId: string;
  count: number;
  /** Seconds per candle: 300 or 900. */
  dt: number;
  from: number;
  to: number;
  lastClose: number;
  pipSize: number | null;
  /** Why the history is shorter than asked, if it is. */
  shortBy: string | null;
  /** The related market loaded for the SMT check, if any, and a note when it couldn't be. */
  smt: { name: string; ok: boolean } | null;
}

/** What the worker holds for one set of candles. */
export interface StoredInfo {
  key: string;
  count: number;
  dt: number;
  from: number;
  to: number;
  lastClose: number;
  pipSize: number | null;
  shortBy: string | null;
}

/** Candle columns, oldest first. */
export interface Columns { t: Float64Array; o: Float64Array; h: Float64Array; l: Float64Array; c: Float64Array }

/** One target cap tried on the current rules. */
export interface TargetRow {
  cap: number; // R, 1000 or more for no cap
  trades: number;
  winRate: number;
  avgR: number;
  totalR: number;
  seenR: number; // first 70%
  lateTrades: number;
  lateR: number; // last 30%
}

export interface MatterRow {
  key: string;
  label: string;
  trades: number;
  totalR: number;
  avgR: number;
  lateTrades: number;
  lateR: number;
}

/** One market in an All markets run: its stored candles and its own copy of the rules. */
export interface ScanMarket { marketId: string; key: string; partnerKey: string | null; cfg: Config }

export type ToWorker =
  | { type: "load"; job: number; marketId: string; key: string; url: string }
  | {
      type: "store"; job: number; key: string;
      t: Float64Array; o: Float64Array; h: Float64Array; l: Float64Array; c: Float64Array;
      pipSize: number | null; shortBy: string | null;
    }
  | { type: "use"; job: number; marketId: string; key: string; partnerKey: string | null; smt: { name: string; ok: boolean } | null }
  | { type: "run"; job: number; cfg: Config; matters: boolean }
  | { type: "candles"; job: number; from: number; to: number }
  | { type: "scan"; job: number; gen: number; markets: ScanMarket[] };

export type FromWorker =
  | { type: "progress"; job: number; text: string; fraction?: number }
  | { type: "loaded"; job: number; info: DataInfo }
  | { type: "stored"; job: number; info: StoredInfo }
  | { type: "result"; job: number; result: RunResult }
  | { type: "matters"; job: number; rows: MatterRow[] }
  | { type: "targets"; job: number; rows: TargetRow[] }
  | { type: "candles"; job: number; t: number[]; o: number[]; h: number[]; l: number[]; c: number[] }
  | { type: "scanRow"; job: number; gen: number; row: ScanRow }
  | { type: "error"; job: number; message: string };

/** A message to the worker before it gets its job number. */
export type Request = ToWorker extends infer T ? (T extends unknown ? Omit<T, "job"> : never) : never;

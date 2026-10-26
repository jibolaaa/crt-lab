// Messages between the page and the engine worker.
import type { Config, RunResult } from "../engine";

export interface DataInfo {
  marketId: string;
  count: number;
  from: number;
  to: number;
  lastClose: number;
  pipSize: number | null;
  /** Why the history is shorter than asked, if it is. */
  shortBy: string | null;
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

export type ToWorker =
  | { type: "load"; job: number; marketId: string; url?: string; symbol?: string; from?: number }
  | { type: "run"; job: number; cfg: Config; matters: boolean }
  | { type: "candles"; job: number; from: number; to: number };

export type FromWorker =
  | { type: "progress"; job: number; text: string; fraction?: number }
  | { type: "loaded"; job: number; info: DataInfo }
  | { type: "result"; job: number; result: RunResult }
  | { type: "matters"; job: number; rows: MatterRow[] }
  | { type: "candles"; job: number; t: number[]; o: number[]; h: number[]; l: number[]; c: number[] }
  | { type: "error"; job: number; message: string };

/** A message to the worker before it gets its job number. */
export type Request = ToWorker extends infer T ? (T extends unknown ? Omit<T, "job"> : never) : never;

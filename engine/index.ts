export * from "./types";
export { prepare, runBacktest, sideAllows, type Prepared } from "./backtest";
export { stats, compound } from "./stats";
export { swingBias, runModel1Pass } from "./model1";
export { nfpRelease, nfpTimes, dayKey, inSessions, usDst } from "./calendar";

import type { Series } from "./types";

/** Read the compact candle file: Uint32 times, then Float32 open, high, low, close. */
export function seriesFromBuffer(buf: ArrayBuffer): Series {
  const n = buf.byteLength / 20;
  if (!Number.isInteger(n)) throw new Error("Candle file has the wrong size.");
  return {
    n,
    t: new Uint32Array(buf, 0, n),
    o: new Float32Array(buf, 4 * n, n),
    h: new Float32Array(buf, 8 * n, n),
    l: new Float32Array(buf, 12 * n, n),
    c: new Float32Array(buf, 16 * n, n)
  };
}

/** Candles as plain arrays (from Deriv), sorted and without duplicates. */
export function seriesFromCandles(rows: { epoch: number; open: number; high: number; low: number; close: number }[]): Series {
  const byT = new Map<number, (typeof rows)[number]>();
  for (const r of rows) byT.set(r.epoch, r);
  const sorted = [...byT.values()].sort((a, b) => a.epoch - b.epoch);
  return {
    n: sorted.length,
    t: sorted.map((r) => r.epoch),
    o: sorted.map((r) => +r.open),
    h: sorted.map((r) => +r.high),
    l: sorted.map((r) => +r.low),
    c: sorted.map((r) => +r.close)
  };
}

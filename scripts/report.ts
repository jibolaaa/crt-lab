// Prints results for a set of rule combinations on the built-in EURUSD data.
// Run from the project folder: npm run report
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFLUENCES, DEFAULT_CONFIG, prepare, runBacktest, seriesFromBuffer, compound, type Config, type Trade } from "../engine/index";

const buf = readFileSync(join(process.cwd(), "public/data/eurusd-15m.bin"));
const s = seriesFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const p = prepare(s, DEFAULT_CONFIG);

const CLASSIC: Partial<Config> = {
  crt: ["day"], entry: "shift", timing: "either", entryWindow: 1, deeperSweeps: false, midCancels: true, freshFrom: "candle2",
  keyLevelKinds: ["ob", "breaker", "fvg"], bias: "majority",
  requireKeyLevel: false, stop: "sweep", stopBuffer: 0, partialAtTp1: true, minR: 0, fullR: 0, lowRPct: 0, maxR: 1000, maxPerDay: 0
};
const rows: [string, Partial<Config>][] = [
  ["Today's rules", {}],
  ["  daily CRTs only", { crt: ["day"] }],
  ["  weekly CRTs only", { crt: ["week"] }],
  ["  shift entry instead of QM", { entry: "shift" }],
  ["  no key level needed", { requireKeyLevel: false }],
  ["  key levels: OB and FVG only", { keyLevelKinds: ["ob", "fvg"] }],
  ["  key level fresh before candle 2", { freshFrom: "candle2" }],
  ["  a deeper sweep cancels", { deeperSweeps: false }],
  ["  entries from candle 2", { timing: "either" }],
  ["  2R to 3R at any percent", { lowRPct: 0 }],
  ["  no minimum R", { minR: 0, fullR: 0 }],
  ["  target capped at 6R", { maxR: 6 }],
  ["  stop beyond the sweep", { stop: "sweep" }],
  ["  weekly structure as a gate", { bias: "structure" }],
  ["  no day-after close", { timeStop: false }],
  ["First version's rules", CLASSIC]
];

const f = (x: number | null, d = 2) => (x === null ? "inf" : x.toFixed(d));
const pad = (x: string, n: number) => x.padEnd(n);
console.log(pad("rules", 36), "trades  /mo   win%   avgR   totalR  PF    maxDD  | last 30%: n  win%  avgR  totalR | 1%risk growth  maxDD%");
for (const [name, over] of rows) {
  const cfg: Config = { ...DEFAULT_CONFIG, ...over };
  const r = runBacktest(p, cfg);
  const a = r.all, u = r.unseen;
  const g = compound(r.trades, 1);
  console.log(
    pad(name, 36),
    String(a.trades).padStart(6), f(a.tradesPerMonth, 1).padStart(5), (a.winRate * 100).toFixed(0).padStart(5) + "%",
    f(a.avgR).padStart(6), f(a.totalR, 1).padStart(8), f(a.profitFactor).padStart(5), f(a.maxDrawdownR, 1).padStart(6), "|",
    String(u.trades).padStart(10), (u.winRate * 100).toFixed(0).padStart(5) + "%", f(u.avgR).padStart(5), f(u.totalR, 1).padStart(7), "|",
    (g.growthPct.toFixed(0) + "%").padStart(10), g.maxDrawdownPct.toFixed(0).padStart(6) + "%"
  );
}

const summarize = (ts: Trade[]) => {
  const n = ts.length, tot = ts.reduce((a, t) => a + t.r, 0);
  return `${String(n).padStart(4)} trades, win ${n ? ((ts.filter((t) => t.r > 0.005).length / n) * 100).toFixed(0) : "-"}%, avg ${n ? (tot / n).toFixed(2) : "-"}R, total ${tot.toFixed(1)}R`;
};
for (const [name, over] of [["Today's rules", {}], ["Today's rules, 2R to 3R at any percent", { lowRPct: 0 }], ["No key level, no R limits (every setup)", { requireKeyLevel: false, minR: 0, fullR: 0 }]] as [string, Partial<Config>][]) {
  const r = runBacktest(p, { ...DEFAULT_CONFIG, ...over });
  console.log(`\n${name}: funnel`, JSON.stringify(r.funnel));
  console.log("  by CRT:");
  for (const tf of ["day", "week"]) console.log(`    ${tf.padEnd(5)} ${summarize(r.trades.filter((t) => t.tf === tf))}`);
  console.log("  by percent:");
  for (const [lo, hi] of [[75, 101], [50, 75], [0, 50]]) console.log(`    ${String(lo).padStart(2)}%+ ${summarize(r.trades.filter((t) => t.pct >= lo - 1e-9 && t.pct < hi - 1e-9))}`);
  console.log("  by check (met / not met):");
  for (const c of CONFLUENCES) console.log(`    ${c.padEnd(13)} ${summarize(r.trades.filter((t) => t.conf[c] === true))}  |  ${summarize(r.trades.filter((t) => t.conf[c] === false))}`);
  const by: Record<string, number> = {};
  for (const t of r.trades) by[t.reason] = (by[t.reason] ?? 0) + 1;
  const med = [...r.trades.map((t) => t.plannedR)].sort((a, b) => a - b)[r.trades.length >> 1];
  console.log("  exits:", JSON.stringify(by), " planned R median:", med?.toFixed(2), " worst trade:", Math.min(...r.trades.map((t) => t.r)).toFixed(2), "R");
}

// Prints results for a set of rule combinations on the built-in EURUSD data.
// Run from the project folder: npm run report
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFLUENCES, DEFAULT_CONFIG, prepare, runBacktest, seriesFromBuffer, compound, type Config, type Trade } from "../engine/index";

const buf = readFileSync(join(process.cwd(), "public/data/eurusd-15m.bin"));
const s = seriesFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const p = prepare(s, DEFAULT_CONFIG);

const CLASSIC: Partial<Config> = { requireKeyLevel: false, stop: "sweep", stopBuffer: 0, partialAtTp1: true, minR: 0, fullR: 0, maxR: 1000, maxPerDay: 0 };
const rows: [string, Partial<Config>][] = [
  ["Default rules", {}],
  ["  no key level needed", { requireKeyLevel: false }],
  ["  key levels: daily only", { keyLevelTfs: ["d1"] }],
  ["  key levels: weekly only", { keyLevelTfs: ["w1"] }],
  ["  key levels: 4-hour only", { keyLevelTfs: ["h4"] }],
  ["  key levels: order blocks + breakers", { keyLevelKinds: ["ob", "breaker"] }],
  ["  bias off", { bias: "off" }],
  ["  zone: gap only", { zone: "fvg" }],
  ["  stop beyond the sweep", { stop: "sweep" }],
  ["  stop beyond the pullback", { stop: "pullback" }],
  ["  2R-3R allowed at any grade", { lowRGrade: "any" }],
  ["  minimum 3R", { minR: 3 }],
  ["  no R limits", { minR: 0, fullR: 0, maxR: 1000 }],
  ["  take half at 50%", { partialAtTp1: true }],
  ["  no day-3 close", { timeStop: false }],
  ["  bias off, no key level", { bias: "off", requireKeyLevel: false }],
  ["First version's rules", CLASSIC]
];

const f = (x: number | null, d = 2) => (x === null ? "inf" : x.toFixed(d));
const pad = (x: string, n: number) => x.padEnd(n);
console.log(pad("rules", 40), "trades  /mo   win%   avgR   totalR  PF    maxDD  | last 30%: n  win%  avgR  totalR | 1%risk growth  maxDD%");
for (const [name, over] of rows) {
  const cfg: Config = { ...DEFAULT_CONFIG, ...over };
  const r = runBacktest(p, cfg);
  const a = r.all, u = r.unseen;
  const g = compound(r.trades, 1);
  console.log(
    pad(name, 40),
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
for (const [name, over] of [["Default rules", {}], ["Default rules without the key level", { requireKeyLevel: false }], ["No R limits, no key level (all setups)", { requireKeyLevel: false, minR: 0, fullR: 0, maxR: 1000 }]] as [string, Partial<Config>][]) {
  const r = runBacktest(p, { ...DEFAULT_CONFIG, ...over });
  console.log(`\n${name}: funnel`, JSON.stringify(r.funnel));
  console.log("  by grade:");
  for (const g of ["A+", "A", "B", "C"]) console.log(`    ${g.padEnd(3)} ${summarize(r.trades.filter((t) => t.grade === g))}`);
  console.log("  by confluence (with / without):");
  for (const c of CONFLUENCES) console.log(`    ${c.padEnd(13)} ${summarize(r.trades.filter((t) => t.conf[c]))}  |  ${summarize(r.trades.filter((t) => !t.conf[c]))}`);
  const by: Record<string, number> = {};
  for (const t of r.trades) by[t.reason] = (by[t.reason] ?? 0) + 1;
  console.log("  exits:", JSON.stringify(by), " planned R median:", [...r.trades.map((t) => t.plannedR)].sort((a, b) => a - b)[r.trades.length >> 1]?.toFixed(2));
}

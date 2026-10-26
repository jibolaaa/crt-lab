// Prints results for a set of rule combinations on the built-in EURUSD data.
// Run from the project folder: npm run report
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, prepare, runBacktest, seriesFromBuffer, compound, type Config } from "../engine/index";

const buf = readFileSync(join(process.cwd(), "public/data/eurusd-15m.bin"));
const s = seriesFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const p = prepare(s, DEFAULT_CONFIG);

const rows: [string, Partial<Config>][] = [
  ["Default rules (2 of 3 bias, OB+FVG, either day)", {}],
  ["  bias: weekly CRT only", { bias: "weeklyCrt" }],
  ["  bias: structure only", { bias: "structure" }],
  ["  bias: premium/discount only", { bias: "premiumDiscount" }],
  ["  bias: all three agree", { bias: "allAgree" }],
  ["  bias: off", { bias: "off" }],
  ["  zone: gap only", { zone: "fvg" }],
  ["  zone: order block only", { zone: "ob" }],
  ["  zone: off", { zone: "off" }],
  ["  timing: same day only", { timing: "sameDay" }],
  ["  timing: next day only", { timing: "nextDay" }],
  ["  no partial at 50%", { partialAtTp1: false }],
  ["  no time stop", { timeStop: false }],
  ["  news guard off", { newsGuard: false }],
  ["  London + New York only", { sessions: ["london", "newyork"] }],
  ["  Asian only", { sessions: ["asian"] }],
  ["  spread 2 pips", { spread: 0.0002 }],
  ["  stop under the pullback", { stop: "pullback" }],
  ["  pullback stop, no partial", { stop: "pullback", partialAtTp1: false }],
  ["  pullback stop, bias off", { stop: "pullback", bias: "off" }],
  ["Bare CRT (no bias, no zone)", { bias: "off", zone: "off" }]
];

const f = (x: number | null, d = 2) => (x === null ? "inf" : x.toFixed(d));
const pad = (x: string, n: number) => x.padEnd(n);
console.log(pad("rules", 48), "trades  /mo   win%   avgR   totalR  PF    maxDD  | unseen: n  win%  avgR  totalR | 1%risk growth  maxDD%");
for (const [name, over] of rows) {
  const cfg: Config = { ...DEFAULT_CONFIG, ...over };
  const r = runBacktest(p, cfg);
  const a = r.all, u = r.unseen;
  const g = compound(r.trades, 1);
  console.log(
    pad(name, 48),
    String(a.trades).padStart(6), f(a.tradesPerMonth, 1).padStart(5), (a.winRate * 100).toFixed(0).padStart(5) + "%",
    f(a.avgR).padStart(6), f(a.totalR, 1).padStart(8), f(a.profitFactor).padStart(5), f(a.maxDrawdownR, 1).padStart(6), "|",
    String(u.trades).padStart(8), (u.winRate * 100).toFixed(0).padStart(5) + "%", f(u.avgR).padStart(5), f(u.totalR, 1).padStart(7), "|",
    (g.growthPct.toFixed(0) + "%").padStart(10), g.maxDrawdownPct.toFixed(0).padStart(6) + "%"
  );
}
const r = runBacktest(p, DEFAULT_CONFIG);
console.log("\nFunnel for the default rules:", r.funnel);
const by: Record<string, number> = {};
for (const t of r.trades) by[t.reason] = (by[t.reason] ?? 0) + 1;
console.log("Exits:", by);
const years: Record<number, { n: number; r: number }> = {};
for (const t of r.trades) { const y = new Date(t.entryT * 1000).getUTCFullYear(); (years[y] ??= { n: 0, r: 0 }); years[y].n++; years[y].r += t.r; }
console.log("By year:", Object.entries(years).map(([y, v]) => `${y}: ${v.n} trades, ${v.r.toFixed(1)}R`).join(" | "));
console.log("Split at", new Date(r.splitT * 1000).toISOString().slice(0, 10));

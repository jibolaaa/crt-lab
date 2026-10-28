// The plain-words summary at the top of the results.
import type { RunResult } from "../engine";
import { fmtInt } from "./format";

const amount = (r: number) => `${Math.abs(r).toFixed(1)}R`;
const plural = (n: number, word: string) => `${fmtInt(n)} ${word}${n === 1 ? "" : "s"}`;
const result = (r: number) => (r >= 0.05 ? `made ${amount(r)}` : r <= -0.05 ? `lost ${amount(r)}` : "broke even");

export function verdict(res: RunResult, model1 = false) {
  const n = res.all.trades, total = res.all.totalR, late = res.unseen;
  if (!n) {
    const hint = model1
      ? "Nothing got through every rule on these prices. Under Change rules, try the weekly or daily structure on its own, or more range candles."
      : "Nothing got through every rule. Try \"Every setup\" above, or switch a rule off.";
    return { line: "No trades with these rules.", notes: [hint], cautions: [] as string[] };
  }

  const line = `These rules ${result(total)} over ${plural(n, "trade")}, winning ${Math.round(res.all.winRate * 100)}% of them.`;
  const notes = [
    late.trades
      ? `On the last 30%, kept aside for checking, they ${result(late.totalR)} over ${plural(late.trades, "trade")}.`
      : "None of the trades fell in the last 30%, the part kept aside for checking."
  ];
  const cautions: string[] = [];
  if (n < 30) cautions.push(`${plural(n, "trade")} is too few to tell an edge from luck.`);
  else if (late.trades < 20) cautions.push(`${plural(late.trades, "trade")} in the last 30% is too few to lean on.`);
  if (total >= 0.05 && late.totalR < 0) cautions.push("Making money early and losing it later is what rules fitted to the past tend to look like.");
  if (total >= 0.05 && late.totalR >= 0.05 && n >= 30 && late.trades >= 20) cautions.push("Worth checking on other markets and years before trusting it.");
  return { line, notes, cautions };
}

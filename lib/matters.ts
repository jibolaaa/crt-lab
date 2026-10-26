// "Change one rule": the current rules with a single layer switched or flipped,
// to show which parts of the strategy carry their weight.
import type { Config } from "../engine";

export interface Variant { key: string; label: string; change: Partial<Config> }

export function variantsFor(cfg: Config): Variant[] {
  const v: Variant[] = [];
  if (cfg.requireKeyLevel) v.push({ key: "key", label: "No key level needed", change: { requireKeyLevel: false } });
  else v.push({ key: "key", label: "Sweep into a key level", change: { requireKeyLevel: true } });
  if (cfg.bias !== "off") v.push({ key: "bias", label: "No weekly bias", change: { bias: "off" } });
  if (cfg.zone !== "off") v.push({ key: "zone", label: "No 1-hour zone", change: { zone: "off" } });
  if (cfg.timing !== "either") v.push({ key: "timing", label: "Either entry day", change: { timing: "either" } });
  if (cfg.sessions.length) v.push({ key: "sessions", label: "Any time of day", change: { sessions: [] } });
  v.push(cfg.stop === "sweep"
    ? { key: "stop", label: "Stop beyond the 1H order block", change: { stop: "ob" } }
    : { key: "stop", label: "Stop beyond the sweep", change: { stop: "sweep" } });
  if (cfg.minR > 0 || cfg.maxR < 1000) v.push({ key: "r", label: "No R limits", change: { minR: 0, fullR: 0, maxR: 1000 } });
  else v.push({ key: "r", label: "2R to 6R, A+ under 3R", change: { minR: 2, fullR: 3, lowRGrade: "A+", maxR: 6 } });
  if (cfg.fullR > cfg.minR && cfg.lowRGrade !== "any") v.push({ key: "grade", label: `Any grade from ${cfg.minR}R`, change: { lowRGrade: "any" } });
  v.push(cfg.partialAtTp1
    ? { key: "partial", label: "Keep it all for the target", change: { partialAtTp1: false } }
    : { key: "partial", label: "Take half at 50%", change: { partialAtTp1: true } });
  v.push(cfg.timeStop
    ? { key: "time", label: "Hold past the end of day 3", change: { timeStop: false } }
    : { key: "time", label: "Close at the end of day 3", change: { timeStop: true } });
  if (cfg.usdNews) v.push(cfg.newsGuard
    ? { key: "news", label: "Trade jobs-report days too", change: { newsGuard: false } }
    : { key: "news", label: "Rest on jobs-report days", change: { newsGuard: true } });
  if (cfg.maxPerDay > 0) v.push({ key: "cap", label: "No daily trade limit", change: { maxPerDay: 0 } });
  return v;
}

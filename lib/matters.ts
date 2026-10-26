// "Change one rule": the current rules with a single layer switched or flipped,
// to show which parts of the strategy carry their weight.
import type { Config } from "../engine";

export interface Variant { key: string; label: string; change: Partial<Config> }

export function variantsFor(cfg: Config): Variant[] {
  const v: Variant[] = [];
  if (cfg.bias !== "off") v.push({ key: "bias", label: "No weekly bias", change: { bias: "off" } });
  if (cfg.zone !== "off") v.push({ key: "zone", label: "No 1-hour zone", change: { zone: "off" } });
  if (cfg.timing !== "either") v.push({ key: "timing", label: "Either entry day", change: { timing: "either" } });
  if (cfg.sessions.length) v.push({ key: "sessions", label: "Any time of day", change: { sessions: [] } });
  v.push(cfg.stop === "sweep"
    ? { key: "stop", label: "Stop under the pullback", change: { stop: "pullback" } }
    : { key: "stop", label: "Stop under the sweep", change: { stop: "sweep" } });
  v.push(cfg.partialAtTp1
    ? { key: "partial", label: "Keep it all for the range end", change: { partialAtTp1: false } }
    : { key: "partial", label: "Take half at 50%", change: { partialAtTp1: true } });
  v.push(cfg.timeStop
    ? { key: "time", label: "Hold past the end of day 3", change: { timeStop: false } }
    : { key: "time", label: "Close at the end of day 3", change: { timeStop: true } });
  if (cfg.usdNews) v.push(cfg.newsGuard
    ? { key: "news", label: "Trade jobs-report days too", change: { newsGuard: false } }
    : { key: "news", label: "Rest on jobs-report days", change: { newsGuard: true } });
  return v;
}

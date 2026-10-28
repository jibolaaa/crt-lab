// "Change one rule": the current rules with a single layer switched or flipped,
// to show which parts of the strategy carry their weight.
import type { Config } from "../engine";

export interface Variant { key: string; label: string; change: Partial<Config> }

export function variantsFor(cfg: Config): Variant[] {
  const v: Variant[] = [];
  if (cfg.entry !== "shift") v.push({ key: "e-bos", label: "Enter on the BOS close", change: { entry: "shift" } });
  if (cfg.entry !== "retest") v.push({ key: "e-retest", label: "Enter on the retest after the BOS", change: { entry: "retest" } });
  if (cfg.entry !== "qm") v.push({ key: "e-qm", label: "Enter on a QM limit", change: { entry: "qm" } });
  if (cfg.entry !== "qm") v.push(cfg.zone === "sweep"
    ? { key: "zone", label: "Zone: an OB or FVG after the sweep", change: { zone: "any" } }
    : { key: "zone", label: "Zone: the candle that made the sweep", change: { zone: "sweep" } });
  if (cfg.entry !== "qm") v.push(cfg.zoneInKiller
    ? { key: "kz", label: "Zone anywhere after the sweep", change: { zoneInKiller: false } }
    : { key: "kz", label: "Zone inside the killer zone", change: { zoneInKiller: true } });
  if (cfg.crt.length === 2) {
    v.push({ key: "day", label: "Daily CRTs only", change: { crt: ["day"] } });
    v.push({ key: "week", label: "Weekly CRTs only", change: { crt: ["week"] } });
  } else v.push({ key: "both", label: "Daily and weekly CRTs", change: { crt: ["day", "week"] } });
  if (cfg.requireKeyLevel) v.push({ key: "key", label: "No key level needed", change: { requireKeyLevel: false } });
  else v.push({ key: "key", label: "Sweep into a key level", change: { requireKeyLevel: true } });
  v.push(cfg.deeperSweeps
    ? { key: "deep", label: "A deeper sweep after candle 2 cancels", change: { deeperSweeps: false } }
    : { key: "deep", label: "Deeper sweeps keep the setup", change: { deeperSweeps: true } });
  v.push(cfg.timing === "nextDay"
    ? { key: "timing", label: "Enter from candle 2", change: { timing: "either" } }
    : { key: "timing", label: "Enter from candle 3 only", change: { timing: "nextDay" } });
  v.push(cfg.bias === "off"
    ? { key: "bias", label: "Weekly structure must agree", change: { bias: "structure" } }
    : { key: "bias", label: "Weekly bias only counts toward the percent", change: { bias: "off" } });
  if (cfg.driftUp) v.push(cfg.side === "both"
    ? { key: "side", label: "Buys only (with the drift)", change: { side: "auto" } }
    : { key: "side", label: "Both ways", change: { side: "both" } });
  if (cfg.sessions.length) v.push({ key: "sessions", label: "Any time of day", change: { sessions: [] } });
  v.push(cfg.stop === "sweep"
    ? { key: "stop", label: "Stop beyond the order block", change: { stop: "ob" } }
    : { key: "stop", label: "Stop beyond the sweep", change: { stop: "sweep" } });
  if (cfg.minR > 0) v.push({ key: "minr", label: "Take targets under 2R too", change: { minR: 0, fullR: 0 } });
  if (cfg.fullR > cfg.minR && cfg.lowRPct > 0) v.push({ key: "pct", label: `Any percent from ${cfg.minR}R`, change: { lowRPct: 0 } });
  v.push(cfg.partialAtTp1
    ? { key: "partial", label: "Keep it all for the target", change: { partialAtTp1: false } }
    : { key: "partial", label: "Take half at 50%", change: { partialAtTp1: true } });
  v.push(cfg.timeStop
    ? { key: "time", label: "Hold past the next day (week)", change: { timeStop: false } }
    : { key: "time", label: "Close at the end of the next day (week)", change: { timeStop: true } });
  if (cfg.usdNews) v.push(cfg.newsGuard
    ? { key: "news", label: "Trade jobs-report days too", change: { newsGuard: false } }
    : { key: "news", label: "Rest on jobs-report days", change: { newsGuard: true } });
  if (cfg.mustHave.length) v.push({ key: "must", label: "No must-have checks", change: { mustHave: [] } });
  if (cfg.minPct > 0) v.push({ key: "minpct", label: "Any checklist percent", change: { minPct: 0 } });
  if (cfg.maxPerDay > 0) v.push({ key: "perday", label: "No daily trade limit", change: { maxPerDay: 0 } });
  return v;
}

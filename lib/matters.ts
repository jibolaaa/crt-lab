// "Change one rule": the current rules with a single layer switched or flipped,
// to show which parts of the strategy carry their weight.
import { MODEL_RULES, type Config } from "../engine";

export interface Variant { key: string; label: string; change: Partial<Config> }

/** Model 1's layers, one at a time. */
function model1Variants(cfg: Config): Variant[] {
  const v: Variant[] = [];
  const has = (tf: Config["crt"][number]) => cfg.crt.includes(tf);
  if (cfg.crt.length > 1) {
    if (has("h4")) v.push({ key: "h4", label: "4-hour ranges only", change: { crt: ["h4"] } });
    if (has("day")) v.push({ key: "day", label: "Daily ranges only", change: { crt: ["day"] } });
  }
  if (!has("h4")) v.push({ key: "add-h4", label: "Add 4-hour ranges", change: { crt: [...cfg.crt, "h4"] } });
  if (!has("week")) v.push({ key: "add-week", label: "Add weekly ranges", change: { crt: [...cfg.crt, "week"] } });
  if (cfg.bias === "weeklyDaily") {
    v.push({ key: "bias-w", label: "Weekly structure only", change: { bias: "weeklySwings" } });
    v.push({ key: "bias-d", label: "Daily structure only", change: { bias: "dailySwings" } });
    v.push({ key: "bias-off", label: "No structure rule", change: { bias: "off" } });
  } else v.push({ key: "bias-wd", label: "Weekly and daily structure agree", change: { bias: "weeklyDaily" } });
  if (cfg.requireKeyLevel) {
    v.push(cfg.keyFit
      ? { key: "fit", label: "Any fresh key level, fitting the structure or not", change: { keyFit: false } }
      : { key: "fit", label: "Key level must fit the structure", change: { keyFit: true } });
    v.push(cfg.keyInside
      ? { key: "inside", label: "The entry needn't be inside the key level", change: { keyInside: false } }
      : { key: "inside", label: "The entry must be inside the key level", change: { keyInside: true } });
    v.push({ key: "key", label: "No key level needed", change: { requireKeyLevel: false } });
  } else v.push({ key: "key", label: "Sweep into a key level", change: { requireKeyLevel: true } });
  if (cfg.sweepWindow > 0) v.push({ key: "sw", label: "The sweep candle only", change: { sweepWindow: 0 } });
  v.push({ key: "sw-more", label: `${cfg.sweepWindow + 2} candles after the sweep candle`, change: { sweepWindow: cfg.sweepWindow + 2 } });
  if (cfg.entryChart !== "m5") v.push({ key: "m5", label: "5-minute entries on every range", change: { entryChart: "m5" } });
  if (cfg.entryChart !== "m15") v.push({ key: "m15", label: "15-minute entries on every range", change: { entryChart: "m15" } });
  v.push(cfg.obStop === "tip"
    ? { key: "stop", label: "Stop just past the order block candle", change: { obStop: "candle" } }
    : { key: "stop", label: "Stop past the sweep's tip", change: { obStop: "tip" } });
  v.push(cfg.partialAtTp1
    ? { key: "partial", label: "Keep it all for the target", change: { partialAtTp1: false } }
    : { key: "partial", label: "Take half at 50%", change: { partialAtTp1: true } });
  v.push(cfg.midCancels
    ? { key: "mid", label: "Keep the order after price reaches 50%", change: { midCancels: false } }
    : { key: "mid", label: "Cancel the order once price reaches 50%", change: { midCancels: true } });
  if (cfg.minR > 0) v.push({ key: "minr", label: `Take targets under ${cfg.minR}R too`, change: { minR: 0 } });
  if (cfg.maxR >= 1000) v.push({ key: "cap", label: "Cap the target at 4R", change: { maxR: 4 } });
  if (cfg.driftUp) v.push(cfg.side === "both"
    ? { key: "side", label: "Buys only (with the drift)", change: { side: "auto" } }
    : { key: "side", label: "Both ways", change: { side: "both" } });
  if (cfg.sessions.length) v.push({ key: "sessions", label: "Any time of day", change: { sessions: [] } });
  if (cfg.usdNews) v.push(cfg.newsGuard
    ? { key: "news", label: "Trade jobs-report days too", change: { newsGuard: false } }
    : { key: "news", label: "Rest on jobs-report days", change: { newsGuard: true } });
  if (cfg.maxPerDay > 0) v.push({ key: "perday", label: "No daily trade limit", change: { maxPerDay: 0 } });
  v.push({ key: "classic", label: "The old rules instead", change: MODEL_RULES.classic });
  return v;
}

export function variantsFor(cfg: Config): Variant[] {
  if (cfg.entry === "model1") return model1Variants(cfg);
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

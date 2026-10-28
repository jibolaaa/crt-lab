"use client";
import { CONFLUENCES, WEIGHT, type Call, type Config, type CrtTf, type LiveSetup, type RunResult } from "../engine";
import type { Market } from "../lib/markets";
import { CONF_LABEL, CRT_LABEL, TF_LABEL, fitText, kindName } from "../lib/confluences";
import { fmtDay, fmtPrice, fmtR, fmtTime } from "../lib/format";
import { pickSetups as pick } from "../lib/live";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (t: number) => WEEKDAY[new Date(t * 1000).getUTCDay()];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = (t: number) => `${new Date(t * 1000).getUTCDate()} ${MONTHS[new Date(t * 1000).getUTCMonth()]}`;

/** What today's CRTs look like under the current rules, at the last closed candle. */
export function Now({ result, market, cfg, loading, dt = 900 }: { result: RunResult | null; market: Market; cfg: Config; loading: boolean; dt?: number }) {
  if (market.source !== "deriv") {
    return (
      <section className="now" aria-labelledby="now-h">
        <h2 className="sec" id="now-h">Right now</h2>
        <p className="now-empty">This needs live prices. Pick a market from Deriv above, like EUR/USD or gold.</p>
      </section>
    );
  }
  const l = result?.live;
  if (!l) {
    return (
      <section className="now" aria-labelledby="now-h">
        <h2 className="sec" id="now-h">Right now</h2>
        <p className="now-empty">{loading ? "Getting the latest prices from Deriv." : "No live prices yet."}</p>
      </section>
    );
  }
  const px = (x: number) => fmtPrice(x, market.digits);
  const word = (b: number) => (b === 1 ? "up" : b === -1 ? "down" : "mixed");
  const structure = l.swings
    ? `Structure: weekly ${word(l.swings.weekly)}, daily ${word(l.swings.daily)}.`
    : `Weekly structure: ${l.bias === 1 ? "up" : l.bias === -1 ? "down" : "no clear direction"}.`;
  const m1 = cfg.entry === "model1";
  const tfs = (m1 ? ["h4", "day", "week"] : ["day", "week"]) as CrtTf[];
  const groups = tfs.filter((tf) => cfg.crt.includes(tf)).map((tf) => ({ tf, rows: pick(l.setups.filter((x) => x.tf === tf)) }));
  const anyCall = l.setups.some((x) => x.call);
  return (
    <section className="now" aria-labelledby="now-h">
      <h2 className="sec" id="now-h">Right now</h2>
      <p className="now-meta">
        {fmtDay(l.date)}, as of {fmtTime(l.asOf)} UTC ({fmtTime(l.asOf + 3600)} in Lagos). {structure}
      </p>
      {groups.map(({ tf, rows }) => {
        const c1 = l.setups.find((x) => x.tf === tf && x.age === 0) ?? null;
        return (
          <div key={tf} className="now-group">
            <h3 className="now-tf">{CRT_LABEL[tf]}</h3>
            {c1 && !m1 && (
              <p className="now-range">
                Candle 1 is {tf === "day" ? fmtDay(c1.rangeDate) : `the week of ${dayMonth(c1.rangeDate)}`}: high {px(c1.rangeHigh)}, low {px(c1.rangeLow)}, 50% at {px(c1.mid)}.
              </p>
            )}
            {c1 && m1 && (
              <p className="now-range">
                Range: {rangeName(tf, c1.rangeDate)}, high {px(c1.rangeHigh)}, low {px(c1.rangeLow)}, 50% at {px(c1.mid)}, with {c1.m1?.inside ?? 1} inside candle{(c1.m1?.inside ?? 1) === 1 ? "" : "s"} after it.
              </p>
            )}
            {rows.length === 0 && (
              <p className="now-empty">
                {m1 ? `No range right now: the last ${tf === "h4" ? "4-hour candle" : tf === "day" ? "day" : "week"} wasn't inside the one before it.` : "Not enough prices yet to read this one."}
              </p>
            )}
            <ul className="now-list">
              {rows.map((s, i) => {
                const { title, text, hot } = describeSetup(s, px, cfg, dt);
                return (
                  <li key={i} className={`now-item${hot ? " hot" : ""}`}>
                    <span className={`dir ${s.dir === 1 ? "buy" : "sell"}`}>{s.dir === 1 ? "Buy" : "Sell"}</span>
                    <div>
                      <b>{title}</b>
                      <span>{text}</span>
                      {s.call && <CallView call={s.call} dir={s.dir} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {anyCall && <p className="now-note">The percent is how much of your checklist the setup meets, with direction checks counting double. It isn&apos;t a chance of winning.</p>}
    </section>
  );
}

export function CallView({ call, dir }: { call: Call; dir: 1 | -1 }) {
  const me = Math.round(call.pct), other = 100 - me;
  const side = dir === 1 ? "Buy" : "Sell", otherSide = dir === 1 ? "Sell" : "Buy";
  return (
    <div className="call">
      <div className="call-line">
        <b className={dir === 1 ? "pos" : "neg"}>{side} {me}%</b>
        <span className="call-other">{otherSide} {other}%</span>
      </div>
      <div className={`call-bar ${dir === 1 ? "buy" : "sell"}`} aria-hidden><i className={dir === 1 ? "buy" : "sell"} style={{ width: `${me}%` }} /></div>
      <details className="call-checks">
        <summary>See the checklist: {call.points} of {call.maxPoints} points</summary>
        <Checklist conf={call.conf} />
      </details>
    </div>
  );
}

export function Checklist({ conf }: { conf: Call["conf"] }) {
  return (
    <ul className="checks">
      {CONFLUENCES.map((c) => {
        const v = conf[c];
        return (
          <li key={c} className={v ? "yes" : "no"}>
            <span aria-hidden>{v ? "✓" : v === null ? "·" : "–"}</span>
            <span className="sr">{v ? "Met: " : v === null ? "Doesn't apply: " : "Not met: "}</span>
            {CONF_LABEL[c]}
            {WEIGHT[c] > 1 && <small className="x2"> ×2</small>}
            {v === null && <small> (doesn&apos;t apply)</small>}
          </li>
        );
      })}
    </ul>
  );
}

/** What a live setup is waiting for, in plain words. */
export function describeSetup(s: LiveSetup, px: (x: number) => string, cfg: Config, dt: number): { title: string; text: string; hot?: boolean } {
  if (s.m1) return describeM1(s, px, cfg);
  const long = s.dir === 1;
  const side = long ? "low" : "high";
  const edge = long ? s.rangeLow : s.rangeHigh;
  const past = long ? "below" : "above";
  const swept = px(s.sweepPrice ?? edge);
  const unit = s.tf === "day" ? "day" : "week";
  const entryChart = s.tf === "week" || dt >= 900 ? "15-minute" : "5-minute";
  const zoneChart = s.zone?.tfH ? `${s.zone.tfH}-hour` : s.tf === "week" ? "4-hour" : "1-hour";
  const tomorrow = s.tf === "day" ? "tomorrow" : "next week";
  // an earlier sweep names its candles, since candle 1 isn't the current one's
  const from = (title: string) => (s.fromYesterday ? `${title} (${s.tf === "day" ? `${weekday(s.sweepDate)}'s` : `the week of ${dayMonth(s.sweepDate)}'s`} sweep)` : title);
  const killer = s.sweepPrice !== null ? `${px(long ? s.sweepPrice : s.bodyEdge)} to ${px(long ? s.bodyEdge : s.sweepPrice)}` : "";
  const level = s.keyLevel ? ` into a ${TF_LABEL[s.keyLevel.tf]} ${kindName(s.keyLevel.kind, s.dir)}${s.keyLevel.top === s.keyLevel.bottom ? ` at ${px(s.keyLevel.top)}` : ` at ${px(s.keyLevel.bottom)} to ${px(s.keyLevel.top)}`}` : "";
  const pending = s.pending
    ? ` A-shape ${long ? "bottom" : "top"} at ${px(s.pending.head)}: a close ${long ? "above" : "below"} ${px(s.pending.sms)} would set a ${long ? "buy" : "sell"} limit at ${px(s.pending.qm)}.`
    : "";
  switch (s.stage) {
    case "blocked":
      if (s.why === "side") {
        return cfg.side === "auto"
          ? { title: `${long ? "Buys" : "Sells"} are off here`, text: "This market tends to rise over time, so only buys are taken. Change it under Change rules, Trade direction." }
          : { title: `${long ? "Buys" : "Sells"} are off`, text: `Your rules take ${cfg.side === "buys" ? "buys" : "sells"} only.` };
      }
      return { title: "Off this week", text: `Your weekly bias rule doesn't allow ${long ? "buys" : "sells"} this week.` };
    case "waiting":
      return { title: "Waiting for the sweep", text: `Needs price to trade ${past} candle 1's ${side}, ${px(edge)}.` };
    case "noKey":
      return { title: "Swept, but not into a key level", text: `Took candle 1's ${side} (to ${swept}) without reaching a fresh key level. No trade unless price reaches one while the range holds.` };
    case "swept":
      return {
        title: "Swept into a key level",
        text: `Took candle 1's ${side} (to ${swept})${level}. Next, this ${unit} has to close back inside candle 1. Then look for the entry in the killer zone, ${killer}, from ${tomorrow}.${pending}`
      };
    case "armed":
      return {
        title: from("Waiting in the killer zone"),
        text: `Candle 2 closed back inside. Watch for an A-shape and a shift in the killer zone, ${killer}.${pending}`
      };
    case "limit": {
      const q = s.order!;
      const what = cfg.entry === "qm" ? "the QM line" : "the order block the BOS left";
      const wait = s.age === 0 && cfg.timing === "nextDay" ? ` It can fill from ${tomorrow}, once this ${unit} closes back inside.` : "";
      return {
        title: from(`${long ? "Buy" : "Sell"} limit set`),
        text: `${long ? "Buy" : "Sell"} limit at ${px(q.level)}, ${what}. Stop ${px(q.stop)}, target ${px(q.target)} (${q.r.toFixed(1)}R).${wait}`,
        hot: true
      };
    }
    case "key":
      return cfg.zone === "sweep"
        ? { title: from("Swept into a key level"), text: `Took candle 1's ${side} (to ${swept})${level}. Waiting for the ${zoneChart} candle that made the sweep to close, to mark its order block.` }
        : { title: from("Swept into a key level"), text: `Took candle 1's ${side} (to ${swept})${level}. Waiting for a ${zoneChart} zone in the killer zone, ${killer}.` };
    case "zone":
      return {
        title: from("Zone ready"),
        text: !s.zone ? "Waiting for price to come back into the zone."
          : s.zone.sweep ? `The ${zoneChart} candle that made the sweep, ${px(s.zone.bottom)} to ${px(s.zone.top)}, is the order block. Waiting for price to come back into it.`
            : `${zoneChart} zone at ${px(s.zone.bottom)} to ${px(s.zone.top)}. Waiting for price to come back into it.`
      };
    case "touched":
      return {
        title: from("Watch for the BOS"),
        text: `Price is back in the ${zoneChart} zone. ${s.level !== null ? `The BOS is a ${entryChart} close ${long ? "above" : "below"} ${px(s.level)}${cfg.entry === "retest" ? ", then a limit goes at the order block it leaves" : ""}.` : "Waiting for a swing to break."}`,
        hot: true
      };
    case "entered": {
      const t = s.trade!;
      const running = t.reason === "end";
      const when = `${weekday(t.entryT - 1)} ${fmtTime(t.entryT)} UTC`;
      const base = `${long ? "Bought" : "Sold"} at ${px(t.entry)} (${when}). Stop ${px(t.stop)}, target ${px(t.tp2)} (${t.plannedR.toFixed(1)}R).`;
      return running
        ? { title: from("In a trade"), text: `${base} Now ${fmtR(t.r, 2)}.`, hot: true }
        : { title: from("Traded"), text: `${base} Closed at ${fmtR(t.r, 2)}.` };
    }
    case "ended":
    default:
      return { title: "No trade", text: whyText(s, px, cfg) };
  }
}

function whyText(s: LiveSetup, px: (x: number) => string, cfg: Config) {
  const r = (s.skipR ?? 0).toFixed(1);
  switch (s.why) {
    case "mid": return `Price reached the 50% level (${px(s.mid)}) before an entry.`;
    case "targetHit": return "Price reached candle 1's other end before an entry.";
    case "closedOutside": return "A candle closed outside candle 1's range.";
    case "noSweep": return "Candle 2 didn't take candle 1's high or low.";
    case "brokeSweep": return "Price went past the sweep the next day.";
    case "noKey": return "Candle 2 closed without reaching a key level.";
    case "news": return "US jobs report day: resting.";
    case "session": return "The entry came outside your entry times.";
    case "dailyCap": return `Already ${cfg.maxPerDay} trades today.`;
    case "alreadyIn": return "Already in a trade the same way.";
    case "pastMid": return "The entry would have been past the 50% level.";
    case "lowR": return `The target was only ${r}R away, under your ${cfg.minR}R minimum.`;
    case "checks":
      if (!cfg.mustHave.length) return `It met less than ${cfg.minPct}% of your checklist, so it was skipped.`;
      return cfg.minPct > 0
        ? `It missed a must-have check, or met less than ${cfg.minPct}% of your checklist.`
        : "It missed a must-have check.";
    case "lowRPct": return `The target was ${r}R away, and under ${cfg.fullR}R you need ${cfg.lowRPct}% or more of your checklist.`;
    default: return "This setup's time ran out.";
  }
}

/** A range candle's name: "Tue 14:00 4-hour candle", a day, or a week. */
export function rangeName(tf: CrtTf, date: number) {
  if (tf === "h4") return `the ${weekday(date)} ${fmtTime(date)} 4-hour candle`;
  if (tf === "day") return fmtDay(date);
  return `the week of ${dayMonth(date)}`;
}

/** The chart an entry is read on. */
export const chartName = (dt: number) => (dt <= 300 ? "5-minute" : dt <= 900 ? "15-minute" : "30-minute");

/** What a Model 1 setup is waiting for, in plain words. */
function describeM1(s: LiveSetup, px: (x: number) => string, cfg: Config): { title: string; text: string; hot?: boolean } {
  const long = s.dir === 1;
  const side = long ? "low" : "high";
  const edge = long ? s.rangeLow : s.rangeHigh;
  const swept = px(s.sweepPrice ?? edge);
  const chart = chartName(s.m1!.entryDt);
  const later = s.fromYesterday ? " (an earlier range)" : "";
  const k = s.keyLevel;
  const level = k
    ? ` into a ${TF_LABEL[k.tf]} ${kindName(k.kind, s.dir)} at ${k.top === k.bottom ? px(k.top) : `${px(k.bottom)} to ${px(k.top)}`}${k.fit && k.fit !== "any" ? `, ${fitText(k.fit, s.dir)}` : ""}`
    : "";
  const ob = s.m1!.ob;
  switch (s.stage) {
    case "blocked": {
      const which = cfg.bias === "weeklySwings" ? "The weekly structure doesn't" : cfg.bias === "dailySwings" ? "The daily structure doesn't" : "The weekly and daily structure don't both";
      return { title: "Against the structure", text: `${which} point ${long ? "up" : "down"}, so no ${long ? "buys" : "sells"} on this range.` };
    }
    case "waiting":
      return { title: "Waiting for the sweep", text: `Needs a candle to take the range ${side}, ${px(edge)}, into a key level, while candles keep closing inside the range.` };
    case "noKey":
      return { title: "Swept, but not into a key level" + later, text: `Took the range ${side} (to ${swept}) without reaching a fresh key level that fits the structure. No trade unless price reaches one while the range holds.` };
    case "key":
      return {
        title: "Swept into a key level" + later,
        text: `Took the range ${side} (to ${swept})${level}. Next: a ${chart} close ${long ? "above" : "below"} ${s.level !== null ? px(s.level) : "the last swing"}, the MSS.`,
        hot: true
      };
    case "mss":
      return {
        title: "MSS done" + later,
        text: `A ${chart} candle closed ${long ? "above" : "below"} ${px(s.m1!.mss ?? s.level ?? edge)}.${ob ? ` Order block ${px(ob.bottom)} to ${px(ob.top)}.` : ""} Waiting for the first pullback, the inducement.`,
        hot: true
      };
    case "limit": {
      const q = s.order!;
      return {
        title: `${long ? "Buy" : "Sell"} limit set` + later,
        text: `${long ? "Buy" : "Sell"} limit at ${px(q.level)}, the order block, once price takes the inducement at ${px(s.m1!.idm ?? q.level)}. Stop ${px(q.stop)}, target ${px(q.target)} (${q.r.toFixed(1)}R)${cfg.partialAtTp1 ? `, half at ${px(s.mid)}` : ""}.`,
        hot: true
      };
    }
    case "entered": {
      const t = s.trade!;
      const running = t.reason === "end";
      const when = `${weekday(t.entryT - 1)} ${fmtTime(t.entryT)} UTC`;
      const base = `${long ? "Bought" : "Sold"} at ${px(t.entry)} (${when}). Stop ${px(t.stop)}, target ${px(t.tp2)} (${t.plannedR.toFixed(1)}R).`;
      return running ? { title: "In a trade" + later, text: `${base} Now ${fmtR(t.r, 2)}.`, hot: true } : { title: "Traded" + later, text: `${base} Closed at ${fmtR(t.r, 2)}.` };
    }
    default:
      return { title: "No trade", text: whyM1(s, px, cfg) };
  }
}

function whyM1(s: LiveSetup, px: (x: number) => string, cfg: Config) {
  switch (s.why) {
    case "noSweep": return "The candle after the inside candles didn't take the range's high or low.";
    case "closedOutside": return "A candle closed outside the range.";
    case "targetHit": return "Price reached the range's other end before an entry.";
    case "mid": return `Price reached the 50% level (${px(s.mid)}) before the order filled.`;
    case "notInKey": return "The order block wasn't inside the key level.";
    case "news": return "US jobs report day: resting.";
    case "session": return "The entry came outside your entry times.";
    case "dailyCap": return `Already ${cfg.maxPerDay} trades today.`;
    case "alreadyIn": return "Already in a trade the same way.";
    case "pastMid": return "The entry would have been past the 50% level.";
    case "lowR": return `The target was only ${(s.skipR ?? 0).toFixed(1)}R away, under your ${cfg.minR}R minimum.`;
    case "expired": return "No entry within the candles allowed after the sweep.";
    default: return "This setup's time ran out.";
  }
}

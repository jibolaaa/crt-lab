"use client";
import type { Config, LiveSetup, RunResult } from "../engine";
import type { Market } from "../lib/markets";
import { KIND_LABEL, TF_LABEL } from "../lib/confluences";
import { fmtDay, fmtPrice, fmtR, fmtTime } from "../lib/format";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (t: number) => WEEKDAY[new Date(t * 1000).getUTCDay()];
// what needs watching first: a running trade, then an entry about to happen, then the rest
const RANK: Record<LiveSetup["stage"], number> = { entered: 0, touched: 1, zone: 2, key: 3, waiting: 4, noKey: 5, ended: 6, blocked: 7 };
const rank = (s: LiveSetup) => (s.stage === "entered" && s.trade?.reason !== "end" ? 5.5 : RANK[s.stage]);
const orList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);

/** What today's CRT looks like under the current rules, at the last closed candle. */
export function Now({ result, market, cfg, loading }: { result: RunResult | null; market: Market; cfg: Config; loading: boolean }) {
  if (market.source !== "deriv") {
    return (
      <section className="now" aria-labelledby="now-h">
        <h2 className="sec" id="now-h">Right now</h2>
        <p className="now-empty">This needs live prices. Pick a market from Deriv above, like Volatility 75 or Gold.</p>
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
  const c1 = l.setups.find((x) => !x.fromYesterday);
  const biasText = l.bias === null ? "off" : l.bias === 1 ? "buys" : l.bias === -1 ? "sells" : "none this week";
  return (
    <section className="now" aria-labelledby="now-h">
      <h2 className="sec" id="now-h">Right now</h2>
      <p className="now-meta">
        {fmtDay(l.date)}, as of {fmtTime(l.asOf)} UTC ({fmtTime(l.asOf + 3600)} in Lagos). Weekly bias: {biasText}.
      </p>
      {c1 && <p className="now-range">Candle 1 is {fmtDay(c1.rangeDate)}: high {px(c1.rangeHigh)}, low {px(c1.rangeLow)}, 50% at {px(c1.mid)}.</p>}
      {l.setups.length === 0 && <p className="now-empty">Not enough prices yet to read today.</p>}
      <ul className="now-list">
        {[...l.setups].sort((a, b) => rank(a) - rank(b)).map((s, i) => {
          const { title, text, hot } = describe(s, px, cfg, l.dayStart);
          return (
            <li key={i} className={`now-item${hot ? " hot" : ""}`}>
              <span className={`dir ${s.dir === 1 ? "buy" : "sell"}`}>{s.dir === 1 ? "Buy" : "Sell"}</span>
              <div>
                <b>{title}</b>
                <span>{text}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function describe(s: LiveSetup, px: (x: number) => string, cfg: Config, dayStart: number): { title: string; text: string; hot?: boolean } {
  const long = s.dir === 1;
  const side = long ? "low" : "high";
  const edge = long ? s.rangeLow : s.rangeHigh;
  const past = long ? "below" : "above";
  const beyond = long ? "above" : "below";
  const swept = px(s.sweepPrice ?? edge);
  // a sweep from yesterday has its own candle 1, so it names its days
  const from = (title: string) => (s.fromYesterday ? `${title} (${weekday(s.sweepDate)}'s sweep)` : title);
  const took = s.fromYesterday ? `${weekday(s.sweepDate)} took ${weekday(s.rangeDate)}'s ${side} (to ${swept}).` : `Took candle 1's ${side} (to ${swept}).`;
  const tfs = orList(cfg.keyLevelTfs.map((tf) => TF_LABEL[tf]));
  switch (s.stage) {
    case "blocked":
      return { title: "Off this week", text: `The weekly bias doesn't allow ${long ? "buys" : "sells"}.` };
    case "waiting":
      return { title: "Waiting for the sweep", text: `Needs price to trade ${past} candle 1's ${side}, ${px(edge)}.` };
    case "noKey":
      return {
        title: "Swept, but not into a key level",
        text: `Took candle 1's ${side} (to ${swept}) without reaching a fresh ${tfs ? `${tfs} ` : "key "}level. No trade unless price reaches one today.`
      };
    case "key":
      return {
        title: from(s.keyLevel ? "Swept into a key level" : "Swept"),
        text: s.keyLevel
          ? `${s.fromYesterday ? `${took} ` : ""}Reached a ${TF_LABEL[s.keyLevel.tf]} ${KIND_LABEL[s.keyLevel.kind]} at ${px(s.keyLevel.bottom)} to ${px(s.keyLevel.top)}. Waiting for a 1-hour zone to form.`
          : `${took} Waiting for a 1-hour zone to form.`
      };
    case "zone":
      return {
        title: from("Zone ready"),
        text: `${s.fromYesterday ? `${took} ` : ""}${s.zone ? `1-hour zone at ${px(s.zone.bottom)} to ${px(s.zone.top)}.` : "The 1-hour zone is set."} Waiting for price to come back into it.`
      };
    case "touched":
      return {
        title: from("Watch for the entry"),
        text: `${s.fromYesterday ? `${took} ` : ""}Price came back into the zone. ${s.level !== null ? `Entry when a 15-minute candle closes ${beyond} ${px(s.level)}.` : "Waiting for a 15-minute swing to break."}`,
        hot: true
      };
    case "entered": {
      const t = s.trade!;
      const running = t.reason === "end";
      const when = t.entryT - 900 >= dayStart ? `${fmtTime(t.entryT)} UTC` : `${weekday(t.entryT)} ${fmtTime(t.entryT)} UTC`;
      const base = `${long ? "Bought" : "Sold"} at ${px(t.entry)} (${when}). Stop ${px(t.stop)}, target ${px(t.tp2)} (${t.plannedR.toFixed(1)}R), grade ${t.grade}.`;
      return running
        ? { title: from("In a trade"), text: `${base} Now ${fmtR(t.r, 2)}.`, hot: true }
        : { title: from("Traded today"), text: `${base} Closed at ${fmtR(t.r, 2)}.` };
    }
    case "ended":
    default:
      return { title: "No trade today", text: whyText(s, px, cfg) };
  }
}

function whyText(s: LiveSetup, px: (x: number) => string, cfg: Config) {
  const r = (s.skipR ?? 0).toFixed(1);
  switch (s.why) {
    case "mid": return `Price reached the 50% level (${px(s.mid)}) before a shift.`;
    case "closedOutside": return "The sweep day closed outside candle 1's range.";
    case "brokeSweep": return "Price went past the sweep the next day.";
    case "news": return "US jobs report day: resting.";
    case "session": return "The shift came outside your entry times.";
    case "dailyCap": return `Already ${cfg.maxPerDay} trades today.`;
    case "pastMid": return "The shift came too close to the 50% level.";
    case "lowR": return `The target was only ${r}R away, under your ${cfg.minR}R minimum.`;
    case "lowRGrade":
      return cfg.lowRGrade === "any"
        ? `The target was ${r}R away.`
        : `The target was ${r}R away. Under ${cfg.fullR}R you only take grade ${cfg.lowRGrade}${cfg.lowRGrade === "A+" ? "" : " or better"}, and this wasn't.`;
    default: return "This setup's time ran out.";
  }
}

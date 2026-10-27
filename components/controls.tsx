"use client";
import { useEffect, useId, useState } from "react";
import type { ConfKey, Config, CrtTf, LevelKind, Session, Tf } from "../engine";
import { MARKETS, type Market, type Spec } from "../lib/markets";
import type { MoneyCfg } from "../lib/money";
import type { DataInfo } from "../lib/protocol";
import { fmtDate, fmtInt } from "../lib/format";

interface Props {
  market: Market;
  cfg: Config;
  update: (c: Partial<Config>) => void;
  reset: () => void;
  money: MoneyCfg;
  setMoney: (m: Partial<MoneyCfg>) => void;
  spec: Spec;
  setSpec: (s: Partial<Spec>) => void;
  /** "all": the rules only, since spread, stop room and lot sizes differ per market. */
  scope?: "one" | "all";
}

export const GROUPS = [...new Set(MARKETS.map((m) => m.group))];
const MUST_OPTIONS: [ConfKey, string][] = [
  ["weeklyBias", "Weekly structure"], ["weeklyCrt", "Weekly CRT"], ["mtf", "4H and daily structure"],
  ["discount", "Premium/discount"], ["strongKey", "Daily or weekly level"], ["obFvg", "OB and FVG overlap"],
  ["fib", "Fib 50 to 78.6%"], ["gann", "Gann box"], ["ifvg", "IFVG"], ["killzone", "London or NY open"],
  ["displacement", "Strong shift candle"], ["smt", "SMT"], ["oldLiquidity", "Old liquidity taken"]
];

interface MarketProps {
  market: Market;
  onMarket: (id: string) => void;
  data: DataInfo | null;
  loading: { text: string; fraction?: number } | null;
  loadError: string | null;
  onRetry: () => void;
}

/** The market picker, with how much data loaded and a refresh for live prices. */
export function MarketBar(p: MarketProps) {
  const m = p.market;
  return (
    <section className="market-bar" aria-label="Market">
      <div className="mb-row">
        <select aria-label="Market" className="select" value={m.id} onChange={(e) => p.onMarket(e.target.value)}>
          {GROUPS.map((g) => (
            <optgroup key={g} label={g === "Built in" ? "Built in (old prices)" : `${g}, live from Deriv`}>
              {MARKETS.filter((x) => x.group === g).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      {p.loading && (
        <div className="progress" role="status">
          <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round((p.loading.fraction ?? 0.04) * 100)}%` }} /></div>
          <p className="progress-text">{p.loading.text}</p>
        </div>
      )}
      {p.loadError && (
        <>
          <p className="error" role="alert">{p.loadError}</p>
          {m.source === "deriv" && <p className="data-meta">Check your connection and try again. If it keeps failing, Deriv may be down or blocked on this network.</p>}
          <button className="btn quiet small more" onClick={p.onRetry}>Try again</button>
        </>
      )}
      {p.data && !p.loading && (
        <p className="data-meta">
          {m.source === "deriv"
            ? <>Live from Deriv: {fmtInt(p.data.count)} {p.data.dt <= 300 ? "five" : "fifteen"}-minute candles since {fmtDate(p.data.from)}, as far back as Deriv sends. <button className="linkbtn" onClick={p.onRetry}>Refresh</button></>
            : <>Built in: 8 years of EUR/USD, 2014 to 2021. Good for testing, but too old for right now.</>}
        </p>
      )}
      {p.data?.shortBy?.startsWith("The connection") && !p.loading && <p className="warn">{p.data.shortBy} Testing what loaded.</p>}
      {m.random && <p className="data-meta">Deriv makes this market&apos;s prices with a random number generator, and says any patterns in its history are coincidental.</p>}
      {p.data?.smt && !p.loading && (
        <p className="data-meta">{p.data.smt.ok ? `SMT is checked against ${p.data.smt.name}.` : `SMT is left out: ${p.data.smt.name} didn't load.`}</p>
      )}
    </section>
  );
}

/** Every rule and the account settings, shown when asked for. */
export function Settings(p: Props) {
  const c = p.cfg, u = p.update, m = p.market;
  const toggleIn = <T extends string>(list: T[], v: T, on: boolean) => {
    const next = on ? [...list, v] : list.filter((x) => x !== v);
    return next.length ? next : list; // keep at least one
  };
  return (
    <>
      <section className="sec-rules" aria-labelledby="rules-h">
        <div className="rules-head">
          <h2 className="sec" id="rules-h">Rules</h2>
          <button className="linkbtn" onClick={p.reset}>Back to my rules</button>
        </div>
        <div className="panel">
          <h3 className="sub">The CRT</h3>
          <Multi
            legend="CRT candles" values={c.crt}
            options={[["day", "Daily"], ["week", "Weekly"]] as [CrtTf, string][]}
            onChange={(v, on) => u({ crt: toggleIn(c.crt, v, on) })}
            hint="Daily: the day before is candle 1, with 1-hour zones and a 5-minute BOS (15-minute on the built-in EUR/USD). Weekly: the week before is candle 1, with 4-hour zones and a 15-minute BOS."
          />
          <Choice
            legend="Weekly bias as a rule" name="bias" value={c.bias} onChange={(v) => u({ bias: v })}
            options={[["off", "Off, it only scores"], ["structure", "Weekly structure"], ["majority", "2 of 3 agree"], ["allAgree", "All 3 agree"], ["weeklyCrt", "Weekly CRT"], ["premiumDiscount", "Premium/discount"]]}
            hint="Off means the weekly bias only moves the percent. Otherwise trades against it are skipped. Structure: the last weekly close broke a weekly swing. Only finished weeks count."
          />
          <Choice
            legend="Daily candle starts at" name="day" value={c.dayStart} onChange={(v) => u({ dayStart: v })}
            options={[["utc", "Midnight UTC"], ["nyClose", "5pm New York"]]}
            hint="Deriv's MT5 charts use midnight UTC. Many other brokers use 5pm New York."
          />

          <hr className="divider" />
          <h3 className="sub">Candle 2&apos;s sweep</h3>
          <Toggle
            label="Must sweep into a key level"
            hint="Candle 2 takes candle 1's high or low and reaches a fresh higher-timeframe level."
            checked={c.requireKeyLevel} onChange={(v) => u({ requireKeyLevel: v })}
          />
          <Multi
            legend="Key levels from" values={c.keyLevelTfs} disabled={!c.requireKeyLevel}
            options={[["h4", "4-hour"], ["d1", "Daily"], ["w1", "Weekly"]] as [Tf, string][]}
            onChange={(v, on) => u({ keyLevelTfs: toggleIn(c.keyLevelTfs, v, on) })}
            hint="Weekly CRTs use the daily and weekly ones."
          />
          <Multi
            legend="Kinds of level" values={c.keyLevelKinds} disabled={!c.requireKeyLevel}
            options={[["old", "Old high or low purged"], ["ob", "Order block"], ["fvg", "Fair value gap"], ["rb", "Rejection block"], ["breaker", "Breaker block"]] as [LevelKind, string][]}
            onChange={(v, on) => u({ keyLevelKinds: toggleIn(c.keyLevelKinds, v, on) })}
            hint="A level counts if nothing touched it before candle 1. Candle 1 may already reach it, and candle 2 goes deeper. A zone stops counting once a candle of its own timeframe closes through it."
          />
          <Toggle
            label="Deeper sweeps keep the setup"
            hint="A later candle can sweep further. The setup ends when a candle closes outside candle 1's range."
            checked={c.deeperSweeps} onChange={(v) => u({ deeperSweeps: v })}
          />

          <hr className="divider" />
          <h3 className="sub">The entry</h3>
          <Choice
            legend="Entry" name="entry" value={c.entry} onChange={(v) => u({ entry: v })}
            options={[["shift", "BOS close"], ["retest", "Retest after the BOS"], ["qm", "QM limit"]]}
            hint="BOS close: price comes back into the zone, then a candle closes past the last swing (5-minute for daily CRTs on live prices, 15-minute for weekly). Retest: after that BOS, a limit at the order block it left. QM: an A-shape and a shift in the killer zone, then a limit at the QM line."
          />
          <Choice
            legend="Entry from" name="timing" value={c.timing} onChange={(v) => u({ timing: v })}
            options={[["nextDay", "Candle 3"], ["either", "Candle 2 or 3"], ["sameDay", "Candle 2 only"]]}
            hint="Candle 3 only counts once candle 2 closed back inside."
          />
          <div className="numrow">
            <NumberField label="Candles to wait" unit="after candle 2" value={c.entryWindow} min={1} max={10} onChange={(v) => u({ entryWindow: Math.max(1, Math.round(v)) })} />
          </div>
          <span className="hint">How long the entry can still come after candle 2, while the range holds.</span>
          {c.entry !== "qm" && (
            <>
              <Choice
                legend="Zone" name="zone" value={c.zone} onChange={(v) => u({ zone: v })}
                options={[["any", "OB, FVG or both"], ["obFvg", "OB with an FVG"], ["fvg", "FVG only"], ["ob", "OB only"], ["off", "No zone"]]}
                hint="A 1-hour zone (4-hour for weekly CRTs) that forms after the sweep. Price has to come back into it before the BOS."
              />
              <Toggle
                label="Zone inside the killer zone"
                hint="Between candle 1's body and the sweep's tip."
                checked={c.zoneInKiller} onChange={(v) => u({ zoneInKiller: v })}
              />
            </>
          )}
          <Choice
            legend="Swing size" name="swing" value={String(c.swing15)} onChange={(v) => u({ swing15: Number(v) })}
            options={[["1", "1 candle"], ["2", "2 candles"], ["3", "3 candles"]]}
            hint="How many candles each side make a swing high or low on the entry chart."
          />
          <Sessions value={c.sessions} onChange={(s) => u({ sessions: s })} />
          {c.usdNews && (
            <Toggle label="Rest on US jobs report days" hint="No new trades on NFP days. Other red folder news isn't in the calendar yet." checked={c.newsGuard} onChange={(v) => u({ newsGuard: v })} />
          )}

          <hr className="divider" />
          <h3 className="sub">The checklist</h3>
          <Multi
            legend="Must have" values={c.mustHave} options={MUST_OPTIONS}
            onChange={(v, on) => u({ mustHave: on ? [...c.mustHave.filter((x) => x !== v), v] : c.mustHave.filter((x) => x !== v) })}
            hint="Trades without these are skipped. The other checks only move the percent. SMT only applies where there's a related market."
          />
          <div className="numrow">
            <NumberField label="Lowest percent" unit="%" value={c.minPct} min={0} max={100} onChange={(v) => u({ minPct: v })} />
          </div>
          <span className="hint">Skip trades under this much of the checklist. 0 means any percent.</span>

          <hr className="divider" />
          <h3 className="sub">Stop and target</h3>
          <Choice
            legend="Stop" name="stop" value={c.stop} onChange={(v) => u({ stop: v })}
            options={[["ob", "Beyond the order block"], ["sweep", "Beyond the sweep"], ["pullback", c.entry === "qm" ? "Beyond the A-shape" : "Beyond the pullback"]]}
            hint="The order block is on the 1-hour chart, or the 4-hour for weekly CRTs."
          />
          {p.scope !== "all" ? (
            <>
              <div className="numrow">
                <NumberField label="Stop buffer" unit={m.unitName} value={c.stopBuffer / m.unit} min={0} max={1e6} onChange={(v) => u({ stopBuffer: v * m.unit })} />
                <NumberField label="Spread" unit={m.unitName} value={c.spread / m.unit} min={0} max={1e6} onChange={(v) => u({ spread: v * m.unit })} />
              </div>
              <span className="hint">The target is the far end of candle 1. The spread is an estimate: copy yours from the MT5 app.</span>
            </>
          ) : (
            <span className="hint">The target is the far end of candle 1. Each market uses its own usual spread and stop room.</span>
          )}
          <div className="numrow" style={{ marginTop: 14 }}>
            <NumberField label="Skip under" unit="R" value={c.minR} min={0} max={100} onChange={(v) => u({ minR: v })} />
            <NumberField label="Cap the target at" unit="R" value={c.maxR >= 1000 ? 0 : c.maxR} min={0} max={100} onChange={(v) => u({ maxR: v > 0 ? v : 1000 })} />
          </div>
          <span className="hint">0 means no cap. More detail has a table of how each cap did.</span>
          <div className="numrow" style={{ marginTop: 14 }}>
            <NumberField label="Below this target" unit="R" value={c.fullR} min={0} max={100} onChange={(v) => u({ fullR: v })} />
            <NumberField label="Need at least" unit="%" value={c.lowRPct} min={0} max={100} onChange={(v) => u({ lowRPct: v })} />
          </div>
          <span className="hint">Of the checklist. 0 means any percent.</span>
          <Toggle label="Take half at 50%" hint="Half closes at the middle of candle 1, and the stop moves to the entry price." checked={c.partialAtTp1} onChange={(v) => u({ partialAtTp1: v })} />
          <Toggle label="Close at the end of the next day (week)" hint="Whatever is still open closes when the day after the entry ends, or the week after for weekly CRTs." checked={c.timeStop} onChange={(v) => u({ timeStop: v })} />
          <div className="numrow">
            <NumberField label="Most trades a day" unit="trades" value={c.maxPerDay} min={0} max={50} onChange={(v) => u({ maxPerDay: Math.round(v) })} />
          </div>
          <span className="hint">0 means no limit.</span>
        </div>
      </section>

      {p.scope !== "all" && <section className="sec-account" aria-labelledby="acct-h">
        <h2 className="sec" id="acct-h">Your account</h2>
        <div className="panel">
          <div className="numrow">
            <NumberField label="Account size" unit="$" value={p.money.account} min={1} max={1e9} onChange={(v) => p.setMoney({ account: v })} />
            <NumberField label="Leverage 1:" unit="" value={p.money.leverage} min={1} max={5000} onChange={(v) => p.setMoney({ leverage: v })} />
          </div>
          <Choice
            legend="Size each trade by" name="mode" value={p.money.mode} onChange={(v) => p.setMoney({ mode: v })}
            options={[["lots", "Fixed lots"], ["risk", "Share of the balance"]]}
          />
          <div className="numrow">
            {p.money.mode === "lots"
              ? <NumberField label="Lots" unit="lots" value={p.money.lots} min={0.001} max={1000} onChange={(v) => p.setMoney({ lots: v })} />
              : <NumberField label="Risk per trade" unit="%" value={p.money.riskPct} min={0.01} max={100} onChange={(v) => p.setMoney({ riskPct: v })} />}
          </div>
          <details className="spec">
            <summary>Contract for {m.name}</summary>
            <div className="numrow">
              <NumberField label="Contract size" unit="per lot" value={p.spec.contract} min={0.0001} max={1e9} onChange={(v) => p.setSpec({ contract: v })} />
              <NumberField label="Smallest lot" unit="lots" value={p.spec.minLot} min={0.0001} max={100} onChange={(v) => p.setSpec({ minLot: v })} />
            </div>
            <div className="numrow" style={{ marginTop: 10 }}>
              <NumberField label="Lot step" unit="lots" value={p.spec.lotStep} min={0.0001} max={100} onChange={(v) => p.setSpec({ lotStep: v })} />
              {p.spec.quoteName && (
                <NumberField label={`Dollars per ${p.spec.quoteName}`} unit="$" value={p.spec.quoteUsd ?? 1} min={0.000001} max={1000} onChange={(v) => p.setSpec({ quoteUsd: v })} />
              )}
            </div>
            {p.spec.quoteName && <span className="hint">Prices here are in {p.spec.quoteName}, so dollars use this rate. About 0.0067 when USD/JPY is 150.</span>}
            <span className="hint">Starting values. Check them in your MT5 app: open the market and tap Specification.</span>
          </details>
        </div>
      </section>}
    </>
  );
}

export function Choice<T extends string>(p: { legend: string; name: string; value: T; options: [T, string][]; onChange: (v: T) => void; hint?: string }) {
  const id = useId();
  return (
    <fieldset className="group" aria-describedby={p.hint ? `${id}-hint` : undefined}>
      <legend>{p.legend}</legend>
      <div className="chips">
        {p.options.map(([v, label]) => (
          <label key={v} className="chip">
            <input type="radio" name={`${id}-${p.name}`} value={v} checked={p.value === v} onChange={() => p.onChange(v)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {p.hint && <span className="hint" id={`${id}-hint`}>{p.hint}</span>}
    </fieldset>
  );
}

function Multi<T extends string>(p: { legend: string; values: T[]; options: [T, string][]; onChange: (v: T, on: boolean) => void; hint?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <fieldset className="group" aria-describedby={p.hint ? `${id}-hint` : undefined} disabled={p.disabled}>
      <legend>{p.legend}</legend>
      <div className="chips">
        {p.options.map(([v, label]) => (
          <label key={v} className="chip">
            <input type="checkbox" checked={p.values.includes(v)} onChange={(e) => p.onChange(v, e.target.checked)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {p.hint && <span className="hint" id={`${id}-hint`}>{p.hint}</span>}
    </fieldset>
  );
}

function Toggle(p: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="toggle">
      <div className="toggle-text">
        <label htmlFor={id}>{p.label}</label>
        {p.hint && <span className="hint">{p.hint}</span>}
      </div>
      <span className="switch">
        <input id={id} type="checkbox" role="switch" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
        <span />
      </span>
    </div>
  );
}

const SESSION_LABELS: [Session, string][] = [["asian", "Asian"], ["london", "London"], ["newyork", "New York"]];

function Sessions(p: { value: Session[]; onChange: (s: Session[]) => void }) {
  const id = useId();
  return (
    <fieldset className="group" aria-describedby={`${id}-hint`}>
      <legend>Entry times</legend>
      <div className="chips">
        <label className="chip">
          <input type="checkbox" checked={p.value.length === 0} onChange={() => p.onChange([])} />
          <span>Any time</span>
        </label>
        {SESSION_LABELS.map(([s, label]) => (
          <label key={s} className="chip">
            <input
              type="checkbox" checked={p.value.includes(s)}
              onChange={(e) => p.onChange(e.target.checked ? [...p.value, s] : p.value.filter((x) => x !== s))}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <span className="hint" id={`${id}-hint`}>Asian 22:00 to 07:00 UTC (11pm to 8am in Lagos), London 07:00 to 12:00 (8am to 1pm), New York 12:00 to 17:00 (1pm to 6pm).</span>
    </fieldset>
  );
}

export function NumberField(p: { label: string; unit: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const id = useId();
  const shown = String(+p.value.toFixed(6));
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <div className="field">
      <label htmlFor={id}>{p.label}</label>
      <div className="num">
        <input
          id={id} inputMode="decimal" value={text}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value.replace(",", "."));
            if (e.target.value.trim() !== "" && Number.isFinite(v) && v >= p.min && v <= p.max) p.onChange(v);
          }}
          onBlur={() => setText(shown)}
        />
        {p.unit && <small>{p.unit}</small>}
      </div>
    </div>
  );
}

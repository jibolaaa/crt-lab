"use client";
import { useEffect, useId, useState } from "react";
import type { Config, Grade, LevelKind, Session, Tf } from "../engine";
import { HISTORY, MARKETS, type Market, type Spec } from "../lib/markets";
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
}

const GROUPS = [...new Set(MARKETS.map((m) => m.group))];

interface MarketProps {
  market: Market;
  months: number;
  onMarket: (id: string) => void;
  onMonths: (m: number) => void;
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
        {m.source === "deriv" && (
          <select aria-label="How far back" className="select months" value={p.months} onChange={(e) => p.onMonths(Number(e.target.value))}>
            {HISTORY.map((h) => <option key={h.months} value={h.months}>{h.label}</option>)}
          </select>
        )}
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
            ? <>Live from Deriv: {fmtInt(p.data.count)} fifteen-minute candles since {fmtDate(p.data.from)}. <button className="linkbtn" onClick={p.onRetry}>Refresh</button></>
            : <>Built in: 8 years of EUR/USD, 2014 to 2021. Good for testing, but too old for right now.</>}
        </p>
      )}
      {p.data?.shortBy && !p.loading && <p className="warn">{p.data.shortBy} Testing what loaded.</p>}
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
          <h3 className="sub">Direction</h3>
          <Choice
            legend="Weekly bias" name="bias" value={c.bias} onChange={(v) => u({ bias: v })}
            options={[["majority", "2 of 3 agree"], ["allAgree", "All 3 agree"], ["weeklyCrt", "Weekly CRT"], ["structure", "Structure"], ["premiumDiscount", "Premium/discount"], ["off", "Off"]]}
            hint="Weekly CRT: last week took one side of the week before and closed back inside. Structure: the last weekly close broke a weekly swing. Premium/discount: buy below the middle of the weekly range, sell above it. Only finished weeks count."
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
            hint="Candle 2 takes candle 1's high or low and reaches a fresh higher-timeframe level past it, without running far through it."
            checked={c.requireKeyLevel} onChange={(v) => u({ requireKeyLevel: v })}
          />
          <Multi
            legend="Key levels from" values={c.keyLevelTfs} disabled={!c.requireKeyLevel}
            options={[["h4", "4-hour"], ["d1", "Daily"], ["w1", "Weekly"]] as [Tf, string][]}
            onChange={(v, on) => u({ keyLevelTfs: toggleIn(c.keyLevelTfs, v, on) })}
          />
          <Multi
            legend="Kinds of level" values={c.keyLevelKinds} disabled={!c.requireKeyLevel}
            options={[["ob", "Order block"], ["breaker", "Breaker block"], ["fvg", "Fair value gap"]] as [LevelKind, string][]}
            onChange={(v, on) => u({ keyLevelKinds: toggleIn(c.keyLevelKinds, v, on) })}
            hint="Fresh means price hadn't come back to it on an earlier day. A level stops counting once a candle of its own timeframe closes through it."
          />

          <hr className="divider" />
          <h3 className="sub">The entry</h3>
          <Choice
            legend="1-hour zone" name="zone" value={c.zone} onChange={(v) => u({ zone: v })}
            options={[["obFvg", "Order block + gap"], ["fvg", "Gap only"], ["ob", "Order block only"], ["off", "No zone"]]}
            hint="After the sweep, wait for a 1-hour zone to form, then for price to come back into it before looking for the shift."
          />
          <Choice
            legend="Entry day" name="timing" value={c.timing} onChange={(v) => u({ timing: v })}
            options={[["either", "Either"], ["sameDay", "Sweep day"], ["nextDay", "Next day"]]}
            hint="Next day only counts if the sweep day closed back inside the range."
          />
          <Choice
            legend="15-minute swing size" name="swing" value={String(c.swing15)} onChange={(v) => u({ swing15: Number(v) })}
            options={[["1", "1 candle"], ["2", "2 candles"], ["3", "3 candles"]]}
            hint="How many candles each side make a swing high or low. The shift is a close beyond the last swing before the low (high for sells)."
          />
          <Sessions value={c.sessions} onChange={(s) => u({ sessions: s })} />
          {c.usdNews && (
            <Toggle label="Rest on US jobs report days" hint="No new trades on NFP days. Other red folder news isn't in the calendar yet." checked={c.newsGuard} onChange={(v) => u({ newsGuard: v })} />
          )}

          <hr className="divider" />
          <h3 className="sub">Stop and target</h3>
          <Choice
            legend="Stop" name="stop" value={c.stop} onChange={(v) => u({ stop: v })}
            options={[["ob", "Beyond the 1H order block"], ["sweep", "Beyond the sweep"], ["pullback", "Beyond the pullback"]]}
            hint="The 1H order block is the one in the entry zone. With a gap-only zone the stop goes beyond the gap, and with no zone beyond the sweep."
          />
          <div className="numrow">
            <NumberField label="Stop buffer" unit={m.unitName} value={c.stopBuffer / m.unit} min={0} max={1e6} onChange={(v) => u({ stopBuffer: v * m.unit })} />
            <NumberField label="Spread" unit={m.unitName} value={c.spread / m.unit} min={0} max={1e6} onChange={(v) => u({ spread: v * m.unit })} />
          </div>
          <span className="hint">The target is the liquidity at the far end of candle 1. The spread is an estimate: copy yours from the MT5 app.</span>
          <div className="numrow" style={{ marginTop: 14 }}>
            <NumberField label="Skip under" unit="R" value={c.minR} min={0} max={100} onChange={(v) => u({ minR: v })} />
            <NumberField label="Cap the target at" unit="R" value={c.maxR >= 1000 ? 0 : c.maxR} min={0} max={100} onChange={(v) => u({ maxR: v > 0 ? v : 1000 })} />
          </div>
          <span className="hint">0 means no cap.</span>
          <div className="numrow" style={{ marginTop: 14 }}>
            <NumberField label="Below this, need a grade" unit="R" value={c.fullR} min={0} max={100} onChange={(v) => u({ fullR: v })} />
          </div>
          <Choice
            legend="Grade needed below that" name="lowg" value={c.lowRGrade} onChange={(v) => u({ lowRGrade: v as Grade | "any" })}
            options={[["A+", "A+ (all)"], ["A", "A or better"], ["B", "B or better"], ["any", "Any"]]}
          />
          <Toggle label="Take half at 50%" hint="Half closes at the middle of candle 1, and the stop moves to the entry price." checked={c.partialAtTp1} onChange={(v) => u({ partialAtTp1: v })} />
          <Toggle label="Close at the end of day 3" hint="Whatever is still open closes when the day after the sweep ends." checked={c.timeStop} onChange={(v) => u({ timeStop: v })} />
          <div className="numrow">
            <NumberField label="Most trades a day" unit="trades" value={c.maxPerDay} min={0} max={50} onChange={(v) => u({ maxPerDay: Math.round(v) })} />
          </div>
          <span className="hint">0 means no limit.</span>
        </div>
      </section>

      <section className="sec-account" aria-labelledby="acct-h">
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
            </div>
            <span className="hint">Starting values. Check them in your MT5 app: open the market and tap Specification.</span>
          </details>
        </div>
      </section>
    </>
  );
}

function Choice<T extends string>(p: { legend: string; name: string; value: T; options: [T, string][]; onChange: (v: T) => void; hint?: string }) {
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

function NumberField(p: { label: string; unit: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
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

"use client";
import { useEffect, useId, useState } from "react";
import type { Config, Session } from "../engine";
import { HISTORY, MARKETS, type Market } from "../lib/markets";
import type { DataInfo } from "../lib/protocol";
import { fmtDate, fmtInt, fmtSpan } from "../lib/format";

interface Props {
  market: Market;
  months: number;
  onMarket: (id: string) => void;
  onMonths: (m: number) => void;
  data: DataInfo | null;
  loading: { text: string; fraction?: number } | null;
  loadError: string | null;
  onRetry: () => void;
  cfg: Config;
  update: (c: Partial<Config>) => void;
  reset: () => void;
  risk: number;
  setRisk: (r: number) => void;
}

const GROUPS = [...new Set(MARKETS.map((m) => m.group))];

export function Controls(p: Props) {
  return (
    <>
      <section className="sec-data" aria-labelledby="data-h">
        <h2 className="sec" id="data-h">Market</h2>
        <div className="panel">
          <div className="field">
            <label htmlFor="market">Prices to test on</label>
            <select id="market" className="select" value={p.market.id} onChange={(e) => p.onMarket(e.target.value)}>
              {GROUPS.map((g) => (
                <optgroup key={g} label={g === "Built in" ? "Built in, loads fast" : `${g}, live from Deriv`}>
                  {MARKETS.filter((m) => m.group === g).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          {p.market.source === "deriv" && (
            <div className="field">
              <label htmlFor="months">How far back</label>
              <select id="months" className="select" value={p.months} onChange={(e) => p.onMonths(Number(e.target.value))}>
                {HISTORY.map((h) => <option key={h.months} value={h.months}>{h.label}</option>)}
              </select>
            </div>
          )}

          {p.loading && (
            <div className="progress" role="status">
              <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round((p.loading.fraction ?? 0.04) * 100)}%` }} /></div>
              <p className="progress-text">{p.loading.text}</p>
            </div>
          )}
          {p.loadError && (
            <>
              <p className="error" role="alert">{p.loadError}</p>
              {p.market.source === "deriv" && <p className="data-meta">Check your connection and try again. If it keeps failing, Deriv may be down or blocked on this network. The built-in EUR/USD still works without it.</p>}
              <button className="btn quiet small more" onClick={p.onRetry}>Try again</button>
            </>
          )}
          {p.data && !p.loading && (
            <p className="data-meta">
              <strong>{fmtInt(p.data.count)}</strong> fifteen-minute candles, {fmtDate(p.data.from)} to {fmtDate(p.data.to - 900)} ({fmtSpan(p.data.from, p.data.to)}).
              {p.market.source === "builtin" ? " Dukascopy bid prices." : " Deriv's own price feed, which can differ slightly from MT5."}
            </p>
          )}
          {p.data?.shortBy && !p.loading && <p className="warn">{p.data.shortBy} Testing what loaded.</p>}
        </div>
      </section>

      <section className="sec-rules" aria-labelledby="rules-h">
        <div className="rules-head">
          <h2 className="sec" id="rules-h">Rules</h2>
          <button className="linkbtn" onClick={p.reset}>Back to my rules</button>
        </div>
        <div className="panel">
          <Choice
            legend="Weekly bias" name="bias" value={p.cfg.bias} onChange={(v) => p.update({ bias: v })}
            options={[["majority", "2 of 3 agree"], ["allAgree", "All 3 agree"], ["weeklyCrt", "Weekly CRT"], ["structure", "Structure"], ["premiumDiscount", "Premium/discount"], ["off", "Off"]]}
            hint="Weekly CRT: last week took one side of the week before and closed back inside. Structure: the last weekly close broke a weekly swing. Premium/discount: buy below the middle of the weekly range, sell above it. Only finished weeks count."
          />
          <Choice
            legend="1-hour zone" name="zone" value={p.cfg.zone} onChange={(v) => p.update({ zone: v })}
            options={[["obFvg", "Order block + gap"], ["fvg", "Gap only"], ["ob", "Order block only"], ["off", "No zone"]]}
            hint="After the sweep, wait for a 1-hour zone to form, then for price to come back into it before looking for the shift."
          />
          <Choice
            legend="Entry day" name="timing" value={p.cfg.timing} onChange={(v) => p.update({ timing: v })}
            options={[["either", "Either"], ["sameDay", "Sweep day"], ["nextDay", "Next day"]]}
            hint="Next day only counts if the sweep day closed back inside the range."
          />
          <Choice
            legend="15-minute swing size" name="swing" value={String(p.cfg.swing15)} onChange={(v) => p.update({ swing15: Number(v) })}
            options={[["1", "1 candle"], ["2", "2 candles"], ["3", "3 candles"]]}
            hint="How many candles each side make a swing high or low. The shift is a close beyond the last swing before the low (high for sells)."
          />
          <Choice
            legend="Stop" name="stop" value={p.cfg.stop} onChange={(v) => p.update({ stop: v })}
            options={[["sweep", "Beyond the sweep"], ["pullback", "Beyond the pullback"]]}
            hint="The pullback is the dip into the zone just before the shift. It's closer, so the risk is smaller, but it gets hit more."
          />

          <hr className="divider" />
          <Toggle label="Take half at 50%" hint="The stop then moves to the entry price." checked={p.cfg.partialAtTp1} onChange={(v) => p.update({ partialAtTp1: v })} />
          <Toggle label="Close at the end of day 3" hint="Whatever is still open closes when the day after the sweep ends." checked={p.cfg.timeStop} onChange={(v) => p.update({ timeStop: v })} />
          {p.cfg.usdNews && (
            <Toggle label="Rest on US jobs report days" hint="No new trades on NFP days. Other red folder news isn't in the calendar yet." checked={p.cfg.newsGuard} onChange={(v) => p.update({ newsGuard: v })} />
          )}

          <Sessions value={p.cfg.sessions} onChange={(s) => p.update({ sessions: s })} />
          <Choice
            legend="Daily candle starts at" name="day" value={p.cfg.dayStart} onChange={(v) => p.update({ dayStart: v })}
            options={[["utc", "Midnight UTC"], ["nyClose", "5pm New York"]]}
            hint="Deriv's MT5 charts use midnight UTC. Many other brokers use 5pm New York."
          />

          <hr className="divider" />
          <div className="numrow">
            <NumberField
              label="Spread" unit={p.market.unitName} value={p.cfg.spread / p.market.unit} min={0} max={1e6}
              onChange={(v) => p.update({ spread: v * p.market.unit })}
            />
            <NumberField label="Risk per trade" unit="%" value={p.risk} min={0.1} max={10} onChange={p.setRisk} />
          </div>
          <span className="hint">The spread is an estimate. Copy yours from the MT5 app for this market. Risk per trade only changes the account growth figure.</span>
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
  const shown = String(+p.value.toFixed(4));
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
        <small>{p.unit}</small>
      </div>
    </div>
  );
}

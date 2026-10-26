"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CONFIG, type Config, type RunResult } from "../engine";
import { defaultSpread, defaultStopBuffer, marketById, type Spec } from "../lib/markets";
import { simulate, type MoneyCfg } from "../lib/money";
import type { DataInfo, FromWorker, MatterRow, Request, ToWorker } from "../lib/protocol";
import { readHash, writeHash } from "../lib/urlstate";
import { fmtR } from "../lib/format";
import { Controls } from "./controls";
import { Funnel, Grades, Matters, StatsTable, Verdict } from "./results";
import { Trades, type Candles } from "./trades";
import { Method } from "./method";

const DATA_URL = "/data/eurusd-15m.bin";
const MONEY_KEY = "crt-lab:money";
const specKey = (id: string) => `crt-lab:spec:${id}`;
const DEFAULT_MONEY: MoneyCfg = { account: 10, mode: "lots", lots: 0.01, riskPct: 1, leverage: 500 };

// Remembered on this phone only, for convenience; the page works without it.
function load<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? { ...fallback, ...JSON.parse(raw) } : fallback; } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or storage off */ }
}

export default function Lab() {
  // ---- what the person chose ----
  const [marketId, setMarketId] = useState("eurusd-2014");
  const [months, setMonths] = useState(12);
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [money, setMoneyState] = useState<MoneyCfg>(DEFAULT_MONEY);
  const [spec, setSpecState] = useState<Spec>(marketById("eurusd-2014").spec);
  const [ready, setReady] = useState(false); // address read
  const market = marketById(marketId);

  // ---- what the engine sent back ----
  const [data, setData] = useState<DataInfo | null>(null);
  const [loading, setLoading] = useState<{ text: string; fraction?: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [matters, setMatters] = useState<MatterRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const worker = useRef<Worker | null>(null);
  const job = useRef(0);
  const loadJob = useRef(0);
  const runJob = useRef(0);
  const waiting = useRef(new Map<number, (m: FromWorker) => void>());
  const pending = useRef<{ spread?: number; stopBuffer?: number }>({});
  const defaults = useRef({ spread: market.spread ?? 0, stopBuffer: DEFAULT_CONFIG.stopBuffer });

  const onMessage = useCallback((m: FromWorker) => {
    const cb = waiting.current.get(m.job);
    if (cb) { waiting.current.delete(m.job); cb(m); return; }
    if (m.job === loadJob.current) {
      if (m.type === "progress") setLoading({ text: m.text, fraction: m.fraction });
      else if (m.type === "loaded") {
        const mk = marketById(m.info.marketId);
        defaults.current = { spread: defaultSpread(mk, m.info.lastClose), stopBuffer: defaultStopBuffer(mk, m.info.lastClose) };
        const spread = pending.current.spread ?? defaults.current.spread;
        const stopBuffer = pending.current.stopBuffer ?? defaults.current.stopBuffer;
        pending.current = {};
        setCfg((c) => ({ ...c, spread, stopBuffer, weekendClosed: mk.weekendClosed, usdNews: mk.usdNews }));
        setData(m.info);
        setLoading(null);
      } else if (m.type === "error") { setLoadError(m.message); setLoading(null); }
      return;
    }
    if (m.job === runJob.current) {
      if (m.type === "result") setResult(m.result);
      else if (m.type === "matters") { setMatters(m.rows); setBusy(false); }
      else if (m.type === "error") setBusy(false);
    }
  }, []);

  useEffect(() => {
    const w = new Worker(new URL("../lib/worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<FromWorker>) => onMessage(e.data);
    worker.current = w;
    return () => { w.terminate(); worker.current = null; };
  }, [onMessage]);

  const send = useCallback((msg: Request) => {
    const id = ++job.current;
    worker.current?.postMessage({ ...msg, job: id } as ToWorker);
    return id;
  }, []);

  // ---- read a shared setup from the address, and this phone's account settings, once ----
  useEffect(() => {
    const saved = readHash(window.location.hash);
    if (saved.marketId && marketById(saved.marketId).id === saved.marketId) setMarketId(saved.marketId);
    if (saved.months) setMonths(saved.months);
    pending.current = { spread: saved.cfg.spread, stopBuffer: saved.cfg.stopBuffer };
    setCfg((c) => ({ ...c, ...saved.cfg }));
    setMoneyState(load(MONEY_KEY, DEFAULT_MONEY));
    setReady(true);
  }, []);

  // the contract for the chosen market, with any changes made on this phone
  useEffect(() => { setSpecState(load(specKey(marketId), marketById(marketId).spec)); }, [marketId]);

  const setMoney = useCallback((change: Partial<MoneyCfg>) => setMoneyState((m) => { const next = { ...m, ...change }; save(MONEY_KEY, next); return next; }), []);
  const setSpec = useCallback((change: Partial<Spec>) => setSpecState((sp) => { const next = { ...sp, ...change }; save(specKey(marketId), next); return next; }), [marketId]);

  // ---- load prices when the market or history length changes ----
  const history = market.source === "builtin" ? 0 : months; // the built-in file has one length
  const loadPrices = useCallback(() => {
    const mk = marketById(marketId);
    setData(null);
    setResult(null);
    setMatters(null);
    setLoadError(null);
    setLoading({ text: mk.source === "builtin" ? "Loading 8 years of prices" : "Connecting to Deriv" });
    const from = Math.floor(Date.now() / 1000 - history * 30.44 * 86400);
    loadJob.current = send(mk.source === "builtin"
      ? { type: "load", marketId: mk.id, url: new URL(DATA_URL, window.location.href).href }
      : { type: "load", marketId: mk.id, symbol: mk.symbol, from });
  }, [marketId, history, send]);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(loadPrices, 50);
    return () => clearTimeout(t);
  }, [ready, loadPrices]);

  // ---- run the rules whenever they change ----
  useEffect(() => {
    if (!data || data.marketId !== marketId) return;
    setBusy(true);
    const t = setTimeout(() => { runJob.current = send({ type: "run", cfg, matters: true }); }, 90);
    return () => clearTimeout(t);
  }, [cfg, data, marketId, send]);

  // ---- keep the setup in the address ----
  useEffect(() => {
    if (!ready || !data) return;
    const hash = writeHash({ marketId, months, cfg, spreadDefault: defaults.current.spread, bufferDefault: defaults.current.stopBuffer });
    const url = window.location.pathname + window.location.search + (hash ? `#${hash}` : "");
    window.history.replaceState(null, "", url);
  }, [ready, data, marketId, months, cfg]);

  const getCandles = useCallback((from: number, to: number) => new Promise<Candles>((resolve, reject) => {
    const id = ++job.current;
    waiting.current.set(id, (m) => (m.type === "candles" ? resolve(m) : reject(new Error(m.type === "error" ? m.message : "No candles."))));
    worker.current?.postMessage({ type: "candles", job: id, from, to } satisfies ToWorker);
  }), []);

  const update = useCallback((change: Partial<Config>) => setCfg((c) => ({ ...c, ...change })), []);
  const reset = useCallback(() => setCfg((c) => ({
    ...DEFAULT_CONFIG, spread: defaults.current.spread, stopBuffer: defaults.current.stopBuffer, weekendClosed: c.weekendClosed, usdNews: c.usdNews
  })), []);

  const dollars = useMemo(() => (result ? simulate(result.trades, spec, money) : null), [result, spec, money]);
  const ticker = result ? { trades: result.all.trades, total: result.all.totalR } : null;

  return (
    <>
      <header className="bar">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
          <Logo /> CRT Lab
        </a>
        <div className="ticker" aria-live="polite">
          {(busy || loading) && <span className="busy" aria-hidden />}
          <span className="tk-market">{market.name}</span>
          {ticker && <span><b>{ticker.trades}</b> trades</span>}
          {ticker && ticker.trades > 0 && <b className={ticker.total > 0.05 ? "pos" : ticker.total < -0.05 ? "neg" : ""}>{fmtR(ticker.total)}</b>}
        </div>
      </header>

      <main className="page">
        <section className="intro">
          <h1>Test Candle Range Theory on years of real prices</h1>
          <p>Set the rules the way you trade them: weekly bias, a daily range swept into a higher-timeframe key level, a 1-hour zone, a 15-minute shift. See every trade they would have taken, graded on its confluences, and whether it held up on years it never saw.</p>
        </section>

        <div className="lab">
          <div className="col-controls">
            <Controls
              market={market} months={months} onMarket={setMarketId} onMonths={setMonths}
              data={data} loading={loading} loadError={loadError} onRetry={loadPrices}
              cfg={cfg} update={update} reset={reset}
              money={money} setMoney={setMoney} spec={spec} setSpec={setSpec}
            />
          </div>
          <div className="col-results">
            <Verdict result={result} data={data} market={market} failed={!!loadError} money={dollars} moneyCfg={money} />
            <StatsTable result={result} />
            <Grades result={result} />
            <Matters result={result} rows={matters} />
            <Funnel result={result} cfg={cfg} />
            <Trades result={result} market={market} getCandles={getCandles} money={dollars} moneyCfg={money} />
            <Method />
          </div>
        </div>

        <footer className="foot">
          <p>A testing tool, not financial advice. A rule set that made money in the past can still lose from here.</p>
          <p className="foot-links"><a href="https://github.com/jibolaaa/crt-lab">Code on GitHub</a><a href="https://ibrahimraji.vercel.app">Made by Ibrahim Raji</a></p>
        </footer>
      </main>
    </>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
      <g strokeLinecap="round">
        <path d="M8 7v18" stroke="#9aa3b0" strokeWidth="1.8" /><rect x="5.5" y="10" width="5" height="10" rx="1" fill="#9aa3b0" />
        <path d="M16 5v23" stroke="#e2725f" strokeWidth="1.8" /><rect x="13.5" y="9" width="5" height="9" rx="1" fill="#e2725f" />
        <path d="M24 6v17" stroke="#e3b04b" strokeWidth="1.8" /><rect x="21.5" y="9" width="5" height="11" rx="1" fill="#e3b04b" />
      </g>
    </svg>
  );
}

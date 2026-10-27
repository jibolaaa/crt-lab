"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CONFIG, type Config, type RunResult } from "../engine";
import { ALL_DEFAULT, DEFAULT_MARKET, MAX_CANDLES, MAX_HISTORY_DAYS, MARKETS, defaultSpread, defaultStopBuffer, marketById, type Spec } from "../lib/markets";
import { loadDerivCandles, type DerivCandle } from "../lib/deriv";
import { simulate, type MoneyCfg } from "../lib/money";
import type { Columns, DataInfo, FromWorker, MatterRow, Request, ScanMarket, StoredInfo, TargetRow, ToWorker } from "../lib/protocol";
import { combine, marketCfg, type ScanRow } from "../lib/scan";
import { readHash, writeHash, type View } from "../lib/urlstate";
import { fmtR } from "../lib/format";
import { CheckFilter, MarketBar, Settings } from "./controls";
import { Now } from "./now";
import { Funnel, Grades, Matters, StatsTable, Targets, Verdict } from "./results";
import { Trades, type Candles } from "./trades";
import { Method } from "./method";
import { AllMarkets } from "./allmarkets";

const DATA_URL = "/data/eurusd-15m.bin";
/** Live markets load 5-minute candles, so daily CRTs can look for 5-minute breaks of structure. */
const LIVE_GRANULARITY = 300;
const MONEY_KEY = "crt-lab:money";
const ALL_KEY = "crt-lab:all-markets";
const specKey = (id: string) => `crt-lab:spec:${id}`;
const DEFAULT_MONEY: MoneyCfg = { account: 10, mode: "lots", lots: 0.01, riskPct: 1, leverage: 500 };
const YEAR = 365 * 86400;

// Remembered on this phone only, for convenience; the page works without it.
function load<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? { ...fallback, ...JSON.parse(raw) } : fallback; } catch { return fallback; }
}
function loadIds(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    const ids = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && MARKETS.some((m) => m.id === x && m.source === "deriv")) : fallback;
  } catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode or storage off */ }
}

/** Resolves once the page is on screen. A phone pauses pages in the background, which can drop Deriv's connection. */
function whenVisible(): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", on);
      resolve();
    };
    document.addEventListener("visibilitychange", on);
  });
}
const dropped = (shortBy: string | null | undefined) => !!shortBy && shortBy.startsWith("The connection");

/** Candles that have closed, as columns for the worker. */
function toColumns(candles: DerivCandle[]): Columns {
  const now = Date.now() / 1000;
  const rows = candles.filter((c) => c.epoch + LIVE_GRANULARITY <= now); // the newest candle is usually still forming
  const col = (k: "epoch" | "open" | "high" | "low" | "close") => Float64Array.from(rows, (r) => r[k]);
  return { t: col("epoch"), o: col("open"), h: col("high"), l: col("low"), c: col("close") };
}

export default function Lab() {
  // ---- what the person chose ----
  const [view, setView] = useState<View>("one");
  const [marketId, setMarketId] = useState(DEFAULT_MARKET);
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [money, setMoneyState] = useState<MoneyCfg>(DEFAULT_MONEY);
  const [spec, setSpecState] = useState<Spec>(marketById(DEFAULT_MARKET).spec);
  const [allIds, setAllIdsState] = useState<string[]>(ALL_DEFAULT);
  const [showRules, setShowRules] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [ready, setReady] = useState(false); // address read
  const market = marketById(marketId);

  // ---- one market: what the engine sent back ----
  const [data, setData] = useState<DataInfo | null>(null);
  const [loading, setLoading] = useState<{ text: string; fraction?: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [matters, setMatters] = useState<MatterRow[] | null>(null);
  const [targets, setTargets] = useState<TargetRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- all markets ----
  const [scan, setScan] = useState<{ gen: number; rows: Record<string, ScanRow> }>({ gen: 0, rows: {} });
  const [scanStatus, setScanStatus] = useState<{ text: string; fraction: number } | null>(null);
  const [scanErrors, setScanErrors] = useState<Record<string, string>>({});

  const worker = useRef<Worker | null>(null);
  const job = useRef(0);
  const loadToken = useRef(0); // the one-market load that's current
  const progressJob = useRef(0); // the worker job whose progress shows
  const runJob = useRef(0);
  const waiting = useRef(new Map<number, (m: FromWorker) => void>());
  /** What the worker holds, by Deriv symbol. */
  const stored = useRef(new Map<string, StoredInfo>());
  /** Deriv loads run one at a time. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const scanGen = useRef(0);
  const scanToken = useRef(0);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const allRef = useRef(allIds);
  allRef.current = allIds;
  const pending = useRef<{ spread?: number; stopBuffer?: number }>({});
  const defaults = useRef({ spread: market.spread ?? 0, stopBuffer: DEFAULT_CONFIG.stopBuffer });

  const onMessage = useCallback((m: FromWorker) => {
    if (m.type === "progress") {
      if (m.job === progressJob.current) setLoading({ text: m.text, fraction: m.fraction });
      return;
    }
    const cb = waiting.current.get(m.job);
    if (cb) { waiting.current.delete(m.job); cb(m); return; }
    if (m.type === "scanRow") {
      setScan((s) => (s.gen === m.gen ? { gen: s.gen, rows: { ...s.rows, [m.row.marketId]: m.row } } : s));
      return;
    }
    if (m.job === runJob.current) {
      if (m.type === "result") setResult(m.result);
      else if (m.type === "matters") setMatters(m.rows);
      else if (m.type === "targets") { setTargets(m.rows); setBusy(false); }
      else if (m.type === "error") setBusy(false);
    }
  }, []);

  useEffect(() => {
    const w = new Worker(new URL("../lib/worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<FromWorker>) => onMessage(e.data);
    worker.current = w;
    return () => { w.terminate(); worker.current = null; };
  }, [onMessage]);

  /** Send a message without waiting for an answer. */
  const send = useCallback((msg: Request) => {
    const id = ++job.current;
    worker.current?.postMessage({ ...msg, job: id } as ToWorker);
    return id;
  }, []);
  /** Send a message and wait for the worker's answer to it. */
  const ask = useCallback((msg: Request, transfer: Transferable[] = []) => {
    const id = ++job.current;
    const done = new Promise<FromWorker>((resolve) => {
      waiting.current.set(id, resolve);
      worker.current?.postMessage({ ...msg, job: id } as ToWorker, transfer);
    });
    return { id, done };
  }, []);

  // ---- read a shared setup from the address, and this phone's settings, once ----
  useEffect(() => {
    const saved = readHash(window.location.hash);
    if (saved.marketId && marketById(saved.marketId).id === saved.marketId) setMarketId(saved.marketId);
    if (saved.view) setView(saved.view);
    pending.current = { spread: saved.cfg.spread, stopBuffer: saved.cfg.stopBuffer };
    setCfg((c) => ({ ...c, ...saved.cfg }));
    setMoneyState(load(MONEY_KEY, DEFAULT_MONEY));
    setAllIdsState(loadIds(ALL_KEY, ALL_DEFAULT));
    setReady(true);
  }, []);

  // the contract for the chosen market, with any changes made on this phone
  useEffect(() => { setSpecState(load(specKey(marketId), marketById(marketId).spec)); }, [marketId]);

  const setMoney = useCallback((change: Partial<MoneyCfg>) => setMoneyState((m) => { const next = { ...m, ...change }; save(MONEY_KEY, next); return next; }), []);
  const setSpec = useCallback((change: Partial<Spec>) => setSpecState((sp) => { const next = { ...sp, ...change }; save(specKey(marketId), next); return next; }), [marketId]);
  const setAllIds = useCallback((ids: string[]) => { setAllIdsState(ids); save(ALL_KEY, ids); }, []);

  /** Load one Deriv market into the worker, as far back as Deriv sends (once, unless forced). */
  const ensure = useCallback((symbol: string, onProgress?: (count: number, oldest: number) => void, force = false) => {
    const run = async (): Promise<StoredInfo> => {
      const have = stored.current.get(symbol);
      if (have && !force) return have;
      await whenVisible(); // wait while the page is in the background
      const now = Date.now() / 1000;
      const res = await loadDerivCandles(symbol, { from: Math.floor(now - MAX_HISTORY_DAYS * 86400), granularity: LIVE_GRANULARITY, maxCandles: MAX_CANDLES, onProgress });
      const cols = toColumns(res.candles);
      const m = await ask({ type: "store", key: symbol, ...cols, pipSize: res.pipSize, shortBy: res.shortBy }, [cols.t.buffer, cols.o.buffer, cols.h.buffer, cols.l.buffer, cols.c.buffer]).done;
      if (m.type !== "stored") throw new Error(m.type === "error" ? m.message : "Couldn't keep the prices.");
      stored.current.set(symbol, m.info);
      return m.info;
    };
    const p = queue.current.then(run, run);
    queue.current = p.catch(() => undefined);
    return p;
  }, [ask]);

  // ---- one market: load its prices, and the related market's for SMT ----
  const onLoaded = useCallback((info: DataInfo) => {
    const mk = marketById(info.marketId);
    defaults.current = { spread: defaultSpread(mk, info.lastClose), stopBuffer: defaultStopBuffer(mk, info.lastClose) };
    const spread = pending.current.spread ?? defaults.current.spread;
    const stopBuffer = pending.current.stopBuffer ?? defaults.current.stopBuffer;
    pending.current = {};
    setCfg((c) => ({ ...c, spread, stopBuffer, weekendClosed: mk.weekendClosed, usdNews: mk.usdNews, driftUp: !!mk.drift }));
    setData(info);
    setLoading(null);
  }, []);

  const loadPrices = useCallback((force = false) => {
    const mk = marketById(marketId);
    setData(null);
    setResult(null);
    setMatters(null);
    setTargets(null);
    setLoadError(null);
    const token = ++loadToken.current;
    const fail = (e: Error) => { if (loadToken.current === token) { setLoadError(e.message); setLoading(null); } };
    const done = (m: FromWorker) => {
      if (loadToken.current !== token) return;
      if (m.type === "loaded") onLoaded(m.info);
      else fail(new Error(m.type === "error" ? m.message : "Couldn't load the prices."));
    };
    if (mk.source === "builtin") {
      setLoading({ text: "Loading 8 years of prices" });
      const a = ask({ type: "load", marketId: mk.id, key: "builtin", url: new URL(DATA_URL, window.location.href).href });
      progressJob.current = a.id;
      a.done.then(done, fail);
      return;
    }
    const symbol = mk.symbol!;
    setLoading({ text: stored.current.has(symbol) && !force ? `Getting ${mk.name} ready` : `Connecting to Deriv for ${mk.name}` });
    const started = Date.now() / 1000;
    const progress = (name: string) => (count: number, oldest: number) => {
      if (loadToken.current === token) setLoading({ text: `Loading ${name} from Deriv: ${count.toLocaleString("en-GB")} candles so far`, fraction: Math.min(1, Math.max(0, (started - oldest) / YEAR)) });
    };
    (async () => {
      await ensure(symbol, progress(mk.name), force);
      let partnerKey: string | null = null, smt: DataInfo["smt"] = null;
      if (mk.smt) {
        try {
          await ensure(mk.smt.symbol, progress(`${mk.smt.name} for the SMT check`), force);
          partnerKey = mk.smt.symbol;
          smt = { name: mk.smt.name, ok: true };
        } catch {
          smt = { name: mk.smt.name, ok: false };
        }
      }
      if (loadToken.current !== token) return;
      done(await ask({ type: "use", marketId: mk.id, key: symbol, partnerKey, smt }).done);
    })().catch(fail);
  }, [marketId, ensure, ask, onLoaded]);

  useEffect(() => {
    if (!ready || view !== "one") return;
    const t = setTimeout(() => loadPrices(false), 50);
    return () => clearTimeout(t);
  }, [ready, view, loadPrices]);

  // ---- one market: run the rules whenever they change ----
  useEffect(() => {
    if (view !== "one" || !data || data.marketId !== marketId) return;
    setBusy(true);
    const t = setTimeout(() => { runJob.current = send({ type: "run", cfg, matters: true }); }, 90);
    return () => clearTimeout(t);
  }, [view, cfg, data, marketId, send]);

  // ---- all markets: run the rules on the loaded ones ----
  const scanMarkets = useCallback((ids: string[], gen: number) => {
    const markets: ScanMarket[] = [];
    for (const id of ids) {
      const mk = marketById(id);
      const info = mk.symbol ? stored.current.get(mk.symbol) : undefined;
      if (!info) continue;
      const partnerKey = mk.smt && stored.current.has(mk.smt.symbol) ? mk.smt.symbol : null;
      markets.push({ marketId: id, key: mk.symbol!, partnerKey, cfg: marketCfg(cfgRef.current, mk, info.lastClose) });
    }
    if (markets.length) send({ type: "scan", gen, markets });
  }, [send]);

  /** Load the chosen markets one by one, and show each one's result as soon as it's in. */
  const loadAll = useCallback(async (ids: string[], forceAll = false, forceIds: string[] = []) => {
    const token = ++scanToken.current;
    const live = ids.filter((id) => marketById(id).source === "deriv");
    for (let k = 0; k < live.length; k++) {
      if (scanToken.current !== token) return;
      const mk = marketById(live[k]);
      const force = forceAll || forceIds.includes(mk.id);
      const label = `${mk.name} (${k + 1} of ${live.length})`;
      const need = force || !stored.current.has(mk.symbol!) || (mk.smt && !stored.current.has(mk.smt.symbol));
      if (need) setScanStatus({ text: `Loading ${label}`, fraction: k / live.length });
      const progress = (what: string) => (count: number) => {
        if (scanToken.current === token) setScanStatus({ text: `Loading ${what}: ${count.toLocaleString("en-GB")} candles`, fraction: (k + 0.5) / live.length });
      };
      try {
        await ensure(mk.symbol!, progress(label), force);
        if (mk.smt) {
          try { await ensure(mk.smt.symbol, progress(`${mk.smt.name} for ${mk.name}'s SMT check`), force); } catch { /* SMT is left out */ }
        }
        setScanErrors((e) => { if (!(mk.id in e)) return e; const next = { ...e }; delete next[mk.id]; return next; });
      } catch (e) {
        setScanErrors((x) => ({ ...x, [mk.id]: (e as Error).message }));
        continue;
      }
      if (scanToken.current !== token) return;
      scanMarkets([mk.id], scanGen.current);
    }
    if (scanToken.current === token) setScanStatus(null);
  }, [ensure, scanMarkets]);

  useEffect(() => {
    if (!ready || view !== "all") return;
    loadAll(allIds);
    return () => { scanToken.current++; setScanStatus(null); }; // stop loading more when leaving, or when the list changes
  }, [ready, view, allIds, loadAll]);

  // new rules (or coming back to this view): run them on every loaded market
  useEffect(() => {
    if (!ready || view !== "all") return;
    const t = setTimeout(() => {
      const gen = ++scanGen.current;
      setScan({ gen, rows: {} });
      scanMarkets(allRef.current, gen);
    }, 120);
    return () => clearTimeout(t);
  }, [ready, view, cfg, scanMarkets]);

  const refreshAll = useCallback(() => {
    const gen = ++scanGen.current;
    setScan((s) => ({ gen, rows: s.rows })); // keep showing the old results until the new ones come in
    loadAll(allRef.current, true);
  }, [loadAll]);

  // back from the background: finish anything the phone cut short
  const viewRef = useRef(view);
  viewRef.current = view;
  const oneRef = useRef({ loadError, data });
  oneRef.current = { loadError, data };
  const errRef = useRef(scanErrors);
  errRef.current = scanErrors;
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === "hidden") return;
      if (viewRef.current === "one") {
        const { loadError: err, data: d } = oneRef.current;
        if (err || dropped(d?.shortBy)) loadPrices(true);
        return;
      }
      const bad = allRef.current.filter((id) => {
        const mk = marketById(id);
        return errRef.current[id] || (mk.symbol && dropped(stored.current.get(mk.symbol)?.shortBy));
      });
      if (bad.length) loadAll(allRef.current, false, bad);
    };
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [loadPrices, loadAll]);

  const openMarket = useCallback((id: string) => {
    setMarketId(id);
    setView("one");
    window.scrollTo({ top: 0 });
  }, []);

  // ---- keep the setup in the address ----
  useEffect(() => {
    if (!ready || (view === "one" && !data)) return;
    const hash = writeHash({ marketId, view, cfg, spreadDefault: defaults.current.spread, bufferDefault: defaults.current.stopBuffer });
    const url = window.location.pathname + window.location.search + (hash ? `#${hash}` : "");
    window.history.replaceState(null, "", url);
  }, [ready, data, marketId, view, cfg]);

  const getCandles = useCallback((from: number, to: number) => new Promise<Candles>((resolve, reject) => {
    const id = ++job.current;
    waiting.current.set(id, (m) => (m.type === "candles" ? resolve(m) : reject(new Error(m.type === "error" ? m.message : "No candles."))));
    worker.current?.postMessage({ type: "candles", job: id, from, to } satisfies ToWorker);
  }), []);

  const update = useCallback((change: Partial<Config>) => setCfg((c) => ({ ...c, ...change })), []);
  const reset = useCallback(() => setCfg((c) => ({
    ...DEFAULT_CONFIG, spread: defaults.current.spread, stopBuffer: defaults.current.stopBuffer, weekendClosed: c.weekendClosed, usdNews: c.usdNews, driftUp: c.driftUp
  })), []);

  const dollars = useMemo(() => (result ? simulate(result.trades, spec, money) : null), [result, spec, money]);
  const scanRows = useMemo(() => allIds.map((id) => scan.rows[id]).filter((r): r is ScanRow => !!r), [allIds, scan]);
  const allTotal = useMemo(() => (view === "all" ? combine(scanRows) : null), [view, scanRows]);
  const ticker = view === "all"
    ? (allTotal && allTotal.markets ? { trades: allTotal.trades, total: allTotal.totalR } : null)
    : result ? { trades: result.all.trades, total: result.all.totalR } : null;
  const working = view === "all" ? !!scanStatus : busy || !!loading;

  return (
    <>
      <header className="bar">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
          <Logo /> CRT Lab
        </a>
        <div className="ticker" aria-live="polite">
          {working && <span className="busy" aria-hidden />}
          <span className="tk-market">{view === "all" ? "All markets" : market.name}</span>
          {ticker && <span><b>{ticker.trades}</b> trade{ticker.trades === 1 ? "" : "s"}</span>}
          {ticker && ticker.trades > 0 && <b className={ticker.total > 0.05 ? "pos" : ticker.total < -0.05 ? "neg" : ""}>{fmtR(ticker.total)}</b>}
        </div>
      </header>

      <main className="page simple">
        <p className="tagline">Your CRT rules on real prices: today&apos;s daily and weekly setups, a call when there&apos;s an entry, and how the rules have done.</p>

        <div className="view-switch" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "one"} className={view === "one" ? "on" : ""} onClick={() => setView("one")}>One market</button>
          <button role="tab" aria-selected={view === "all"} className={view === "all" ? "on" : ""} onClick={() => setView("all")}>All markets</button>
        </div>
        <p className="view-hint">
          {view === "one"
            ? "One market in detail: its setups, trades and charts."
            : "Your rules on all your markets at once: every setup close to an entry, and the total result."}
        </p>
        <CheckFilter value={cfg.minPct} onChange={(v) => update({ minPct: v })} />

        {view === "one" ? (
          <>
            <MarketBar market={market} onMarket={setMarketId} data={data} loading={loading} loadError={loadError} onRetry={() => loadPrices(true)} />
            <Now result={result} market={market} cfg={cfg} loading={!!loading} dt={data?.dt} />
            <Verdict result={result} data={data} market={market} failed={!!loadError} money={dollars} moneyCfg={money} />
          </>
        ) : (
          <AllMarkets ids={allIds} setIds={setAllIds} rows={scanRows} status={scanStatus} errors={scanErrors} cfg={cfg} onOpen={openMarket} onRefresh={refreshAll} />
        )}

        <div className="more-row">
          <button className={`btn quiet${showRules ? " on" : ""}`} aria-expanded={showRules} onClick={() => setShowRules((x) => !x)}>
            {showRules ? "Hide rules" : "Change rules"}
          </button>
          {view === "one" && (
            <button className={`btn quiet${showMore ? " on" : ""}`} aria-expanded={showMore} onClick={() => setShowMore((x) => !x)}>
              {showMore ? "Less detail" : "More detail"}
            </button>
          )}
        </div>

        {showRules && (
          <div className="drawer">
            <Settings market={market} cfg={cfg} update={update} reset={reset} money={money} setMoney={setMoney} spec={spec} setSpec={setSpec} scope={view} />
          </div>
        )}
        {view === "one" && showMore && (
          <div className="drawer">
            <StatsTable result={result} />
            <Targets result={result} rows={targets} cfg={cfg} />
            <Grades result={result} />
            <Matters result={result} rows={matters} />
            <Funnel result={result} cfg={cfg} />
            <Method />
          </div>
        )}

        {view === "one" && <Trades result={result} market={market} getCandles={getCandles} money={dollars} moneyCfg={money} dt={data?.dt ?? 900} />}

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

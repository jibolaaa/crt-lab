/// <reference lib="webworker" />
// Runs the engine off the main thread so the page stays smooth on a phone.
// It keeps every market's candles it has been given, so switching markets, or
// running the rules on all of them, doesn't load anything twice.
import { prepare, runBacktest, seriesFromBuffer, type Config, type Prepared, type Series } from "../engine";
import { candleSeconds } from "../engine/htf";
import { variantsFor } from "./matters";
import type { FromWorker, MatterRow, StoredInfo, TargetRow, ToWorker } from "./protocol";
import { toScanRow } from "./scan";

/** The target caps tried in the "Which target?" table. */
export const CAPS = [2, 3, 4, 5, 6, 8, 10, 1000];

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: FromWorker) => ctx.postMessage(msg);

interface Stored { s: Series; pipSize: number | null; shortBy: string | null }
const store = new Map<string, Stored>();
/** Prepared candles, by series, related market and the settings that change them. */
const preparedCache = new Map<string, Prepared>();
/** The one-market view: which stored candles it reads. */
let current: { key: string; partnerKey: string | null } | null = null;
let latestRun = 0;
let latestGen = 0;

function infoOf(key: string, e: Stored): StoredInfo {
  const s = e.s, dt = candleSeconds(s);
  return { key, count: s.n, dt, from: s.t[0], to: s.t[s.n - 1] + dt, lastClose: s.c[s.n - 1], pipSize: e.pipSize, shortBy: e.shortBy };
}

function put(key: string, e: Stored) {
  store.set(key, e);
  for (const k of [...preparedCache.keys()]) if (k.split("|").slice(0, 2).includes(key)) preparedCache.delete(k);
}

function preparedFor(key: string, partnerKey: string | null, cfg: Config) {
  const id = `${key}|${partnerKey ?? ""}|${cfg.dayStart}|${cfg.weekendClosed}|${cfg.swingWeekly}`;
  let p = preparedCache.get(id);
  if (!p) {
    const e = store.get(key);
    if (!e) throw new Error("Those prices aren't loaded yet.");
    const partner = partnerKey ? store.get(partnerKey)?.s ?? null : null;
    if (preparedCache.size > 60) preparedCache.clear(); // keep memory in check
    p = prepare(e.s, cfg, partner && partner.n ? partner : null);
    preparedCache.set(id, p);
  }
  return p;
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));

async function fetchWithProgress(url: string, job: number) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error("Couldn't load the built-in prices.");
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) post({ type: "progress", job, text: "Loading 8 years of prices", fraction: got / total });
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out.buffer;
}

function useStored(job: number, marketId: string, key: string, partnerKey: string | null, smt: { name: string; ok: boolean } | null) {
  const e = store.get(key);
  if (!e || !e.s.n) throw new Error("No prices came back for this market.");
  current = { key, partnerKey: partnerKey && store.get(partnerKey)?.s.n ? partnerKey : null };
  const i = infoOf(key, e);
  post({ type: "loaded", job, info: { marketId, count: i.count, dt: i.dt, from: i.from, to: i.to, lastClose: i.lastClose, pipSize: i.pipSize, shortBy: i.shortBy, smt } });
}

ctx.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      // the built-in file
      if (!store.has(msg.key)) {
        post({ type: "progress", job: msg.job, text: "Loading 8 years of prices", fraction: 0 });
        put(msg.key, { s: seriesFromBuffer(await fetchWithProgress(msg.url, msg.job)), pipSize: null, shortBy: null });
      }
      useStored(msg.job, msg.marketId, msg.key, null, null);
    } else if (msg.type === "store") {
      // live candles, loaded by the page from Deriv
      const s: Series = { n: msg.t.length, t: msg.t, o: msg.o, h: msg.h, l: msg.l, c: msg.c };
      put(msg.key, { s, pipSize: msg.pipSize, shortBy: msg.shortBy });
      if (!s.n) throw new Error("No prices came back for this market.");
      post({ type: "stored", job: msg.job, info: infoOf(msg.key, store.get(msg.key)!) });
    } else if (msg.type === "use") {
      useStored(msg.job, msg.marketId, msg.key, msg.partnerKey, msg.smt);
    } else if (msg.type === "run") {
      latestRun = msg.job;
      if (!current) throw new Error("Load a market first.");
      const cur = current;
      const p = preparedFor(cur.key, cur.partnerKey, msg.cfg);
      const result = runBacktest(p, msg.cfg);
      post({ type: "result", job: msg.job, result });
      if (!msg.matters) return;
      const rows: MatterRow[] = [];
      for (const v of variantsFor(msg.cfg)) {
        await nextTick();
        if (latestRun !== msg.job) return; // newer rules arrived
        const cfg = { ...msg.cfg, ...v.change };
        const r = runBacktest(preparedFor(cur.key, cur.partnerKey, cfg), cfg);
        rows.push({ key: v.key, label: v.label, trades: r.all.trades, totalR: r.all.totalR, avgR: r.all.avgR, lateTrades: r.unseen.trades, lateR: r.unseen.totalR });
      }
      post({ type: "matters", job: msg.job, rows });
      const targets: TargetRow[] = [];
      for (const cap of CAPS) {
        await nextTick();
        if (latestRun !== msg.job) return;
        const cfg = { ...msg.cfg, maxR: cap };
        const r = runBacktest(preparedFor(cur.key, cur.partnerKey, cfg), cfg);
        targets.push({
          cap, trades: r.all.trades, winRate: r.all.winRate, avgR: r.all.avgR, totalR: r.all.totalR,
          seenR: r.seen.totalR, lateTrades: r.unseen.trades, lateR: r.unseen.totalR
        });
      }
      post({ type: "targets", job: msg.job, rows: targets });
    } else if (msg.type === "scan") {
      // All markets: each market's result as soon as it's ready; a newer run (gen) stops older ones
      latestGen = Math.max(latestGen, msg.gen);
      for (const m of msg.markets) {
        await nextTick();
        if (msg.gen < latestGen) return;
        const e = store.get(m.key);
        if (!e || !e.s.n) continue;
        const r = runBacktest(preparedFor(m.key, m.partnerKey, m.cfg), m.cfg);
        post({ type: "scanRow", job: msg.job, gen: msg.gen, row: toScanRow(m.marketId, infoOf(m.key, e), r) });
      }
    } else if (msg.type === "candles") {
      if (!current) throw new Error("Load a market first.");
      const s = store.get(current.key)!.s;
      let i0 = 0, i1 = s.n;
      while (i0 < s.n && s.t[i0] < msg.from) i0++;
      i1 = i0;
      while (i1 < s.n && s.t[i1] <= msg.to) i1++;
      const take = (a: ArrayLike<number>) => Array.from({ length: i1 - i0 }, (_, k) => a[i0 + k]);
      post({ type: "candles", job: msg.job, t: take(s.t), o: take(s.o), h: take(s.h), l: take(s.l), c: take(s.c) });
    }
  } catch (err) {
    post({ type: "error", job: msg.job, message: err instanceof Error ? err.message : "Something went wrong." });
  }
};

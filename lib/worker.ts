/// <reference lib="webworker" />
// Runs the engine off the main thread so the page stays smooth on a phone.
import { prepare, runBacktest, seriesFromBuffer, type Config, type Prepared, type Series } from "../engine";
import { candleSeconds } from "../engine/htf";
import { variantsFor } from "./matters";
import type { FromWorker, MatterRow, TargetRow, ToWorker } from "./protocol";

/** The target caps tried in the "Which target?" table. */
export const CAPS = [2, 3, 4, 5, 6, 8, 10, 1000];

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: FromWorker) => ctx.postMessage(msg);

let series: Series | null = null;
let partner: Series | null = null; // a related market, for the SMT check
let prepared: { key: string; p: Prepared } | null = null;
let latestRun = 0;

function getPrepared(cfg: Config) {
  const key = `${cfg.dayStart}|${cfg.weekendClosed}|${cfg.swingWeekly}`;
  if (!prepared || prepared.key !== key) prepared = { key, p: prepare(series!, cfg, partner) };
  return prepared.p;
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

ctx.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    if (msg.type === "load" || msg.type === "series") {
      series = null;
      partner = null;
      prepared = null;
      let pipSize: number | null = null, shortBy: string | null = null;
      let smt: { name: string; ok: boolean } | null = null;
      if (msg.type === "load") {
        post({ type: "progress", job: msg.job, text: "Loading 8 years of prices", fraction: 0 });
        series = seriesFromBuffer(await fetchWithProgress(msg.url, msg.job));
      } else {
        // live candles, loaded by the page from Deriv
        series = { n: msg.t.length, t: msg.t, o: msg.o, h: msg.h, l: msg.l, c: msg.c };
        pipSize = msg.pipSize;
        shortBy = msg.shortBy;
        const pc = msg.partner;
        if (pc && pc.t.length) partner = { n: pc.t.length, t: pc.t, o: pc.o, h: pc.h, l: pc.l, c: pc.c };
        smt = msg.smt;
      }
      if (!series.n) throw new Error("No prices came back for this market.");
      post({
        type: "loaded", job: msg.job,
        info: { marketId: msg.marketId, count: series.n, dt: candleSeconds(series), from: series.t[0], to: series.t[series.n - 1] + candleSeconds(series), lastClose: series.c[series.n - 1], pipSize, shortBy, smt }
      });
    } else if (msg.type === "run") {
      latestRun = msg.job;
      if (!series) throw new Error("Load a market first.");
      const p = getPrepared(msg.cfg);
      const result = runBacktest(p, msg.cfg);
      post({ type: "result", job: msg.job, result });
      if (!msg.matters) return;
      const rows: MatterRow[] = [];
      for (const v of variantsFor(msg.cfg)) {
        await nextTick();
        if (latestRun !== msg.job) return; // newer rules arrived
        const cfg = { ...msg.cfg, ...v.change };
        const r = runBacktest(getPrepared(cfg), cfg);
        rows.push({ key: v.key, label: v.label, trades: r.all.trades, totalR: r.all.totalR, avgR: r.all.avgR, lateTrades: r.unseen.trades, lateR: r.unseen.totalR });
      }
      post({ type: "matters", job: msg.job, rows });
      const targets: TargetRow[] = [];
      for (const cap of CAPS) {
        await nextTick();
        if (latestRun !== msg.job) return;
        const cfg = { ...msg.cfg, maxR: cap };
        const r = runBacktest(getPrepared(cfg), cfg);
        targets.push({
          cap, trades: r.all.trades, winRate: r.all.winRate, avgR: r.all.avgR, totalR: r.all.totalR,
          seenR: r.seen.totalR, lateTrades: r.unseen.trades, lateR: r.unseen.totalR
        });
      }
      post({ type: "targets", job: msg.job, rows: targets });
    } else if (msg.type === "candles") {
      if (!series) throw new Error("Load a market first.");
      const s = series;
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

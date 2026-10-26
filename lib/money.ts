// Turns R results into dollars for a given account, lot size and leverage.
// Every market here is quoted in US dollars, so a price move of 1.0 on one
// unit is $1: a trade's dollars are price move x contract size x lots.
import type { Trade } from "../engine";
import type { Spec } from "./markets";

export interface MoneyCfg {
  account: number; // starting balance in dollars
  mode: "lots" | "risk"; // a fixed lot size, or a share of the balance at risk
  lots: number;
  riskPct: number;
  leverage: number; // 500 means 1:500
}

export interface TradeMoney {
  lots: number;
  balance: number; // balance when the trade opened
  riskUsd: number; // lost if the stop is hit
  targetUsd: number; // made if the final target is hit
  pnlUsd: number; // what it actually made or lost
  riskShare: number; // riskUsd / balance
  margin: number;
  minLotTooBig: boolean; // in risk mode, even the smallest lot risks more than the chosen share
  skipped: boolean; // the account was already empty
}

export interface MoneyResult {
  byId: Map<number, TradeMoney>;
  final: number;
  maxDrawdownPct: number;
  blownAt: number | null; // when the balance reached zero
  riskiest: number; // the largest share of the balance any single trade put at risk
  overShare: number; // trades that risked more than 10% of the balance
  curve: { t: number; v: number }[];
}

/** Round a lot size down to the lot step, without floating-point dust. */
export function roundLots(x: number, step: number) {
  const n = Math.floor(x / step + 1e-9);
  return +(n * step).toFixed(6);
}

export function dollarsPerMove(spec: Spec, lots: number) {
  return spec.contract * lots;
}

export function simulate(trades: Trade[], spec: Spec, m: MoneyCfg): MoneyResult {
  const byId = new Map<number, TradeMoney>();
  // sizes are set when a trade opens, from the balance after every trade that had closed by then
  const opened = [...trades].sort((a, b) => a.entryT - b.entryT);
  const closing = [...trades].sort((a, b) => a.exitT - b.exitT);
  let balance = m.account, closedUpTo = 0, peak = m.account, maxDd = 0;
  let blownAt: number | null = null, riskiest = 0, overShare = 0;
  const pnl = new Map<number, number>();
  const curve: { t: number; v: number }[] = [];
  const settle = (until: number) => {
    while (closedUpTo < closing.length && closing[closedUpTo].exitT <= until) {
      const tr = closing[closedUpTo++];
      const p = pnl.get(tr.id);
      if (p === undefined) continue;
      balance += p;
      if (blownAt === null && balance <= 0) { blownAt = tr.exitT; balance = 0; }
      peak = Math.max(peak, balance);
      if (peak > 0) maxDd = Math.max(maxDd, (peak - balance) / peak);
      curve.push({ t: tr.exitT, v: balance });
    }
  };
  for (const tr of opened) {
    settle(tr.entryT);
    const empty = blownAt !== null || balance <= 0;
    let lots = m.mode === "lots" ? Math.max(spec.minLot, roundLots(m.lots, spec.lotStep)) : 0;
    let minLotTooBig = false;
    if (m.mode === "risk") {
      const perLot = tr.risk * spec.contract;
      lots = roundLots((balance * m.riskPct) / 100 / perLot, spec.lotStep);
      if (lots < spec.minLot) { lots = spec.minLot; minLotTooBig = true; }
    }
    const per = dollarsPerMove(spec, lots);
    const riskUsd = tr.risk * per;
    const share = balance > 0 ? riskUsd / balance : Infinity;
    const money: TradeMoney = {
      lots, balance, riskUsd, targetUsd: tr.plannedR * riskUsd, pnlUsd: empty ? 0 : tr.r * riskUsd,
      riskShare: share, margin: (lots * spec.contract * tr.entry) / Math.max(1, m.leverage), minLotTooBig, skipped: empty
    };
    byId.set(tr.id, money);
    if (!empty) {
      pnl.set(tr.id, money.pnlUsd);
      riskiest = Math.max(riskiest, share);
      if (share > 0.1) overShare++;
    }
  }
  settle(Infinity);
  return { byId, final: balance, maxDrawdownPct: maxDd * 100, blownAt, riskiest, overShare, curve };
}

export const fmtUsd = (x: number) => {
  const a = Math.abs(x);
  const s = a >= 1000 ? a.toLocaleString("en-GB", { maximumFractionDigits: 0 }) : a.toFixed(2);
  return (x < 0 ? "−$" : "$") + s;
};

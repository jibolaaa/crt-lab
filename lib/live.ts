// Which live setups to show first, shared by the one-market and All markets views.
import type { LiveSetup } from "../engine";

// what needs watching first: a running trade, a limit, an entry about to happen, then the rest
export const RANK: Record<LiveSetup["stage"], number> = {
  entered: 0, limit: 1, touched: 2, armed: 3, zone: 4, swept: 5, key: 6, waiting: 7, noKey: 8, ended: 9, blocked: 10
};
export const rank = (s: LiveSetup) => (s.stage === "entered" && s.trade?.reason !== "end" ? 8.5 : RANK[s.stage]);

/** Setups worth listing across markets: a trade, an order, or a setup on its way to an entry. */
export const ACTIONABLE = new Set<LiveSetup["stage"]>(["entered", "limit", "touched", "armed", "zone", "key", "swept"]);

/** One row per direction: the setup furthest along, plus any trade still running. */
export function pickSetups(list: LiveSetup[]) {
  const sorted = [...list].sort((a, b) => rank(a) - rank(b) || b.age - a.age);
  const out: LiveSetup[] = [];
  for (const s of sorted) {
    const running = s.stage === "entered" && s.trade?.reason === "end";
    if (running || !out.some((x) => x.dir === s.dir && !(x.stage === "entered" && x.trade?.reason === "end"))) out.push(s);
  }
  return out.sort((a, b) => rank(a) - rank(b));
}

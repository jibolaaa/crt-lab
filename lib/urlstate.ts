// Keeps the chosen market and rules in the address, so a setup can be shared.
import { CONFLUENCES, DEFAULT_CONFIG, type ConfKey, type Config, type CrtTf, type LevelKind, type Session, type Tf } from "../engine";
import { DEFAULT_MARKET } from "./markets";

export type View = "one" | "all";
export interface Saved { marketId?: string; view?: View; cfg: Partial<Config> }

const ONE_OF = {
  bias: ["off", "weeklyCrt", "structure", "premiumDiscount", "majority", "allAgree"],
  entry: ["shift", "retest", "qm"],
  zone: ["any", "obFvg", "fvg", "ob", "off"],
  timing: ["sameDay", "nextDay", "either"],
  stop: ["sweep", "pullback", "ob"],
  dayStart: ["utc", "nyClose"],
  freshFrom: ["candle1", "candle2"]
} as const;
const FLAGS = { half: "partialAtTp1", day3: "timeStop", news: "newsGuard", key: "requireKeyLevel", deep: "deeperSweeps", mid: "midCancels", kz: "zoneInKiller" } as const;
const NUMBERS = { swing: "swing15", minr: "minR", fullr: "fullR", lowpct: "lowRPct", maxr: "maxR", perday: "maxPerDay", window: "entryWindow", minpct: "minPct" } as const;
const LISTS = {
  crt: { key: "crt", allowed: ["day", "week"] as CrtTf[] },
  sess: { key: "sessions", allowed: ["asian", "london", "newyork"] as Session[] },
  ktf: { key: "keyLevelTfs", allowed: ["h4", "d1", "w1"] as Tf[] },
  kind: { key: "keyLevelKinds", allowed: ["old", "ob", "fvg", "rb", "breaker"] as LevelKind[] },
  must: { key: "mustHave", allowed: [...CONFLUENCES] as ConfKey[] }
} as const;

export function readHash(hash: string): Saved {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const cfg: Record<string, unknown> = {};
  for (const [key, allowed] of Object.entries(ONE_OF)) {
    const v = q.get(key);
    if (v && (allowed as readonly string[]).includes(v)) cfg[key] = v;
  }
  for (const [short, key] of Object.entries(FLAGS)) {
    const v = q.get(short);
    if (v === "1" || v === "0") cfg[key] = v === "1";
  }
  for (const [short, key] of Object.entries(NUMBERS)) {
    const v = Number(q.get(short));
    if (q.has(short) && Number.isFinite(v) && v >= 0 && v <= 1000) cfg[key] = v;
  }
  for (const [short, { key, allowed }] of Object.entries(LISTS)) {
    const v = q.get(short);
    if (v === null) continue;
    const list = v.split(",").filter((x) => (allowed as readonly string[]).includes(x));
    if (list.length || key === "sessions" || key === "mustHave") cfg[key] = list;
  }
  for (const [short, key] of [["spread", "spread"], ["buf", "stopBuffer"]] as const) {
    const v = Number(q.get(short));
    if (q.has(short) && Number.isFinite(v) && v >= 0) cfg[key] = v;
  }
  return {
    marketId: q.get("m") ?? undefined,
    view: q.get("v") === "all" ? "all" : undefined,
    cfg: cfg as Partial<Config>
  };
}

export function writeHash(s: { marketId: string; view?: View; cfg: Config; spreadDefault: number; bufferDefault: number }) {
  const q = new URLSearchParams();
  const c = s.cfg as unknown as Record<string, unknown>, d = DEFAULT_CONFIG as unknown as Record<string, unknown>;
  if (s.marketId !== DEFAULT_MARKET) q.set("m", s.marketId);
  if (s.view === "all") q.set("v", "all");
  for (const key of Object.keys(ONE_OF)) if (c[key] !== d[key]) q.set(key, String(c[key]));
  for (const [short, key] of Object.entries(FLAGS)) if (c[key] !== d[key]) q.set(short, c[key] ? "1" : "0");
  for (const [short, key] of Object.entries(NUMBERS)) if (c[key] !== d[key]) q.set(short, String(c[key]));
  for (const [short, { key }] of Object.entries(LISTS)) {
    const a = c[key] as string[], b = d[key] as string[];
    if (a.length !== b.length || a.some((x) => !b.includes(x))) q.set(short, a.join(","));
  }
  if (Math.abs(s.cfg.spread - s.spreadDefault) > 1e-12) q.set("spread", String(+s.cfg.spread.toPrecision(6)));
  if (Math.abs(s.cfg.stopBuffer - s.bufferDefault) > 1e-12) q.set("buf", String(+s.cfg.stopBuffer.toPrecision(6)));
  return q.toString();
}

// Keeps the chosen market and rules in the address, so a setup can be shared.
import { DEFAULT_CONFIG, type Config, type Session } from "../engine";

export interface Saved { marketId?: string; months?: number; cfg: Partial<Config>; risk?: number }

const ONE_OF = {
  bias: ["off", "weeklyCrt", "structure", "premiumDiscount", "majority", "allAgree"],
  zone: ["obFvg", "fvg", "ob", "off"],
  timing: ["sameDay", "nextDay", "either"],
  stop: ["sweep", "pullback"],
  dayStart: ["utc", "nyClose"]
} as const;
const FLAGS = { half: "partialAtTp1", day3: "timeStop", news: "newsGuard" } as const;
const SESSIONS: Session[] = ["asian", "london", "newyork"];

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
  const sess = q.get("sess");
  if (sess !== null) cfg.sessions = sess.split(",").filter((s): s is Session => (SESSIONS as string[]).includes(s));
  const swing = Number(q.get("swing"));
  if ([1, 2, 3].includes(swing)) cfg.swing15 = swing;
  const spread = Number(q.get("spread"));
  if (q.has("spread") && Number.isFinite(spread) && spread >= 0) cfg.spread = spread;
  const months = Number(q.get("h"));
  const risk = Number(q.get("risk"));
  return {
    marketId: q.get("m") ?? undefined,
    months: [3, 12, 24, 60].includes(months) ? months : undefined,
    cfg: cfg as Partial<Config>,
    risk: Number.isFinite(risk) && risk > 0 && risk <= 10 ? risk : undefined
  };
}

export function writeHash(s: { marketId: string; months: number; cfg: Config; risk: number; spreadDefault: number }) {
  const q = new URLSearchParams();
  if (s.marketId !== "eurusd-2014") { q.set("m", s.marketId); q.set("h", String(s.months)); }
  for (const key of Object.keys(ONE_OF) as (keyof typeof ONE_OF)[]) if (s.cfg[key] !== DEFAULT_CONFIG[key]) q.set(key, String(s.cfg[key]));
  for (const [short, key] of Object.entries(FLAGS) as [string, keyof typeof DEFAULT_CONFIG][]) if (s.cfg[key] !== DEFAULT_CONFIG[key]) q.set(short, s.cfg[key] ? "1" : "0");
  if (s.cfg.sessions.length) q.set("sess", s.cfg.sessions.join(","));
  if (s.cfg.swing15 !== DEFAULT_CONFIG.swing15) q.set("swing", String(s.cfg.swing15));
  if (Math.abs(s.cfg.spread - s.spreadDefault) > 1e-12) q.set("spread", String(+s.cfg.spread.toPrecision(6)));
  if (s.risk !== 1) q.set("risk", String(s.risk));
  return q.toString();
}

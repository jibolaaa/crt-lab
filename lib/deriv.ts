// Loads 15-minute candles from Deriv's public price feed, straight from the
// browser. Deriv returns up to 5,000 candles per request, so this walks
// backwards from now until it reaches the start date or Deriv runs out.

export interface DerivCandle { epoch: number; open: number; high: number; low: number; close: number }

export const ENDPOINTS = [
  "wss://api.derivws.com/trading/v1/options/ws/public",
  "wss://ws.derivws.com/websockets/v3?app_id=1089"
];

const PAGE = 5000;
const GRANULARITY = 900;

type SocketLike = Pick<WebSocket, "send" | "close" | "readyState"> & {
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
};

export interface LoadOptions {
  /** Oldest time wanted, in UTC seconds. */
  from: number;
  onProgress?: (count: number, oldest: number) => void;
  makeSocket?: (url: string) => SocketLike;
  /** Wait between retries after Deriv asks to slow down (ms). */
  retryWait?: number;
  openTimeout?: number;
  replyTimeout?: number;
}

export interface LoadResult {
  candles: DerivCandle[];
  pipSize: number | null;
  /** Set when Deriv stopped giving older candles before the start date. */
  shortBy: string | null;
  endpoint: string;
}

export class DerivError extends Error {}

/** One socket that sends a request and waits for its reply. */
class Feed {
  private ws: SocketLike;
  private waiting: ((msg: Record<string, unknown> | null, err?: Error) => void) | null = null;
  private nextId = 1;
  private current = 0;

  private constructor(ws: SocketLike) {
    this.ws = ws;
    ws.onmessage = (ev) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.req_id !== undefined && Number(msg.req_id) !== this.current) return; // a late reply to an old request
      if (!msg.error && !Array.isArray(msg.candles)) return; // greetings and anything else that isn't our answer
      const w = this.waiting;
      this.waiting = null;
      w?.(msg);
    };
    ws.onclose = () => {
      const w = this.waiting;
      this.waiting = null;
      w?.(null, new DerivError("Deriv closed the connection."));
    };
  }

  static open(url: string, make: (url: string) => SocketLike, timeout: number): Promise<Feed> {
    return new Promise((resolve, reject) => {
      let ws: SocketLike;
      try { ws = make(url); } catch { reject(new DerivError("Couldn't open a connection to Deriv.")); return; }
      const timer = setTimeout(() => { ws.onopen = ws.onerror = null; try { ws.close(); } catch {} reject(new DerivError("Deriv didn't answer.")); }, timeout);
      ws.onopen = () => { clearTimeout(timer); ws.onerror = null; resolve(new Feed(ws)); };
      ws.onerror = () => { clearTimeout(timer); reject(new DerivError("Couldn't reach Deriv.")); };
    });
  }

  ask(req: Record<string, unknown>, timeout: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting = null; reject(new DerivError("Deriv took too long to reply.")); }, timeout);
      this.waiting = (msg, err) => { clearTimeout(timer); if (err || !msg) reject(err); else resolve(msg); };
      this.current = this.nextId++;
      this.ws.send(JSON.stringify({ ...req, req_id: this.current }));
    });
  }

  close() { try { this.ws.close(); } catch {} }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorText(err: { code?: string; message?: string }) {
  if (err.code === "InvalidSymbol") return "Deriv doesn't offer this market's price history.";
  return err.message ? `Deriv said: ${err.message}` : "Deriv sent an error.";
}

export async function loadDerivCandles(symbol: string, opts: LoadOptions): Promise<LoadResult> {
  const make = opts.makeSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const openTimeout = opts.openTimeout ?? 10000, replyTimeout = opts.replyTimeout ?? 20000, retryWait = opts.retryWait ?? 3000;
  let lastError: Error | null = null;

  for (const endpoint of ENDPOINTS) {
    let feed: Feed;
    try { feed = await Feed.open(endpoint, make, openTimeout); } catch (e) { lastError = e as Error; continue; }

    const byEpoch = new Map<number, DerivCandle>();
    let pipSize: number | null = null;
    let end: string = "latest";
    let oldest = Infinity;
    let shortBy: string | null = null;
    let tries = 0;
    let failedHere = false;

    try {
      for (let page = 0; page < 200; page++) {
        const msg = await feed.ask({ ticks_history: symbol, style: "candles", granularity: GRANULARITY, end, count: PAGE }, replyTimeout);
        const err = msg.error as { code?: string; message?: string } | undefined;
        if (err) {
          if (err.code === "RateLimit" && tries < 4) { tries++; await sleep(retryWait * tries); page--; continue; }
          // the newer feed may not know this request yet: try the other one
          if (page === 0 && byEpoch.size === 0 && endpoint !== ENDPOINTS[ENDPOINTS.length - 1] && err.code !== "InvalidSymbol") { failedHere = true; lastError = new DerivError(errorText(err)); break; }
          if (byEpoch.size === 0) throw new DerivError(errorText(err));
          shortBy = "Deriv stopped sending older candles here.";
          break;
        }
        tries = 0;
        if (typeof msg.pip_size === "number") pipSize = msg.pip_size;
        const rows = Array.isArray(msg.candles) ? (msg.candles as DerivCandle[]) : [];
        let got = 0, pageOldest = Infinity;
        for (const r of rows) {
          const epoch = Number(r.epoch);
          if (!Number.isFinite(epoch) || epoch % GRANULARITY !== 0) continue;
          const c = { epoch, open: +r.open, high: +r.high, low: +r.low, close: +r.close };
          if (![c.open, c.high, c.low, c.close].every(Number.isFinite)) continue;
          if (!byEpoch.has(epoch)) got++;
          byEpoch.set(epoch, c);
          if (epoch < pageOldest) pageOldest = epoch;
        }
        if (pageOldest < oldest) oldest = pageOldest;
        opts.onProgress?.(byEpoch.size, oldest);
        if (oldest <= opts.from) break;
        if (got === 0) { shortBy = "Deriv has no older candles for this market."; break; }
        end = String(oldest - 1);
      }
    } catch (e) {
      feed.close();
      if (byEpoch.size === 0) { lastError = e as Error; continue; }
      shortBy = "The connection dropped before all the history loaded.";
    }
    feed.close();
    if (failedHere) continue;

    const candles = [...byEpoch.values()].filter((c) => c.epoch >= opts.from).sort((a, b) => a.epoch - b.epoch);
    if (!candles.length) { lastError = new DerivError("Deriv sent no candles for this market."); continue; }
    return { candles, pipSize, shortBy, endpoint };
  }
  throw lastError ?? new DerivError("Couldn't load candles from Deriv.");
}

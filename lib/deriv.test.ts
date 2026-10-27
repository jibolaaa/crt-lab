import { describe, expect, it } from "vitest";
import { ENDPOINTS, loadDerivCandles, type DerivCandle } from "./deriv";

// A pretend Deriv server: it holds candles and answers ticks_history the way
// Deriv does, with the newest `count` candles at or before `end`.
interface ServerOpts { candles: DerivCandle[]; down?: string[]; rateLimitOnce?: boolean; errorOn?: Record<string, { code: string; message: string }>; chatty?: boolean; }
function server(opts: ServerOpts) {
  const log: { url: string; req: Record<string, unknown> }[] = [];
  let limited = false;
  const make = (url: string) => {
    const ws = {
      readyState: 0,
      onopen: null as ((e: Event) => unknown) | null,
      onmessage: null as ((e: MessageEvent) => unknown) | null,
      onerror: null as ((e: Event) => unknown) | null,
      onclose: null as ((e: CloseEvent) => unknown) | null,
      close() { this.readyState = 3; },
      send(data: string) {
        const req = JSON.parse(data);
        log.push({ url, req });
        const reply = (msg: unknown) => setTimeout(() => ws.onmessage?.({ data: JSON.stringify(msg) } as MessageEvent), 1);
        if (opts.chatty) ws.onmessage?.({ data: JSON.stringify({ msg_type: "website_status", website_status: { site_status: "up" } }) } as MessageEvent);
        if (opts.errorOn?.[url]) return reply({ error: opts.errorOn[url], msg_type: "ticks_history", req_id: req.req_id });
        if (opts.rateLimitOnce && !limited && log.length === 2) { limited = true; return reply({ error: { code: "RateLimit", message: "slow down" }, req_id: req.req_id }); }
        const end = req.end === "latest" ? Infinity : Number(req.end);
        const older = opts.candles.filter((c) => c.epoch <= end);
        reply({ candles: older.slice(-req.count), pip_size: 5, msg_type: "candles", req_id: req.req_id, echo_req: req });
      }
    };
    setTimeout(() => {
      if (opts.down?.includes(url)) ws.onerror?.(new Event("error"));
      else { ws.readyState = 1; ws.onopen?.(new Event("open")); }
    }, 1);
    return ws;
  };
  return { make, log };
}

const START = Date.UTC(2025, 0, 6) / 1000; // a Monday
function candles(n: number): DerivCandle[] {
  return Array.from({ length: n }, (_, i) => ({ epoch: START + i * 900, open: 1.1, high: 1.1002, low: 1.0998, close: 1.1001 }));
}

describe("loading candles from Deriv", () => {
  it("walks back page by page until the start date", async () => {
    const all = candles(12000);
    const { make, log } = server({ candles: all });
    const from = all[1500].epoch;
    const res = await loadDerivCandles("frxEURUSD", { from, makeSocket: make });
    expect(res.candles.length).toBe(12000 - 1500);
    expect(res.candles[0].epoch).toBe(from);
    expect(res.candles.at(-1)!.epoch).toBe(all.at(-1)!.epoch);
    expect(res.shortBy).toBeNull();
    expect(log.length).toBe(3); // 5,000 + 5,000 + the rest
    expect(log[0].req).toMatchObject({ ticks_history: "frxEURUSD", style: "candles", granularity: 900, end: "latest", count: 5000 });
    expect(log[1].req.end).toBe(String(all[7000].epoch - 1));
  });
  it("asks for 5-minute candles when told to, and keeps only ones on the 5-minute grid", async () => {
    const five = Array.from({ length: 600 }, (_, i) => ({ epoch: START + i * 300, open: 1.1, high: 1.1002, low: 1.0998, close: 1.1001 }));
    const { make, log } = server({ candles: [...five, { epoch: START + 600 * 300 + 7, open: 1, high: 1, low: 1, close: 1 }] });
    const res = await loadDerivCandles("R_75", { from: START, granularity: 300, makeSocket: make });
    expect(log[0].req).toMatchObject({ granularity: 300 });
    expect(res.candles.length).toBe(600);
  });

  it("says so when Deriv runs out of history first", async () => {
    const all = candles(6000);
    const { make } = server({ candles: all });
    const res = await loadDerivCandles("R_75", { from: START - 365 * 86400, makeSocket: make });
    expect(res.candles.length).toBe(6000);
    expect(res.shortBy).toMatch(/no older candles/);
  });

  it("falls back to the older feed when the new one is down", async () => {
    const { make, log } = server({ candles: candles(300), down: [ENDPOINTS[0]] });
    const res = await loadDerivCandles("frxXAUUSD", { from: 0, makeSocket: make });
    expect(res.endpoint).toBe(ENDPOINTS[1]);
    expect(log.every((x) => x.url === ENDPOINTS[1])).toBe(true);
  });

  it("falls back when the new feed rejects the request", async () => {
    const { make } = server({ candles: candles(300), errorOn: { [ENDPOINTS[0]]: { code: "UnrecognisedRequest", message: "Unrecognised request" } } });
    const res = await loadDerivCandles("OTC_NDX", { from: 0, makeSocket: make });
    expect(res.endpoint).toBe(ENDPOINTS[1]);
    expect(res.candles.length).toBe(300);
  });

  it("waits and tries again when asked to slow down", async () => {
    const all = candles(12000);
    const { make } = server({ candles: all, rateLimitOnce: true });
    const res = await loadDerivCandles("frxEURUSD", { from: all[0].epoch, makeSocket: make, retryWait: 5 });
    expect(res.candles.length).toBe(12000);
  });

  it("ignores messages that aren't the answer", async () => {
    const all = candles(12000);
    const { make } = server({ candles: all, chatty: true });
    const res = await loadDerivCandles("R_75", { from: all[0].epoch, makeSocket: make });
    expect(res.candles.length).toBe(12000);
    expect(res.shortBy).toBeNull();
  });

  it("explains an unknown market", async () => {
    const err = { code: "InvalidSymbol", message: "Symbol XYZ invalid" };
    const { make } = server({ candles: [], errorOn: { [ENDPOINTS[0]]: err, [ENDPOINTS[1]]: err } });
    await expect(loadDerivCandles("XYZ", { from: 0, makeSocket: make })).rejects.toThrow(/doesn't offer/);
  });

  it("explains when Deriv can't be reached at all", async () => {
    const { make } = server({ candles: [], down: ENDPOINTS });
    await expect(loadDerivCandles("frxEURUSD", { from: 0, makeSocket: make })).rejects.toThrow(/Couldn't reach Deriv/);
  });
});

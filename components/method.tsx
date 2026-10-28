export function Method() {
  return (
    <section className="sec-method method" aria-labelledby="method-h">
      <h2 className="sec" id="method-h">How it&apos;s tested</h2>
      <ul>
        <li><b>Model 1, the default.</b> A range candle (4-hour or daily), one or more inside candles that take neither its high nor its low, then a candle that takes one side into a key level. The weekly and daily structure have to agree: lower highs and lower lows for sells, higher highs and higher lows for buys. On the entry chart (5-minute for 4-hour ranges, 15-minute for daily), a close past the last swing before the sweep&apos;s tip is the MSS. The first pullback after it is the inducement, and a limit waits at the order block (the last up candle at the top for sells), no closer than the inducement, so it only fills once the inducement is taken. The stop goes past the order block, half comes off at 50%, and the rest runs to the range&apos;s far end. One position each way at a time.</li>
        <li><b>Model 1&apos;s key levels.</b> From one chart up: daily and 4-hour levels for a 4-hour range, weekly and daily for a daily range. For a sell, a level fits the structure if it&apos;s the supply of the last lower high, where price broke down from (an old swing low that a close went below, or a broken order block), an order block or gap the latest drop left, or any zone above the middle of the latest swing range. It counts if nothing touched it since the range candle began; at a break, price has to move away before a return counts as a touch. The order has to sit inside the level.</li>
        <li><b>Candle by candle.</b> The test walks through the candles in order and only uses candles that have closed. Every bigger candle is built from the same prices. The old rules look for 1-hour zones and a 5-minute break for daily CRTs, and 4-hour zones and a 15-minute break for weekly ones (15-minute everywhere on the built-in EUR/USD, which has no 5-minute prices).</li>
        <li><b>No peeking.</b> A swing only counts once the candles after it have closed. A zone only exists once the candle that formed it has closed. Structure only uses finished weeks and days. The engine is checked by cutting real prices off at each entry and making sure the same trade still comes out.</li>
        <li><b>The old rules&apos; key levels and entries.</b> Old highs and lows, order blocks, fair value gaps and rejection blocks on the 4-hour, daily and weekly charts. BOS close: price comes back into the zone, and the candle that closes past the last swing is the entry. Retest: after that BOS, a limit at the order block it left. QM: an A-shape beyond the swing before it, a close past the low between them, then a limit at that earlier swing.</li>
        <li><b>The worst case inside a candle.</b> When one candle could have hit both the stop and a target, the stop is assumed to come first. A limit that fills on a candle that also reaches the stop counts as a loss.</li>
        <li><b>Costs.</b> Buys open at the ask and close at the bid, sells the other way round, so every trade pays the spread you set. Swaps and commissions aren&apos;t included.</li>
        <li><b>The percent (old rules).</b> Each trade scores the checklist using only what was known when it was taken: 13 checks, with the 5 direction checks counting double. It shows how much of the checklist a setup meets, not a chance of winning.</li>
        <li><b>Dollars.</b> A trade&apos;s dollars are its price move times the contract size times the lots. Prices in yen use the rate set in the contract details.</li>
        <li><b>Kept aside.</b> The last 30% of the prices is reported on its own, so you can tell rules that work from rules fitted to the past.</li>
        <li><b>News.</b> Only US jobs report (NFP) days are in the calendar. CPI, rate decisions and other red folder events aren&apos;t yet.</li>
      </ul>
    </section>
  );
}

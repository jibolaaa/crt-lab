export function Method() {
  return (
    <section className="sec-method method" aria-labelledby="method-h">
      <h2 className="sec" id="method-h">How it&apos;s tested</h2>
      <ul>
        <li><b>Candle by candle.</b> The test walks through the candles in order and only uses candles that have closed. Daily CRTs look for entries on 15-minute candles, weekly CRTs on 1-hour candles, all built from the same 15-minute prices.</li>
        <li><b>No peeking.</b> A swing only counts once the candles after it have closed. A zone only exists once the candle that formed it has closed. Weekly structure only uses finished weeks.</li>
        <li><b>Key levels.</b> Old highs and lows, order blocks, fair value gaps and rejection blocks on the 4-hour, daily and weekly charts count once the candle that completed them has closed. A level only counts if nothing touched it before candle 1, and a zone stops counting once a candle of its own timeframe closes through it.</li>
        <li><b>QM entries.</b> In the killer zone, a swing beyond the one before it is the A-shape. A close past the low (high for buys) between them is the shift, and a limit goes at the earlier swing: the QM line. It fills when price comes back to it, from candle 3 by default.</li>
        <li><b>The worst case inside a candle.</b> When one candle could have hit both the stop and a target, the stop is assumed to come first. A limit that fills on a candle that also reaches the stop counts as a loss.</li>
        <li><b>Costs.</b> Buys open at the ask and close at the bid, sells the other way round, so every trade pays the spread you set. Swaps and commissions aren&apos;t included.</li>
        <li><b>The percent.</b> Each trade scores your checklist using only what was known when it was taken: 13 checks, with the 5 direction checks counting double. It shows how much of your checklist a setup meets, not a chance of winning.</li>
        <li><b>SMT.</b> It needs a related market (GBP/USD for EUR/USD, say), loaded from Deriv with the main one. Where there isn&apos;t one, the check is left out of the percent.</li>
        <li><b>Dollars.</b> A trade&apos;s dollars are its price move times the contract size times the lots. Prices in yen use the rate set in the contract details.</li>
        <li><b>Kept aside.</b> The last 30% of the prices is reported on its own, so you can tell rules that work from rules fitted to the past.</li>
        <li><b>News.</b> Only US jobs report (NFP) days are in the calendar. CPI, rate decisions and other red folder events aren&apos;t yet.</li>
        <li><b>Checks.</b> Every trade can be opened on its chart. The engine is tested on hand-built candles, and on real prices by cutting the data off at each entry and checking the same trade, key level and percent come out.</li>
      </ul>
    </section>
  );
}

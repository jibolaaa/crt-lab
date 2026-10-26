export function Method() {
  return (
    <section className="sec-method method" aria-labelledby="method-h">
      <h2 className="sec" id="method-h">How it&apos;s tested</h2>
      <ul>
        <li><b>Candle by candle.</b> The test walks through 15-minute candles in order and only uses candles that have closed. Daily and 1-hour candles are built from them.</li>
        <li><b>No peeking.</b> A swing only counts once the candles after it have closed. A zone only exists once the hour that formed it has closed. The weekly bias only uses finished weeks.</li>
        <li><b>The worst case inside a candle.</b> When one candle could have hit both the stop and a target, the stop is assumed to come first.</li>
        <li><b>Costs.</b> Buys open at the ask and close at the bid, sells the other way round, so every trade pays the spread you set.</li>
        <li><b>Kept aside.</b> The last 30% of the prices is reported on its own, so you can tell rules that work from rules fitted to the past.</li>
        <li><b>News.</b> Only US jobs report (NFP) days are in the calendar. CPI, rate decisions and other red folder events aren&apos;t yet.</li>
        <li><b>Checks.</b> Every trade can be opened on its chart. The engine is tested on hand-built candles, and on real prices by cutting the data off at each entry and checking the same trade is still taken.</li>
      </ul>
    </section>
  );
}

# CRT Lab

See where today's Candle Range Theory (CRT) setup stands, and test the rules on years of real prices, with every trade they would have taken.

## What it tests

For a buy (sells are the mirror image):

1. The weekly bias allows buys. It can come from a weekly CRT, weekly structure, premium/discount, or a vote of the three.
2. Candle 2 trades below candle 1's low (the sweep) and into a fresh higher-timeframe key level: an order block, breaker block or fair value gap on the 4-hour, daily or weekly chart, without running far through it.
3. A 1-hour fair value gap and/or order block forms after the sweep, and price comes back into it.
4. A 15-minute candle closes above the last swing high made before the low: the market structure shift. That close is the entry.
5. The stop goes a pip beyond the 1-hour order block. The target is the liquidity at candle 1's high, capped at 6R. Trades under 2R are skipped, and trades under 3R need every confluence. Anything left closes at the end of the day after the sweep. At most 3 new trades a day.

Each trade is graded on 10 confluences (key level, weekly bias, 4-hour and daily structure, premium/discount, OB and FVG overlap, the 50 to 78.6% fib zone, the deepest quarter of candle 1, the London or New York open, an inverted 15-minute gap, and a strong shift candle), and the page shows whether better grades actually did better.

Every rule can be switched off or changed on the page. A dollar view turns the results into money for a chosen account size, lot size or risk per trade, and leverage.

## Right now

On a live Deriv market (it opens on Volatility 75), the page reads today's setup at the last closed 15-minute candle: candle 1's range, whether candle 2 has swept it, whether the sweep reached a key level, the 1-hour zone, and the price a 15-minute candle has to close beyond for the entry. A sweep from the day before stays on the list while it can still enter, or while its trade is running.

## What it found on EUR/USD, 2014 to 2021

With the default rules: 8 trades in 8 years and +3.0R, with +1.3R from 2 trades in the last 30% of the data, kept aside for checking. That is far too few trades to tell an edge from luck. Loosening the rules gives more trades but loses: without the key level, 20 trades and −0.9R; without the weekly bias, 41 trades and −7.1R. The first version of the rules (stop beyond the sweep, half off at 50%, no key level) lost 8.1R over 71 trades. On those 71 trades, better grades didn't mean better results: the 27 B-grade trades lost 10.1R, while the 40 C-grade trades made 1.6R.

## How it's tested

- The engine walks through 15-minute candles in order and only uses candles that have closed. Swings count once they're confirmed, zones exist once their hour has closed, and the weekly bias only uses finished weeks.
- When one candle could have hit both the stop and a target, the stop is assumed to come first.
- Every trade pays the spread: buys open at the ask and close at the bid.
- Higher-timeframe levels only count after the candle that completed them has closed, and stop counting once a candle of their own timeframe closes through them.
- 145 automated tests: hand-built candle scenarios with exact expected results, key level detection, the dollar maths, a fake Deriv server for the price loader, real-data checks that cut the prices off at each entry and confirm the same trade, key level and grade still come out, and checks of the "right now" view at each stage.

## Data

- **Built in:** EUR/USD 15-minute bid candles from 2014 to 2021, from Dukascopy via the [FX-Data](https://github.com/FX-Data/FX-Data-EURUSD-DS) project. `scripts/build_eurusd.py` turns their MT4 history files into `public/data/eurusd-15m.bin`. February 2017 is missing in the source.
- **Live:** Deriv's public price feed, loaded straight from the browser: EUR/USD, GBP/USD, gold, Volatility 75, Volatility 75 (1s), US Tech 100, US 500 and Wall Street 30.

## Run it

```
npm install
npm run dev      # the page, at localhost:3000
npm test         # the engine and loader tests
npm run report   # results for a set of rule combinations
```

Built with Next.js (static export), TypeScript, a Web Worker for the engine, TradingView's Lightweight Charts and Vitest.

A testing tool, not financial advice.

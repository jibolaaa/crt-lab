# CRT Lab

See where today's daily and weekly Candle Range Theory (CRT) setups stand, get a call with your checklist percent when there's an entry, and test the rules on years of real prices, with every trade they would have taken.

## What it looks for

For a sell (buys are the mirror image):

1. **The CRT.** Candle 1 is a finished day, or a finished week. Candle 2 trades above its high (the sweep) into a fresh higher-timeframe key level, then closes back inside candle 1's range. Later candles may sweep further; the setup holds until a candle closes outside the range.
2. **Key levels**, on the 4-hour, daily and weekly charts: an old high purged, an order block, a fair value gap or a rejection block. A level counts if nothing touched it before candle 1.
3. **The entry**, from candle 3, in the killer zone between candle 1's body top and the sweep's tip. QM: an A-shape top beyond the high before it, a close below the low between them (the shift), then a sell limit at that earlier high (the QM line). Daily CRTs use 15-minute candles for this, weekly CRTs 1-hour candles. A shift-close entry (a close past the last swing after a retest of a 1-hour zone) is there to compare.
4. **Stop and target.** The stop goes beyond the 1-hour order block (4-hour for weekly CRTs). The target is candle 1's low, with no cap. Targets under 2R are skipped, and under 3R the setup needs 75% of the checklist. At most 3 new trades a day, and never two at once the same way on the same CRT.

## The call

When there's an entry, or a QM limit to set, the page shows which way and how much of your checklist the setup meets, e.g. Sell 72% / Buy 28%. The checklist has 13 checks: weekly structure, weekly CRT, 4-hour and daily structure, premium/discount and a daily or weekly key level count double; an order block and gap overlap, the 50 to 78.6% fib zone, the Gann box, an IFVG, the London or New York open, a strong shift candle, SMT and old liquidity count once. That's 18 points. SMT needs a related market (GBP/USD for EUR/USD, say), loaded from Deriv with the main one; without one it is left out. The percent is how much of the checklist is met, not a chance of winning.

## Right now

On a live Deriv market (it opens on Volatility 75), the page reads each CRT at the last closed candle: candle 1's range, whether candle 2 has swept it into a key level and closed back inside, the killer zone, any A-shape waiting for its shift, and any limit or trade with its stop, target and percent.

## What it found on EUR/USD, 2014 to 2021

With today's rules: 294 trades in 8 years (about 3 a month), 16% won, and +32.9R in all, about +0.11R a trade. But the last 30% of the data, kept aside for checking, lost 12.3R over 94 trades, and the worst run cost 63.7R from a peak. At 1% risk a trade that's +21% over 8 years, with a 49% drop along the way.

- Higher percents did better: 12 trades at 75% or more averaged +0.70R, 158 at 50 to 74% averaged +0.13R, and 124 under 50% averaged +0.03R. Too few trades at the top to lean on.
- Daily CRTs: 236 trades, +25.3R. Weekly CRTs: 58 trades, +7.6R.
- The shift-close entry: 66 trades, −7.8R. The first version's rules (shift close, stop at the sweep, half off at 50%, no key level): 71 trades, −9.8R.

## How it's tested

- The engine walks through the candles in order and only uses candles that have closed. Swings count once they're confirmed, zones exist once the candle that formed them has closed, and weekly structure only uses finished weeks.
- When one candle could have hit both the stop and a target, the stop is assumed to come first. A limit that fills on a candle that also reaches the stop counts as a loss.
- Every trade pays the spread: buys open at the ask and close at the bid.
- Higher-timeframe levels only count after the candle that completed them has closed, and zones stop counting once a candle of their own timeframe closes through them.
- 190 automated tests: hand-built candle scenarios with exact expected results (daily and weekly QM sells, deeper sweeps, closes outside the range, old-high key levels, SMT), key level detection, the dollar maths, a fake Deriv server for the price loader, and real-data checks that cut the prices off at each entry and confirm the same trade, key level and percent still come out.

## Data

- **Built in:** EUR/USD 15-minute bid candles from 2014 to 2021, from Dukascopy via the [FX-Data](https://github.com/FX-Data/FX-Data-EURUSD-DS) project. `scripts/build_eurusd.py` turns their MT4 history files into `public/data/eurusd-15m.bin`. February 2017 is missing in the source.
- **Live:** Deriv's public price feed, loaded straight from the browser: EUR/USD, GBP/USD, AUD/USD, GBP/JPY, gold, silver, Volatility 75, Volatility 75 (1s), US Tech 100, US 500, Wall Street 30 and BTC/USD, plus a related market for SMT where one fits.

## Run it

```
npm install
npm run dev      # the page, at localhost:3000
npm test         # the engine and loader tests
npm run report   # results for a set of rule combinations
```

Built with Next.js (static export), TypeScript, a Web Worker for the engine, TradingView's Lightweight Charts and Vitest.

A testing tool, not financial advice.

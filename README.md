# CRT Lab

See where today's daily and weekly Candle Range Theory (CRT) setups stand, get a call with your checklist percent when there's an entry, test the rules on real prices with every trade they would have taken, and see what they could do to your account.

## What it looks for

For a sell (buys are the mirror image):

1. **The CRT.** Candle 1 is a finished day, or a finished week. Candle 2 trades above its high (the sweep) into a higher-timeframe key level, then closes back inside candle 1's range. Later candles may sweep further; the setup holds until a candle closes outside the range.
2. **Key levels**, on the 4-hour, daily and weekly charts: an old high purged, an order block, a fair value gap or a rejection block. A level counts if nothing touched it before candle 1.
3. **The zone.** After the sweep, an order block, a fair value gap, or both overlapping, inside the killer zone (between candle 1's body top and the sweep's tip). Daily CRTs use 1-hour zones, weekly CRTs 4-hour zones.
4. **The entry**, from candle 3: price comes back into the zone, then a candle closes below the last swing low (the BOS). Daily CRTs look for the BOS on 5-minute candles, weekly CRTs on 15-minute candles. The built-in EUR/USD only has 15-minute prices, so its daily CRTs use 15-minute candles for the BOS. A retest entry (a limit at the order block the BOS left) and a QM entry are there to compare.
5. **Stop and target.** The stop goes beyond the 1-hour order block (4-hour for weekly CRTs). The target is candle 1's low, capped at 5R. Targets under 2R are skipped. At most 3 new trades a day, and never two at once the same way on the same CRT.

## The call

When there's an entry, or a limit to set, the page shows which way and how much of your checklist the setup meets, e.g. Sell 72% / Buy 28%. The checklist has 13 checks: weekly structure, weekly CRT, 4-hour and daily structure, premium/discount and a daily or weekly key level count double; an order block and gap overlap, the 50 to 78.6% fib zone, the Gann box, an IFVG, the London or New York open, a strong shift candle, SMT and old liquidity count once. That's 18 points. SMT needs a related market (GBP/USD for EUR/USD, say), loaded from Deriv with the main one; without one it is left out. The percent is how much of the checklist is met, not a chance of winning.

## Right now

On a live Deriv market (it opens on Volatility 75), the page reads each CRT at the last closed candle: candle 1's range, whether candle 2 has swept it into a key level and closed back inside, the killer zone, any zone waiting for price, and any limit or trade with its stop, target and percent.

## What could happen next

Enter your account size and pick a week, a month, 3 months or a year. Each of 2,000 runs picks trades at random from the market's past ones, about as often as they came, at your lot size or risk. The page shows a bad, a likely and a good result, the chance of ending down and the chance of losing the whole account. It shows how wide the outcomes can be, not a forecast.

## Which target

Under More detail, the same rules run with the target capped at 2R, 3R, 4R, 5R, 6R, 8R, 10R and with no cap, with the win rate for each. The cap that did best on the first 70% of the prices is marked, and the last 30% shows whether it held up.

## What it found on EUR/USD, 2014 to 2021

With today's rules: 190 trades in 8 years (about 2 a month), 26% won, and −9.3R in all. The last 30% of the data, kept aside for checking, made +1.1R over 58 trades. The worst run cost 27.7R from a peak. At 1% risk a trade that's −12% over 8 years.

- Weekly CRTs on their own: 53 trades, 32% won, +11.1R, and +3.6R on the last 30%. Daily CRTs: 137 trades, 24% won, −20.4R.
- Targets: a 5R cap did best on the first 70% (−10.4R), then made +1.1R on the last 30%. A 2R cap won more often (30%) but lost 32.3R.
- The retest entry: 217 trades, 21% won, −35.6R. The QM entry: 326 trades, 21% won, +7.7R, but −36.9R on the last 30%.
- Higher percents didn't do better: 7 trades at 75% or more, 14% won.
- Trades at the London or New York open: 67, 33% won, +15.4R. The other 123: −24.7R.
- No setting tested came near a 70% win rate.

## How it's tested

- The engine walks through the candles in order and only uses candles that have closed. Swings count once they're confirmed, zones exist once the candle that formed them has closed, and weekly structure only uses finished weeks.
- When one candle could have hit both the stop and a target, the stop is assumed to come first. A limit that fills on a candle that also reaches the stop counts as a loss.
- Every trade pays the spread: buys open at the ask and close at the bid.
- Higher-timeframe levels only count after the candle that completed them has closed, and zones stop counting once a candle of their own timeframe closes through them.
- 207 automated tests: hand-built candle scenarios with exact expected results (5-minute BOS and retest entries, zones outside the killer zone, daily and weekly QM sells, deeper sweeps, closes outside the range, old-high key levels, SMT), key level detection, the dollar maths, the projection, a fake Deriv server for the price loader, and real-data checks that cut the prices off at each entry and confirm the same trade, key level and percent still come out.

## Data

- **Built in:** EUR/USD 15-minute bid candles from 2014 to 2021, from Dukascopy via the [FX-Data](https://github.com/FX-Data/FX-Data-EURUSD-DS) project. `scripts/build_eurusd.py` turns their MT4 history files into `public/data/eurusd-15m.bin`. February 2017 is missing in the source.
- **Live:** Deriv's public price feed, loaded straight from the browser as 5-minute candles, up to a year back: EUR/USD, GBP/USD, AUD/USD, GBP/JPY, gold, silver, Volatility 75, Volatility 75 (1s), US Tech 100, US 500, Wall Street 30 and BTC/USD, plus a related market for SMT where one fits.

## Run it

```
npm install
npm run dev      # the page, at localhost:3000
npm test         # the engine and loader tests
npm run report   # results for a set of rule combinations
```

Built with Next.js (static export), TypeScript, a Web Worker for the engine, TradingView's Lightweight Charts and Vitest.

A testing tool, not financial advice.

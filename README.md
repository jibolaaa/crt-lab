# CRT Lab

See where today's daily and weekly Candle Range Theory (CRT) setups stand, get a call with your checklist percent when there's an entry, test the rules on real prices with every trade they would have taken, and see what they could do to your account.

## What it looks for

For a sell (buys are the mirror image):

1. **The CRT.** Candle 1 is a finished day, or a finished week. Candle 2 trades above its high (the sweep) into a higher-timeframe key level, then closes back inside candle 1's range. Later candles may sweep further; the setup holds until a candle closes outside the range.
2. **Key levels**, on the 4-hour, daily and weekly charts: an old high purged, an order block, a fair value gap or a rejection block. A level counts if nothing touched it before candle 1.
3. **The zone.** After the sweep, an order block, a fair value gap, or both overlapping, inside the killer zone (between candle 1's body top and the sweep's tip). Daily CRTs use 1-hour zones, weekly CRTs 4-hour zones.
4. **The entry**, from candle 3: price comes back into the zone, then a candle closes below the last swing low (the BOS). Daily CRTs look for the BOS on 5-minute candles, weekly CRTs on 15-minute candles. The built-in EUR/USD only has 15-minute prices, so its daily CRTs use 15-minute candles for the BOS. A retest entry (a limit at the order block the BOS left) and a QM entry are there to compare.
5. **Stop and target.** The stop goes beyond the 1-hour order block (4-hour for weekly CRTs). The target is candle 1's low, capped at 4R. Targets under 2R are skipped. TP1: half closes at candle 1's 50% level and the stop moves to the entry. Trades run until they hit the stop or the target. At most 3 new trades a day, and never two at once the same way on the same CRT.
6. **The checklist.** Only setups that meet 60% or more of the checklist below are taken.

## The call

When there's an entry, or a limit to set, the page shows which way and how much of your checklist the setup meets, e.g. Sell 72% / Buy 28%. The checklist has 13 checks: weekly structure, weekly CRT, 4-hour and daily structure, premium/discount and a daily or weekly key level count double; an order block and gap overlap, the 50 to 78.6% fib zone, the Gann box, an IFVG, the London or New York open, a strong shift candle, SMT and old liquidity count once. That's 18 points. SMT needs a related market (GBP/USD for EUR/USD, say), loaded from Deriv with the main one; without one it is left out. The percent is how much of the checklist is met, not a chance of winning.

Under Change rules you can make any check a must-have, or set a lowest percent. Trades without them are skipped.

## Right now

On a live Deriv market (it opens on EUR/USD), the page reads each CRT at the last closed candle: candle 1's range, whether candle 2 has swept it into a key level and closed back inside, the killer zone, any zone waiting for price, and any limit or trade with its stop, target and percent.

## What could happen next

Enter your account size and pick a week, a month, 3 months or a year. Each of 2,000 runs picks trades at random from the market's past ones, about as often as they came, at your lot size or risk. The page shows a bad, a likely and a good result, the chance of ending down and the chance of losing the whole account. It shows how wide the outcomes can be, not a forecast.

## Which target

Under More detail, the same rules run with the target capped at 2R, 3R, 4R, 5R, 6R, 8R, 10R and with no cap, with the win rate for each. The cap that did best on the first 70% of the prices is marked, and the last 30% shows whether it held up.

## What it found on EUR/USD, 2014 to 2021

With today's rules: 54 trades in 8 years (about 7 a year), 43% won, and +14.8R in all. The last 30% of the data, kept aside for checking, made +4.8R over 15 trades. The worst run cost 6.8R from a peak. At 1% risk a trade that's +15% over 8 years.

- **The 60% lowest percent.** Results got better as the lowest percent went up: −28.3R with any percent, −10.0R from 50%, +5.3R from 55%, +14.8R from 60%. Above 60% there were few trades and they did worse. From 60%, both the first 70% and the last 30% made money. On 12 runs of random prices, the same rules averaged −3.2R, and one did as well (+15.0R).
- **TP1 at the 50% level** raised the win rate from 30% to 43%, with about the same total (+14.8R instead of +14.9R).
- **Holding to the stop or target** did a little better than closing at the end of the next day (+14.8R against +11.8R).
- **The 4R cap** did best on the first 70% (+10.0R), then made +4.8R on the last 30%.
- **Weekly CRTs did the work:** 23 trades, 57% won, +21.3R. Daily CRTs lost 6.5R over 31 trades (32% won), but on this data their BOS uses 15-minute candles, not 5-minute ones.
- **Entries in candle 2** doubled the trades (102) but made only +2.5R. Taking any percent as well lost 77.1R over 442 trades.
- These were picked by looking at the same 8 years, so they aren't proven. The fair test is the live prices on the page, which weren't used to pick them.
- No setting tested reached a 70% win rate.

### Looking for better rules

With the earlier rules (the time limit and any percent), about 130 changes (single rule changes, and pairs of must-have checks) were each scored on the first 70% of the prices, then checked on the last 30%. None held up. The best on the first 70%, the QM entry (+44.6R), lost 36.9R on the last 30%. Entries only at the London or New York open won 38% and made +17.9R on the first 70%, then won 23% and lost 2.6R. On made-up random prices with EUR/USD's volatility, the same search also found rules that made +9R to +40R on the first 70%, so a strong number on its own can be luck.

### Small targets

Capping the target at 0.5R raised the win rate to 58 to 59%, but lost 33.7R over the 8 years, since each loss cost about twice what a win paid. On random prices, 0.5R targets won 64% and also lost.

## How it's tested

- The engine walks through the candles in order and only uses candles that have closed. Swings count once they're confirmed, zones exist once the candle that formed them has closed, and weekly structure only uses finished weeks.
- When one candle could have hit both the stop and a target, the stop is assumed to come first. A limit that fills on a candle that also reaches the stop counts as a loss.
- Every trade pays the spread: buys open at the ask and close at the bid.
- Higher-timeframe levels only count after the candle that completed them has closed, and zones stop counting once a candle of their own timeframe closes through them.
- 218 automated tests: hand-built candle scenarios with exact expected results (5-minute BOS and retest entries, zones outside the killer zone, daily and weekly QM sells, deeper sweeps, closes outside the range, old-high key levels, SMT), key level detection, the dollar maths, the projection, a fake Deriv server for the price loader, and real-data checks that cut the prices off at each entry and confirm the same trade, key level and percent still come out.

## Data

- **Built in:** EUR/USD 15-minute bid candles from 2014 to 2021, from Dukascopy via the [FX-Data](https://github.com/FX-Data/FX-Data-EURUSD-DS) project. `scripts/build_eurusd.py` turns their MT4 history files into `public/data/eurusd-15m.bin`. February 2017 is missing in the source.
- **Live:** Deriv's public price feed, loaded straight from the browser as 5-minute candles, up to a year back: EUR/USD, GBP/USD, AUD/USD, GBP/JPY, gold, silver, US Tech 100, US 500, Wall Street 30 and BTC/USD, plus a related market for SMT where one fits.
- **Not included:** Deriv's synthetic indices, like Volatility 75. Deriv makes their prices with a random number generator and says any patterns in their history are coincidental, so there's no liquidity or session for CRT to read. On made-up random prices with V75's volatility, the rules won about 1 trade in 4 and lost a little on average.

## Run it

```
npm install
npm run dev      # the page, at localhost:3000
npm test         # the engine and loader tests
npm run report   # results for a set of rule combinations
```

Built with Next.js (static export), TypeScript, a Web Worker for the engine, TradingView's Lightweight Charts and Vitest.

A testing tool, not financial advice.

# CRT Lab

See where today's daily and weekly Candle Range Theory (CRT) setups stand, on one market or all of them at once, get a call with your checklist percent when there's an entry, and test the rules on real prices with every trade they would have taken.

## What it looks for

For a sell (buys are the mirror image):

1. **The CRT.** Candle 1 is a finished day, or a finished week. Candle 2 trades above its high (the sweep) into a higher-timeframe key level, then closes back inside candle 1's range. Later candles may sweep further; the setup holds until a candle closes outside the range.
2. **Key levels**, on the 4-hour, daily and weekly charts: an old high purged, an order block, a fair value gap or a rejection block. A level counts if nothing touched it before candle 1.
3. **The order block.** The candle that made the sweep: the last up candle at the swept high, on the 1-hour chart (4-hour for weekly CRTs). If that candle closed down, the 2-hour and then the 4-hour candle that made the sweep is used (8-hour and daily for weekly CRTs). The part of it inside the killer zone (between candle 1's body top and the sweep's tip) is where price has to come back. An OB or FVG that forms after the sweep is still there as an option.
4. **The entry**, in candle 2 once it has swept, or in candle 3: price comes back into the zone, then a candle closes below the last swing low (the BOS). Daily CRTs look for the BOS on 5-minute candles, weekly CRTs on 15-minute candles. The built-in EUR/USD only has 15-minute prices, so its daily CRTs use 15-minute candles for the BOS. A retest entry (a limit at the order block the BOS left) and a QM entry are there to compare.
5. **Stop and target.** The stop goes past the order block, which reaches the sweep's tip. The target is candle 1's low, capped at 4R. Targets under 2R are skipped. TP1: half closes at candle 1's 50% level and the stop moves to the entry. Trades run until they hit the stop or the target. At most 3 new trades a day, and never two at once the same way on the same CRT.
6. **The checklist.** Every setup is taken and shows how much of the checklist below it meets. A switch at the top keeps only those at 50% or 60% or more.
7. **Direction.** US indices tend to rise over time, so on them only buys are taken (with the drift). Other markets trade both ways.

## The call

When there's an entry, or a limit to set, the page shows which way and how much of your checklist the setup meets, e.g. Sell 72% / Buy 28%. The checklist has 13 checks: weekly structure, weekly CRT, 4-hour and daily structure, premium/discount and a daily or weekly key level count double; an order block and gap overlap, the 50 to 78.6% fib zone, the Gann box, an IFVG, the London or New York open, a strong shift candle, SMT and old liquidity count once. That's 18 points. SMT needs a related market (GBP/USD for EUR/USD, say), loaded from Deriv with the main one; without one it is left out. The percent is how much of the checklist is met, not a chance of winning.

Under Change rules you can make any check a must-have, or set a lowest percent. Trades without them are skipped.

## Right now

On a live Deriv market (it opens on Volatility 25), the page reads each CRT at the last closed candle: candle 1's range, whether candle 2 has swept it into a key level and closed back inside, the killer zone, any zone waiting for price, and any limit or trade with its stop, target and percent.

## All markets

Pick the markets you trade (it starts with Volatility 25, 50 and 75 and their 1s versions) and the page loads each one from Deriv, then runs the same rules on all of them: every setup close to an entry right now, in one list with the most urgent first; the combined result with trades a week across the markets; each market's own result; and every trade, newest first. Tap a market to open it on its own. A month switch shows the result for one month at a time. Each market uses its own usual spread and stop room, and the rules from Change rules.

## Which target

Under More detail, the same rules run with the target capped at 2R, 3R, 4R, 5R, 6R, 8R, 10R and with no cap, with the win rate for each. The cap that did best on the first 70% of the prices is marked, and the last 30% shows whether it held up.

## What it found on EUR/USD, 2014 to 2021

Today's rules take every setup and show its checklist percent. A one-tap switch at the top of the page keeps only setups that meet 50% or 60% of the checklist. On 8 years of EUR/USD, with the order block as the candle that made the sweep:

| Take | Entries in candle 2 or 3 (today's) | Entries in candle 3 only |
|---|---|---|
| Every setup | 917 trades, 28% won, −168.8R | 244 trades, 34% won, −14.3R |
| 50% or more | 382 trades, 30% won, −60.4R | |
| 60% or more | 162 trades, 30% won, −15.1R | 46 trades, 46% won, +18.2R |

With this order block, waiting for candle 2 to close back inside did far better: the order block is known as soon as the sweep candle closes, and many candle 2 entries came before candle 2 had closed back inside. 60% or more with candle 3 entries is the best result so far, positive on both the first 70% (+13.9R) and the last 30% (+4.3R), but it was picked on the same 8 years.

With the earlier zone (the first OB or FVG that forms after the sweep), every setup lost 77.1R over 442 trades and 60% or more made +2.5R over 102, with entries in candle 2 or 3.

With the earlier zone and 60% or more:

- **Entries in candle 2** doubled the trades (102 instead of 54 with candle 3 only) but cut the total from +14.8R to +2.5R.
- **TP1 at the 50% level** raised the win rate with about the same total (with candle 3 entries: 43% won instead of 30%, +14.8R instead of +14.9R).
- **Holding to the stop or target** did better than closing at the end of the next day (+2.5R against −3.6R).
- **The 4R cap** did best of the caps on the first 70% (−6.3R), then made +8.8R on the last 30%.
- **Weekly CRTs did better:** 47 trades, 36% won, +9.9R. Daily CRTs lost 7.4R over 55 trades, but on this data their BOS uses 15-minute candles, not 5-minute ones.
- These were picked by looking at the same 8 years, so they aren't proven. The fair test is the live prices on the page, which weren't used to pick them.
- No setting tested reached a 70% win rate.

### Looking for better rules

With the earlier rules (the time limit and any percent), about 130 changes (single rule changes, and pairs of must-have checks) were each scored on the first 70% of the prices, then checked on the last 30%. None held up. The best on the first 70%, the QM entry (+44.6R), lost 36.9R on the last 30%. Entries only at the London or New York open won 38% and made +17.9R on the first 70%, then won 23% and lost 2.6R. On made-up random prices with EUR/USD's volatility, the same search also found rules that made +9R to +40R on the first 70%, so a strong number on its own can be luck.

### A CRT on the New York open

Candle 1 the hour before 9:30 New York time, candle 2 the first half hour after it, entering when candle 2 closes back inside (or at the swept level), stop past candle 2's wick, target candle 1's other end. On 8 years of EUR/USD it lost in every version tried (−17.5R to −147.7R). Even with no spread or stop room, all but one version lost, and that one lost on the first 70% of the data. So it isn't on the page.

### Small targets

Capping the target at 0.5R raised the win rate to 58 to 59%, but lost 33.7R over the 8 years, since each loss cost about twice what a win paid. On random prices, 0.5R targets won 64% and also lost.

## How it's tested

- The engine walks through the candles in order and only uses candles that have closed. Swings count once they're confirmed, zones exist once the candle that formed them has closed, and weekly structure only uses finished weeks.
- When one candle could have hit both the stop and a target, the stop is assumed to come first. A limit that fills on a candle that also reaches the stop counts as a loss.
- Every trade pays the spread: buys open at the ask and close at the bid.
- Higher-timeframe levels only count after the candle that completed them has closed, and zones stop counting once a candle of their own timeframe closes through them.
- 234 automated tests: hand-built candle scenarios with exact expected results (5-minute BOS and retest entries, the candle that made the sweep as the order block, zones outside the killer zone, daily and weekly QM sells, deeper sweeps, closes outside the range, old-high key levels, SMT), key level detection, the dollar maths, adding up All markets and cutting it to one month, a fake Deriv server for the price loader, and real-data checks that cut the prices off at each entry and confirm the same trade, key level and percent still come out.

## Data

- **Built in:** EUR/USD 15-minute bid candles from 2014 to 2021, from Dukascopy via the [FX-Data](https://github.com/FX-Data/FX-Data-EURUSD-DS) project. `scripts/build_eurusd.py` turns their MT4 history files into `public/data/eurusd-15m.bin`. February 2017 is missing in the source.
- **Live:** Deriv's public price feed, loaded straight from the browser as 5-minute candles, as far back as Deriv sends them (about 5 months for gold), up to 150,000 candles a market: EUR/USD, GBP/USD, AUD/USD, GBP/JPY, gold, silver, US Tech 100, US 500, Wall Street 30, BTC/USD and Volatility 25, 50 and 75 (and their 1s versions), plus a related market for SMT where one fits.
- **Volatility indices:** Deriv makes their prices with a random number generator and says any patterns in their history are coincidental, so there's no liquidity or session for CRT to read. On made-up random prices with V75's volatility, the rules won about 1 trade in 4 and lost a little on average. They're on the page so they can be tested like the rest.

## Run it

```
npm install
npm run dev      # the page, at localhost:3000
npm test         # the engine and loader tests
npm run report   # results for a set of rule combinations
```

Built with Next.js (static export), TypeScript, a Web Worker for the engine, TradingView's Lightweight Charts and Vitest.

A testing tool, not financial advice.

# CRT Lab

See where today's Candle Range Theory (CRT) setups stand, on one market or all of them at once, see the order to place when there's an entry, and test the rules on real prices with every trade they would have taken.

## Model 1: the three-candle CRT

The page's rules. For a sell (buys are the mirror image):

1. **The range.** Candle 1 is a 4-hour candle or a day (weekly is an option). One or more inside candles follow, taking neither its high nor its low. If candle 1 is itself inside the candle before it, the bigger candle is the range.
2. **Structure.** The weekly and the daily structure both have to be bearish: lower highs and lower lows, read from swings on finished weeks and days. A close above the last lower high makes it mixed, and mixed means no trade. Weekly only, daily only, or off are options.
3. **The sweep into a key level.** The next candle, or any candle after it while the candles keep closing inside the range, takes the range high into a key level that fits the structure. Key levels come from one chart up: daily and 4-hour levels for a 4-hour range, weekly and daily levels for a daily range. A level fits if it is:
   - the supply of the last lower high (the order block where the last drop to a lower low started),
   - where price broke down from (an old swing low that a close went below, now resistance, or a broken order block),
   - an order block or gap the latest drop left on its way down, or
   - any zone above the middle of the latest swing range (premium).

   It counts if nothing touched it since the range candle began. At a break, price has to move away first before a return counts as a touch.
4. **The entry (model 1).** On the entry chart (5-minute for 4-hour ranges, 15-minute for daily, 30-minute for weekly): a close below the last swing low before the sweep's tip is the MSS. The order block is the last up candle at or before the tip. The first pullback after the MSS leaves a swing high, the inducement. A sell limit waits at the order block, no lower than the inducement, so it only fills once the inducement is taken. The order has to sit inside the key level.
5. **Stop and target.** The stop goes just past the order block, which reaches the sweep's tip. Half closes at the range's 50% level and the stop moves to the entry; the rest runs to the range low, with no cap. Targets under 2R are skipped. One position each way at a time, across range sizes, and at most 3 new trades a day.

The old rules (candle 2 sweeps candle 1, then a 1-hour zone and a 5-minute BOS, with a checklist percent) are one tap away under Change rules, Model.

## Right now

On a live Deriv market (it opens on GBP/JPY), the page reads each range at the last closed candle: the range and its inside candles, whether a candle has swept it into a key level, the close that would be the MSS, the inducement, and the limit with its stop, target and R once it's set.

## All markets

Pick the markets you trade (it starts with CAD/JPY, gold, AUD/JPY and GBP/JPY) and the page loads each one from Deriv, then runs the same rules on all of them: every setup close to an entry right now, in one list with the most urgent first; the combined result with trades a week across the markets; each market's own result; and every trade, newest first. Tap a market to open it on its own. A month switch shows the result for one month at a time. Each market uses its own usual spread and stop room.

## Which target

Under More detail, the same rules run with the target capped at 2R, 3R, 4R, 5R, 6R, 8R, 10R and with no cap, with the win rate for each. The cap that did best on the first 70% of the prices is marked, and the last 30% shows whether it held up. Change one rule shows each layer switched on its own, with its trades and total.

## Model 1 on EUR/USD, 2014 to 2021

The built-in prices only have 15-minute candles, so 4-hour ranges use 15-minute entries here (5-minute on the live page).

| Structure | Trades | A year | Won | Total | Last 30% |
|---|---|---|---|---|---|
| Weekly and daily agree (the default) | 7 | 0.9 | 29% | +3.5R | −1.0R |
| Weekly only | 13 | 1.6 | 23% | −0.5R | −1.0R |
| Daily only | 15 | 1.9 | 40% | +8.3R | −0.1R |
| Off | 45 | 5.6 | 24% | −2.4R | −3.1R |

The weekly and daily structure agree on about 1 day in 6, and each rule after that cuts more, so Model 1 takes few trades: about one a year on one market with every rule on. That's far too few to tell an edge from luck. The live page shows the same on each Deriv market, and Change one rule shows how many trades each layer costs.

## The old rules

For a sell:

1. **The CRT.** Candle 1 is a finished day, or a finished week. Candle 2 trades above its high (the sweep) into a higher-timeframe key level, then closes back inside candle 1's range. Later candles may sweep further; the setup holds until a candle closes outside the range.
2. **Key levels**, on the 4-hour, daily and weekly charts: an old high purged, an order block, a fair value gap or a rejection block. A level counts if nothing touched it before candle 1.
3. **The order block.** The candle that made the sweep: the last up candle at the swept high, on the 1-hour chart (4-hour for weekly CRTs). If that candle closed down, the 2-hour and then the 4-hour candle that made the sweep is used (8-hour and daily for weekly CRTs). The part of it inside the killer zone (between candle 1's body top and the sweep's tip) is where price has to come back.
4. **The entry**, in candle 2 once it has swept, or in candle 3: price comes back into the zone, then a candle closes below the last swing low (the BOS), on 5-minute candles for daily CRTs and 15-minute for weekly ones. A retest entry and a QM entry are there to compare.
5. **Stop and target.** The stop goes past the order block. The target is candle 1's low, capped at 4R. TP1: half at candle 1's 50% level, then the stop moves to the entry.
6. **The checklist.** Every setup shows how much of a 13-check list it meets, e.g. Sell 72% / Buy 28%: weekly structure, weekly CRT, 4-hour and daily structure, premium/discount and a daily or weekly key level count double; an order block and gap overlap, the 50 to 78.6% fib zone, the Gann box, an IFVG, the London or New York open, a strong shift candle, SMT and old liquidity count once. The percent is how much of the checklist is met, not a chance of winning. A switch at the top keeps only setups at 50% or 60% or more.

## What the old rules found on EUR/USD, 2014 to 2021

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

- The engine walks through the candles in order and only uses candles that have closed. Swings count once they're confirmed, zones exist once the candle that formed them has closed, and structure only uses finished weeks and days.
- When one candle could have hit both the stop and a target, the stop is assumed to come first. A limit that fills on a candle that also reaches the stop counts as a loss.
- Every trade pays the spread: buys open at the ask and close at the bid.
- Higher-timeframe levels only count after the candle that completed them has closed, and zones stop counting once a candle of their own timeframe closes through them.
- 278 automated tests: hand-built candle scenarios with exact expected results (Model 1's range, inside candle, MSS, inducement and order block fill, and its key levels and structure; 5-minute BOS and retest entries, the candle that made the sweep as the order block, zones outside the killer zone, daily and weekly QM sells, deeper sweeps, closes outside the range, old-high key levels, SMT), key level detection, the dollar maths, adding up All markets and cutting it to one month, a fake Deriv server for the price loader, and real-data checks that cut the prices off at each entry and confirm the same trade, key level and percent still come out.

## Data

- **Built in:** EUR/USD 15-minute bid candles from 2014 to 2021, from Dukascopy via the [FX-Data](https://github.com/FX-Data/FX-Data-EURUSD-DS) project. `scripts/build_eurusd.py` turns their MT4 history files into `public/data/eurusd-15m.bin`. February 2017 is missing in the source.
- **Live:** Deriv's public price feed, loaded straight from the browser as 5-minute candles, as far back as Deriv sends them (about 5 months for gold), up to 150,000 candles a market: EUR/USD, GBP/USD, AUD/USD, GBP/JPY, AUD/JPY, CAD/JPY, gold, silver, US Tech 100, US 500, Wall Street 30, BTC/USD and Volatility 25, 50 and 75 (and their 1s versions), plus a related market for SMT where one fits (the old rules only).
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

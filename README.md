# CRT Lab

Test Candle Range Theory (CRT) and SMC entry rules on years of real prices, and see every trade they would have taken.

## What it tests

For a buy (sells are the mirror image):

1. The weekly bias allows buys. It can come from a weekly CRT, weekly structure, premium/discount, or a vote of the three.
2. Today trades below yesterday's low: the sweep.
3. A 1-hour fair value gap and/or order block forms after the sweep, and price comes back into it.
4. A 15-minute candle closes above the last swing high made before the low: the market structure shift. That close is the entry.
5. The stop goes beyond the sweep (or the pullback). Half comes off at the range's 50% level and the stop moves to entry. The rest targets the range high, and anything left closes at the end of the day after the sweep.

Each rule can be switched off or changed on the page, along with sessions, the news rest day, the daily candle's start time, the spread and the swing size.

## What it found on EUR/USD, 2014 to 2021

With the default rules: 71 trades and −8.1R in total. On the last 30% of the data, kept aside for checking, −4.0R over 22 trades. Plain CRT with no bias and no zone: −95.7R over 1,080 trades. The results stay negative with zero spread, with kinder fill assumptions, and with New York-close daily candles.

## How it's tested

- The engine walks through 15-minute candles in order and only uses candles that have closed. Swings count once they're confirmed, zones exist once their hour has closed, and the weekly bias only uses finished weeks.
- When one candle could have hit both the stop and a target, the stop is assumed to come first.
- Every trade pays the spread: buys open at the ask and close at the bid.
- 73 automated tests: hand-built candle scenarios with exact expected results, a check that a week's own candle never changes its bias, a fake Deriv server for the price loader, and real-data checks that cut the prices off at each entry and confirm the same trade is still taken.

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

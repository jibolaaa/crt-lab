// Days, weeks, sessions and the US jobs report (NFP), all in UTC seconds.
import type { DayStart, Session } from "./types";

const DAY = 86400;

/** Day of the week for a day number (days since 1970-01-01, a Thursday). 0 = Sunday. */
export const weekday = (day: number) => (((day + 4) % 7) + 7) % 7;

/** Start of the n-th weekday `wd` (0 = Sunday) of a month, as a day number. */
function nthWeekday(year: number, month0: number, wd: number, n: number) {
  const first = Math.floor(Date.UTC(year, month0, 1) / 1000 / DAY);
  const shift = (wd - weekday(first) + 7) % 7;
  return first + shift + 7 * (n - 1);
}

/** US daylight saving (since 2007): 2nd Sunday of March 07:00 UTC to 1st Sunday of November 06:00 UTC. */
export function usDst(t: number) {
  const y = new Date(t * 1000).getUTCFullYear();
  const start = nthWeekday(y, 2, 0, 2) * DAY + 7 * 3600;
  const end = nthWeekday(y, 10, 0, 1) * DAY + 6 * 3600;
  return t >= start && t < end;
}

/**
 * The trading day a 15-minute candle belongs to.
 * - "utc": days run midnight to midnight UTC (Deriv's MT5 server time).
 * - "nyClose": days start at 5pm New York time, the usual forex daily close.
 * Markets closed at weekends fold the short Sunday session into Monday.
 */
export function dayKey(t: number, dayStart: DayStart, weekendClosed: boolean) {
  let d: number;
  if (dayStart === "utc") d = Math.floor(t / DAY);
  else {
    const ny = t + (usDst(t) ? -4 : -5) * 3600;
    d = Math.floor((ny + 7 * 3600) / DAY);
  }
  if (weekendClosed) {
    const wd = weekday(d);
    if (wd === 0) d += 1;
    else if (wd === 6) d += 2;
  }
  return d;
}

/** Monday-based week number for a day number. */
export const weekKey = (day: number) => Math.floor((day + 3) / 7);

/**
 * Session windows, fixed in UTC (Lagos is UTC+1 all year):
 * Asian 22:00–07:00 UTC (11pm–8am Lagos), London 07:00–12:00 UTC (8am–1pm Lagos),
 * New York 12:00–17:00 UTC (1pm–6pm Lagos).
 */
export function inSessions(t: number, sessions: Session[]) {
  if (!sessions.length) return true;
  const hour = Math.floor((((t % DAY) + DAY) % DAY) / 3600);
  return sessions.some((s) =>
    s === "asian" ? hour >= 22 || hour < 7 : s === "london" ? hour >= 7 && hour < 12 : hour >= 12 && hour < 17
  );
}

/**
 * Release time of the US jobs report (NFP) for a month, in UTC seconds.
 * BLS publishes it on the third Friday after the week (Sunday to Saturday)
 * that holds the 12th of the month before, at 8:30am New York time.
 * Holidays move it: a date in the first three days of January goes a week
 * later (as in 2014, 2016, 2020 and 2021), and the July 4th holiday moves it
 * to the Thursday before.
 */
export function nfpRelease(year: number, month0: number) {
  const refYear = month0 === 0 ? year - 1 : year;
  const refMonth = month0 === 0 ? 11 : month0 - 1;
  const twelfth = Math.floor(Date.UTC(refYear, refMonth, 12) / 1000 / DAY);
  const saturday = twelfth + (6 - weekday(twelfth));
  let release = saturday + 6 + 14;
  const date = new Date(release * DAY * 1000);
  const m = date.getUTCMonth(), dd = date.getUTCDate();
  if (m === 0 && dd <= 3) release += 7;
  else if (m === 6 && (dd === 3 || dd === 4)) release -= 1;
  const t = release * DAY + 13 * 3600 + 30 * 60; // 8:30am EST = 13:30 UTC
  return usDst(t) ? t - 3600 : t;
}

/** NFP release times between two UTC times. */
export function nfpTimes(from: number, to: number) {
  const out: number[] = [];
  const a = new Date(from * 1000), b = new Date(to * 1000);
  for (let y = a.getUTCFullYear(); y <= b.getUTCFullYear(); y++) {
    for (let m = 0; m < 12; m++) {
      const t = nfpRelease(y, m);
      if (t >= from && t <= to) out.push(t);
    }
  }
  return out;
}

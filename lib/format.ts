// Number and date formats used across the page. Times are UTC, like Deriv's MT5 charts.
const MINUS = "−";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const sign = (x: number) => (x > 0 ? "+" : x < 0 ? MINUS : "");

export const fmtR = (r: number, d = 1) => {
  const v = Math.abs(r).toFixed(d);
  return (Number(v) === 0 ? "" : sign(r)) + v + "R";
};
export const fmtNum = (x: number, d = 2) => (x < 0 ? MINUS : "") + Math.abs(x).toFixed(d);
export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-GB");
export const fmtPct = (x: number, d = 0) => `${Math.round(x * 100 * 10 ** d) / 10 ** d}%`;
export const fmtSignedPct = (x: number) => sign(Math.round(x)) + Math.abs(Math.round(x)) + "%";

const d = (t: number) => new Date(t * 1000);
export const fmtDate = (t: number) => `${d(t).getUTCDate()} ${MONTHS[d(t).getUTCMonth()]} ${d(t).getUTCFullYear()}`;
export const fmtMonth = (t: number) => `${MONTHS[d(t).getUTCMonth()]} ${d(t).getUTCFullYear()}`;
export const fmtDay = (t: number) => `${DAYS[d(t).getUTCDay()]} ${d(t).getUTCDate()} ${MONTHS[d(t).getUTCMonth()]}`;
export const fmtTime = (t: number) => `${String(d(t).getUTCHours()).padStart(2, "0")}:${String(d(t).getUTCMinutes()).padStart(2, "0")}`;
export const fmtPrice = (x: number, digits: number) => x.toFixed(digits);

/** How long a span of time is, in words. */
export function fmtSpan(from: number, to: number) {
  const months = (to - from) / (30.44 * 86400);
  if (months < 1.5) return `${Math.max(1, Math.round((to - from) / 86400))} days`;
  if (months < 18) return `${Math.round(months)} months`;
  const years = months / 12;
  return `${Math.round(years * 2) / 2} years`.replace(".5 years", "½ years");
}

import { describe, expect, it } from "vitest";
import { dayKey, inSessions, nfpRelease, usDst } from "./calendar";

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16);

describe("US jobs report (NFP) dates", () => {
  // Published release dates, first Friday-ish of each month
  const known: Record<number, string[]> = {
    2019: ["01-04", "02-01", "03-08", "04-05", "05-03", "06-07", "07-05", "08-02", "09-06", "10-04", "11-01", "12-06"],
    2020: ["01-10", "02-07", "03-06", "04-03", "05-08", "06-05", "07-02", "08-07", "09-04", "10-02", "11-06", "12-04"],
    2021: ["01-08", "02-05", "03-05", "04-02", "05-07", "06-04", "07-02", "08-06", "09-03", "10-08", "11-05", "12-03"]
  };
  for (const [year, dates] of Object.entries(known)) {
    it(`matches ${year}`, () => {
      const got = dates.map((_, m) => iso(nfpRelease(+year, m)).slice(5, 10));
      expect(got).toEqual(dates);
    });
  }
  it("is at 8:30am New York time", () => {
    expect(iso(nfpRelease(2021, 0))).toBe("2021-01-08T13:30"); // winter, UTC-5
    expect(iso(nfpRelease(2021, 6))).toBe("2021-07-02T12:30"); // summer, UTC-4
  });
});

describe("days and sessions", () => {
  const sunday = Date.UTC(2024, 0, 7, 22) / 1000; // Sunday 22:00 UTC
  const monday = Date.UTC(2024, 0, 8, 1) / 1000;
  it("folds Sunday evening into Monday for markets closed at weekends", () => {
    expect(dayKey(sunday, "utc", true)).toBe(dayKey(monday, "utc", true));
    expect(dayKey(sunday, "utc", false)).toBe(dayKey(monday, "utc", false) - 1);
  });
  it("starts New York close days at 5pm New York", () => {
    const before = Date.UTC(2024, 0, 9, 21, 45) / 1000; // 4:45pm New York (winter)
    const after = Date.UTC(2024, 0, 9, 22, 0) / 1000; // 5:00pm New York
    expect(dayKey(after, "nyClose", true)).toBe(dayKey(before, "nyClose", true) + 1);
  });
  it("knows US daylight saving", () => {
    expect(usDst(Date.UTC(2024, 6, 1) / 1000)).toBe(true);
    expect(usDst(Date.UTC(2024, 0, 15) / 1000)).toBe(false);
    expect(usDst(Date.UTC(2024, 2, 10, 6, 59) / 1000)).toBe(false);
    expect(usDst(Date.UTC(2024, 2, 10, 7, 0) / 1000)).toBe(true);
  });
  it("checks session windows", () => {
    const at = (h: number) => Date.UTC(2024, 0, 9, h) / 1000;
    expect(inSessions(at(3), ["asian"])).toBe(true);
    expect(inSessions(at(9), ["asian"])).toBe(false);
    expect(inSessions(at(9), ["london"])).toBe(true);
    expect(inSessions(at(14), ["newyork"])).toBe(true);
    expect(inSessions(at(14), [])).toBe(true);
  });
});

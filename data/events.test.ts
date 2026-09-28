import { describe, expect, it } from "vitest";
import { DAY_KEY_RE, SAUDI_EVENT_KINDS } from "@/lib/domain";
import { SAUDI_EVENTS, getSaudiEvent } from "./events";

/** True when "YYYY-MM-DD" names a real calendar day (no Feb 30, no month 13). */
const realDay = (key: string): boolean => {
  if (!DAY_KEY_RE.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

describe("Saudi moments calendar (planning/data/saudi-events.json)", () => {
  it("loads the events with their defaults filled", () => {
    expect(SAUDI_EVENTS.length).toBeGreaterThanOrEqual(13);
    for (const e of SAUDI_EVENTS) {
      expect(Array.isArray(e.hashtags)).toBe(true);
      expect(typeof e.approx).toBe("boolean");
      expect(e.leadDays).toBeGreaterThanOrEqual(0);
      expect(SAUDI_EVENT_KINDS).toContain(e.kind);
    }
  });

  it("has unique kebab-case ids", () => {
    const ids = SAUDI_EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("has real dates, end dates after start dates, and is sorted by date", () => {
    for (const e of SAUDI_EVENTS) {
      expect(realDay(e.date), e.id).toBe(true);
      if (e.endDate) {
        expect(realDay(e.endDate), e.id).toBe(true);
        expect(e.endDate >= e.date, e.id).toBe(true);
      }
    }
    const dates = SAUDI_EVENTS.map((e) => e.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("names every event in Arabic and English with # hashtags", () => {
    for (const e of SAUDI_EVENTS) {
      expect(e.name.ar.trim().length, e.id).toBeGreaterThan(0);
      expect(e.name.en.trim().length, e.id).toBeGreaterThan(0);
      expect(e.hashtags.length, e.id).toBeGreaterThan(0);
      for (const h of e.hashtags) expect(h.startsWith("#"), `${e.id} ${h}`).toBe(true);
    }
  });

  it("carries the round-30 moments with their lead days and approx flags", () => {
    expect(getSaudiEvent("saudi-national-day-2026")).toMatchObject({
      date: "2026-09-23",
      leadDays: 21,
      kind: "national",
      approx: false,
    });
    expect(getSaudiEvent("ramadan-2027")).toMatchObject({
      date: "2027-02-08",
      endDate: "2027-03-08",
      leadDays: 30,
      kind: "religious",
      approx: true,
    });
    expect(getSaudiEvent("f1-saudi-arabian-gp-2027")).toMatchObject({
      date: "2027-03-19",
      endDate: "2027-03-21",
      kind: "sport",
      approx: false,
    });
    expect(getSaudiEvent("nope")).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import { startOfDay, startOfDaysAgo, DEFAULT_TIME_ZONE } from "../businessDay";

/**
 * "Today" has to be the shop's today.
 *
 * The dashboard previously used `new Date().toISOString().slice(0, 10)` as the
 * start of day, which is midnight UTC — 5:30am in India. An order taken at
 * 1am showed up under the previous day, and between midnight and 5:30am the
 * "today" panel reported yesterday's takings.
 */

describe("startOfDay in Asia/Kolkata", () => {
  it("is 18:30 UTC the previous day", () => {
    // 09 Sep 2026, 10:00 IST → the day began at 08 Sep 18:30 UTC.
    const start = startOfDay(new Date("2026-09-09T04:30:00Z"));
    expect(start.toISOString()).toBe("2026-09-08T18:30:00.000Z");
  });

  it("puts a 1am local order inside today, not yesterday", () => {
    // 01:00 IST on 9 Sep is 19:30 UTC on 8 Sep — before UTC midnight, which is
    // exactly the case the old code got wrong.
    const order = new Date("2026-09-08T19:30:00Z");
    const start = startOfDay(order);
    expect(order.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(start.toISOString()).toBe("2026-09-08T18:30:00.000Z");
  });

  it("excludes an order from just before the local day started", () => {
    const start = startOfDay(new Date("2026-09-09T04:30:00Z"));
    const yesterdayEvening = new Date("2026-09-08T18:29:00Z");
    expect(yesterdayEvening.getTime()).toBeLessThan(start.getTime());
  });

  it("is stable no matter what time of day it is asked", () => {
    const morning = startOfDay(new Date("2026-09-09T04:30:00Z"));
    const night = startOfDay(new Date("2026-09-09T17:00:00Z"));
    expect(morning.toISOString()).toBe(night.toISOString());
  });

  it("rolls over at local midnight, not UTC midnight", () => {
    // 18:29 UTC is still 8 Sep locally; 18:31 UTC is already 9 Sep.
    const before = startOfDay(new Date("2026-09-08T18:29:00Z"));
    const after = startOfDay(new Date("2026-09-08T18:31:00Z"));
    expect(before.toISOString()).toBe("2026-09-07T18:30:00.000Z");
    expect(after.toISOString()).toBe("2026-09-08T18:30:00.000Z");
  });
});

describe("other time zones", () => {
  it("handles a zone with a whole-hour offset", () => {
    const start = startOfDay(new Date("2026-09-09T12:00:00Z"), "Asia/Tokyo");
    expect(start.toISOString()).toBe("2026-09-08T15:00:00.000Z");
  });

  it("handles UTC itself", () => {
    const start = startOfDay(new Date("2026-09-09T12:00:00Z"), "UTC");
    expect(start.toISOString()).toBe("2026-09-09T00:00:00.000Z");
  });

  it("lands on local midnight across a DST transition", () => {
    // 2026-03-29 is the spring-forward date in Europe/London.
    const start = startOfDay(new Date("2026-03-29T12:00:00Z"), "Europe/London");
    // Local midnight that day is still GMT, so 00:00 UTC.
    expect(start.toISOString()).toBe("2026-03-29T00:00:00.000Z");
  });

  it("defaults to India", () => {
    const explicit = startOfDay(new Date("2026-09-09T04:30:00Z"), DEFAULT_TIME_ZONE);
    const implicit = startOfDay(new Date("2026-09-09T04:30:00Z"));
    expect(implicit.toISOString()).toBe(explicit.toISOString());
  });
});

describe("startOfDaysAgo", () => {
  it("counts back whole days from the local day boundary", () => {
    const weekAgo = startOfDaysAgo(7, new Date("2026-09-09T04:30:00Z"));
    expect(weekAgo.toISOString()).toBe("2026-09-01T18:30:00.000Z");
  });

  it("with zero is the same as startOfDay", () => {
    const now = new Date("2026-09-09T04:30:00Z");
    expect(startOfDaysAgo(0, now).toISOString()).toBe(startOfDay(now).toISOString());
  });
});

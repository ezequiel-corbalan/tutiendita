import { describe, expect, it } from "vitest";
import { isOk } from "../../../src/packages/core/domain/result";
import { parseScheduledFor, upcomingScheduled } from "../../../src/packages/core/domain/schedule";
import type { Order } from "../../../src/packages/core/domain/order";

const now = new Date("2026-11-09T15:00:00Z");
const code = (text: string) => {
  const r = parseScheduledFor(text, now);
  return isOk(r) ? "ok" : r.error.code;
};

describe("parseScheduledFor", () => {
  it("takes the buyer's local date and time as written", () => {
    const r = parseScheduledFor("2026-11-14T18:30", now);
    expect(isOk(r) && r.value).toBe("2026-11-14T18:30");
  });
  it("rejects a malformed text, a date that doesn't exist and an hour out of range", () => {
    for (const bad of ["", "2026-11-14", "2026-11-14 18:30", "2026-02-30T10:00", "2026-11-14T24:00", "2026-11-14T10:60"]) {
      expect(code(bad), bad).toBe("INVALID_ORDER");
    }
  });
  it("accepts from yesterday in UTC (any time zone's today) up to 365 days ahead", () => {
    expect(code("2026-11-08T23:00")).toBe("ok");
    expect(code("2026-11-07T23:59")).toBe("INVALID_ORDER");
    expect(code("2027-11-09T10:00")).toBe("ok");
    expect(code("2027-11-10T16:00")).toBe("INVALID_ORDER");
  });
});

describe("upcomingScheduled", () => {
  const order = (id: string, status: Order["status"], at?: string) =>
    ({ id, status, ...(at ? { scheduled: { for: at, fulfillment: "retiro" } } : {}) }) as Order;
  it("only scheduled orders: open ones by date, nearest first, then the closed ones", () => {
    const list = [
      order("now", "nuevo"),
      order("late", "nuevo", "2026-11-20T10:00"),
      order("done", "entregado", "2026-11-10T10:00"),
      order("soon", "contactado", "2026-11-12T09:00"),
    ];
    expect(upcomingScheduled(list).map((o) => o.id)).toEqual(["soon", "late", "done"]);
  });
});

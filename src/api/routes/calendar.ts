import { toICS } from "../../packages/core/index";
import { Hono } from "hono";
import { z } from "zod";
import { build } from "../../container";
import { orderEvent } from "../../lib/order-calendar";
import { requireSession } from "../middlewares/session";
import type { ApiEnv } from "../types";
import { validate } from "../validation";

const sha256 = async (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));

/** Constant time, whatever the lengths: compares the hashes. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  return crypto.subtle.timingSafeEqual(await sha256(a), await sha256(b));
}

const DAY = 86_400_000;

/** An IANA zone the runtime knows ("America/Argentina/Buenos_Aires"). */
const timeZone = z
  .string()
  .max(64)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone");

/**
 * Google Calendar (or Apple, Outlook) subscribes to /api/calendar/<token>.ics and refreshes it on its own.
 * Public by design (calendars have no session): the unguessable token is the only key, and every miss is a 404.
 */
export const calendarRoutes = new Hono<ApiEnv>()
  .post("/token", requireSession("completa"), validate("json", z.object({ time_zone: timeZone.optional() })), async (c) => {
    const { calendar } = build(c.env);
    const zone = c.req.valid("json").time_zone;
    if (zone) await calendar.setTimeZone(zone);
    const token = await calendar.rotate();
    return c.json({ url: new URL(`/api/calendar/${token}.ics`, c.req.url).href });
  })
  .get("/:file", async (c) => {
    const container = build(c.env);
    const token = await container.calendar.token();
    const file = c.req.param("file");
    if (!token || !file.endsWith(".ics") || !(await sameSecret(file.slice(0, -4), token))) return c.notFound();
    const [enabled, orders, store, zone] = await Promise.all([
      container.advanceOrders.isEnabled(),
      container.orders.list(),
      container.getStore(),
      container.calendar.timeZone(),
    ]);
    // Recent ones stay a month so they don't vanish from the calendar the day after.
    const from = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
    const host = new URL(c.req.url).host;
    const events = enabled
      ? orders
          .filter((o) => o.scheduled && o.status !== "cancelado" && o.scheduled.for >= from)
          .map((o) => orderEvent(o, host, store?.language ?? "es"))
      : [];
    const options = { ...(store ? { name: store.name } : {}), ...(zone ? { timeZone: zone } : {}) };
    return c.body(toICS(events, new Date(), options), 200, {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-store",
    });
  });

import { isOpen, type Order, type OrderStatus, ORDER_STATUSES } from "../packages/core/index";
import { toMajor } from "./agent-json";

/** Until the owner's browser tells the shop's zone (connecting the assistant or the calendar). */
// shortcut: Buenos Aires as the fallback zone, the stores are Argentine first; ask the zone in onboarding if that changes
export const DEFAULT_TIME_ZONE = "America/Argentina/Buenos_Aires";

const DAY = 86_400_000;

/** The calendar date of `d` in `zone`, as YYYY-MM-DD. */
export const localDate = (d: Date, zone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Monday to Sunday around `today`. */
export function weekOf(today: string): { from: string; to: string } {
  const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  return { from: monday, to: addDays(monday, 6) };
}

export type OrderFilters = {
  status?: OrderStatus | undefined;
  open_only?: boolean | undefined;
  /** Inclusive dates (YYYY-MM-DD, shop's zone) of when the order came in. */
  created_from?: string | undefined;
  created_to?: string | undefined;
  /** Inclusive dates of the advance-order delivery; orders for "as soon as possible" never match. */
  scheduled_from?: string | undefined;
  scheduled_to?: string | undefined;
};

const between = (date: string, from?: string, to?: string) => (!from || date >= from) && (!to || date <= to);

export function filterOrders(orders: readonly Order[], f: OrderFilters, zone: string): Order[] {
  return orders.filter((o) => {
    if (f.status !== undefined && o.status !== f.status) return false;
    if (f.open_only && !isOpen(o.status)) return false;
    if ((f.created_from || f.created_to) && !between(localDate(o.createdAt, zone), f.created_from, f.created_to)) return false;
    if (f.scheduled_from || f.scheduled_to) {
      // The delivery date is the buyer's local text: compared as is, it never shifts a day.
      if (!o.scheduled || !between(o.scheduled.for.slice(0, 10), f.scheduled_from, f.scheduled_to)) return false;
    }
    return true;
  });
}

/** Not cancelled, in the major unit per currency (a store has one, but an old order may keep another). */
function revenue(orders: readonly Order[]): Record<string, number> {
  const minor: Record<string, number> = {};
  for (const o of orders) if (o.status !== "cancelado") minor[o.total.currency] = (minor[o.total.currency] ?? 0) + o.total.amount;
  return Object.fromEntries(Object.entries(minor).map(([currency, amount]) => [currency, toMajor(amount, currency)]));
}

/** What an owner asks first: how many, how many this week, what's coming, how much it adds up to. */
export function summarize(orders: readonly Order[], now: Date, zone: string) {
  const today = localDate(now, zone);
  const week = weekOf(today);
  const month = { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-31` };
  const created = (from: string, to: string) => filterOrders(orders, { created_from: from, created_to: to }, zone);
  const upcoming = filterOrders(orders, { open_only: true, scheduled_from: today, scheduled_to: addDays(today, 6) }, zone);
  return {
    today,
    time_zone: zone,
    this_week: week,
    total_orders: orders.length,
    by_status: Object.fromEntries(ORDER_STATUSES.map((s) => [s, orders.filter((o) => o.status === s).length])),
    open: orders.filter((o) => isOpen(o.status)).length,
    created_today: created(today, today).length,
    created_this_week: created(week.from, week.to).length,
    created_this_month: created(month.from, month.to).length,
    /** Advance orders to deliver this week (Monday to Sunday), still open. */
    to_deliver_this_week: filterOrders(orders, { open_only: true, scheduled_from: week.from, scheduled_to: week.to }, zone).length,
    to_deliver_next_7_days: upcoming.length,
    revenue_this_week: revenue(created(week.from, week.to)),
    revenue_this_month: revenue(created(month.from, month.to)),
  };
}

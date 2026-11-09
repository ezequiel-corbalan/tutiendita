import { type DomainError, domainError } from "./errors";
import { isOpen, type Order } from "./order";
import { err, ok, type Result } from "./result";

/** Stored literals (`pedidos.entrega_tipo`): delivery or pickup. */
export type Fulfillment = "envio" | "retiro";
/** An advance order: the buyer's local date and time as typed (`YYYY-MM-DDTHH:MM`, no zone), and how it's handed over. */
export type ScheduledDelivery = { readonly for: string; readonly fulfillment: Fulfillment };

const DAY = 86_400_000;

/**
 * Validates the date and time the buyer typed. It stays local text: the store has no time zone and the buyer
 * means the shop's own clock. Accepts from yesterday in UTC (today somewhere) up to 365 days ahead.
 */
export function parseScheduledFor(text: string, now: Date): Result<string, DomainError> {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  const invalid = err(domainError("INVALID_ORDER", "The date and time must be a real YYYY-MM-DDTHH:MM", { text }));
  if (!m) return invalid;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const at = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(at);
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59) return invalid;
  const yesterday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY;
  if (at < yesterday || at > now.getTime() + 365 * DAY) {
    return err(domainError("INVALID_ORDER", "The date must be from today up to a year ahead", { text }));
  }
  return ok(text);
}

/** Only the advance orders: open ones by date (nearest first), then the closed ones. */
export const upcomingScheduled = (orders: readonly Order[]): Order[] =>
  orders
    .filter((o) => o.scheduled !== undefined)
    .sort(
      (a, b) =>
        Number(isOpen(b.status)) - Number(isOpen(a.status)) ||
        (a.scheduled?.for ?? "").localeCompare(b.scheduled?.for ?? ""),
    );

import { type DomainError, domainError } from "./errors";
import { add, type Money, multiply } from "./money";
import { err, ok, type Result } from "./result";
import type { ScheduledDelivery } from "./schedule";

// Stored in D1: values stay in Spanish (new, contacted, paid, delivered, cancelled).
export const ORDER_STATUSES = ["nuevo", "contactado", "pagado", "entregado", "cancelado"] as const; // tuple: zod's z.enum needs it
export type OrderStatus = (typeof ORDER_STATUSES)[number];
/** Stored literals, same as medios_de_pago.tipo. */
export type OrderPaymentMethod = "transferencia" | "whatsapp";

export const isOpen = (s: OrderStatus): boolean => s === "nuevo" || s === "contactado" || s === "pagado";

export type OrderItem = {
  readonly productId: string;
  readonly name: string;
  /** The chosen variant ("Relleno: Dulce de leche · Talle: M"), if the product has options. */
  readonly variant?: string;
  /** Price frozen at order time, with the variant's adjustments. */
  readonly unitPrice: Money;
  readonly quantity: number;
};

/** Confirmed purchase intent. Not a payment: money never goes through the system. */
export type Order = {
  readonly id: string;
  readonly items: readonly OrderItem[];
  /** `address` is "" when the buyer left it blank (pickup, or agreed on WhatsApp). */
  readonly buyer: { readonly name: string; readonly address: string };
  readonly paymentMethod: OrderPaymentMethod;
  readonly total: Money;
  readonly status: OrderStatus;
  readonly note: string;
  /** Absent: as soon as possible. */
  readonly scheduled?: ScheduledDelivery;
  readonly createdByAgent: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

/** The total is always calculated on the server; the browser is never trusted. */
export function calculateTotal(items: readonly OrderItem[]): Result<Money, DomainError> {
  const first = items[0];
  if (first === undefined) {
    return err(domainError("INVALID_PRICE", "An order needs at least one item"));
  }
  let total: Money = { amount: 0, currency: first.unitPrice.currency };
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return err(
        domainError("INVALID_PRICE", "The quantity must be an integer greater than zero", {
          productId: item.productId,
          quantity: item.quantity,
        }),
      );
    }
    if (item.unitPrice.currency !== total.currency) {
      return err(
        domainError("INVALID_PRICE", "All items must be in the same currency", {
          expected: total.currency,
          received: item.unitPrice.currency,
        }),
      );
    }
    total = add(total, multiply(item.unitPrice, item.quantity));
  }
  return ok(total);
}

export const transitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  nuevo: ["contactado", "pagado", "cancelado"],
  contactado: ["pagado", "cancelado"],
  pagado: ["entregado", "cancelado"],
  entregado: [],
  cancelado: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean => transitions[from].includes(to);

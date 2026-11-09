import { type DomainError, domainError } from "../domain/errors";
import type { Order, OrderPaymentMethod } from "../domain/order";
import { err, ok, type Result } from "../domain/result";
import { parseScheduledFor, type ScheduledDelivery } from "../domain/schedule";
import { ADVANCE_ORDERS } from "../domain/settings";
import type { Clock } from "../ports/clock";
import type { IdGenerator } from "../ports/id-generator";
import type { OrderRepository } from "../ports/order-repository";
import type { ProductRepository } from "../ports/product-repository";
import type { SettingsRepository } from "../ports/settings-repository";
import { type CartLine, quoteOrder } from "./quote-order";

export const MAX_BUYER_NAME = 80;
export const MAX_ORDER_NOTE = 500;
export const MAX_BUYER_ADDRESS = 200;

export type PlaceOrderInput = {
  lines: readonly CartLine[];
  buyerName: string;
  note: string;
  /** Where to deliver; optional (pickup, or agreed on WhatsApp). */
  address?: string;
  paymentMethod: OrderPaymentMethod;
  /** Only when the store turned advance orders on. */
  scheduled?: ScheduledDelivery;
};

/** Stores the browser's cart as a new order: priced and totalled on the server via quoteOrder. */
export const placeOrder =
  (deps: {
    repo: ProductRepository;
    orders: OrderRepository;
    settings: SettingsRepository;
    ids: IdGenerator;
    clock: Clock;
  }) =>
  async (input: PlaceOrderInput): Promise<Result<Order, DomainError>> => {
    const name = input.buyerName.trim();
    const note = input.note.trim();
    const address = (input.address ?? "").trim();
    if (
      name === "" ||
      name.length > MAX_BUYER_NAME ||
      note.length > MAX_ORDER_NOTE ||
      address.length > MAX_BUYER_ADDRESS
    ) {
      return err(
        domainError(
          "INVALID_ORDER",
          "The order needs a buyer name (up to 80), a note up to 500 and an address up to 200",
        ),
      );
    }
    if (input.scheduled) {
      if ((await deps.settings.get(ADVANCE_ORDERS)) !== "1") {
        return err(domainError("INVALID_ORDER", "This store doesn't take advance orders"));
      }
      const at = parseScheduledFor(input.scheduled.for, deps.clock.now());
      if (!at.ok) return at;
      if (input.scheduled.fulfillment === "envio" && address === "") {
        return err(domainError("INVALID_ORDER", "A delivery needs an address"));
      }
    }
    const quote = await quoteOrder({ repo: deps.repo })(input.lines);
    if (!quote.ok) return quote;
    const now = deps.clock.now();
    const order: Order = {
      id: deps.ids.newId(),
      items: quote.value.items,
      buyer: { name, address },
      paymentMethod: input.paymentMethod,
      total: quote.value.total,
      status: "nuevo",
      note,
      ...(input.scheduled ? { scheduled: { ...input.scheduled } } : {}),
      createdByAgent: false,
      createdAt: now,
      updatedAt: now,
    };
    await deps.orders.insert(order);
    return ok(order);
  };

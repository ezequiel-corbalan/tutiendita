import type { Order, OrderPaymentMethod, OrderStatus } from "../packages/core/index";

/** JSON representation of an order for the owner's panel. */
export type OrderJson = {
  id: string;
  buyer_name: string;
  /** "" when the buyer left it blank. */
  buyer_address: string;
  note: string;
  payment_method: OrderPaymentMethod;
  items: {
    product_id: string;
    name: string;
    variant: string | null;
    quantity: number;
    unit_price: { amount: number; currency: string };
  }[];
  total: { amount: number; currency: string };
  status: OrderStatus;
  created_at: string;
  updated_at: string;
};

export function toOrderJson(o: Order): OrderJson {
  return {
    id: o.id,
    buyer_name: o.buyer.name,
    buyer_address: o.buyer.address,
    note: o.note,
    payment_method: o.paymentMethod,
    items: o.items.map((i) => ({
      product_id: i.productId,
      name: i.name,
      variant: i.variant ?? null,
      quantity: i.quantity,
      unit_price: i.unitPrice,
    })),
    total: o.total,
    status: o.status,
    created_at: o.createdAt.toISOString(),
    updated_at: o.updatedAt.toISOString(),
  };
}

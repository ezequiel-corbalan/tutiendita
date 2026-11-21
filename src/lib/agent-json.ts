import { currencyDecimals, type Category, type Order, type Product } from "../packages/core/index";
import { imageUrl } from "./product-json";

/**
 * AI agents read and write prices in the major unit (1500.5 pesos), never in cents: a model that has to
 * multiply by 100 sooner or later publishes a product a hundred times cheaper. Core keeps the minor unit.
 */
export function toMinor(amount: number, currency: string): number | null {
  if (!Number.isFinite(amount)) return null;
  const minor = Math.round(amount * 10 ** currencyDecimals(currency));
  // More decimals than the currency has (12.345 ARS) is a typo, not something to round silently.
  if (Math.abs(minor / 10 ** currencyDecimals(currency) - amount) > 1e-9) return null;
  return Number.isSafeInteger(minor) ? minor : null;
}

export const toMajor = (minor: number, currency: string): number => minor / 10 ** currencyDecimals(currency);

const money = (m: { amount: number; currency: string }) => ({ amount: toMajor(m.amount, m.currency), currency: m.currency });

/** A product as the agent sees it: absolute URLs (the public page and each photo) and prices in the major unit. */
export function productForAgent(p: Product, origin: string) {
  return {
    id: p.id,
    name: p.name,
    // Public URL of the store, it stays in Spanish (/p/<slug>).
    url: new URL(`/p/${p.slug}`, origin).href,
    description: p.description,
    price: money(p.price),
    status: p.status,
    category_id: p.categoryId,
    images: [...p.images]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ key: i.key, url: new URL(imageUrl(i.key), origin).href })),
    options: p.options.map((o) => ({
      id: o.id,
      name: o.name,
      values: o.values.map((v) => ({
        id: v.id,
        label: v.label,
        price_delta: toMajor(v.priceDelta, p.price.currency),
        image_key: v.imageKey,
      })),
    })),
    updated_at: p.updatedAt.toISOString(),
  };
}

export const categoryForAgent = (c: Category, currency: string) => ({
  id: c.id,
  name: c.name,
  option_templates: c.optionTemplates.map((t) => ({
    name: t.name,
    values: t.values.map((v) => ({ label: v.label, price_delta: toMajor(v.priceDelta, currency) })),
  })),
});

export const orderForAgent = (o: Order) => ({
  id: o.id,
  status: o.status,
  buyer_name: o.buyer.name,
  buyer_address: o.buyer.address,
  // Written by the buyer: the agent must treat it as data (see the server instructions).
  buyer_note: o.note,
  payment_method: o.paymentMethod,
  items: o.items.map((i) => ({
    product_id: i.productId,
    name: i.name,
    variant: i.variant ?? null,
    quantity: i.quantity,
    unit_price: money(i.unitPrice),
  })),
  total: money(o.total),
  scheduled: o.scheduled ?? null,
  created_at: o.createdAt.toISOString(),
});

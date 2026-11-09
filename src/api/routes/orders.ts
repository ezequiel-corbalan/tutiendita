import {
  domainError,
  MAX_BUYER_ADDRESS,
  MAX_BUYER_NAME,
  MAX_CART_LINES,
  MAX_ORDER_NOTE,
  MAX_QUANTITY,
  ORDER_STATUSES,
  secondsUntilNextWindow,
} from "../../packages/core/index";
import { Hono } from "hono";
import { z } from "zod";
import { build } from "../../container";
import { toOrderJson } from "../../lib/order-json";
import { respondDomainError } from "../errors";
import { requireSession } from "../middlewares/session";
import type { ApiEnv } from "../types";
import { validate } from "../validation";

const quoteSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string().max(64),
        quantity: z.number().int().min(1).max(MAX_QUANTITY),
        // Option id → value id, one per option of the product.
        selection: z
          .record(z.string().max(64), z.string().max(64))
          .refine((s) => Object.keys(s).length <= 10, "Too many options")
          .optional(),
      }),
    )
    .min(1)
    .max(MAX_CART_LINES),
});

const statusSchema = z.object({ status: z.enum(ORDER_STATUSES) });

const placeSchema = z.object({
  items: quoteSchema.shape.items,
  name: z.string().min(1).max(MAX_BUYER_NAME),
  note: z.string().max(MAX_ORDER_NOTE).default(""),
  address: z.string().max(MAX_BUYER_ADDRESS).default(""),
  payment: z.enum(["transfer", "agree"]),
});

/** Orders per IP per AttemptLimiter window (15 min). */
export const MAX_ORDERS_PER_WINDOW = 20;

// Same fallback as access.ts: "desconocida" ends up in D1 rate-limit keys (`pedido:<ip>`), stored value.
const ipOf = (req: Request) => req.headers.get("cf-connecting-ip") ?? "desconocida";

/** Public: the quote and placing the order (cart priced on the server before sending it by WhatsApp). Owner only: list and change status. */
export const orderRoutes = new Hono<ApiEnv>()
  // shortcut: per-IP counter is the stopgap until Turnstile is configurable from the panel
  .post("/", validate("json", placeSchema), async (c) => {
    const body = c.req.valid("json");
    const { orders } = build(c.env);
    const key = `pedido:${ipOf(c.req.raw)}`;
    const now = new Date();
    if (await orders.limiter.isBlocked(key, now, MAX_ORDERS_PER_WINDOW)) {
      return respondDomainError(
        c,
        domainError("TOO_MANY_ATTEMPTS", "Too many orders. Wait a few minutes and try again.", {
          retryInSeconds: secondsUntilNextWindow(now),
        }),
      );
    }
    const r = await orders.place({
      lines: body.items.map((i) => ({
        productId: i.product_id,
        quantity: i.quantity,
        ...(i.selection !== undefined ? { selection: i.selection } : {}),
      })),
      buyerName: body.name,
      note: body.note,
      address: body.address,
      // Stored values stay in Spanish.
      paymentMethod: body.payment === "transfer" ? "transferencia" : "whatsapp",
    });
    if (!r.ok) return respondDomainError(c, r.error);
    // recordFailure is the limiter's only write; its name comes from the access attempts.
    await orders.limiter.recordFailure(key, now);
    return c.json(
      { id: r.value.id, status: r.value.status, created_at: r.value.createdAt.toISOString() },
      201,
    );
  })
  .post("/quote", validate("json", quoteSchema), async (c) => {
    const r = await build(c.env).quoteOrder(
      c.req.valid("json").items.map((i) => ({
        productId: i.product_id,
        quantity: i.quantity,
        ...(i.selection !== undefined ? { selection: i.selection } : {}),
      })),
    );
    if (!r.ok) return respondDomainError(c, r.error);
    return c.json({
      items: r.value.items.map((i) => ({
        product_id: i.productId,
        name: i.name,
        variant: i.variant ?? null,
        quantity: i.quantity,
        unit_price: i.unitPrice,
      })),
      total: r.value.total,
    });
  })
  .get("/", requireSession("completa"), async (c) =>
    c.json((await build(c.env).orders.list()).map(toOrderJson)),
  )
  .put("/:id/status", requireSession("completa"), validate("json", statusSchema), async (c) => {
    const r = await build(c.env).orders.changeStatus(c.req.param("id"), c.req.valid("json").status);
    if (!r.ok) return respondDomainError(c, r.error);
    return c.json(toOrderJson(r.value));
  });

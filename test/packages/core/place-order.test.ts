import { beforeEach, describe, expect, it } from "vitest";
import { money } from "../../../src/packages/core/domain/money";
import { isOk } from "../../../src/packages/core/domain/result";
import { createProduct } from "../../../src/packages/core/use-cases/create-product";
import { placeOrder } from "../../../src/packages/core/use-cases/place-order";
import {
  FixedClock,
  InMemoryCategoryRepository,
  InMemoryImageStorage,
  InMemoryOrderRepository,
  InMemoryProductRepository,
  SequentialIdGenerator,
} from "./doubles/in-memory";

const ars = (amount: number) => {
  const r = money(amount, "ARS");
  if (!isOk(r)) throw new Error("fixture");
  return r.value;
};
const png = {
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
  mimeType: "image/png",
};

let orders: InMemoryOrderRepository;
let create: ReturnType<typeof createProduct>;
let place: ReturnType<typeof placeOrder>;

beforeEach(() => {
  const repo = new InMemoryProductRepository();
  orders = new InMemoryOrderRepository();
  create = createProduct({
    repo,
    categories: new InMemoryCategoryRepository(),
    images: new InMemoryImageStorage(),
    clock: new FixedClock(new Date("2026-10-15T12:00:00Z")),
    ids: new SequentialIdGenerator(),
  });
  place = placeOrder({
    repo,
    orders,
    ids: new SequentialIdGenerator(),
    clock: new FixedClock(new Date("2026-10-17T12:00:00Z")),
  });
});

async function product(name: string, amount: number, publish = true) {
  const r = await create({ name, price: ars(amount), gallery: [{ upload: 0 }], uploads: [png], publish });
  if (!isOk(r)) throw new Error("fixture");
  return r.value;
}

describe("placeOrder", () => {
  it("stores the quoted items, the server total and status nuevo", async () => {
    const torta = await product("Torta", 2800000);
    const r = await place({
      lines: [{ productId: torta.id, quantity: 2 }],
      buyerName: "  Ana ",
      note: "",
      paymentMethod: "whatsapp",
    });
    expect(isOk(r) && r.value).toMatchObject({
      status: "nuevo",
      buyer: { name: "Ana" },
      paymentMethod: "whatsapp",
      createdByAgent: false,
      total: { amount: 5600000, currency: "ARS" },
    });
    expect(isOk(r) && r.value.items[0]).toMatchObject({
      name: "Torta",
      quantity: 2,
      unitPrice: { amount: 2800000 },
    });
    expect(await orders.list()).toHaveLength(1);
  });

  it("rejects a blank name, a long name and a long note, and stores nothing", async () => {
    const torta = await product("Torta", 2800000);
    const lines = [{ productId: torta.id, quantity: 1 }];
    for (const input of [
      { lines, buyerName: "   ", note: "", paymentMethod: "whatsapp" as const },
      { lines, buyerName: "a".repeat(81), note: "", paymentMethod: "whatsapp" as const },
      { lines, buyerName: "Ana", note: "n".repeat(501), paymentMethod: "transferencia" as const },
    ]) {
      const r = await place(input);
      expect(!isOk(r) && r.error.code).toBe("INVALID_ORDER");
    }
    expect(await orders.list()).toHaveLength(0);
  });

  it("stores the delivery address trimmed, empty when missing, and rejects one over 200 characters", async () => {
    const torta = await product("Torta", 2800000);
    const lines = [{ productId: torta.id, quantity: 1 }];
    const base = { lines, buyerName: "Ana", note: "", paymentMethod: "whatsapp" as const };
    const withAddress = await place({ ...base, address: "  San Martín 123, timbre B " });
    expect(isOk(withAddress) && withAddress.value.buyer).toEqual({ name: "Ana", address: "San Martín 123, timbre B" });
    const without = await place(base);
    expect(isOk(without) && without.value.buyer).toEqual({ name: "Ana", address: "" });
    const long = await place({ ...base, address: "a".repeat(201) });
    expect(!isOk(long) && long.error.code).toBe("INVALID_ORDER");
    expect(await orders.list()).toHaveLength(2);
  });

  it("a draft product or an empty cart fails like the quote does", async () => {
    const draft = await product("Borrador", 1000, false);
    const r = await place({
      lines: [{ productId: draft.id, quantity: 1 }],
      buyerName: "Ana",
      note: "",
      paymentMethod: "whatsapp",
    });
    expect(!isOk(r) && r.error.code).toBe("PRODUCT_UNAVAILABLE");
    const empty = await place({ lines: [], buyerName: "Ana", note: "", paymentMethod: "whatsapp" });
    expect(!isOk(empty) && empty.error.code).toBe("INVALID_CART");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { money } from "../../../src/packages/core/domain/money";
import type { Order, OrderStatus } from "../../../src/packages/core/domain/order";
import { isOk } from "../../../src/packages/core/domain/result";
import { changeOrderStatus, listOrders } from "../../../src/packages/core/use-cases/manage-orders";
import { FixedClock, InMemoryOrderRepository } from "./doubles/in-memory";

const clock = new FixedClock(new Date("2026-10-17T12:00:00Z"));
let orders: InMemoryOrderRepository;

beforeEach(() => {
  orders = new InMemoryOrderRepository();
});

async function seed(id: string, status: OrderStatus, createdAt: string) {
  const total = money(1000, "ARS");
  if (!isOk(total)) throw new Error("fixture");
  const order: Order = {
    id,
    items: [],
    buyer: { name: "Ana", address: "" },
    paymentMethod: "whatsapp",
    total: total.value,
    status,
    note: "",
    createdByAgent: false,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
  };
  await orders.insert(order);
}
const change = (id: string, to: OrderStatus) => changeOrderStatus({ orders, clock })(id, to);

describe("manage orders", () => {
  it("lists open orders first and newest first inside each group", async () => {
    await seed("a", "entregado", "2026-10-17T10:00:00Z");
    await seed("b", "nuevo", "2026-10-16T10:00:00Z");
    await seed("c", "pagado", "2026-10-17T09:00:00Z");
    await seed("d", "cancelado", "2026-10-17T11:00:00Z");
    expect((await listOrders({ orders })()).map((o) => o.id)).toEqual(["c", "b", "d", "a"]);
  });
  it("follows the allowed transitions and stamps updatedAt", async () => {
    await seed("a", "nuevo", "2026-10-17T10:00:00Z");
    for (const to of ["contactado", "pagado", "entregado"] as const) {
      const r = await change("a", to);
      expect(isOk(r) && r.value.status).toBe(to);
      expect(isOk(r) && r.value.updatedAt).toEqual(clock.now());
    }
  });
  it("refuses the same status, a step back, anything after a final state and an unknown id", async () => {
    await seed("a", "pagado", "2026-10-17T10:00:00Z");
    await seed("z", "entregado", "2026-10-17T10:00:00Z");
    for (const [id, to] of [
      ["a", "pagado"],
      ["a", "nuevo"],
      ["a", "contactado"],
      ["z", "cancelado"],
      ["z", "pagado"],
    ] as const) {
      const r = await change(id, to);
      expect(!isOk(r) && r.error.code, `${id} → ${to}`).toBe("INVALID_TRANSITION");
    }
    const missing = await change("nope", "pagado");
    expect(!isOk(missing) && missing.error.code).toBe("ORDER_NOT_FOUND");
    expect((await orders.findById("a"))?.status).toBe("pagado");
  });
});

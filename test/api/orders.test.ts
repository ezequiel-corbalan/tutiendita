import { env } from "cloudflare:workers";
import { createD1OrderRepository } from "../../src/packages/infra-cloudflare/index";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_ORDERS_PER_WINDOW } from "../../src/api/routes/orders";
import type { OrderJson } from "../../src/lib/order-json";
import type { ProductJson } from "../../src/lib/product-json";
import {
  BASE,
  call,
  clearD1,
  clearR2,
  create,
  sampleOrder,
  send,
  startTestSession,
  validCreation,
} from "../helpers";

type Quote = { items: { name: string; quantity: number }[]; total: { amount: number; currency: string } };

const quote = (items: unknown, origin: string | null = BASE) =>
  call("/api/orders/quote", {
    method: "POST",
    body: JSON.stringify({ items }),
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
  });

beforeEach(async () => {
  await clearD1();
  await clearR2();
});

describe("D1 order repository", () => {
  const order = sampleOrder;
  it("round-trips an order, keeps items without a variant, lists open first and updates the status", async () => {
    const repo = createD1OrderRepository(env.DB);
    await repo.insert(order("a", "entregado", "2026-10-17T10:00:00Z", "Relleno: Chocolate"));
    await repo.insert(order("b", "nuevo", "2026-10-16T10:00:00Z"));
    await repo.insert(order("c", "pagado", "2026-10-17T09:00:00Z"));
    expect((await repo.list()).map((o) => o.id)).toEqual(["c", "b", "a"]);
    expect(await repo.findById("a")).toEqual(
      order("a", "entregado", "2026-10-17T10:00:00Z", "Relleno: Chocolate"),
    );
    expect((await repo.findById("b"))?.items[0]).not.toHaveProperty("variant");
    await repo.updateStatus("b", "contactado", new Date("2026-10-17T12:00:00Z"));
    expect(await repo.findById("b")).toMatchObject({
      status: "contactado",
      updatedAt: new Date("2026-10-17T12:00:00Z"),
    });
    expect(await repo.findById("nope")).toBeNull();
  });
});

describe("orders stored before the address existed", () => {
  it("read back with an empty address", async () => {
    await env.DB.prepare(
      `INSERT INTO pedidos (id, comprador_nombre, nota, medio_de_pago, items, total_monto, total_moneda, estado, creado_en, actualizado_en)
       VALUES ('old', 'Ana', '', 'whatsapp', '[]', 100, 'ARS', 'nuevo', '2026-10-01T10:00:00.000Z', '2026-10-01T10:00:00.000Z')`,
    ).run();
    expect((await createD1OrderRepository(env.DB).findById("old"))?.buyer).toEqual({ name: "Ana", address: "" });
  });
});

describe("advance orders", () => {
  const turnOn = (enabled: boolean, cookies: Record<string, string>) =>
    send("PUT", "/api/store/advance-orders", { enabled }, { cookies });

  it("the owner turns them on; only then the buyer can send a date, a time and delivery or pickup", async () => {
    const a = (await (await create(validCreation({ name: "Torta" }))).json()) as ProductJson;
    const items = [{ product_id: a.id, quantity: 1 }];
    const scheduled = { for: "2027-01-15T18:00", fulfillment: "retiro" };
    expect((await send("PUT", "/api/store/advance-orders", { enabled: true })).status).toBe(401);
    expect((await post({ items, name: "Ana", payment: "agree", scheduled })).status).toBe(422);

    const cookies = await startTestSession();
    expect((await turnOn(true, cookies)).status).toBe(200);
    expect((await post({ items, name: "Ana", payment: "agree", scheduled })).status).toBe(201);
    expect(
      (await post({ items, name: "Beto", payment: "agree", scheduled: { ...scheduled, fulfillment: "envio" } })).status,
    ).toBe(422);
    expect((await post({ items, name: "Caro", payment: "agree", scheduled: { ...scheduled, fulfillment: "moto" } })).status).toBe(422);
    const listed = (await (await send("GET", "/api/orders", undefined, { cookies })).json()) as OrderJson[];
    expect(listed.map((o) => o.scheduled)).toEqual([scheduled]);

    expect((await turnOn(false, cookies)).status).toBe(200);
    expect((await post({ items, name: "Ana", payment: "agree", scheduled })).status).toBe(422);
  });

  it("the repository keeps the date as typed and leaves orders for now without one", async () => {
    const repo = createD1OrderRepository(env.DB);
    const later = { ...sampleOrder("a", "nuevo", "2026-11-09T10:00:00Z"), scheduled: { for: "2026-11-30T23:30", fulfillment: "envio" as const } };
    await repo.insert(later);
    await repo.insert(sampleOrder("b", "nuevo", "2026-11-09T11:00:00Z"));
    expect((await repo.findById("a"))?.scheduled).toEqual({ for: "2026-11-30T23:30", fulfillment: "envio" });
    expect(await repo.findById("b")).not.toHaveProperty("scheduled");
  });
});

describe("POST /api/orders/quote", () => {
  it("prices the cart on the server, without a session", async () => {
    const a = (await (
      await create(validCreation({ name: "Torta", price_amount: "2800000" }))
    ).json()) as ProductJson;
    const b = (await (
      await create(validCreation({ name: "Alfajores", price_amount: "750000" }))
    ).json()) as ProductJson;
    const res = await quote([
      { product_id: a.id, quantity: 1 },
      { product_id: b.id, quantity: 2 },
    ]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Quote;
    expect(body.total).toEqual({ amount: 4300000, currency: "ARS" });
    expect(body.items.map((i) => [i.name, i.quantity])).toEqual([
      ["Torta", 1],
      ["Alfajores", 2],
    ]);
  });

  it("a draft is not for sale; bad quantities and other origins are rejected", async () => {
    const draft = (await (await create(validCreation({ publish: "false" }))).json()) as ProductJson;
    const r = await quote([{ product_id: draft.id, quantity: 1 }]);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("PRODUCT_UNAVAILABLE");
    expect((await quote([{ product_id: draft.id, quantity: 0 }])).status).toBe(422);
    expect((await quote([])).status).toBe(422);
    expect((await quote([{ product_id: draft.id, quantity: 1 }], "https://otro.example")).status).toBe(403);
  });
});

describe("owner orders API", () => {
  const seedOrder = (id: string, status: Parameters<typeof sampleOrder>[1]) =>
    createD1OrderRepository(env.DB).insert(sampleOrder(id, status, "2026-10-17T10:00:00Z"));

  it("GET and PUT need a full session", async () => {
    expect((await send("GET", "/api/orders")).status).toBe(401);
    expect((await send("PUT", "/api/orders/a/status", { status: "pagado" })).status).toBe(401);
  });

  it("lists orders as JSON and moves a status along the allowed path", async () => {
    const cookies = await startTestSession();
    await seedOrder("a", "nuevo");
    const list = await send("GET", "/api/orders", undefined, { cookies });
    expect(list.status).toBe(200);
    expect(
      ((await list.json()) as OrderJson[]).map((o) => [o.id, o.status, o.buyer_name, o.total.amount]),
    ).toEqual([["a", "nuevo", "Ana", 100]]);
    const ok = await send("PUT", "/api/orders/a/status", { status: "pagado" }, { cookies });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as OrderJson).status).toBe("pagado");
    const back = await send("PUT", "/api/orders/a/status", { status: "nuevo" }, { cookies });
    expect(back.status).toBe(422);
    expect(((await back.json()) as { error: { code: string } }).error.code).toBe("INVALID_TRANSITION");
    expect((await send("PUT", "/api/orders/nope/status", { status: "pagado" }, { cookies })).status).toBe(
      404,
    );
    expect((await send("PUT", "/api/orders/a/status", { status: "robado" }, { cookies })).status).toBe(422);
  });
});

const post = (body: unknown, ip?: string) =>
  call("/api/orders", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: BASE, ...(ip ? { "cf-connecting-ip": ip } : {}) },
  });

describe("POST /api/orders", () => {
  it("stores a sale without a session with the server's prices and status nuevo", async () => {
    const a = (await (
      await create(validCreation({ name: "Torta", price_amount: "2800000" }))
    ).json()) as ProductJson;
    const res = await post({
      items: [{ product_id: a.id, quantity: 2 }],
      name: " Ana ",
      note: "lo retiro el sábado",
      payment: "transfer",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string; created_at: string };
    expect(body.status).toBe("nuevo");
    const stored = await createD1OrderRepository(env.DB).findById(body.id);
    expect(stored).toMatchObject({
      buyer: { name: "Ana" },
      paymentMethod: "transferencia",
      note: "lo retiro el sábado",
      total: { amount: 5600000, currency: "ARS" },
    });
  });

  it("stores the delivery address when the buyer writes one, and lists it for the owner", async () => {
    const a = (await (await create(validCreation({ name: "Empanadas" }))).json()) as ProductJson;
    const items = [{ product_id: a.id, quantity: 12 }];
    expect((await post({ items, name: "Ana", payment: "agree", address: " San Martín 123 " })).status).toBe(201);
    expect((await post({ items, name: "Beto", payment: "agree" })).status).toBe(201);
    expect((await post({ items, name: "Caro", payment: "agree", address: "a".repeat(201) })).status).toBe(422);
    const listed = (await (await send("GET", "/api/orders", undefined, { cookies: await startTestSession() })).json()) as OrderJson[];
    expect(Object.fromEntries(listed.map((o) => [o.buyer_name, o.buyer_address]))).toEqual({
      Ana: "San Martín 123",
      Beto: "",
    });
  });

  it("rejects a blank name, an unknown payment, a long note, an unpublished product and another origin; nothing is stored", async () => {
    const draft = (await (await create(validCreation({ publish: "false" }))).json()) as ProductJson;
    const live = (await (await create(validCreation({ name: "Alfajor" }))).json()) as ProductJson;
    const items = [{ product_id: live.id, quantity: 1 }];
    expect((await post({ items, name: "   ", payment: "agree" })).status).toBe(422);
    expect((await post({ items, name: "Ana", payment: "cash" })).status).toBe(422);
    expect((await post({ items, name: "Ana", note: "n".repeat(501), payment: "agree" })).status).toBe(422);
    const gone = await post({
      items: [{ product_id: draft.id, quantity: 1 }],
      name: "Ana",
      payment: "agree",
    });
    expect(gone.status).toBe(422);
    expect(((await gone.json()) as { error: { code: string } }).error.code).toBe("PRODUCT_UNAVAILABLE");
    expect(
      (
        await send(
          "POST",
          "/api/orders",
          { items, name: "Ana", payment: "agree" },
          { origin: "https://otro.example" },
        )
      ).status,
    ).toBe(403);
    expect(await createD1OrderRepository(env.DB).list()).toHaveLength(0);
  });

  it("the 21st order from one IP in a window is 429 and is not stored; another IP goes on", async () => {
    const live = (await (await create(validCreation({ name: "Alfajor" }))).json()) as ProductJson;
    const body = { items: [{ product_id: live.id, quantity: 1 }], name: "Ana", payment: "agree" };
    for (let n = 0; n < MAX_ORDERS_PER_WINDOW; n++) expect((await post(body, "1.1.1.1")).status).toBe(201);
    const blocked = await post(body, "1.1.1.1");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect((await post(body, "2.2.2.2")).status).toBe(201);
    expect(await createD1OrderRepository(env.DB).list()).toHaveLength(MAX_ORDERS_PER_WINDOW + 1);
  });
});

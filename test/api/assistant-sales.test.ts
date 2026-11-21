import { env } from "cloudflare:workers";
import { createD1OrderRepository } from "../../src/packages/infra-cloudflare/index";
import { beforeEach, describe, expect, it } from "vitest";
import { parseActions } from "../../src/lib/action-link";
import { addDays, filterOrders, localDate, summarize, weekOf } from "../../src/lib/sales-summary";
import { call, clearD1, PNG_1X1, sampleOrder, seedStore, send, startTestSession } from "../helpers";

const ZONE = "America/Argentina/Buenos_Aires";

async function connect(): Promise<{ path: string; token: string }> {
  const res = await send("POST", "/api/assistant/token", { time_zone: ZONE }, { cookies: await startTestSession() });
  expect(res.status).toBe(200);
  const path = new URL(((await res.json()) as { url: string }).url).pathname;
  return { path, token: path.split("/").pop()! };
}

let next = 1;
async function use(path: string, name: string, args: Record<string, unknown> = {}) {
  const res = await call(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: next++, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  return { isError: body.result.isError === true, value: JSON.parse(body.result.content[0]!.text) };
}

/** A product with a photo (so it can be published) and, optionally, a size option. */
async function product(path: string, name: string, price: number, options?: unknown) {
  const body = new FormData();
  body.set("name", name);
  body.set("price_amount", String(Math.round(price * 100)));
  body.set("price_currency", "ARS");
  body.set("publish", "true");
  body.set("image", new File([PNG_1X1], "p.png", { type: "image/png" }));
  if (options) body.set("options", JSON.stringify(options));
  const cookies = await startTestSession();
  const res = await call("/api/products", {
    method: "POST",
    headers: { origin: "http://tiendita.test", cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") },
    body,
  });
  expect(res.status).toBe(201);
  void path;
  return ((await res.json()) as { id: string }).id;
}

const today = () => localDate(new Date(), ZONE);
const at = (id: string, created: Date, scheduledFor?: string, status: "nuevo" | "entregado" | "cancelado" = "nuevo") => ({
  ...sampleOrder(id, status, created.toISOString()),
  ...(scheduledFor ? { scheduled: { for: scheduledFor, fulfillment: "retiro" as const } } : {}),
});

beforeEach(async () => {
  await clearD1();
  await seedStore();
});

describe("sales questions", () => {
  it("summarises today, this week and what's to deliver, in the shop's zone", async () => {
    const { path } = await connect();
    const repo = createD1OrderRepository(env.DB);
    const now = new Date();
    await repo.insert(at("a", now, `${today()}T18:00`));
    await repo.insert(at("b", new Date(now.getTime() - 40 * 86_400_000)));
    await repo.insert(at("c", now, undefined, "cancelado"));
    const summary = (await use(path, "get_sales_summary")).value;
    expect(summary.today).toBe(today());
    expect(summary.time_zone).toBe(ZONE);
    expect(summary.total_orders).toBe(3);
    expect(summary.created_today).toBe(2);
    expect(summary.to_deliver_next_7_days).toBe(1);
    expect(summary.by_status.cancelado).toBe(1);

    const forToday = (await use(path, "list_orders", { scheduled_from: today(), scheduled_to: today() })).value;
    expect(forToday.orders.map((o: { id: string }) => o.id)).toEqual(["a"]);
    expect(forToday.orders[0].created_date).toBe(today());
    expect((await use(path, "list_orders", { open_only: true })).value.count).toBe(2);
    expect((await use(path, "list_orders", { created_from: "tomorrow" })).value.error).toBe("INVALID_INPUT");
  });

  it("previews and then applies a general price rise, variants included, rounded", async () => {
    const { path } = await connect();
    const cake = await product(path, "Torta", 15000, [
      { name: "Tamaño", values: [{ label: "Chica", price_delta: 0 }, { label: "Grande", price_delta: 500000 }] },
    ]);
    await product(path, "Alfajor", 1234);
    const preview = (await use(path, "bulk_update_products", { all: true, price_percent: 10, round_to: 100 })).value;
    expect(preview.dry_run).toBe(true);
    expect(preview.changes.find((c: { id: string }) => c.id === cake).price).toEqual({ from: 15000, to: 16500 });
    expect(preview.changes.find((c: { name: string }) => c.name === "Alfajor").price).toEqual({ from: 1234, to: 1400 });
    expect((await use(path, "get_product", { id: cake })).value.price.amount).toBe(15000);

    const applied = (await use(path, "bulk_update_products", { all: true, price_percent: 10, round_to: 100, dry_run: false })).value;
    expect(applied.failed).toBe(0);
    const after = (await use(path, "get_product", { id: cake })).value;
    expect(after.price.amount).toBe(16500);
    expect(after.options[0].values[1].price_delta).toBe(5500);
  });

  it("sets prices one by one, pauses many and reports what it couldn't do", async () => {
    const { path } = await connect();
    const a = await product(path, "A", 100);
    const b = await product(path, "B", 200);
    const set = (await use(path, "bulk_update_products", { new_prices: [{ id: a, price: 150 }, { id: "nope", price: 1 }], dry_run: false })).value;
    expect(set.not_found).toEqual(["nope"]);
    expect((await use(path, "get_product", { id: a })).value.price.amount).toBe(150);
    const paused = (await use(path, "bulk_update_products", { product_ids: [a, b], status: "pausado", dry_run: false })).value;
    expect(paused.products).toBe(2);
    expect((await use(path, "list_products", { status: "pausado" })).value).toHaveLength(2);
    expect((await use(path, "bulk_update_products", { all: true, category_id: "x", status: "pausado" })).value.error).toBe("INVALID_INPUT");
    expect((await use(path, "bulk_update_products", { all: true })).value.error).toBe("INVALID_INPUT");
  });
});

describe("guide link and confirmation links (AIs without a connector)", () => {
  it("the guide has the instructions and the store's data, only with the current token", async () => {
    const { path, token } = await connect();
    await product(path, "Torta de ricota", 9000);
    await createD1OrderRepository(env.DB).insert(at("p1", new Date()));
    expect((await call("/mcp/nope/guide.md")).status).toBe(404);
    const res = await call(`${path}/guide.md`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).toContain("# La tiendita de prueba");
    expect(text).toContain('"name": "Torta de ricota"');
    expect(text).toContain('"price": 9000');
    expect(text).toContain('"id": "p1"');
    expect(text).toContain(`http://tiendita.test/confirmar/${token}`);
    expect(text).toContain("Spanish from Argentina");
  });

  it("a confirmed link applies its changes through the same tools; another token can't", async () => {
    const { path, token } = await connect();
    const a = await product(path, "A", 100);
    await createD1OrderRepository(env.DB).insert(at("p1", new Date()));
    const query = `?price=${a}:250,5&status=${a}:pausado&order=p1:contactado&delete=nope&evil=1`;
    const confirm = (t: string) => send("POST", `/api/assistant/actions/${t}`, { query });
    expect((await confirm("other")).status).toBe(401);
    const res = await confirm(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { applied: number; results: { ok: boolean; error?: string }[] };
    expect(body.applied).toBe(3);
    expect(body.results.at(-1)).toMatchObject({ type: "delete", ok: false, error: "PRODUCT_NOT_FOUND" });
    const after = (await use(path, "get_product", { id: a })).value;
    expect(after).toMatchObject({ price: { amount: 250.5 }, status: "pausado" });
    expect((await use(path, "list_orders", { status: "contactado" })).value.count).toBe(1);
  });
});

describe("helpers", () => {
  it("weeks run Monday to Sunday and dates are the shop's", () => {
    expect(weekOf("2026-11-21")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(weekOf("2026-11-16")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    // 01:00 UTC is still the day before in Buenos Aires.
    expect(localDate(new Date("2026-11-21T01:00:00Z"), ZONE)).toBe("2026-11-20");
  });

  it("filters and summarises without shifting advance-order dates", () => {
    const now = new Date("2026-11-21T15:00:00Z");
    const orders = [at("a", now, "2026-11-22T10:00"), at("b", now, "2026-11-30T10:00"), at("c", now, undefined, "entregado")];
    expect(filterOrders(orders, { scheduled_from: "2026-11-22", scheduled_to: "2026-11-22" }, ZONE).map((o) => o.id)).toEqual(["a"]);
    const s = summarize(orders, now, ZONE);
    expect(s).toMatchObject({ today: "2026-11-21", open: 2, to_deliver_this_week: 1, created_this_week: 3 });
  });

  it("reads the changes an AI writes in a link and keeps what it doesn't understand apart", () => {
    const { actions, invalid } = parseActions(
      new URLSearchParams("price=01A:1500&price=01B:12,5&status=01C:pausado&delete=01D&order=p1:pagado&status=01E:gone&v=3&x=1"),
    );
    expect(actions).toEqual([
      { type: "price", id: "01A", price: 1500 },
      { type: "price", id: "01B", price: 12.5 },
      { type: "status", id: "01C", status: "pausado" },
      { type: "delete", id: "01D" },
      { type: "order", id: "p1", status: "pagado" },
    ]);
    expect(invalid).toEqual(["status=01E:gone", "x=1"]);
  });
});

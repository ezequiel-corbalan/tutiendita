import { env } from "cloudflare:workers";
import { createD1OrderRepository } from "../../src/packages/infra-cloudflare/index";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toMinor } from "../../src/lib/agent-json";
import { readTicket, signTicket, TICKET_TTL_MS } from "../../src/lib/photo-ticket";
import { crc32 } from "../../src/lib/zip";
import { call, clearD1, PNG_1X1, sampleOrder, seedStore, send, startTestSession } from "../helpers";

/** Turns the assistant on as the owner and returns the MCP path. */
async function connect(): Promise<string> {
  const res = await send("POST", "/api/assistant/token", {}, { cookies: await startTestSession() });
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  expect(url).toMatch(/^http:\/\/tiendita\.test\/mcp\/[A-Za-z0-9_-]{43}$/);
  return new URL(url).pathname;
}

let next = 1;
/** One JSON-RPC call, as an MCP client sends it: from its own server, no Origin, no cookie. */
const rpc = (path: string, method: string, params?: unknown) =>
  call(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: next++, method, ...(params !== undefined ? { params } : {}) }),
  });

/** tools/call → the tool's JSON answer, and whether it's an error. */
async function use(path: string, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(path, "tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  return { isError: body.result.isError === true, value: JSON.parse(body.result.content[0]!.text) };
}

beforeEach(async () => {
  await clearD1();
  await seedStore();
});
afterEach(() => vi.restoreAllMocks());

describe("AI assistant (MCP)", () => {
  it("only the owner turns it on; without the token, or with an old one, everything is 404", async () => {
    expect((await send("POST", "/api/assistant/token")).status).toBe(401);
    expect((await rpc("/mcp/abc", "ping")).status).toBe(404);
    const old = await connect();
    const fresh = await connect();
    expect((await rpc(old, "ping")).status).toBe(404);
    expect((await rpc(fresh, "ping")).status).toBe(200);
    const off = await send("DELETE", "/api/assistant/token", undefined, { cookies: await startTestSession() });
    expect(off.status).toBe(200);
    expect((await rpc(fresh, "ping")).status).toBe(404);
  });

  it("speaks MCP: initialize, notifications, tools/list with JSON Schema, unknown methods", async () => {
    const path = await connect();
    const init = await rpc(path, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    const { result } = (await init.json()) as { result: { protocolVersion: string; instructions: string } };
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.instructions).toContain("major unit");
    const notification = await call(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(notification.status).toBe(202);
    const list = (await (await rpc(path, "tools/list")).json()) as {
      result: { tools: { name: string; inputSchema: { type: string }; annotations: Record<string, boolean> }[] };
    };
    const names = list.result.tools.map((t) => t.name);
    expect(names).toContain("create_product");
    expect(names).not.toContain("update_payment_methods");
    expect(list.result.tools.every((t) => t.inputSchema.type === "object")).toBe(true);
    expect(list.result.tools.find((t) => t.name === "delete_product")?.annotations.destructiveHint).toBe(true);
    const unknown = (await (await rpc(path, "nope")).json()) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32601);
    expect((await call(path)).status).toBe(405);
  });

  it("creates, edits and deletes a product with prices in pesos", async () => {
    const path = await connect();
    const created = await use(path, "create_product", { name: "Alfajor de maicena", price: 1500.5 });
    expect(created.value).not.toHaveProperty("error");
    expect(created.value.price).toEqual({ amount: 1500.5, currency: "ARS" });
    // No photo: a draft (the store only publishes products with a photo).
    expect(created.value.status).toBe("borrador");
    expect(created.value.url).toMatch(/^http:\/\/tiendita\.test\/p\/alfajor-de-maicena$/);
    const stored = await env.DB.prepare("SELECT precio_monto FROM productos").first<{ precio_monto: number }>();
    expect(stored?.precio_monto).toBe(150050);

    const edited = await use(path, "update_product", {
      id: created.value.id,
      name: "Alfajor de maicena x6",
      options: [{ name: "Tamaño", values: [{ label: "Chico", price_delta: 0 }, { label: "Grande", price_delta: 300 }] }],
    });
    expect(edited.isError).toBe(false);
    expect(edited.value.name).toBe("Alfajor de maicena x6");
    expect(edited.value.price.amount).toBe(1500.5);
    expect(edited.value.status).toBe("borrador");
    expect(edited.value.options[0].values[1].price_delta).toBe(300);

    const bad = await use(path, "update_product", { id: created.value.id, price: 10.555 });
    expect(bad.isError).toBe(true);
    expect(bad.value.error).toBe("INVALID_PRICE");
    expect((await use(path, "create_product", { name: "", price: 1 })).value.error).toBe("INVALID_INPUT");

    expect((await use(path, "delete_product", { id: created.value.id })).isError).toBe(false);
    expect((await use(path, "list_products")).value).toEqual([]);
  });

  it("downloads photos from https links and rejects what isn't an image", async () => {
    const path = await connect();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).endsWith(".png")
        ? new Response(PNG_1X1, { headers: { "content-type": "image/png" } })
        : new Response("<html>", { headers: { "content-type": "text/html" } }),
    );
    const withPhoto = await use(path, "create_product", {
      name: "Mate",
      price: 9000,
      image_urls: ["https://example.com/mate.png"],
    });
    expect(withPhoto.isError).toBe(false);
    expect(withPhoto.value.images).toHaveLength(1);
    expect(withPhoto.value.status).toBe("publicado");
    expect(withPhoto.value.images[0].url).toMatch(/^http:\/\/tiendita\.test\/img\//);
    const page = await use(path, "create_product", { name: "Otro", price: 1, image_urls: ["https://example.com/x"] });
    expect(page.value.error).toBe("INVALID_IMAGE");
    expect((await use(path, "create_product", { name: "Http", price: 1, image_urls: ["http://example.com/a.png"] })).value.error).toBe(
      "INVALID_INPUT",
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reads the store and the sales, and moves an order forward", async () => {
    const path = await connect();
    await createD1OrderRepository(env.DB).insert(sampleOrder("p1", "nuevo", "2026-11-09T10:00:00Z"));
    const store = await use(path, "get_store");
    expect(store.value.name).toBe("La tiendita de prueba");
    expect(store.value.open_orders).toBe(1);
    const orders = await use(path, "list_orders", { status: "nuevo" });
    expect(orders.value.count).toBe(1);
    expect(typeof orders.value.orders[0].total.amount).toBe("number");
    const moved = await use(path, "update_order_status", { id: "p1", status: "contactado" });
    expect(moved.value.status).toBe("contactado");
    const renamed = await use(path, "update_store", { tagline: "Tortas caseras" });
    expect(renamed.value).toMatchObject({ name: "La tiendita de prueba", tagline: "Tortas caseras" });
  });

  it("hands out a photo upload link; the owner uploads from it without a session, and it dies with the assistant", async () => {
    const path = await connect();
    const product = await use(path, "create_product", { name: "Torta", price: 20000 });
    const link = await use(path, "get_photo_upload_link", { product_id: product.value.id });
    expect(link.value.for).toBe("Torta");
    expect(link.value.url).toMatch(/^http:\/\/tiendita\.test\/subir-fotos\/[\w-]+\.[\w-]+$/);
    const ticket = new URL(link.value.url).pathname.split("/").pop()!;
    const upload = () => {
      const body = new FormData();
      body.set("image_0", new File([PNG_1X1], "torta.png", { type: "image/png" }));
      return call(`/api/assistant/photos/${ticket}`, { method: "POST", headers: { origin: "http://tiendita.test" }, body });
    };
    const res = await upload();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ uploaded: 1 });
    const after = await use(path, "get_product", { id: product.value.id });
    expect(after.value.images).toHaveLength(1);
    expect((await use(path, "update_product", { id: product.value.id, status: "publicado" })).value.status).toBe("publicado");
    // Another site can't post with the ticket: the store's Origin is required, as for the whole API.
    const body = new FormData();
    body.set("image_0", new File([PNG_1X1], "x.png", { type: "image/png" }));
    const foreign = await call(`/api/assistant/photos/${ticket}`, { method: "POST", headers: { origin: "https://evil.test" }, body });
    expect(foreign.status).toBe(403);
    const fresh = await connect();
    expect((await upload()).status).toBe(410);
    const logo = await use(fresh, "get_photo_upload_link");
    expect(logo.value).toMatchObject({ for: "logo", max_photos: 1 });
  });

  it("changes the settings and loads or removes the sample catalog", async () => {
    const path = await connect();
    const settings = await use(path, "update_settings", { language: "en", advance_orders: true, counted_on_tutiendita: false });
    expect(settings.value).toEqual({ language: "en", advance_orders: true, counted_on_tutiendita: false });
    expect((await use(path, "update_settings", { language: "fr" })).value.error).toBe("INVALID_INPUT");
    const store = await use(path, "get_store");
    expect(store.value.only_in_the_panel).toContain("payment methods");
    const loaded = await use(path, "load_sample_products", { industry: "pasteleria" });
    expect(loaded.value.created).toBeGreaterThan(0);
    expect((await use(path, "list_products")).value.length).toBeGreaterThan(0);
    expect((await use(path, "remove_sample_products")).value.deleted).toBeGreaterThan(0);
    expect((await use(path, "list_products")).value).toEqual([]);
  });

  it("serves the optional skill as a zip with SKILL.md", async () => {
    const res = await call("/mcp/skill.zip");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(0x04034b50);
    expect(new TextDecoder().decode(bytes)).toContain("tutiendita/SKILL.md");
    expect(new TextDecoder().decode(bytes)).toContain("name: tutiendita");
  });
});

describe("agent helpers", () => {
  it("toMinor converts the major unit and refuses extra decimals", () => {
    expect(toMinor(1500.5, "ARS")).toBe(150050);
    expect(toMinor(0.1 + 0.2, "ARS")).toBe(30);
    expect(toMinor(1000, "CLP")).toBe(1000);
    expect(toMinor(10.555, "ARS")).toBeNull();
    expect(toMinor(Number.NaN, "ARS")).toBeNull();
  });

  it("a photo ticket only opens with its token, unchanged and in time", async () => {
    const now = new Date("2026-11-21T10:00:00Z");
    const ticket = await signTicket("secret", { product: "p1" }, now);
    expect(await readTicket("secret", ticket, now)).toEqual({
      target: { product: "p1" },
      expiresAt: new Date(now.getTime() + TICKET_TTL_MS),
    });
    expect((await readTicket("secret", await signTicket("secret", { logo: true }, now), now))?.target).toEqual({ logo: true });
    expect(await readTicket("other", ticket, now)).toBeNull();
    expect(await readTicket("secret", ticket, new Date(now.getTime() + TICKET_TTL_MS))).toBeNull();
    const [body, signature] = ticket.split(".");
    const forged = btoa(JSON.stringify({ p: "p2", e: now.getTime() + TICKET_TTL_MS })).replace(/=+$/, "");
    expect(await readTicket("secret", `${forged}.${signature}`, now)).toBeNull();
    expect(await readTicket("secret", `${body}`, now)).toBeNull();
    expect(await readTicket("secret", "%%%.%%%", now)).toBeNull();
  });

  it("crc32 matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

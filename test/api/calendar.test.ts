import { env } from "cloudflare:workers";
import { createD1OrderRepository } from "../../src/packages/infra-cloudflare/index";
import { beforeEach, describe, expect, it } from "vitest";
import { call, clearD1, sampleOrder, seedStore, send, startTestSession } from "../helpers";

const at = (id: string, when: string, status: "nuevo" | "cancelado" = "nuevo") => ({
  ...sampleOrder(id, status, "2026-11-09T10:00:00Z"),
  scheduled: { for: when, fulfillment: "retiro" as const },
});
const advanceOrders = (on: boolean) =>
  env.DB.prepare(
    "INSERT OR REPLACE INTO configuracion (clave, valor, actualizado_en) VALUES ('pedidos.anticipados', ?, '2026-11-09T10:00:00.000Z')",
  )
    .bind(on ? "1" : "")
    .run();
const soon = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 16);

/** Creates (or changes) the secret link and returns the feed's path. */
async function link(cookies: Record<string, string>): Promise<string> {
  const res = await send("POST", "/api/calendar/token", undefined, { cookies });
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  expect(url).toMatch(/^http:\/\/tiendita\.test\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
  return new URL(url).pathname;
}

beforeEach(async () => {
  await clearD1();
  await seedStore();
});

describe("calendar feed (Google Calendar subscription)", () => {
  it("only the owner creates the link; without one, any token is 404", async () => {
    expect((await send("POST", "/api/calendar/token")).status).toBe(401);
    expect((await call("/api/calendar/abc.ics")).status).toBe(404);
  });

  it("serves the open advance orders as iCalendar, without the cancelled ones or the ones for now", async () => {
    await advanceOrders(true);
    const repo = createD1OrderRepository(env.DB);
    await repo.insert(at("a", soon(2)));
    await repo.insert(at("b", soon(-40)));
    await repo.insert(at("c", soon(3), "cancelado"));
    await repo.insert(sampleOrder("d", "nuevo", "2026-11-09T10:00:00Z"));
    const path = await link(await startTestSession());
    const res = await call(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const ics = await res.text();
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain("UID:a@tiendita.test");
  });

  it("changing the link kills the old one; with advance orders off the feed is empty", async () => {
    await advanceOrders(true);
    await createD1OrderRepository(env.DB).insert(at("a", soon(2)));
    const cookies = await startTestSession();
    const old = await link(cookies);
    const fresh = await link(cookies);
    expect(fresh).not.toBe(old);
    expect((await call(old)).status).toBe(404);
    const tampered = fresh.replace(/(.)\.ics$/, (_, c: string) => `${c === "A" ? "B" : "A"}.ics`);
    expect((await call(tampered)).status).toBe(404);
    await advanceOrders(false);
    const off = await call(fresh);
    expect(off.status).toBe(200);
    expect(await off.text()).not.toContain("BEGIN:VEVENT");
  });
});

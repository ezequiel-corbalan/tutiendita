import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { version } from "../../package.json";
import { clearD1, seedStore } from "../helpers";

/** The heartbeat only goes out over https; the tests' BASE is http. */
const SECURE_BASE = "https://tiendita.test";
const request = (path: string, base = SECURE_BASE) =>
  exports.default.fetch(`${base}${path}`, { redirect: "manual" });

const heartbeatSentAt = async () =>
  (await env.DB.prepare("SELECT latido_en FROM tiendas").first<{ latido_en: string | null }>())?.latido_en ??
  null;

/** The mark is written inside waitUntil, after the response: poll briefly. */
async function until(check: () => Promise<boolean>, tries = 20, everyMs = 50): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(clearD1);

describe("heartbeat from the middleware (REGISTRY_URL is empty in tests: nothing leaves)", () => {
  it("a public page over https marks the heartbeat once a day", async () => {
    await seedStore();
    expect((await request("/")).status).toBe(200);
    expect(await until(async () => (await heartbeatSentAt()) !== null)).toBe(true);
    const first = await heartbeatSentAt();
    expect(first).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    expect((await request("/")).status).toBe(200);
    await sleep(300);
    expect(await heartbeatSentAt()).toBe(first);
  });

  it("the panel also counts as a visit", async () => {
    await seedStore();
    await request("/panel/ingresar");
    expect(await until(async () => (await heartbeatSentAt()) !== null)).toBe(true);
  });

  it("over http nothing is sent", async () => {
    await seedStore();
    expect((await request("/", "http://tiendita.test")).status).toBe(200);
    await sleep(300);
    expect(await heartbeatSentAt()).toBeNull();
  });

  it("a store that opted out never marks", async () => {
    await seedStore();
    await env.DB.prepare("UPDATE tiendas SET latido_activo = 0").run();
    expect((await request("/")).status).toBe(200);
    await sleep(300);
    expect(await heartbeatSentAt()).toBeNull();
  });

  it("without a store (first boot) nothing happens", async () => {
    const res = await request("/");
    expect(res.status).toBe(200);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM tiendas").first<{ n: number }>()).toEqual({
      n: 0,
    });
  });

  it("every page carries the generator meta with the version", async () => {
    await seedStore();
    for (const path of ["/", "/panel/ingresar"]) {
      const html = await (await request(path)).text();
      expect(html, path).toContain(`<meta name="generator" content="tutiendita ${version}"`);
    }
    expect(version).toBe("0.16.0");
  });
});

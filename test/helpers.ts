import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { Order, OrderStatus } from "../src/packages/core/index";

export const BASE = "http://tiendita.test";
export const RP_ID = "tiendita.test";
/** On http outside localhost the cookie carries the __Host- prefix (and Secure): see src/lib/cookies.ts. */
export const SESSION_COOKIE = "__Host-tiendita_sesion";

/** Real 1×1 pixel PNG. */
export const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (ch) => ch.charCodeAt(0),
);

/**
 * Calls the Hono app directly, without Astro, with the pool's emulated bindings. It's imported only here so
 * the "pages" tests (which only use the built Worker) don't load the app's source code.
 */
export async function call(path: string, init?: RequestInit, environment: Env = env): Promise<Response> {
  const ctx = createExecutionContext();
  const { api } = await import("../src/api/app");
  const res = await api.fetch(new Request(`${BASE}${path}`, init), environment, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** Cookies set by a response (name → value; empty if it expired them). */
export function cookiesOf(res: Response): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const i = pair?.indexOf("=") ?? -1;
    if (pair && i > 0) cookies[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return cookies;
}

export const cookieHeader = (cookies: Record<string, string>) =>
  Object.entries(cookies)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

/** POST/PUT/DELETE as the panel would: JSON, with the store's Origin and the given cookies. */
export function send(
  method: string,
  path: string,
  body?: unknown,
  options: { cookies?: Record<string, string>; origin?: string | null; environment?: Env } = {},
): Promise<Response> {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (options.origin !== null) headers.set("origin", options.origin ?? BASE);
  if (options.cookies) headers.set("cookie", cookieHeader(options.cookies));
  return call(
    path,
    { method: method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
    options.environment,
  );
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const NOW = "2026-10-15T10:00:00.000Z";

/** The store already claimed from BASE (access row and main origin), without credentials. Raw SQL: real D1 names. */
export async function seedOwner({ completed = true }: { completed?: boolean } = {}): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO acceso (id, webauthn_user_id, reclamada_en, primer_ingreso_paso, primer_ingreso_completado_en)
       VALUES (1, 'dueno-de-prueba', ?, ?, ?)`,
    ).bind(NOW, completed ? "producto" : "acceso", completed ? NOW : null),
    env.DB.prepare(
      "INSERT OR IGNORE INTO origenes_permitidos (origen, rp_id, principal, agregado_en) VALUES (?, ?, 1, ?)",
    ).bind(BASE, RP_ID, NOW),
  ]);
}

/**
 * How tests write (there's no writing without a session): leaves the store with an owner and a session of the
 * requested type directly in D1, and returns the cookie to send. Session types are the stored literals.
 */
export async function startTestSession(
  type: "completa" | "reclamo" | "recuperacion" = "completa",
  options: { completed?: boolean } = {},
): Promise<Record<string, string>> {
  if (type !== "reclamo") await seedOwner(options);
  const token = `test-token-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO sesiones (id_hash, tipo, creada_en, expira_en, ultimo_uso_en) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      await sha256Hex(token),
      type,
      new Date().toISOString(),
      new Date(Date.now() + 3_600_000).toISOString(),
      new Date().toISOString(),
    )
    .run();
  return { [SESSION_COOKIE]: token };
}

export type CreationFields = {
  name?: string;
  description?: string;
  price_amount?: string;
  price_currency?: string;
  publish?: string;
  status?: string;
  category_id?: string;
  options?: string;
  image?: { bytes: Uint8Array<ArrayBuffer>; type: string; name: string };
  gallery?: string;
  /** Sent as image_0, image_1 …, for `gallery`. */
  files?: { bytes: Uint8Array<ArrayBuffer>; type: string; name: string }[];
};

export function form(fields: CreationFields): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || k === "image" || k === "files") continue;
    fd.set(k, v as string);
  }
  if (fields.image) {
    fd.set("image", new File([fields.image.bytes], fields.image.name, { type: fields.image.type }));
  }
  fields.files?.forEach((f, i) => {
    fd.set(`image_${i}`, new File([f.bytes], f.name, { type: f.type }));
  });
  return fd;
}

export const validCreation = (extra: CreationFields = {}): CreationFields => ({
  name: "Dulce de leche ¡artesanal! 500g",
  description: "Receta de la abuela",
  price_amount: "4500",
  price_currency: "ARS",
  publish: "true",
  image: { bytes: PNG_1X1, type: "image/png", name: "dulce.png" },
  ...extra,
});

/** Headers of an authenticated creation: the store's Origin and a new full session. */
export async function creationHeaders(): Promise<Headers> {
  return new Headers({ origin: BASE, cookie: cookieHeader(await startTestSession()) });
}

export const create = async (fields: CreationFields, environment?: Env) =>
  call(
    "/api/products",
    { method: "POST", body: form(fields), headers: await creationHeaders() },
    environment,
  );

/** The test pool always binds R2 (wrangler.test.jsonc); the app type keeps it optional. */
export const bucket = () => env.IMAGENES as R2Bucket;

export async function clearR2(): Promise<void> {
  const list = await bucket().list();
  for (const o of list.objects) await bucket().delete(o.key);
}

export async function clearD1(): Promise<void> {
  await env.DB.batch(
    [
      "imagenes_producto",
      "imagenes_blob",
      "configuracion",
      "productos",
      "categorias",
      "tiendas",
      "acceso",
      "origenes_permitidos",
      "credenciales_passkey",
      "sesiones",
      "desafios_webauthn",
      "intentos_fallidos",
      "medios_de_pago",
      "conexion_github",
      "pedidos",
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
}

/** A store past onboarding: a tiendas row and completed access. */
export async function seedStore(language: "es" | "en" | "pt" = "es"): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO tiendas (id, nombre, descripcion, moneda, idioma, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind("tienda-test", "La tiendita de prueba", "", "ARS", language, NOW, NOW)
    .run();
  await seedOwner();
}

/** A stored-shape order: buyer "Ana", pays by WhatsApp, one "Torta" for 100 ARS (optionally with a variant). */
export const sampleOrder = (id: string, status: OrderStatus, createdAt: string, variant?: string): Order => ({
  id,
  status,
  createdAt: new Date(createdAt),
  updatedAt: new Date(createdAt),
  note: "",
  createdByAgent: false,
  buyer: { name: "Ana", address: "" },
  paymentMethod: "whatsapp",
  total: { amount: 100, currency: "ARS" },
  items: [
    {
      productId: "p1",
      name: "Torta",
      quantity: 1,
      unitPrice: { amount: 100, currency: "ARS" },
      ...(variant ? { variant } : {}),
    },
  ],
});

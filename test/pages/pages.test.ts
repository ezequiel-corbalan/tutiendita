import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProductJson } from "../../src/lib/product-json";
import {
  BASE,
  type CreationFields,
  clearD1,
  clearR2,
  cookieHeader,
  form,
  PNG_1X1,
  seedOwner,
  seedStore,
  startTestSession,
  validCreation,
} from "../helpers";
import { TEST_CLAIM_CODE } from "../test-code.mjs";

/** Hits the Worker `astro build` produced (Astro + middleware + Hono), not the bare Hono app. */
const request = (path: string, init?: RequestInit) => exports.default.fetch(`${BASE}${path}`, init);

/** Creation through the Worker's API, with a seeded full session (leaves the store with an owner). */
async function seed(fields: CreationFields): Promise<ProductJson> {
  const cookie = cookieHeader(await startTestSession());
  const res = await request("/api/products", {
    method: "POST",
    body: form(fields),
    headers: { origin: BASE, cookie },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as ProductJson;
}

function jsonLd(html: string): Record<string, unknown> {
  const m = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  expect(m, "the page must have a <script type=application/ld+json>").not.toBeNull();
  return JSON.parse(m?.[1] ?? "");
}

beforeEach(async () => {
  await clearD1();
  await clearR2();
});

/** Turns the store back to "unclaimed" without touching products (like the emergency plan). Real D1 table names. */
async function noOwner(): Promise<void> {
  await env.DB.batch(
    ["acceso", "origenes_permitidos", "sesiones"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
  );
}

describe("GET / on first boot (unclaimed store)", () => {
  it("shows 'Tu tiendita está lista' (200) instead of the empty catalog", async () => {
    const res = await request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Tu tiendita está lista");
    // Generic text: the real D1 and R2 names depend on the Worker name.
    expect(html).not.toContain("tiendita-imagenes");
    expect(html).toContain("GitHub o GitLab");
    expect(html).toContain('<meta name="viewport"');
    expect(html).not.toContain("Todavía no hay productos");
    expect(html).not.toContain("application/ld+json");
  });

  it("explains how to claim it: the 'Reclamar mi tienda' button and where the code is", async () => {
    const html = await (await request("/")).text();
    expect(html).toContain("Reclamar mi tienda");
    expect(html).toContain('href="/panel/reclamar"');
    // Today's Cloudflare dashboard: the deployment, then its "Desplegando" stage (no "View build log" any more).
    expect(html).toContain("la etapa <strong>Desplegando</strong>");
    expect(html).toContain("TU TIENDITA: CÓDIGO PARA RECLAMARLA");
    expect(html).not.toContain("registro de compilación");
  });

  it("the claim page explains the same current steps", async () => {
    const html = await (await request("/panel/reclamar")).text();
    expect(html).toContain("la etapa <strong>Desplegando</strong>");
    expect(html).not.toContain("View build log");
  });

  it("even with published products, without an owner it keeps showing the first boot", async () => {
    await seed(validCreation({ name: "Mate de calabaza" }));
    await noOwner();
    const html = await (await request("/")).text();
    expect(html).toContain("Tu tiendita está lista");
    expect(html).not.toContain("Mate de calabaza");
  });
});

describe("GET / with onboarding half done (setting up)", () => {
  it("says the store is being prepared and shows no products", async () => {
    await seed(validCreation({ name: "Mate de calabaza" }));
    await env.DB.prepare(
      "UPDATE acceso SET primer_ingreso_paso = 'whatsapp', primer_ingreso_completado_en = NULL",
    ).run();
    const res = await request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Estamos preparando la tienda");
    expect(html).not.toContain("Mate de calabaza");
    expect(html).not.toContain("Tu tiendita está lista");
  });
});

describe("GET /", () => {
  beforeEach(() => seedStore());

  it("without products it renders empty (200) with an empty ItemList", async () => {
    const res = await request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Todavía no hay productos");
    expect(html).toContain('<meta name="viewport"');
    expect(jsonLd(html)).toMatchObject({ "@type": "ItemList", numberOfItems: 0, itemListElement: [] });
  });

  it("lists the published ones (not drafts) with a JSON-LD ItemList", async () => {
    const published = await seed(validCreation({ name: "Mate de calabaza" }));
    await seed(validCreation({ name: "Bombilla en borrador", publish: "false" }));

    const html = await (await request("/")).text();
    expect(html).toContain("Mate de calabaza");
    expect(html).not.toContain("Bombilla en borrador");
    expect(html).toContain(published.images[0]?.url);
    expect(html).toMatch(/\$\s?45,00/);
    const ld = jsonLd(html);
    expect(ld["@type"]).toBe("ItemList");
    expect(ld.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, url: `${BASE}/p/mate-de-calabaza`, name: "Mate de calabaza" },
    ]);
  });

  it("a card without options adds to the cart with a quantity; one with options links to choose them", async () => {
    const plain = await seed(validCreation({ name: "Empanada de carne" }));
    const options = JSON.stringify([{ name: "Gusto", values: [{ label: "Muzza", price_delta: 0 }] }]);
    await seed(validCreation({ name: "Pizza grande", options }));

    const html = await (await request("/")).text();
    const card = (name: string) => html.split('<li class="product"').slice(1).find((c) => c.includes(name)) ?? "";
    const empanada = card("Empanada de carne");
    expect(empanada).toContain("data-add-to-cart");
    expect(empanada).toContain(`data-product-id="${plain.id}"`);
    expect(empanada).toContain('aria-label="Cantidad de Empanada de carne"');
    const pizza = card("Pizza grande");
    expect(pizza).not.toContain("data-add-to-cart");
    expect(pizza).toMatch(/<a class="button secondary[^"]*" href="\/p\/pizza-grande"[^>]*>Elegir<\/a>/);
  });
});

describe("catalog with categories (sample products)", () => {
  async function loadSamples(industry: string): Promise<void> {
    const cookie = cookieHeader(await startTestSession());
    const res = await request("/api/samples", {
      method: "POST",
      body: JSON.stringify({ industry }),
      headers: { origin: BASE, cookie, "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
  }

  beforeEach(() => seedStore());

  it("without categories the home page shows no category navigation", async () => {
    await seed(validCreation({ name: "Mate de calabaza" }));
    const html = await (await request("/")).text();
    expect(html).not.toContain("<nav");
    expect(html).toContain("Mate de calabaza");
  });

  it("the home page shows the categories with their URL and the products with their photos served by /img", async () => {
    await loadSamples("pasteleria");
    const html = await (await request("/")).text();
    expect(html).toContain('<nav class="categories" aria-label="Categorías" data-categories>');
    for (const slug of ["tortas", "facturas-y-medialunas", "alfajores-y-galletitas"]) {
      expect(html).toContain(`href="/c/${slug}"`);
    }
    expect(html).toContain("Torta de chocolate");
    expect(html).toContain("Medialunas de manteca (docena)");
    // Tiles (one photo per category), "Novedades" and one section per category: every photo comes from /img.
    const urls = [...html.matchAll(/<img class="[^"]+" src="(\/img\/[^"]+\.webp)"/g)].map((m) => m[1] ?? "");
    expect(urls.length).toBeGreaterThanOrEqual(6);
    const img = await request(urls[0] ?? "");
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/webp");
    expect(new TextDecoder().decode(new Uint8Array(await img.arrayBuffer()).slice(8, 12))).toBe("WEBP");
  });

  it("with categories the home page has sections: Novedades, then each category with its 'Ver todo' link", async () => {
    await loadSamples("pasteleria");
    const html = await (await request("/")).text();
    expect(html).toContain('<h2 class="shelf__title" id="shelf-0">Novedades</h2>');
    // The biggest category comes first: "Tortas" has three products.
    expect(html).toContain('<h2 class="shelf__title" id="shelf-1">Tortas</h2>');
    expect(html).toMatch(/<a class="shelf__all" href="\/c\/tortas">\s*Ver todo/);
    // The tile grid replaces the chips: every category has a photo tile.
    expect(html.match(/<span class="categories__photo"><img class="categories__img" /g)).toHaveLength(3);
  });

  it("'Cómo comprar' lists only the configured channels; the footer links the store's WhatsApp", async () => {
    await seed(validCreation({ name: "Mate de calabaza" }));
    let html = await (await request("/")).text();
    expect(html).not.toContain("Cómo comprar");
    expect(html).not.toContain("wa.me");
    const cookie = cookieHeader(await startTestSession());
    const res = await request("/api/payment-methods/whatsapp", {
      method: "PUT",
      body: JSON.stringify({ number: "11 2345-6789" }),
      headers: { origin: BASE, cookie, "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    html = await (await request("/")).text();
    expect(html).toContain("Cómo comprar");
    expect(html).toContain("Pedís por WhatsApp");
    expect(html).not.toContain("Pagás por transferencia");
    expect(html).toContain('href="https://wa.me/5491123456789"');
  });

  it("a category page keeps one plain grid, without sections", async () => {
    await loadSamples("pasteleria");
    const html = await (await request("/c/tortas")).text();
    expect(html).not.toContain("Novedades");
    expect(html).not.toContain("shelf__all");
  });

  it("/c/<slug> filters the catalog by the category and marks it as current", async () => {
    await loadSamples("pasteleria");
    const res = await request("/c/tortas");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h2>Tortas</h2>");
    expect(html).toContain('<a class="categories__link" href="/c/tortas" aria-current="page">');
    expect(html).toContain("Lemon pie");
    expect(html).not.toContain("Medialunas de manteca");
    expect(jsonLd(html)).toMatchObject({ "@type": "ItemList", numberOfItems: 3 });
  });

  it("/c/<slug> of a missing category → 404 with a page", async () => {
    await loadSamples("pasteleria");
    const res = await request("/c/no-existe");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Categoría no encontrada");
  });

  it("in the store's language when loading them", async () => {
    await env.DB.prepare("UPDATE tiendas SET idioma = 'en'").run();
    await loadSamples("ropa");
    const html = await (await request("/c/outerwear")).text();
    expect(html).toContain("Denim jacket");
    expect(html).toContain('<nav class="categories" aria-label="Categories" data-categories>');
  });
});

describe("the store in the chosen language", () => {
  it("Spanish by default: <html lang=es>", async () => {
    await seedStore();
    expect(await (await request("/")).text()).toContain('<html lang="es"');
  });

  it.each([
    ["en", 'lang="en"', "No products yet.", "Page not found", "Product not found"],
    ["pt", 'lang="pt-BR"', "Ainda não há produtos.", "Página não encontrada", "Produto não encontrado"],
  ] as const)(
    "in %s: home, 404 and missing product without Spanish leftovers",
    async (language, lang, empty, notFound, noProduct) => {
      await seedStore(language);
      const hero = await (await request("/")).text();
      expect(hero).toContain(`<html ${lang}`);
      expect(hero).toContain(empty);
      expect(hero).not.toContain("Todavía no hay productos");

      const page404 = await request("/does-not-exist");
      expect(page404.status).toBe(404);
      const html404 = await page404.text();
      expect(html404).toContain(notFound);
      expect(html404).not.toContain("Volver a la tiendita");

      const product = await (await request("/p/does-not-exist")).text();
      expect(product).toContain(noProduct);
      expect(product).not.toContain("No existe un producto");
    },
  );

  it("prices use the language format with the store currency", async () => {
    await seedStore("en");
    const p = await seed(validCreation({ name: "Mate", price_amount: "450050" }));
    expect(await (await request("/")).text()).toMatch(/ARS\s4,500\.50/);
    expect(await (await request(`/p/${p.slug}`)).text()).toMatch(/ARS\s4,500\.50/);
  });
});

describe("GET /p/:slug", () => {
  it("page of a published one (200) with JSON-LD Product and Offer", async () => {
    const p = await seed(validCreation({ name: "Mate de calabaza", description: "Curado a mano" }));
    const res = await request(`/p/${p.slug}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Mate de calabaza</h1>");
    expect(html).toContain("Curado a mano");
    expect(jsonLd(html)).toMatchObject({
      "@type": "Product",
      name: "Mate de calabaza",
      image: [`${BASE}${p.images[0]?.url}`],
      offers: {
        "@type": "Offer",
        price: "45.00",
        priceCurrency: "ARS",
        availability: "https://schema.org/InStock",
      },
    });
  });

  it("breadcrumb with the category; 'También te puede gustar' lists its siblings first and never itself", async () => {
    const cookie = cookieHeader(await startTestSession());
    const res = await request("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name: "Tortas" }),
      headers: { origin: BASE, cookie, "content-type": "application/json" },
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const loose = await seed(validCreation({ name: "Mate de calabaza" }));
    const a = await seed(validCreation({ name: "Torta de chocolate", category_id: id }));
    const b = await seed(validCreation({ name: "Torta de limón", category_id: id }));
    const html = await (await request(`/p/${a.slug}`)).text();
    expect(html).toContain('<nav class="breadcrumb" aria-label="Navegación">');
    expect(html).toContain('href="/c/tortas"');
    expect(html).toContain('<p class="label">Tortas</p>');
    expect(html).not.toContain("Volver a la tiendita");
    const related =
      html.match(/<section class="shelf" aria-labelledby="related">(.*?)<\/section>/s)?.[1] ?? "";
    expect(related).toContain("También te puede gustar");
    expect(related).toContain(`href="/p/${b.slug}"`);
    // Fewer than four siblings: the newest other products fill the section, after them.
    expect(related).toContain(`href="/p/${loose.slug}"`);
    expect(related.indexOf(b.slug)).toBeLessThan(related.indexOf(loose.slug));
    expect(related).not.toContain(`href="/p/${a.slug}"`);
    // Without a category: no category crumb nor label, and the rest of the store as related.
    const other = await (await request(`/p/${loose.slug}`)).text();
    expect(other).not.toContain('href="/c/');
    expect(other).not.toContain('class="label"');
    expect(other).toContain(`href="/p/${a.slug}"`);
  });

  it("alone in the store there's nothing related; 'Consultar por WhatsApp' and 'Cómo comprar' need the WhatsApp method", async () => {
    // The WhatsApp number is normalized with the store's country: the store row must exist.
    await seedStore();
    const p = await seed(validCreation({ name: "Mate de calabaza" }));
    let html = await (await request(`/p/${p.slug}`)).text();
    expect(html).not.toContain("También te puede gustar");
    expect(html).not.toContain("Consultar por WhatsApp");
    expect(html).not.toContain("Cómo comprar");
    const cookie = cookieHeader(await startTestSession());
    const res = await request("/api/payment-methods/whatsapp", {
      method: "PUT",
      body: JSON.stringify({ number: "11 2345-6789" }),
      headers: { origin: BASE, cookie, "content-type": "application/json" },
    });
    expect(res.status).toBe(200);
    html = await (await request(`/p/${p.slug}`)).text();
    expect(html).toContain("Consultar por WhatsApp");
    const message = encodeURIComponent(`Hola, quiero consultar por Mate de calabaza: ${BASE}/p/${p.slug}`);
    expect(html).toContain(`href="https://wa.me/5491123456789?text=${message}"`);
    expect(html).toContain("Cómo comprar");
    expect(html).toContain("Pedís por WhatsApp");
  });

  it("unknown slug → 404 with a page", async () => {
    const res = await request("/p/does-not-exist");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Producto no encontrado");
  });

  it("draft product → 404 with a page", async () => {
    const draft = await seed(validCreation({ publish: "false" }));
    const res = await request(`/p/${draft.slug}`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Producto no encontrado");
    expect(html).not.toContain("application/ld+json");
  });

  it("a name with </script> doesn't break the JSON-LD or inject HTML", async () => {
    const p = await seed(validCreation({ name: "Oferta </script><b>x" }));
    const html = await (await request(`/p/${p.slug}`)).text();
    // The JSON-LD is cut at the first </script>: if it parses whole, the name didn't close the tag.
    expect(html).toContain("<h1>Oferta &lt;/script&gt;&lt;b&gt;x</h1>");
    expect(jsonLd(html).name).toBe("Oferta </script><b>x");
  });
});

describe("search engines", () => {
  it("before it's claimed: the first boot is noindex and the sitemap is empty", async () => {
    const html = await (await request("/")).text();
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('rel="canonical"');
    const sitemap = await (await request("/sitemap.xml")).text();
    expect(sitemap).toContain("<urlset");
    expect(sitemap).not.toContain("<loc>");
  });

  it("robots.txt keeps the panel, cart and API out and points to the sitemap", async () => {
    const res = await request("/robots.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    for (const path of ["/panel", "/carrito", "/api/"])
      expect(text).toContain(`Disallow: ${path}
`);
    expect(text).not.toContain("/img");
    expect(text).toContain(`Sitemap: ${BASE}/sitemap.xml`);
  });

  describe("a ready store", () => {
    beforeEach(() => seedStore());

    it("the sitemap lists the home page, the categories and the published products, not the drafts", async () => {
      const samples = await request("/api/samples", {
        method: "POST",
        body: JSON.stringify({ industry: "pasteleria" }),
        headers: {
          origin: BASE,
          cookie: cookieHeader(await startTestSession()),
          "content-type": "application/json",
        },
      });
      expect(samples.status).toBe(200);
      const p = await seed(validCreation({ name: "Mate de calabaza" }));
      await seed(validCreation({ name: "Bombilla en borrador", publish: "false" }));
      const res = await request("/sitemap.xml");
      expect(res.headers.get("content-type")).toContain("application/xml");
      const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      expect(locs[0]).toBe(`${BASE}/`);
      expect(locs).toContain(`${BASE}/p/${p.slug}`);
      expect(locs).toContain(`${BASE}/c/tortas`);
      expect(locs.some((u) => u?.includes("bombilla"))).toBe(false);
    });

    it("a product page has its canonical (without the query), Open Graph with its photo and a one-line description", async () => {
      const p = await seed(
        validCreation({
          name: "Mate de calabaza",
          description: `Curado a mano.

${"Muy lindo. ".repeat(30)}`,
        }),
      );
      const html = await (await request(`/p/${p.slug}?utm_source=instagram`)).text();
      expect(html).toContain(`<link rel="canonical" href="${BASE}/p/${p.slug}">`);
      expect(html).toContain(`<meta property="og:image" content="${BASE}${p.images[0]?.url}">`);
      expect(html).toContain('<meta property="og:title" content="Mate de calabaza · ');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(html).not.toContain('content="noindex"');
      const description = html.match(/<meta name="description" content="([^"]*)">/)?.[1] ?? "";
      expect(description.startsWith("Curado a mano. Muy lindo.")).toBe(true);
      expect(description.length).toBeLessThanOrEqual(160);
      expect(description.endsWith("…")).toBe(true);
    });

    it("once the store's own domain answers, public pages move there (301) and the panel stays", async () => {
      await env.DB.prepare("UPDATE tiendas SET dominio = 'tienda.ejemplo.com'").run();
      const page = await request("/p/mate?utm_source=ig", { redirect: "manual" });
      expect(page.status).toBe(301);
      expect(page.headers.get("location")).toBe("https://tienda.ejemplo.com/p/mate?utm_source=ig");
      expect((await request("/sitemap.xml", { redirect: "manual" })).status).toBe(301);
      expect((await request("/panel/ingresar", { redirect: "manual" })).status).not.toBe(301);
      expect((await request("/.well-known/webauthn", { redirect: "manual" })).status).toBe(200);
    });

    it("the cart is noindex and the footer links back to tutiendita.ar", async () => {
      const cart = await (await request("/carrito")).text();
      expect(cart).toContain('<meta name="robots" content="noindex">');
      expect(cart).toContain('<a href="https://tutiendita.ar/">tutiendita</a>');
    });
  });
});

describe("the Astro middleware delegates to Hono", () => {
  it("/api/products answers Hono JSON", async () => {
    const p = await seed(validCreation());
    const res = await request("/api/products");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(((await res.json()) as ProductJson[]).map((x) => x.slug)).toEqual([p.slug]);
  });

  it("/img/:key serves the bytes from R2", async () => {
    const p = await seed(validCreation());
    const res = await request(p.images[0]?.url ?? "");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_1X1);
  });

  it.each(["/img/..%2Fx", "/feed", "/.well-known/something", "/mcp"])(
    "%s is answered by Hono (404 JSON), not Astro",
    async (path) => {
      const res = await request(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
    },
  );

  it("an unknown route outside the Hono prefixes is answered by Astro with its 404 page", async () => {
    const res = await request("/this-page-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Página no encontrada");
  });
});

describe("production build configuration", () => {
  // Vite resolves import.meta.glob when bundling the test: if the build doesn't exist, it's empty and fails.
  const generated = import.meta.glob<{ vars?: Record<string, string> }>("../../dist/server/wrangler.json", {
    eager: true,
    import: "default",
  });

  it("dist/server/wrangler.json without vars or extra environments (no secrets to load)", () => {
    const config = Object.values(generated)[0];
    expect(config, "dist/server/wrangler.json is missing: run astro build first").toBeDefined();
    expect(config?.vars ?? {}).toEqual({});
  });

  const client = import.meta.glob<string>("../../dist/client/**/*.{js,mjs,css,html,json,txt}", {
    eager: true,
    query: "?raw",
    import: "default",
  });
  const server = import.meta.glob<string>("../../dist/server/**/*.{js,mjs}", {
    eager: true,
    query: "?raw",
    import: "default",
  });
  const codeHash = async () => {
    const normalized = TEST_CLAIM_CODE.replaceAll("-", "");
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  it("the claim code hash is in the Worker and never in dist/client; the plain code, in neither", async () => {
    const hash = await codeHash();
    expect(Object.keys(client).length, "dist/client should have the panel scripts").toBeGreaterThan(0);
    expect(
      Object.entries(client)
        .filter(([, t]) => t.includes(hash))
        .map(([r]) => r),
    ).toEqual([]);
    expect(Object.values(server).some((t) => t.includes(hash))).toBe(true);
    const code = TEST_CLAIM_CODE.replaceAll("-", "");
    const withCode = [...Object.entries(client), ...Object.entries(server)].filter(([, t]) =>
      t.includes(code),
    );
    expect(withCode.map(([r]) => r)).toEqual([]);
  });
});

describe("titles' font", () => {
  it("the store marks <html data-store> and preloads the self-hosted font; the panel does neither", async () => {
    await seedStore();
    const home = await (await request("/")).text();
    expect(home).toContain('<html lang="es" data-store>');
    expect(home).toContain('href="/fonts/bricolage-grotesque-700-latin.woff2"');
    const font = await env.ASSETS.fetch(`${BASE}/fonts/bricolage-grotesque-700-latin.woff2`);
    expect(font.status).toBe(200);
    const panel = await (await request("/panel/reclamar")).text();
    expect(panel).not.toContain("data-store");
    expect(panel).not.toContain("/fonts/");
  });
});

describe("stylesheet (tutiendita.ar design kit)", () => {
  it.each([
    ["the home page", "/", seedStore],
    ["the panel", "/panel/reclamar", async () => undefined],
  ])("%s loads the sheet with the site tokens", async (_, path, prepare) => {
    await prepare();
    const res = await request(path);
    expect(res.status).toBe(200);
    const href = (await res.text()).match(/<link rel="stylesheet" href="(\/_astro\/[^"]+\.css)"/)?.[1];
    expect(href, `${path} should link a /_astro sheet`).toBeDefined();
    // Static files are served by the ASSETS binding (dist/client), like on Cloudflare.
    const leaf = await env.ASSETS.fetch(`${BASE}${href}`);
    expect(leaf.status).toBe(200);
    expect(await leaf.text()).toMatch(/--brand:\s*#1d6b47/);
  });
});

describe("claim against the built Worker", () => {
  it("the code pinned in the build claims the store (printed and embedded match)", async () => {
    const res = await request("/api/access/claim", {
      method: "POST",
      headers: { origin: BASE, "content-type": "application/json" },
      body: JSON.stringify({ code: TEST_CLAIM_CODE }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/__Host-tiendita_sesion=/);
  });

  it("with an owner, POST /api/products without a session → 401", async () => {
    await seedOwner();
    const res = await request("/api/products", {
      method: "POST",
      body: form(validCreation()),
      headers: { origin: BASE },
    });
    expect(res.status).toBe(401);
  });
});

describe("cart", () => {
  beforeEach(() => seedStore());

  it("a product with variants: a fieldset per variant with a pill per value, 'Desde' price, multi-paragraph description", async () => {
    const options = JSON.stringify([
      {
        name: "Tamaño",
        values: [
          { label: "Chica", price_delta: -100000 },
          { label: "Grande", price_delta: 200000 },
        ],
      },
    ]);
    const { slug } = await seed(
      validCreation({
        name: "Maceta",
        price_amount: "1500000",
        options,
        description: "Terracota.\n\nCon drenaje.",
      }),
    );
    const html = await (await request(`/p/${slug}`)).text();
    expect(html).toContain("data-variants");
    expect(html).toContain('<legend class="variant-picker__legend">Tamaño</legend>');
    expect(html.match(/<input class="pill__input" type="radio" name="option-[^"]+"/g)).toHaveLength(2);
    expect(html).toContain('data-delta="200000"');
    expect(html).toMatch(/Grande \(\+ \$\s?2\.000,00\)/);
    expect(html).toMatch(/Desde \$\s?14\.000,00/);
    expect(html).toContain('class="description"');
    const ld = jsonLd(html) as { offers: Record<string, unknown> };
    expect(ld.offers).toMatchObject({
      "@type": "AggregateOffer",
      lowPrice: "14000.00",
      highPrice: "17000.00",
    });
    const home = await (await request("/")).text();
    expect(home).toMatch(/Desde<\/span>\s*\$\s?14\.000,00/);
  });

  describe("product gallery (PRO)", () => {
    const photo = (name: string) => ({ bytes: PNG_1X1, type: "image/png", name });
    const { image: _single, ...noImage } = validCreation();
    const color = JSON.stringify([
      {
        name: "Color",
        values: [
          { label: "Rojo", price_delta: 0, image_ref: { upload: 1 } },
          { label: "Azul", price_delta: 0 },
        ],
      },
    ]);

    it("three photos: a main image, three labelled thumbnails and the red photo on its option", async () => {
      const p = await seed({
        ...noImage,
        gallery: JSON.stringify([{ upload: 0 }, { upload: 1 }, { upload: 2 }]),
        files: [photo("a.png"), photo("b.png"), photo("c.png")],
        options: color,
      });
      const html = await (await request(`/p/${p.slug}`)).text();
      expect(html).toContain("data-gallery-main");
      for (const n of [1, 2, 3]) expect(html).toContain(`aria-label="Ver foto ${n} de 3"`);
      expect(html).toContain('aria-current="true"');
      const fallback = html.match(/<noscript>(.*?)<\/noscript>/s)?.[1] ?? "";
      expect(fallback.match(/<img /g)).toHaveLength(2);
      expect(fallback).toContain(`src="${p.images[1]?.url}"`);
      expect(fallback).toContain(`src="${p.images[2]?.url}"`);
      expect(fallback.match(new RegExp(`alt="${p.name}"`, "g"))).toHaveLength(2);
      expect(html).toContain(`data-image="${p.images[1]?.url}"`);
      // The home card carries the second photo (shown on hover), decorative.
      const home = await (await request("/")).text();
      expect(home).toContain(`<img class="product__img product__img--alt" src="${p.images[1]?.url}" alt=""`);
    });

    it("one photo: no thumbnails, no second photo on the card", async () => {
      const p = await seed(validCreation());
      const html = await (await request(`/p/${p.slug}`)).text();
      expect(html).toContain("data-gallery-main");
      expect(html).not.toContain("Ver foto");
      expect(await (await request("/")).text()).not.toContain("product__img--alt");
    });
  });

  it("the product page offers Add to cart and the header links to the cart", async () => {
    const { slug } = await seed(validCreation({ name: "Torta de chocolate" }));
    const html = await (await request(`/p/${slug}`)).text();
    expect(html).toContain("data-add-to-cart");
    expect(html).toContain("Agregar al carrito");
    expect(html).toContain('href="/carrito"');
  });

  it("the cart page carries the WhatsApp number and shows the transfer data and the receipt notice", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO medios_de_pago (tipo, activo, configuracion, actualizado_en) VALUES ('whatsapp', 1, ?, '2026-10-15T12:00:00.000Z')",
      ).bind(JSON.stringify({ numero: "+5491122334455", plantilla: "¡Hola! Quiero hacer este pedido:" })),
      env.DB.prepare(
        "INSERT INTO medios_de_pago (tipo, activo, configuracion, actualizado_en) VALUES ('transferencia', 1, ?, '2026-10-15T12:00:00.000Z')",
      ).bind(JSON.stringify({ tipoDeCuenta: "alias", cuenta: "torta.rica.mp", titular: "Ana Pérez" })),
    ]);
    const html = await (await request("/carrito")).text();
    expect(html).toContain('data-whatsapp="5491122334455"');
    expect(html).toContain("torta.rica.mp");
    expect(html).toContain("Ana Pérez");
    expect(html).toContain("mandá la foto del comprobante");
    expect(html).toContain('value="transfer"');
  });

  it("the cart's script posts the order to /api/orders with keepalive when the buyer sends it", async () => {
    const html = await (await request("/carrito")).text();
    const src = html.match(/<script type="module" src="([^"]*carrito[^"]*)"/)?.[1];
    const js = src ? await (await request(src)).text() : html;
    // The bundler may rewrite the quotes around the URL.
    expect(js).toMatch(/["'`]\/api\/orders["'`]/);
    expect(js).toContain("keepalive");
  });

  it("without WhatsApp configured the cart says it can't take orders", async () => {
    const html = await (await request("/carrito")).text();
    expect(html).toContain("todavía no configuró su WhatsApp");
  });
});

describe("store identity on the public pages", () => {
  beforeEach(() => seedStore());

  /** PUT /api/store/identity through the Worker, as the panel's Configuración form does. */
  async function setIdentity(fields: Record<string, string>, logo = true): Promise<string | null> {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    if (logo) body.set("logo", new File([PNG_1X1], "logo.png", { type: "image/png" }));
    const res = await request("/api/store/identity", {
      method: "PUT",
      body,
      headers: { origin: BASE, cookie: cookieHeader(await startTestSession()) },
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { logoUrl: string | null }).logoUrl;
  }

  it("shows the logo before the name, the tagline, and the chosen brand colour inline", async () => {
    const logoUrl = await setIdentity({
      name: "La Espiga",
      description: "Tortas caseras en Villa Crespo",
      color: "azul",
    });
    const html = await (await request("/")).text();
    expect(html).toContain(`<img class="store-bar__logo" src="${logoUrl}" alt="" width="40" height="40">`);
    // The logo is also the tab icon and, on the home page, the share image.
    expect(html).toContain(`<link rel="icon" href="${BASE}${logoUrl}">`);
    expect(html).toContain(`<meta property="og:image" content="${BASE}${logoUrl}">`);
    expect(html).toContain("Tortas caseras en Villa Crespo");
    expect(html).toContain("<style>body{--brand:#1e4f8a;--brand-text:#ffffff;--brand-soft:#e1ebf7}");
    expect(html).toContain("@media (prefers-color-scheme: dark){body{--brand:#8ab4f8;");
  });

  it("with the default colour and no logo the page has no inline brand style nor logo", async () => {
    await setIdentity({ name: "La Espiga", description: "", color: "verde" }, false);
    const html = await (await request("/")).text();
    expect(html).not.toContain("--brand:#");
    expect(html).not.toContain("store-bar__logo");
    expect(html).not.toContain('rel="icon"');
    expect(html).not.toContain("og:image");
  });
});

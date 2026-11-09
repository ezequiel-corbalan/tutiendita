import { env, exports } from "cloudflare:workers";
import { createD1OrderRepository } from "../../src/packages/infra-cloudflare/index";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BASE,
  type CreationFields,
  clearD1,
  cookieHeader,
  form,
  PNG_1X1,
  sampleOrder,
  seedOwner,
  seedStore,
  startTestSession,
  validCreation,
} from "../helpers";

/** Panel pages against the `astro build` Worker (Astro middleware included). Expected texts are Spanish UI. */
const request = (path: string, cookies?: Record<string, string>, init: RequestInit = {}) =>
  exports.default.fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...init,
    headers: {
      ...(cookies ? { cookie: cookieHeader(cookies) } : {}),
      ...(init.headers as Record<string, string>),
    },
  });

async function expectRedirect(path: string, target: string, cookies?: Record<string, string>) {
  const res = await request(path, cookies);
  expect(res.status, `${path} should redirect`).toBe(303);
  expect(new URL(res.headers.get("location") ?? "", BASE).pathname).toBe(target);
}

async function waitForPage(path: string, text: string, cookies?: Record<string, string>) {
  const res = await request(path, cookies);
  expect(res.status, `${path} should be shown`).toBe(200);
  const html = await res.text();
  expect(html).toContain(text);
  return { res, html };
}

const savedStep = (step: string) =>
  env.DB.prepare("UPDATE acceso SET primer_ingreso_paso = ?, primer_ingreso_completado_en = NULL")
    .bind(step)
    .run();

beforeEach(clearD1);

describe("unclaimed", () => {
  it("the whole panel leads to /panel/reclamar, which explains where the code is", async () => {
    await expectRedirect("/panel", "/panel/reclamar");
    await expectRedirect("/panel/ingresar", "/panel/reclamar");
    const { html } = await waitForPage("/panel/reclamar", "TU TIENDITA: CÓDIGO PARA RECLAMARLA");
    expect(html).toContain("Workers y Pages");
    expect(html).toContain('autocomplete="off"');
  });

  it("with the claim session it moves on to creating the passkey (step 1 of 5)", async () => {
    const claim = await startTestSession("reclamo");
    await expectRedirect("/panel", "/panel/primer-ingreso/acceso", claim);
    const { html } = await waitForPage("/panel/primer-ingreso/acceso", "Paso 1 de 5", claim);
    expect(html).toContain("No hay contraseña");
    expect(html).toContain("volver a desplegar la tienda");
  });
});

describe("setting-up", () => {
  it("no session → /panel/ingresar with 'Entrar con passkey' and the recovery link", async () => {
    await seedOwner({ completed: false });
    await expectRedirect("/panel", "/panel/ingresar");
    const { html } = await waitForPage("/panel/ingresar", "Entrar con passkey");
    expect(html).toContain('href="/panel/recuperar"');
    expect(html).toContain('autocomplete="username webauthn"');
    const recover = await waitForPage("/panel/recuperar", "código de recuperación");
    // Without WebAuthn the code isn't sent: a notice is shown first (the page script shows it).
    expect(recover.html).toContain("data-unsupported");
  });

  it("with a full session it resumes the saved step and allows going back", async () => {
    const session = await startTestSession("completa", { completed: false });
    await savedStep("whatsapp");
    await expectRedirect("/panel", "/panel/primer-ingreso/whatsapp", session);
    await expectRedirect("/panel/primer-ingreso/producto", "/panel/primer-ingreso/whatsapp", session);
    await waitForPage("/panel/primer-ingreso/whatsapp", "Paso 3 de 5", session);
    await waitForPage("/panel/primer-ingreso/nombre", "Paso 2 de 5", session);
  });

  it("WhatsApp has a country dropdown with its code, Argentina by default in Spanish", async () => {
    const session = await startTestSession("completa", { completed: false });
    await savedStep("whatsapp");
    const { html } = await waitForPage("/panel/primer-ingreso/whatsapp", "Paso 3 de 5", session);
    expect(html).toContain('<select id="country" name="country"');
    expect(html).toMatch(/<option value="AR" selected[^>]*>Argentina \(\+54\)<\/option>/);
    expect(html).toContain("(+598)");
  });

  it.each([
    ["nombre", "Paso 2 de 5", "Panadería La Espiga"],
    ["whatsapp", "Paso 3 de 5", "WhatsApp"],
    ["transferencia", "Paso 4 de 5", "Ahora no"],
    ["producto", "Paso 5 de 5", "Lo cargo después"],
  ])("screen %s is shown with its text", async (step, number, text) => {
    const session = await startTestSession("completa", { completed: false });
    await savedStep(step);
    const { html } = await waitForPage(`/panel/primer-ingreso/${step}`, number, session);
    expect(html).toContain(text);
  });

  it("the product step offers loading sample products by industry, bakery first", async () => {
    const session = await startTestSession("completa", { completed: false });
    await savedStep("producto");
    const { html } = await waitForPage(
      "/panel/primer-ingreso/producto",
      "Cargar productos de ejemplo",
      session,
    );
    expect(html).toMatch(
      /<select id="industry" name="industry"[^>]*><option value="pasteleria"[^>]*>Pastelería<\/option>/,
    );
    expect(html).toContain('value="artesanias"');
    expect(html).not.toContain("data-delete-samples");
  });
});

describe("ready", () => {
  it("Products offers loading sample products and deleting them all", async () => {
    await seedStore();
    const { html } = await waitForPage(
      "/panel/productos",
      "Cargar productos de ejemplo",
      await startTestSession(),
    );
    expect(html).toContain("Borrar los productos de ejemplo");
    expect(html).toContain('<option value="ropa"');
  });

  it("with a full session it shows the panel home; onboarding and sign-in go back to /panel", async () => {
    await seedStore();
    const session = await startTestSession();
    const { html } = await waitForPage("/panel", "Tu tienda está vendiendo", session);
    expect(html).toContain("Todavía no cargaste productos");
    await expectRedirect("/panel/primer-ingreso/nombre", "/panel", session);
    await expectRedirect("/panel/ingresar", "/panel", session);
  });

  it("the Access page lists the passkeys and offers a new recovery code", async () => {
    const session = await startTestSession();
    await env.DB.prepare(
      `INSERT INTO credenciales_passkey (id, clave_publica, contador, transportes, rp_id, origen, tipo_dispositivo, respaldada, nombre, creada_en)
       VALUES ('cred-1', X'0102', 0, '[]', 'tiendita.test', ?, 'multiDevice', 1, 'iPhone de Ana', '2026-10-15T10:00:00.000Z')`,
    )
      .bind(BASE)
      .run();
    const { html } = await waitForPage("/panel/acceso", "iPhone de Ana", session);
    expect(html).toContain("Agregar passkey");
    expect(html).toContain("Generar un código de recuperación nuevo");
  });

  it("no session → /panel/ingresar", async () => {
    await seedStore();
    await expectRedirect("/panel", "/panel/ingresar");
    await expectRedirect("/panel/acceso", "/panel/ingresar");
    await expectRedirect("/panel/productos", "/panel/ingresar");
  });
});

/** Creation through the Worker's API with a full session; returns the slug. */
async function seedProduct(fields: CreationFields): Promise<string> {
  const res = await request("/api/products", await startTestSession(), {
    method: "POST",
    body: form(fields),
    headers: { origin: BASE },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { slug: string }).slug;
}

describe("products", () => {
  it("the panel home links to Products, which says so kindly when there are none", async () => {
    await seedStore();
    const session = await startTestSession();
    const home = await waitForPage("/panel", "Tu tienda está vendiendo", session);
    expect(home.html).toContain('href="/panel/productos"');
    const { html } = await waitForPage("/panel/productos", "Todavía no cargaste productos", session);
    expect(html).not.toContain("<table");
  });

  it("lists published and drafts with photo, price and status; only the published one links to its page", async () => {
    await seedStore();
    const published = await seedProduct(validCreation({ name: "Mate de calabaza", price_amount: "450050" }));
    // No photo: the draft doesn't need one.
    const draft = await seedProduct({
      name: "Bombilla en borrador",
      price_amount: "1200",
      price_currency: "ARS",
      publish: "false",
    });
    const { html } = await waitForPage("/panel/productos", "Mate de calabaza", await startTestSession());
    expect(html).toContain("Bombilla en borrador");
    expect(html).toContain(`href="/p/${published}"`);
    expect(html).not.toContain(`href="/p/${draft}"`);
    expect(html).toContain("4.500,50");
    expect(html).toContain("Publicado");
    expect(html).toContain("Borrador");
    expect(html).toMatch(/<img src="\/img\/[^"]+" alt=""/);
    expect(html).not.toContain("Todavía no cargaste");
  });

  it("with onboarding half done, Products leads to the saved step", async () => {
    const session = await startTestSession("completa", { completed: false });
    await savedStep("nombre");
    await expectRedirect("/panel/productos", "/panel/primer-ingreso/nombre", session);
  });

  it.each([
    ["en", "Products", ["Draft", "Price", "Status"], "added any products yet"],
    ["pt", "Produtos", ["Rascunho", "Preço", "Status"], "Você ainda não cadastrou produtos"],
  ] as const)(
    "in %s the list and the empty state show no Spanish sentences",
    async (language, title, sentences, empty) => {
      await seedStore(language);
      const session = await startTestSession();
      const noProducts = await waitForPage("/panel/productos", empty, session);
      expect(noProducts.html).not.toContain("Todavía no cargaste");
      const home = await waitForPage("/panel", title, session);
      expect(home.html).toContain('href="/panel/productos"');
      expect(home.html).not.toContain("todo lo que cargaste");

      await seedProduct(validCreation({ name: "Mate", publish: "false" }));
      const { html } = await waitForPage("/panel/productos", `<h1>${title}</h1>`, session);
      for (const sentence of sentences) expect(html).toContain(sentence);
      for (const spanish of ["Borrador", "Precio", "Estado", "Volver al panel"])
        expect(html).not.toContain(spanish);
    },
  );
});

describe("language", () => {
  it("step 2 offers the language selector, Spanish by default", async () => {
    const session = await startTestSession("completa", { completed: false });
    await savedStep("nombre");
    const { html } = await waitForPage(
      "/panel/primer-ingreso/nombre",
      '<label for="language">Idioma de la tienda</label>',
      session,
    );
    expect(html).toContain('aria-describedby="language-help"');
    expect(html).toMatch(/<option value="es" lang="es" selected[^>]*>\s*Español/);
    expect(html).toMatch(/<option value="en" lang="en"[^>]*>\s*English/);
    expect(html).toMatch(/<option value="pt" lang="pt-BR"[^>]*>\s*Português \(Brasil\)/);
  });

  it.each([
    [
      "en",
      [
        "Your store is open for business",
        "Save language",
        "Sign out",
        "Step 3 of 5",
        "Sign in with passkey",
        "Your passkeys",
      ],
    ],
    [
      "pt",
      [
        "Sua loja está vendendo",
        "Salvar idioma",
        "Sair",
        "Passo 3 de 5",
        "Entrar com passkey",
        "Suas passkeys",
      ],
    ],
  ] as const)(
    "in %s the panel, onboarding and sign-in show no Spanish sentences",
    async (language, sentences) => {
      const [selling, save, exit, step3, enter, passkeys] = sentences;
      await seedStore(language);
      const session = await startTestSession();
      const panel = await waitForPage("/panel", selling, session);
      expect(panel.html).toContain(exit);
      const settings = await waitForPage("/panel/configuracion", save, session);
      expect(settings.html).toMatch(new RegExp(`<option value="${language}"[^>]*selected`));
      for (const spanish of ["Tu tienda está vendiendo", "Todavía no cargaste", ">Salir<"]) {
        expect(panel.html).not.toContain(spanish);
      }
      for (const spanish of ["Guardar idioma", "Tu dominio", "Configuración<"]) {
        expect(settings.html).not.toContain(spanish);
      }
      const access = await waitForPage("/panel/acceso", passkeys, session);
      expect(access.html).not.toContain("Tus passkeys");

      await savedStep("whatsapp");
      const whatsapp = await waitForPage("/panel/primer-ingreso/whatsapp", step3, session);
      expect(whatsapp.html).not.toContain("Paso 3 de 5");
      expect(whatsapp.html).not.toContain("¿A qué WhatsApp te escriben");
      expect(whatsapp.html).not.toMatch(/<option value="AR" selected/);

      const signIn = await waitForPage("/panel/ingresar", enter);
      expect(signIn.html).not.toContain("Entrá a tu tienda");
      expect(signIn.html).not.toContain("Perdí mi dispositivo");
    },
  );
});

describe("recovery", () => {
  it("with a recovery session everything leads to /panel/recuperar, which asks for the new passkey", async () => {
    const session = await startTestSession("recuperacion");
    await expectRedirect("/panel", "/panel/recuperar", session);
    await waitForPage("/panel/recuperar", "Creá una passkey nueva", session);
  });
});

describe("headers and origin", () => {
  it("panel pages are neither cached nor embeddable", async () => {
    const { res } = await waitForPage("/panel/reclamar", "Reclamá tu tienda");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    const redirection = await request("/panel");
    expect(redirection.headers.get("cache-control")).toBe("no-store");
  });

  it("a POST to the panel from another origin → 403", async () => {
    const res = await request("/panel/reclamar", undefined, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(403);
  });
});

describe("updates", () => {
  it("a self-hosted store has no hosted Updates page: /panel/hosted-updates goes back to /panel/actualizaciones", async () => {
    const res = await request("/panel/hosted-updates", await startTestSession("completa"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(new URL(res.headers.get("location") ?? "", BASE).pathname).toBe("/panel/actualizaciones");
  });

  it("not connected it offers creating the GitHub app with a manifest and leaves the state in a cookie", async () => {
    const session = await startTestSession("completa");
    const { res, html } = await waitForPage("/panel/actualizaciones", "Conectar con GitHub", session);
    const status = /action="https:\/\/github\.com\/settings\/apps\/new\?state=([0-9a-f]{32})"/.exec(
      html,
    )?.[1];
    expect(status).toBeDefined();
    expect(res.headers.get("set-cookie")).toContain(`tiendita_github=${status}`);
    expect(html).toContain("Tu tienda tiene la versión 0.17.0");
    const manifest = JSON.parse(
      (/name="manifest" value="([^"]+)"/.exec(html)?.[1] ?? "")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&"),
    ) as { redirect_url: string; default_permissions: Record<string, string>; public: boolean; name: string };
    expect(manifest.redirect_url).toBe(`${BASE}/panel/actualizaciones/github`);
    expect(manifest.default_permissions).toEqual({
      contents: "write",
      pull_requests: "write",
      metadata: "read",
    });
    expect(manifest.public).toBe(false);
    expect(manifest.name.length).toBeLessThanOrEqual(34);
  });

  it("the return from GitHub without the right state exchanges nothing", async () => {
    const session = await startTestSession("completa");
    await waitForPage(
      "/panel/actualizaciones/github?code=abc&state=other",
      "La conexión no salió bien",
      session,
    );
    const { results } = await env.DB.prepare("SELECT * FROM conexion_github").all();
    expect(results).toEqual([]);
  });

  it("with the app created it asks to install it on the repo; without a session, redirects to ingresar", async () => {
    const session = await startTestSession("completa");
    await env.DB.prepare(
      "INSERT INTO conexion_github (id, app_id, slug, clave_privada, actualizado_en) VALUES (1, 7, 'tiendita-ana', 'PEM', '2026-10-15T12:00:00.000Z')",
    ).run();
    const { html } = await waitForPage("/panel/actualizaciones", "Falta un paso", session);
    expect(html).toContain("https://github.com/apps/tiendita-ana/installations/new");
    await expectRedirect("/panel/actualizaciones", "/panel/ingresar");
  });

  it("the home's update alert is a bare fragment, empty without a pending update, and owner-only", async () => {
    await seedStore();
    const session = await startTestSession("completa");
    const res = await request("/panel/actualizaciones/aviso", session);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("<html");
    expect(html).not.toContain("update-alert");
    await expectRedirect("/panel/actualizaciones/aviso", "/panel/ingresar");
    const { html: home } = await waitForPage("/panel", "Tu tienda está vendiendo", session);
    expect(home).toContain("data-update-alert");
  });
});

describe("settings", () => {
  it("has the language and, without GitHub connected, sends to Updates before asking for a domain", async () => {
    await seedStore();
    const session = await startTestSession();
    const { html } = await waitForPage("/panel/configuracion", "<h1>Configuración</h1>", session);
    expect(html).toMatch(/<a href="\/panel\/configuracion" aria-current="page">/);
    // The way to Acceso and Actualizaciones: two cards at the top.
    expect(html).toContain('<nav class="settings-links" aria-label="Acceso y actualizaciones">');
    expect(html).toContain('<a class="card settings-links__item" href="/panel/acceso">');
    expect(html).toContain('<a class="card settings-links__item" href="/panel/actualizaciones">');
    const access = await waitForPage("/panel/acceso", "<h1>", session);
    expect(access.html).toMatch(/<a href="\/panel\/configuracion" aria-current="page">/);
    expect(html).toContain("Guardar idioma");
    expect(html).toContain("Tu dominio");
    expect(html).toContain("primero conectá tu tienda con GitHub");
    expect(html).toContain('href="/panel/actualizaciones"');
    expect(html).not.toContain("data-domain-check");
    // The test Worker has the IMAGENES binding: professional photos, nothing to turn on.
    expect(html).toContain('<section id="photos" aria-labelledby="photos-title"');
    expect(html).toContain("<strong>Fotos profesionales y sin límite</strong> · activas");
    expect(html).not.toContain("data-enable");
    expect(html).not.toContain("data-photos-polling");
    const home = await waitForPage("/panel", "Tu tienda está vendiendo", session);
    expect(home.html).not.toContain("Guardar idioma");
  });

  describe("photos in basic mode (Worker without the IMAGENES binding)", () => {
    // The built Worker reads the same `env` object as the tests: dropping the binding here is a Worker
    // deployed without R2. Restored after each test so the rest of the file keeps professional photos.
    const bindings = env as unknown as Record<string, unknown>;
    let bucket: unknown;
    beforeEach(() => {
      bucket = bindings.IMAGENES;
      delete bindings.IMAGENES;
    });
    afterEach(() => {
      bindings.IMAGENES = bucket;
    });

    it("without GitHub: step 1 with the bucket name, then the note and the link to Updates (no confirm step)", async () => {
      await seedStore();
      const session = await startTestSession();
      const { html } = await waitForPage(
        "/panel/configuracion",
        "<strong>Fotos básicas</strong> · 0 de 200 fotos usadas",
        session,
      );
      expect(html).toContain("tiendita-imagenes</code>");
      expect(html).toContain("data-copy");
      expect(html).not.toContain("data-r2-ready");
      expect(html).not.toContain("data-enable");
      const photos = html.slice(html.indexOf('<section id="photos"'));
      expect(photos).toMatch(/Necesita la tienda conectada a GitHub[\s\S]*href="\/panel\/actualizaciones"/);
    });

    it("with GitHub: the checkbox and the (disabled) Activar button", async () => {
      await seedStore();
      const session = await startTestSession();
      await env.DB.prepare(
        "INSERT INTO conexion_github (id, app_id, slug, clave_privada, instalacion_id, repositorio, actualizado_en) VALUES (1, 7, 'tiendita-ana', 'PEM', 99, 'ana/tiendita', '2026-10-16T12:00:00.000Z')",
      ).run();
      const { html } = await waitForPage("/panel/configuracion", "<strong>Fotos básicas</strong>", session);
      expect(html).toContain("tiendita-imagenes</code>");
      expect(html).toMatch(/<input type="checkbox" data-r2-ready[^>]*>/);
      expect(html).toMatch(/<button type="button" data-enable disabled[^>]*>/);
      expect(html).not.toContain("data-photos-polling");
    });
  });

  it("explains the heartbeat and shows its checkbox checked, or not once the store opted out", async () => {
    await seedStore();
    const session = await startTestSession();
    const on = await waitForPage("/panel/configuracion", "Tiendas activas", session);
    expect(on.html).toContain("No manda nada más");
    expect(on.html).toMatch(
      /<form data-heartbeat[^>]*>[\s\S]*<label>\s*<input[^>]*type="checkbox"[^>]*name="enabled"[^>]*checked/,
    );
    expect(on.html).toContain("Contar mi tienda en tutiendita.ar");

    await env.DB.prepare("UPDATE tiendas SET latido_activo = 0").run();
    const off = await waitForPage("/panel/configuracion", "Tiendas activas", session);
    const checkbox = /<input[^>]*name="enabled"[^>]*>/.exec(off.html)?.[0];
    expect(checkbox).toBeDefined();
    expect(checkbox).not.toContain("checked");
  });

  it("with GitHub ready it asks which address; with a domain connecting it says so and offers to disconnect", async () => {
    await seedStore();
    const session = await startTestSession();
    await env.DB.prepare(
      "INSERT INTO conexion_github (id, app_id, slug, clave_privada, instalacion_id, repositorio, actualizado_en) VALUES (1, 7, 'tiendita-ana', 'PEM', 99, 'ana/tiendita', '2026-10-16T12:00:00.000Z')",
    ).run();
    const ask = await waitForPage("/panel/configuracion", "¿En qué dirección querés tu tienda?", session);
    expect(ask.html).toContain("data-domain-check");
    expect(ask.html).toContain('aria-describedby="hostname-hint"');
    expect(ask.html).not.toContain("data-disconnect");

    // A domain that doesn't answer yet (.test never resolves): still connecting.
    await env.DB.prepare(
      "INSERT INTO origenes_permitidos (origen, rp_id, principal, agregado_en) VALUES ('https://tienda.ejemplo.test', 'tiendita.test', 0, '2026-10-16T12:00:00.000Z')",
    ).run();
    const connecting = await waitForPage(
      "/panel/configuracion",
      "Estamos conectando tienda.ejemplo.test",
      session,
    );
    expect(connecting.html).toContain("data-disconnect");
    expect(connecting.html).not.toContain("data-domain-check");
  });
});

describe("panel bar, dashboard and footer", () => {
  it("with the store ready: bar with the current section marked, insights coming soon and footer with the version", async () => {
    await seedStore();
    const session = await startTestSession();
    const { html } = await waitForPage("/panel", "Tu tienda está vendiendo", session);
    expect(html).toContain('<header class="panel-bar"');
    expect(html).toMatch(/<a href="\/panel" aria-current="page">/);
    // Acceso and Actualizaciones live inside Configuración, not in the bar.
    expect(html).not.toContain('href="/panel/actualizaciones"');
    expect(html).not.toContain('href="/panel/acceso"');
    expect(html).toContain("data-sign-out");
    expect(html).toContain("Próximamente");
    expect(html).toContain("Visitas a tu tienda");
    expect(html).toMatch(/<footer[^>]*class="panel-footer"/);
    expect(html).toContain("tiendita 0.17.0");
    expect(html).toContain("/panel/ventas");
    const products = await waitForPage("/panel/productos", "Productos", session);
    expect(products.html).toMatch(/<a href="\/panel\/productos" aria-current="page">/);
  });

  it("onboarding and signed-out screens don't show the bar", async () => {
    const session = await startTestSession("completa", { completed: false });
    await savedStep("whatsapp");
    const { html } = await waitForPage("/panel/primer-ingreso/whatsapp", "Paso 3 de 5", session);
    expect(html).not.toContain("panel-bar");
    expect(html).not.toContain("panel-footer");
  });
});

describe("new product", () => {
  it("Products has the add button and the form has name, description, price, photo and publish", async () => {
    await seedStore();
    const session = await startTestSession();
    const list = await waitForPage("/panel/productos", "Cargar producto", session);
    expect(list.html).toContain('href="/panel/productos/nuevo"');
    const { html } = await waitForPage("/panel/productos/nuevo", "Nuevo producto", session);
    // The test Worker binds R2 (PRO): the photo is the gallery, not the single `image` field.
    for (const field of [
      'name="name"',
      'name="description"',
      'name="price"',
      "data-gallery",
      'name="publish"',
    ]) {
      expect(html).toContain(field);
    }
    expect(html).toMatch(/<a href="\/panel\/productos" aria-current="page">/);
    const created = await waitForPage("/panel/productos?created=1", "el producto quedó cargado", session);
    expect(created.res.status).toBe(200);
  });

  it("without a session it redirects to sign in", async () => {
    await seedStore();
    await expectRedirect("/panel/productos/nuevo", "/panel/ingresar");
  });
});

describe("edit and delete products", () => {
  async function seedWithId(fields: CreationFields): Promise<{ id: string; slug: string }> {
    const res = await request("/api/products", await startTestSession(), {
      method: "POST",
      body: form(fields),
      headers: { origin: BASE },
    });
    return (await res.json()) as { id: string; slug: string };
  }

  it("each row links to its edit page, which comes filled in with status, category and delete", async () => {
    await seedStore();
    await env.DB.prepare("INSERT INTO categorias (id, nombre, slug) VALUES ('c1', 'Tortas', 'tortas')").run();
    const p = await seedWithId(
      validCreation({ name: "Torta húmeda", price_amount: "450050", category_id: "c1" }),
    );
    const session = await startTestSession();
    const list = await waitForPage("/panel/productos", "Torta húmeda", session);
    expect(list.html).toContain(`href="/panel/productos/${p.id}"`);
    const { html } = await waitForPage(`/panel/productos/${p.id}`, "Editar producto", session);
    expect(html).toContain('value="Torta húmeda"');
    expect(html).toContain('value="4500.50"');
    expect(html).toMatch(/<option value="c1" selected[^>]*>Tortas<\/option>/);
    expect(html).toMatch(/<option value="publicado" selected/);
    expect(html).toContain("Borrar producto");
    expect(html).toContain(`href="/p/${p.slug}"`);
  });

  it("an unknown product answers 404; New product offers the category select", async () => {
    await seedStore();
    const session = await startTestSession();
    const res = await request("/panel/productos/nope", session);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Producto no encontrado");
    const nuevo = await waitForPage("/panel/productos/nuevo", "Nuevo producto", session);
    expect(nuevo.html).toContain('<select id="category" name="category"');
    expect(nuevo.html).toContain("Sin categoría");
    expect(nuevo.html).not.toContain("Borrar producto");
  });

  it("without a session the edit page redirects to sign in", async () => {
    await seedStore();
    await expectRedirect("/panel/productos/abc", "/panel/ingresar");
  });
  it("the product form has the variants editor, with the category's templates at hand", async () => {
    await seedStore();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO categorias (id, nombre, slug) VALUES ('c1', 'Tortas', 'tortas')"),
      env.DB.prepare(
        "INSERT INTO plantillas_opcion (id, categoria_id, nombre, valores_json, orden) VALUES ('c1:0', 'c1', 'Relleno', ?, 0)",
      ).bind(JSON.stringify([{ etiqueta: "Dulce de leche", ajuste: 0 }])),
    ]);
    const session = await startTestSession();
    const { html } = await waitForPage("/panel/productos/nuevo", "Variantes (opcional)", session);
    expect(html).toContain("data-options-editor");
    expect(html).toContain("Usar las variantes de la categoría");
    expect(html).toContain("Dulce de leche");
    expect(html).toContain("Agregar variante");
  });
});

describe("product photos", () => {
  const photo = (name: string) => ({ bytes: PNG_1X1, type: "image/png", name });

  /** A product with three photos and a "Color" variant whose "Rojo" points to the second one. */
  async function seedThreePhotos(): Promise<{ id: string; images: { key: string }[] }> {
    const { image: _single, ...fields } = validCreation();
    const res = await request("/api/products", await startTestSession(), {
      method: "POST",
      headers: { origin: BASE },
      body: form({
        ...fields,
        gallery: JSON.stringify([{ upload: 0 }, { upload: 1 }, { upload: 2 }]),
        files: [photo("a.png"), photo("b.png"), photo("c.png")],
        options: JSON.stringify([
          {
            name: "Color",
            values: [
              { label: "Rojo", price_delta: 0, image_ref: { upload: 1 } },
              { label: "Azul", price_delta: 0 },
            ],
          },
        ]),
      }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; images: { key: string }[] };
  }

  it("PRO: the edit page has the gallery with every photo and a photo control per option value", async () => {
    await seedStore();
    const p = await seedThreePhotos();
    const { html } = await waitForPage(
      `/panel/productos/${p.id}`,
      "Editar producto",
      await startTestSession(),
    );
    expect(html).toContain("data-gallery");
    for (const { key } of p.images) expect(html).toContain(`src="/img/${key}"`);
    expect(html).toContain("Agregar fotos");
    expect(html).toContain("data-photo-picker");
    expect(html).not.toContain('id="image"');
    expect(html).not.toContain("activá fotos profesionales");
  });

  describe("basic mode (Worker without the IMAGENES binding)", () => {
    const bindings = env as unknown as Record<string, unknown>;
    let bucket: unknown;
    afterEach(() => {
      bindings.IMAGENES = bucket;
    });
    const dropBucket = () => {
      bucket = bindings.IMAGENES;
      delete bindings.IMAGENES;
    };

    it("New product keeps the single photo and points to professional photos", async () => {
      await seedStore();
      dropBucket();
      const { html } = await waitForPage(
        "/panel/productos/nuevo",
        "Nuevo producto",
        await startTestSession(),
      );
      expect(html).toContain('id="image"');
      expect(html).toContain("activá fotos profesionales");
      expect(html).toContain('href="/panel/configuracion#photos"');
      expect(html).not.toContain("data-gallery");
      expect(html).not.toContain("data-photo-picker");
    });

    it("a product with three photos shows them all, read-only, without the replace input", async () => {
      await seedStore();
      const p = await seedThreePhotos();
      dropBucket();
      const { html } = await waitForPage(
        `/panel/productos/${p.id}`,
        "Editar producto",
        await startTestSession(),
      );
      for (const { key } of p.images) expect(html).toContain(`src="/img/${key}"`);
      expect(html).not.toContain('id="image"');
      expect(html).not.toContain("Mover antes");
      expect(html).toContain("activá fotos profesionales");
    });
  });

  it("the category form has no photo control", async () => {
    await seedStore();
    const { html } = await waitForPage(
      "/panel/categorias/nueva",
      "Nueva categoría",
      await startTestSession(),
    );
    expect(html).toContain("data-options-editor");
    expect(html).not.toContain("data-photo-picker");
  });
});

describe("panel: categories", () => {
  it("Products links to Categories, which lists them with their variants and opens the edit form", async () => {
    await seedStore();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO categorias (id, nombre, slug) VALUES ('c1', 'Remeras', 'remeras')"),
      env.DB.prepare(
        "INSERT INTO plantillas_opcion (id, categoria_id, nombre, valores_json, orden) VALUES ('c1:0', 'c1', 'Talle', ?, 0)",
      ).bind(JSON.stringify([{ etiqueta: "M", ajuste: 0 }])),
    ]);
    const session = await startTestSession();
    const products = await waitForPage("/panel/productos", "Productos", session);
    expect(products.html).toContain('href="/panel/categorias"');
    const list = await waitForPage("/panel/categorias", "Remeras", session);
    expect(list.html).toContain("0 productos");
    expect(list.html).toContain("Talle");
    expect(list.html).toContain('href="/panel/categorias/c1"');
    const edit = await waitForPage("/panel/categorias/c1", "Editar categoría", session);
    expect(edit.html).toContain('value="Remeras"');
    expect(edit.html).toContain("Variantes de la categoría");
    expect(edit.html).toContain("Borrar categoría");
    await waitForPage("/panel/categorias/nueva", "Nueva categoría", session);
    const missing = await request("/panel/categorias/nope", session);
    expect(missing.status).toBe(404);
  });

  it("without a session, categories redirect to sign in", async () => {
    await seedStore();
    await expectRedirect("/panel/categorias", "/panel/ingresar");
  });
});

const orders = () => createD1OrderRepository(env.DB);

describe("panel: sales", () => {
  it("without a session it redirects to sign in", async () => {
    await seedStore();
    await expectRedirect("/panel/ventas", "/panel/ingresar");
  });
  it("lists sales with buyer, items, total, status and the next-step buttons; the bar marks Ventas", async () => {
    await seedStore();
    const cookies = await startTestSession();
    await orders().insert(sampleOrder("a", "nuevo", "2026-10-17T10:00:00Z", "Relleno: Chocolate"));
    await orders().insert(sampleOrder("z", "entregado", "2026-10-17T09:00:00Z"));
    const { html } = await waitForPage("/panel/ventas", "Ventas", cookies);
    expect(html).toMatch(/<a href="\/panel\/ventas" aria-current="page">/);
    expect(html).toContain("Ana");
    expect(html).toContain("1 x Torta (Relleno: Chocolate)");
    expect(html).toContain('<time datetime="2026-10-17T10:00:00.000Z"');
    expect(html).toContain("Nuevo");
    expect(html).toContain('data-status="contactado"');
    expect(html).toContain('data-status="pagado"');
    expect(html).toContain('data-status="cancelado"');
    const button = (to: string) => html.match(new RegExp(`<button[^>]*data-status="${to}"[^>]*>`))?.[0] ?? "";
    expect(button("pagado")).not.toContain("secondary");
    expect(button("contactado")).toContain("secondary");
    expect(button("cancelado")).toContain("secondary");
    expect(html.indexOf('data-order-id="a"')).toBeLessThan(html.indexOf('data-order-id="z"'));
    const delivered = html.slice(html.indexOf('data-order-id="z"'));
    expect(delivered).not.toContain("data-status=");
  });
  it("shows the delivery address when the buyer wrote one", async () => {
    await seedStore();
    const cookies = await startTestSession();
    const withAddress = sampleOrder("a", "nuevo", "2026-10-17T10:00:00Z");
    await orders().insert({ ...withAddress, buyer: { name: "Ana", address: "San Martín 123, timbre B" } });
    await orders().insert(sampleOrder("b", "nuevo", "2026-10-17T09:00:00Z"));
    const { html } = await waitForPage("/panel/ventas", "Ventas", cookies);
    expect(html).toMatch(/<strong>Dirección:<\/strong>\s*San Martín 123, timbre B/);
    expect(html.slice(html.indexOf('data-order-id="b"'))).not.toContain("Dirección:");
  });
  it("'Por adelantado' lists only advance orders, nearest first, with their date and how they're handed over", async () => {
    await seedStore();
    const cookies = await startTestSession();
    const at = (id: string, when: string, fulfillment: "envio" | "retiro") => ({
      ...sampleOrder(id, "nuevo", "2026-11-09T10:00:00Z"),
      scheduled: { for: when, fulfillment },
    });
    await orders().insert(at("late", "2026-12-20T10:00", "retiro"));
    await orders().insert(at("soon", "2026-11-30T23:30", "envio"));
    await orders().insert(sampleOrder("now", "nuevo", "2026-11-09T11:00:00Z"));
    const all = await waitForPage("/panel/ventas", "Ventas", cookies);
    expect(all.html).toContain('href="/panel/ventas?adelantado"');
    expect(all.html).toContain('data-order-id="now"');
    const { html } = await waitForPage("/panel/ventas?adelantado", "Ventas", cookies);
    expect(html).not.toContain('data-order-id="now"');
    expect(html.indexOf('data-order-id="soon"')).toBeLessThan(html.indexOf('data-order-id="late"'));
    expect(html).toMatch(/Para [^<]*30\D11[^<]*23:30 · Envío/);
    expect(html).toContain('id="pedido-soon"');
  });
  it("the 'Por adelantado' filter shows as soon as the option is on, before the first advance order", async () => {
    await seedStore();
    const cookies = await startTestSession();
    const before = await waitForPage("/panel/ventas", "Ventas", cookies);
    expect(before.html).not.toContain('href="/panel/ventas?adelantado"');
    await env.DB.prepare(
      "INSERT INTO configuracion (clave, valor, actualizado_en) VALUES ('pedidos.anticipados', '1', '2026-11-09T10:00:00.000Z')",
    ).run();
    const { html } = await waitForPage("/panel/ventas", "Ventas", cookies);
    expect(html).toContain('href="/panel/ventas?adelantado"');
  it("the calendar shows each advance order on its day, moves by month and offers Google Calendar", async () => {
    await seedStore();
    await expectRedirect("/panel/ventas/calendario", "/panel/ingresar");
    const cookies = await startTestSession();
    await orders().insert({
      ...sampleOrder("a", "nuevo", "2026-11-09T10:00:00Z"),
      scheduled: { for: "2026-11-14T18:00", fulfillment: "retiro" },
    });
    const sales = await waitForPage("/panel/ventas?adelantado", "Ventas", cookies);
    expect(sales.html).toContain('href="/panel/ventas/calendario"');
    expect(sales.html).toMatch(/href="https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE[^"]*dates=20261114T180000%2F20261114T183000/);
    const { html } = await waitForPage("/panel/ventas/calendario?mes=2026-11", "Conectar con Google Calendar", cookies);
    const day = html.slice(html.indexOf('data-date="2026-11-14"'));
    expect(day.slice(0, day.indexOf("</td>"))).toContain("18:00 Ana · Retiro");
    expect(html).toContain('href="/panel/ventas/calendario?mes=2026-10"');
    expect(html).toContain('href="/panel/ventas/calendario?mes=2026-12"');
    expect(html).toContain('href="/panel/ventas?adelantado#pedido-a"');
  });
  it("says so kindly when there are no sales yet", async () => {
    await seedStore();
    const { html } = await waitForPage("/panel/ventas", "Todavía no tenés ventas", await startTestSession());
    expect(html).not.toContain("data-order-id");
  });
  it("the home counts the sales to handle and links to Ventas", async () => {
    await seedStore();
    const cookies = await startTestSession();
    await orders().insert(sampleOrder("a", "nuevo", "2026-10-17T10:00:00Z"));
    await orders().insert(sampleOrder("b", "contactado", "2026-10-17T10:00:00Z"));
    await orders().insert(sampleOrder("c", "pagado", "2026-10-17T10:00:00Z"));
    const { html } = await waitForPage("/panel", "ventas por atender", cookies);
    expect(html).toMatch(/<span class="dashboard__number">2<\/span>\s*<span>ventas por atender/);
    expect(html).toContain('href="/panel/ventas"');
  });
  it("with advance orders on, the home counts the open ones for the next 7 days, and Configuración has the switch", async () => {
    await seedStore();
    const cookies = await startTestSession();
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 16);
    const at = (id: string, when: string, status: "nuevo" | "entregado" = "nuevo") => ({
      ...sampleOrder(id, status, "2026-11-09T10:00:00Z"),
      scheduled: { for: when, fulfillment: "retiro" as const },
    });
    await orders().insert(at("a", day(1)));
    await orders().insert(at("b", day(3)));
    await orders().insert(at("c", day(10)));
    await orders().insert(at("d", day(2), "entregado"));
    const before = await waitForPage("/panel", "ventas por atender", cookies);
    expect(before.html).not.toContain("por adelantado, próximos 7 días");
    const settings = await waitForPage("/panel/configuracion", "Pedidos por adelantado", cookies);
    expect(settings.html).toContain("Tomar pedidos por adelantado");
    await env.DB.prepare(
      "INSERT INTO configuracion (clave, valor, actualizado_en) VALUES ('pedidos.anticipados', '1', '2026-11-09T10:00:00.000Z')",
    ).run();
    const { html } = await waitForPage("/panel", "por adelantado, próximos 7 días", cookies);
    expect(html).toMatch(/<span class="dashboard__number">2<\/span>\s*<span>por adelantado, próximos 7 días/);
  });
});

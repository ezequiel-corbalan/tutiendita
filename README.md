**English** · [Español](README.es.md) · [Português](README.pt.md)

# tutiendita

Your online store, running on **your own Cloudflare account**, with a single button. No coding, no hosting bills, and no keys or passwords to paste anywhere. Project site: [tutiendita.ar](https://tutiendita.ar).

**Free, open source e-commerce for small businesses**, self-hosted on Cloudflare Workers and D1: product catalog with photos (up to 8 per product, and one per option, when R2 is connected), categories and variants, a cart that sends the order by WhatsApp (each order is kept in the panel's Sales section, where you mark it paid and delivered), bank transfer payments, Google-ready pages (sitemap, Open Graph, schema.org Product) and an owner panel with passkeys. No sales fees and your data stays yours.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/ezequiel-corbalan/tutiendita)

## How to install it

1. Click the **Deploy to Cloudflare** button above.
2. Sign in to your Cloudflare account (if you don't have one, you can create one for free right there).
3. Connect your GitHub or GitLab account when asked. You only do this once: that's where your copy of the store is kept.
4. Choose a name for your store (the Worker's name; if you already have another tiendita on the same account, use a different one) and click **Create and deploy**.
5. Wait a couple of minutes. When it's done, open the address it shows you (it ends in `.workers.dev`): you'll see **"Tu tiendita está lista"** (Your tiendita is ready).

You don't need to type any commands or set up anything else.

Your store can be shown in Spanish, English or Portuguese: you choose the language the first time you sign in, and you can change it later from the panel (Spanish is the default, so the store's screens start out in Spanish).

## What gets created in your account

Everything is in your name; nobody else has access.

| What | What for |
|---|---|
| A **Worker** with your store's name | It's the store itself: the pages your customers see and the API. |
| A **D1** database named after your store | Keeps your products, categories, orders and product photos (up to 200). |
| A repository on your GitHub or GitLab | Your copy of the code. Every change you push there is published automatically. |

**No credit card needed.** Photos go into the database. If you want more, you can enable **"Professional photos, no limit"** later from the panel's Settings: it uses R2, Cloudflare asks for a card to enable it, and it is free up to 10 GB.

## How much it costs

For a small store, **nothing**: it fits within Cloudflare's free plan (Workers and D1 have free daily and monthly allowances). If your store ever grows a lot, Cloudflare lets you know before charging you; a paid plan is never turned on by itself.

## Claim your store

Your store's address is easy to guess, so the first time you open it we ask for a **claim code** that only you can see. A new one is generated every time the store is published, and it shows up in the log of the **Deploying** stage:

1. Go to your [Cloudflare dashboard](https://dash.cloudflare.com/).
2. Go to **Workers & Pages** and open your store (the Worker with the name you chose when installing it; if you didn't change it, **tiendita**).
3. In the **Deployments** tab, click the most recent one and then the **Deploying** stage.
4. The log shows the box **TU TIENDITA: CÓDIGO PARA RECLAMARLA** (in Spanish): copy what follows `CODIGO DE RECLAMO:`, dashes included (`XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`); that's your claim code.
5. Open your store, click **"Reclamar mi tienda"** (Claim my store) and paste the code.

Then you'll:

1. Create your **passkey**: you sign in with your phone's or computer's fingerprint, face or PIN. There's no password.
2. Save your **recovery code** (it helps if you lose your device). It's shown only once.
3. Choose your store's **name**.
4. Add your **WhatsApp** number: that's where your orders arrive.
5. If you want, add your **alias or CBU** (your Argentine bank account details) to get paid by bank transfer, and add your **first product**.

If you close it halfway through, sign back in with your passkey and pick up where you left off. Once the store is claimed, the claim code is no longer good for anything.

## If you lose access

- **You lost your device but have your recovery code:** on the sign-in screen click **"Perdí mi dispositivo"** (I lost my device), type the code and create a new passkey. The code keeps working until you create it; then we give you a new one (the old one stops working) and you can delete your old passkeys from **"Acceso"** (Access).
- **Emergency plan (you lost your passkey and your recovery code too):** whoever owns the Cloudflare account can set the store back to "unclaimed". Your products, photos and data **are not lost**.
  1. In the Cloudflare dashboard, go to **Storage & Databases → D1**, open the database named after your store plus `-db` (if you didn't rename it, **tiendita-db**) and open the **Console**.
  2. Run: `DELETE FROM acceso;`
  3. Publish the store again so a new claim code is generated: in **Workers & Pages →** your store **→ Deployments**, retry the latest build (or push any change to your repository).
  4. Find the new code in the log of the **Deploying** stage of the latest deployment and claim the store just like the first time (you can do it from a different address: with no owner, old addresses don't count). Old passkeys, sessions and addresses are deleted automatically when you claim it.

## Active stores

Once a day your store tells tutiendita.ar its address (nothing else: no sales, no products, no customer data) so we can count how many stores are active. You can turn it off from **"Configuración"** (Settings) in the panel.

## For people who code

This repo is a self-contained copy of the store from the **tutiendita** monorepo (`apps/tiendita` plus its packages; project site: https://tutiendita.ar): it's generated automatically, so it's best to make changes over there. You can still modify it however you like.

```sh
npm ci                        # dependencias
npm run dev                   # migraciones locales + Astro + wrangler en http://localhost:4321, tienda ya lista
npm run build                 # build de producción (dist/)
npm test                      # todos los tests (node --test, build de prueba y Vitest); el CI los corre en cada PR
npm run deploy                # crea la D1 si falta + migraciones remotas + wrangler deploy (lo que corre Cloudflare)
```

- Astro builds the pages and Hono handles `/api`, `/img`, `/feed`, `/.well-known` and `/mcp`, all in a single Worker.
- The domain and use cases live in `src/packages/core`; the D1 and R2 adapters in `src/packages/infra-cloudflare`.
- The D1 database is named after the Worker plus `-db` (`wrangler.jsonc`). If you rename the Worker by hand, rename the database as well: that way two stores on the same account never share data. There is no R2 bucket until the owner enables "Professional photos, no limit" in Settings, which adds the `r2_buckets` line to your `wrangler.jsonc`.
- Every write requires an owner session (passkey) and the store's `Origin`: without a session, `POST /api/products` returns 401. With `npm run dev` on `localhost` the store comes up claimed, with onboarding done and the sample products, and the panel opens without a passkey (`src/dev/local-owner.ts`, never in the build). To try the real claim, delete `.wrangler/state` and use `npm run build && npm run preview`; you can pin the claim code with the `CODIGO_DE_RECLAMO` build variable (not needed in production).
- The claim code is generated by `integrations/claim-code.mjs` on every `astro build`: it prints the code and leaves only its SHA-256 in the Worker.

## License

[FSL-1.1-MIT](LICENSE) (Functional Source License): you can use, copy, modify and fork the code for any purpose, including running your own store and selling with it. The only thing not allowed is offering it, or a derivative, as a commercial product or service that competes with tutiendita. Each version becomes MIT two years after it's published.

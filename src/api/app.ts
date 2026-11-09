import { Hono } from "hono";
import { internalError, notFound } from "./errors";
import { requireAllowedOrigin } from "./middlewares/origin";
import { loadSession } from "./middlewares/session";
import { accessRoutes } from "./routes/access";
import { calendarRoutes } from "./routes/calendar";
import { categoryRoutes } from "./routes/categories";
import { domainRoutes, wellKnownRoutes } from "./routes/domain";
import { imgRoutes } from "./routes/img";
import { onboardingRoutes, paymentMethodRoutes, storeRoutes } from "./routes/onboarding";
import { orderRoutes } from "./routes/orders";
import { photoRoutes } from "./routes/photos";
import { productRoutes } from "./routes/products";
import { sampleRoutes } from "./routes/samples";
import { updatesRoutes } from "./routes/updates";
import type { ApiEnv } from "./types";

/** Hono app mounted by the Astro middleware under /api, /img, /feed, /.well-known and /mcp. */
export const api = new Hono<ApiEnv>()
  // Origin-based CSRF on every unsafe method, before touching the session.
  .use("/api/*", requireAllowedOrigin)
  .use("/api/*", loadSession)
  .route("/api/access", accessRoutes)
  .route("/api/products", productRoutes)
  .route("/api/categories", categoryRoutes)
  .route("/api/orders", orderRoutes)
  .route("/api/calendar", calendarRoutes)
  .route("/api/store", storeRoutes)
  .route("/api/payment-methods", paymentMethodRoutes)
  .route("/api/onboarding", onboardingRoutes)
  .route("/api/samples", sampleRoutes)
  .route("/api/updates", updatesRoutes)
  .route("/api/domain", domainRoutes)
  .route("/api/photos", photoRoutes)
  .route("/.well-known", wellKnownRoutes)
  .route("/img", imgRoutes)
  .notFound(notFound)
  .onError((cause, c) => internalError(c, cause));

/** Prefixes Hono handles; Astro renders the rest. */
export const API_ROUTES = /^\/(api|img|feed|\.well-known|mcp)(\/|$)/;

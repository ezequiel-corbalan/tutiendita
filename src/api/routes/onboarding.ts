import { MAX_BASIC_IMAGE_SIZE, MAX_IMAGE_SIZE, ONBOARDING_STEPS, type Upload } from "../../packages/core/index";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { build } from "../../container";
import { respondDomainError } from "../errors";
import { requireSession } from "../middlewares/session";
import type { ApiEnv } from "../types";
import { validate } from "../validation";
import { verifyImage } from "../verify-image";
import { capFor } from "./products";

/** Onboarding screens 2 to 5 and moving between steps. All with a full session. */
const ownerOnly = requireSession("completa");

const stepSchema = z.object({
  step: z.enum(ONBOARDING_STEPS as [string, ...string[]], { message: "Unknown step" }),
  skipped: z.boolean().optional(),
});

// Core validates the language (INVALID_LANGUAGE); here only the length is bounded.
const language = z.string().max(10);

/** Multipart fields of PUT /api/store/identity; core decides the lengths, the colour and the logo bytes. */
const identitySchema = z.object({
  name: z.string().max(200),
  description: z.string().max(1000),
  color: z.string().max(40),
  logo: z.instanceof(File, { message: "Must be a file" }).optional(),
  remove_logo: z
    .enum(["true", "false"], { message: 'Must be "true" or "false"' })
    .optional()
    .transform((v) => v === "true"),
});

/** One logo (same cap as a product photo) plus the text fields. */
const identityCap = createMiddleware<ApiEnv>((c, next) =>
  capFor((c.env.IMAGENES === undefined ? MAX_BASIC_IMAGE_SIZE : MAX_IMAGE_SIZE) + 1024 * 1024)(c, next),
);

export const storeRoutes = new Hono<ApiEnv>()
  .put("/identity", ownerOnly, identityCap, validate("form", identitySchema), async (c) => {
    const { name, description, color, logo, remove_logo } = c.req.valid("form");
    let upload: Upload | undefined;
    if (logo !== undefined) {
      const problem = verifyImage(logo.name, logo.type);
      if (problem !== null) return respondDomainError(c, problem);
      upload = { bytes: new Uint8Array(await logo.arrayBuffer()), mimeType: logo.type };
    }
    const r = await build(c.env).identity.update({
      name,
      description,
      color,
      logo: upload,
      removeLogo: remove_logo,
    });
    if (!r.ok) return respondDomainError(c, r.error);
    const { store } = r.value;
    return c.json({
      name: store.name,
      description: store.description,
      color: r.value.color,
      logoUrl: store.logoKey === null ? null : `/img/${store.logoKey}`,
    });
  })
  .put(
    "/",
    ownerOnly,
    validate("json", z.object({ name: z.string().max(200), language: language.optional() })),
    async (c) => {
      const { name, language } = c.req.valid("json");
      const r = await build(c.env).onboarding.saveStoreName({
        name,
        ...(language !== undefined ? { language } : {}),
      });
      if (!r.ok) return respondDomainError(c, r.error);
      return c.json({ name: r.value.name, currency: r.value.currency, language: r.value.language });
    },
  )
  .put("/language", ownerOnly, validate("json", z.object({ language })), async (c) => {
    const r = await build(c.env).onboarding.changeLanguage(c.req.valid("json"));
    if (!r.ok) return respondDomainError(c, r.error);
    return c.json({ language: r.value.language });
  })
  .put("/heartbeat", ownerOnly, validate("json", z.object({ enabled: z.boolean() })), async (c) => {
    const r = await build(c.env).heartbeat.setEnabled(c.req.valid("json").enabled);
    if (!r.ok) return respondDomainError(c, r.error);
    return c.json({ enabled: r.value.heartbeatEnabled });
  })
  .put("/advance-orders", ownerOnly, validate("json", z.object({ enabled: z.boolean() })), async (c) => {
    const { enabled } = c.req.valid("json");
    await build(c.env).advanceOrders.setEnabled(enabled);
    return c.json({ enabled });
  });

export const paymentMethodRoutes = new Hono<ApiEnv>()
  .put("/whatsapp", ownerOnly, validate("json", z.object({ number: z.string().max(40) })), async (c) => {
    const r = await build(c.env).onboarding.saveWhatsapp(c.req.valid("json"));
    if (!r.ok) return respondDomainError(c, r.error);
    return c.json(r.value);
  })
  .put(
    "/transfer",
    ownerOnly,
    validate("json", z.object({ account: z.string().max(60), holder: z.string().max(200) })),
    async (c) => {
      const r = await build(c.env).onboarding.saveTransfer(c.req.valid("json"));
      if (!r.ok) return respondDomainError(c, r.error);
      return c.json(r.value);
    },
  );

export const onboardingRoutes = new Hono<ApiEnv>().post(
  "/advance",
  ownerOnly,
  validate("json", stepSchema),
  async (c) => {
    const { step, skipped } = c.req.valid("json");
    const r = await build(c.env).onboarding.advance({
      step: step as (typeof ONBOARDING_STEPS)[number],
      ...(skipped !== undefined ? { skipped } : {}),
    });
    if (!r.ok) return respondDomainError(c, r.error);
    return c.json(r.value);
  },
);

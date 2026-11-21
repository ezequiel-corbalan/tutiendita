import {
  domainError,
  err,
  MAX_BASIC_IMAGE_SIZE,
  money,
  ok,
  type PhotoRef,
  type Upload,
} from "../../packages/core/index";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { build } from "../../container";
import { toProductJson } from "../../lib/product-json";
import { type ErrorBody, respondDomainError } from "../errors";
import { requireSession } from "../middlewares/session";
import { galleryField, MAX_UPLOADS, optionsField } from "../options-schema";
import type { ApiEnv } from "../types";
import { validate } from "../validation";
import { verifyImage } from "../verify-image";

/** Body cap: up to 8 photos (max 5 MB each) plus the other fields. */
export const MAX_BODY_SIZE = MAX_UPLOADS * 5 * 1024 * 1024 + 1024 * 1024;
/** Basic stores (no IMAGENES bucket) take one photo of up to 1.5 MB. */
const MAX_BASIC_BODY_SIZE = MAX_BASIC_IMAGE_SIZE + 1024 * 1024;
export const MAX_NAME_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 5000;

/** Multipart fields of POST /api/products. Numbers arrive as text: they're validated as text. */
const creationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(MAX_NAME_LENGTH, `At most ${MAX_NAME_LENGTH} characters`),
  description: z
    .string()
    .max(MAX_DESCRIPTION_LENGTH, `At most ${MAX_DESCRIPTION_LENGTH} characters`)
    .optional(),
  price_amount: z
    .string()
    .regex(/^\d+$/, "Must be an integer greater than or equal to zero in the minor unit (cents)")
    .transform(Number)
    .refine(Number.isSafeInteger, "Amount out of range"),
  price_currency: z.string().regex(/^[A-Z]{3}$/, "Must be a three-letter ISO 4217 code (e.g. ARS)"),
  publish: z
    .enum(["true", "false"], { message: 'Must be "true" or "false"' })
    .optional()
    .transform((v) => v === "true"),
  // One photo (kept for compatibility), or `gallery` (JSON) plus the files image_0 … image_7.
  image: z.instanceof(File, { message: "Must be a file" }).optional(),
  gallery: galleryField.optional(),
  ...Object.fromEntries(
    Array.from({ length: MAX_UPLOADS }, (_, i) => [
      `image_${i}`,
      z.instanceof(File, { message: "Must be a file" }).optional(),
    ]),
  ),
  // Empty means "no category".
  category_id: z
    .string()
    .max(64)
    .optional()
    .transform((v) => (v ? v : null)),
  // Variants as JSON. Omitted on creation: the category's templates; omitted on update: unchanged.
  options: optionsField.optional(),
});

/** Multipart fields of PUT /api/products/:id: the whole product (the panel sends the full form). */
const updateSchema = creationSchema.omit({ publish: true }).extend({
  description: z.string().max(MAX_DESCRIPTION_LENGTH, `At most ${MAX_DESCRIPTION_LENGTH} characters`),
  // Stored in D1 in Spanish: published, paused, draft.
  status: z.enum(["publicado", "pausado", "borrador"], { message: "Unknown status" }),
});

/** 413 with the API error shape when the multipart body goes over `maxSize`. */
export const capFor = (maxSize: number) =>
  bodyLimit({
    maxSize,
    onError: (c) =>
      c.json<ErrorBody>(
        {
          error: {
            code: "BODY_TOO_LARGE",
            // The panel has no text for this code and shows this message as is: it stays in Spanish.
            message: "El cuerpo de la solicitud supera el máximo",
            details: { max: maxSize },
          },
        },
        413,
      ),
  });
export const bodyCap = createMiddleware<ApiEnv>((c, next) =>
  capFor(c.env.IMAGENES === undefined ? MAX_BASIC_BODY_SIZE : MAX_BODY_SIZE)(c, next),
);

/** Turns the photo fields into the gallery and the uploads of core; every file goes through `verifyImage`. */
export async function readPhotos(data: {
  image?: File | undefined;
  gallery?: PhotoRef[] | undefined;
  [file: `image_${number}`]: File | undefined;
}) {
  const files = Array.from({ length: MAX_UPLOADS }, (_, i) => data[`image_${i}`]);
  const sent = files.filter((f): f is File => f !== undefined);
  if (data.image !== undefined && (data.gallery !== undefined || sent.length > 0)) {
    return err(domainError("INVALID_IMAGE", "Send either image or gallery with image_0 … image_7"));
  }
  if (files.slice(0, sent.length).some((f) => f === undefined)) {
    return err(domainError("INVALID_IMAGE", "The files must be image_0, image_1 … without gaps"));
  }
  const uploads: Upload[] = [];
  for (const file of data.image !== undefined ? [data.image] : sent) {
    const problem = verifyImage(file.name, file.type);
    if (problem !== null) return err(problem);
    uploads.push({ bytes: new Uint8Array(await file.arrayBuffer()), mimeType: file.type });
  }
  // Neither image, gallery nor files: the product's photos stay as they are.
  const gallery = data.image !== undefined ? [{ upload: 0 }] : data.gallery;
  return ok(gallery === undefined && uploads.length === 0 ? {} : { gallery: gallery ?? [], uploads });
}

export const productRoutes = new Hono<ApiEnv>()
  .get("/", async (c) => {
    const products = await build(c.env).listProducts();
    return c.json(products.map(toProductJson));
  })
  .get("/:slug", async (c) => {
    const r = await build(c.env).getProduct(c.req.param("slug"));
    if (!r.ok) return respondDomainError(c, r.error);
    return c.json(toProductJson(r.value));
  })
  .post(
    "/",
    // Only the owner, with a full session. The app already required the origin.
    requireSession("completa"),
    bodyCap,
    validate("form", creationSchema, "Invalid product data"),
    async (c) => {
      const data = c.req.valid("form");
      const price = money(data.price_amount, data.price_currency);
      if (!price.ok) return respondDomainError(c, price.error);
      const photos = await readPhotos(data);
      if (!photos.ok) return respondDomainError(c, photos.error);
      const r = await build(c.env).createProduct({
        name: data.name,
        price: price.value,
        publish: data.publish,
        categoryId: data.category_id,
        ...(data.options !== undefined ? { options: data.options } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...photos.value,
      });
      if (!r.ok) return respondDomainError(c, r.error);
      return c.json(toProductJson(r.value), 201);
    },
  )
  .put(
    "/:id",
    requireSession("completa"),
    bodyCap,
    validate("form", updateSchema, "Invalid product data"),
    async (c) => {
      const data = c.req.valid("form");
      const price = money(data.price_amount, data.price_currency);
      if (!price.ok) return respondDomainError(c, price.error);
      const photos = await readPhotos(data);
      if (!photos.ok) return respondDomainError(c, photos.error);
      const r = await build(c.env).updateProduct(c.req.param("id"), {
        name: data.name,
        description: data.description,
        price: price.value,
        categoryId: data.category_id,
        status: data.status,
        ...(data.options !== undefined ? { options: data.options } : {}),
        ...photos.value,
      });
      if (!r.ok) return respondDomainError(c, r.error);
      return c.json(toProductJson(r.value));
    },
  )
  .delete("/:id", requireSession("completa"), async (c) => {
    const r = await build(c.env).deleteProduct(c.req.param("id"));
    if (!r.ok) return respondDomainError(c, r.error);
    return c.json(r.value);
  });

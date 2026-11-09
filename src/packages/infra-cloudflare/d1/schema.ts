import { sql } from "drizzle-orm";
import { blob, check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** The `LANGUAGES` of core (same approach as the onboarding steps below). */
const LANGUAGES = ["es", "en", "pt"] as const;

// TS property names are English; the SQL table/column names (strings) are the D1 schema and stay in Spanish.

/** One row per deployment. */
export const stores = sqliteTable("tiendas", {
  id: text("id").primaryKey(),
  name: text("nombre").notNull(),
  description: text("descripcion").notNull().default(""),
  logoKey: text("logo_key"),
  currency: text("moneda").notNull(),
  language: text("idioma", { enum: LANGUAGES }).notNull().default("es"),
  contactWhatsapp: text("contacto_whatsapp"),
  contactEmail: text("contacto_email"),
  domain: text("dominio"),
  /** Daily announcement to tutiendita.ar: on by default, and the ISO date of the last one. */
  heartbeatEnabled: integer("latido_activo", { mode: "boolean" }).notNull().default(true),
  heartbeatSentAt: text("latido_en"),
  createdAt: text("creado_en").notNull(),
  updatedAt: text("actualizado_en").notNull(),
});

export const categories = sqliteTable("categorias", {
  id: text("id").primaryKey(),
  name: text("nombre").notNull(),
  slug: text("slug").notNull().unique(),
  parentId: text("padre_id"),
});

export const products = sqliteTable(
  "productos",
  {
    id: text("id").primaryKey(),
    name: text("nombre").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("descripcion").notNull().default(""),
    priceAmount: integer("precio_monto").notNull(),
    priceCurrency: text("precio_moneda").notNull(),
    stock: integer("stock"),
    status: text("estado", { enum: ["borrador", "publicado", "pausado"] }).notNull(),
    categoryId: text("categoria_id").references(() => categories.id),
    federate: integer("federar", { mode: "boolean" }).notNull().default(false),
    version: integer("version").notNull(),
    createdAt: text("creado_en").notNull(),
    updatedAt: text("actualizado_en").notNull(),
  },
  (t) => [
    index("productos_estado_idx").on(t.status),
    check("productos_estado_check", sql`${t.status} IN ('borrador', 'publicado', 'pausado')`),
  ],
);

export const productImages = sqliteTable(
  "imagenes_producto",
  {
    id: text("id").primaryKey(),
    productId: text("producto_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    position: integer("orden").notNull(),
  },
  (t) => [index("imagenes_producto_producto_idx").on(t.productId)],
);

// --- Variants: product options with their values, and the category's templates ---

/** Variant templates of a category, copied into the products created there (see core options.ts). */
export const optionTemplates = sqliteTable(
  "plantillas_opcion",
  {
    id: text("id").primaryKey(),
    categoryId: text("categoria_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    name: text("nombre").notNull(),
    /** JSON `[{"etiqueta","ajuste"}]`: they are defaults, never queried on their own. */
    valuesJson: text("valores_json").notNull(),
    position: integer("orden").notNull(),
  },
  (t) => [index("plantillas_opcion_categoria_idx").on(t.categoryId)],
);

export const productOptions = sqliteTable(
  "opciones_producto",
  {
    id: text("id").primaryKey(),
    productId: text("producto_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("nombre").notNull(),
    position: integer("orden").notNull(),
  },
  (t) => [index("opciones_producto_producto_idx").on(t.productId)],
);

export const optionValues = sqliteTable(
  "valores_opcion",
  {
    id: text("id").primaryKey(),
    optionId: text("opcion_id")
      .notNull()
      .references(() => productOptions.id, { onDelete: "cascade" }),
    label: text("etiqueta").notNull(),
    /** In the product currency's minor unit; may be negative. */
    priceDelta: integer("ajuste_precio").notNull().default(0),
    /** Key of one of the product's photos; null when the value has none. */
    imageKey: text("imagen_clave"),
    position: integer("orden").notNull(),
  },
  (t) => [index("valores_opcion_opcion_idx").on(t.optionId)],
);

// --- Access and onboarding ---

// Stored in D1: values stay in Spanish.
const ONBOARDING_STEPS = ["acceso", "nombre", "whatsapp", "transferencia", "producto"] as const;

/** A single row (id = 1): exists if and only if the store has an owner. */
export const access = sqliteTable(
  "acceso",
  {
    id: integer("id").primaryKey(),
    webauthnUserId: text("webauthn_user_id").notNull(),
    claimedAt: text("reclamada_en").notNull(),
    /** SHA-256 (hex) of the current recovery code; null after it is used. */
    recoveryCodeHash: text("codigo_recuperacion_hash"),
    recoveryCodeCreatedAt: text("codigo_recuperacion_creado_en"),
    /** Hash of the owner's sign-in password (for owners without a passkey, see ADR-020); null if there is none. */
    keyHash: text("clave_hash"),
    onboardingStep: text("primer_ingreso_paso", { enum: ONBOARDING_STEPS }).notNull(),
    onboardingCompletedAt: text("primer_ingreso_completado_en"),
  },
  (t) => [
    check("acceso_una_fila_check", sql`${t.id} = 1`),
    check(
      "acceso_paso_check",
      sql`${t.onboardingStep} IN ('acceso', 'nombre', 'whatsapp', 'transferencia', 'producto')`,
    ),
  ],
);

export const allowedOrigins = sqliteTable("origenes_permitidos", {
  origin: text("origen").primaryKey(),
  rpId: text("rp_id").notNull(),
  primary: integer("principal", { mode: "boolean" }).notNull(),
  addedAt: text("agregado_en").notNull(),
});

export const passkeyCredentials = sqliteTable("credenciales_passkey", {
  /** base64url, as the browser sends it. */
  id: text("id").primaryKey(),
  publicKeyBytes: blob("clave_publica").notNull(),
  counter: integer("contador").notNull(),
  /** JSON with the list of transports. */
  transports: text("transportes").notNull(),
  rpId: text("rp_id").notNull(),
  origin: text("origen").notNull(),
  deviceType: text("tipo_dispositivo").notNull(),
  backedUp: integer("respaldada", { mode: "boolean" }).notNull(),
  name: text("nombre").notNull(),
  createdAt: text("creada_en").notNull(),
  lastUsedAt: text("ultimo_uso_en"),
});

/** The session id only travels in the cookie; its SHA-256 goes here. */
export const sessions = sqliteTable(
  "sesiones",
  {
    idHash: text("id_hash").primaryKey(),
    type: text("tipo", { enum: ["completa", "reclamo", "recuperacion"] }).notNull(),
    createdAt: text("creada_en").notNull(),
    expiresAt: text("expira_en").notNull(),
    lastUsedAt: text("ultimo_uso_en").notNull(),
  },
  (t) => [
    index("sesiones_expira_en_idx").on(t.expiresAt),
    check("sesiones_tipo_check", sql`${t.type} IN ('completa', 'reclamo', 'recuperacion')`),
  ],
);

export const webauthnChallenges = sqliteTable(
  "desafios_webauthn",
  {
    id: text("id").primaryKey(),
    challenge: text("desafio").notNull(),
    purpose: text("proposito", { enum: ["registro", "ingreso"] }).notNull(),
    sessionIdHash: text("sesion_id_hash"),
    /** `user.id` sent in the registration options (the browser does not return it). */
    webauthnUserId: text("webauthn_user_id"),
    expiresAt: text("expira_en").notNull(),
  },
  (t) => [check("desafios_webauthn_proposito_check", sql`${t.purpose} IN ('registro', 'ingreso')`)],
);

/** `clave` = `reclamo:<ip>` or `recuperacion:<ip>`; `ventana` = start of the 15-minute window. */
export const failedAttempts = sqliteTable(
  "intentos_fallidos",
  {
    key: text("clave").notNull(),
    windowStart: text("ventana").notNull(),
    quantity: integer("cantidad").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const paymentMethods = sqliteTable(
  "medios_de_pago",
  {
    type: text("tipo", { enum: ["whatsapp", "transferencia"] }).primaryKey(),
    active: integer("activo", { mode: "boolean" }).notNull(),
    /** JSON validated in core, with Spanish keys (see payment-method-repository-d1). */
    config: text("configuracion").notNull(),
    updatedAt: text("actualizado_en").notNull(),
  },
  (t) => [check("medios_de_pago_tipo_check", sql`${t.type} IN ('whatsapp', 'transferencia')`)],
);

/** The store's own GitHub App, used to update it from the panel. A single row (`id` = 1). */
export const githubConnection = sqliteTable(
  "conexion_github",
  {
    id: integer("id").primaryKey(),
    appId: integer("app_id").notNull(),
    slug: text("slug").notNull(),
    /** PEM returned by GitHub; whoever can access this database already owns the store. */
    privateKeyPem: text("clave_privada").notNull(),
    installationId: integer("instalacion_id"),
    repository: text("repositorio"),
    updatedAt: text("actualizado_en").notNull(),
  },
  (t) => [check("conexion_github_una_fila", sql`${t.id} = 1`)],
);

/** Photos stored in D1 (basic mode, no R2). `key` is `${ulid}.${ext}`, like the R2 keys. */
export const imageBlobs = sqliteTable("imagenes_blob", {
  key: text("key").primaryKey(),
  mime: text("mime").notNull(),
  bytes: blob("bytes", { mode: "buffer" }).notNull(),
  createdAt: text("creado_en").notNull(),
});

/** WhatsApp orders. `items` is a JSON snapshot, written and read only by order-repository-d1. */
export const orders = sqliteTable(
  "pedidos",
  {
    id: text("id").primaryKey(),
    buyerName: text("comprador_nombre").notNull(),
    buyerAddress: text("comprador_direccion").notNull().default(""),
    note: text("nota").notNull().default(""),
    paymentMethod: text("medio_de_pago", { enum: ["whatsapp", "transferencia"] }).notNull(),
    items: text("items").notNull(),
    totalAmount: integer("total_monto").notNull(),
    totalCurrency: text("total_moneda").notNull(),
    status: text("estado", { enum: ["nuevo", "contactado", "pagado", "entregado", "cancelado"] }).notNull(),
    createdAt: text("creado_en").notNull(),
    updatedAt: text("actualizado_en").notNull(),
  },
  (t) => [
    index("pedidos_estado_idx").on(t.status),
    check(
      "pedidos_estado_check",
      sql`${t.status} IN ('nuevo', 'contactado', 'pagado', 'entregado', 'cancelado')`,
    ),
  ],
);

/** Store settings as key/value (keys in core `SettingKey`). */
export const settings = sqliteTable("configuracion", {
  key: text("clave").primaryKey(),
  value: text("valor").notNull(),
  updatedAt: text("actualizado_en").notNull(),
});

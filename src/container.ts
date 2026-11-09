import {
  type AccessDeps,
  ADVANCE_ORDERS,
  CALENDAR_TOKEN,
  addCategory,
  advanceOnboarding,
  applyUpdate,
  type CustomDomainDeps,
  changeOrderStatus,
  changeStoreLanguage,
  checkDomain,
  claimWithKey,
  connectDomain,
  connectGithub,
  createProduct,
  deleteCategory,
  deletePasskey,
  deleteProduct,
  deleteSampleProducts,
  disconnectDomain,
  domainStatus,
  enableProfessionalPhotos,
  finishPasskeyRegistration,
  finishSignIn,
  getBrandColor,
  getProduct,
  getStoreStatus,
  type HostedUpdatesDeps,
  hostedUpdateStatus,
  listAllProducts,
  listOrders,
  listPasskeys,
  listPublishedProducts,
  loadSampleProducts,
  MAX_BASIC_IMAGE_SIZE,
  MAX_IMAGE_SIZE,
  type OnboardingDeps,
  type PhotoStorageDeps,
  photoStorageStatus,
  placeOrder,
  prepareUpdate,
  quoteOrder,
  regenerateRecoveryCode,
  registerInstallation,
  requestHostedUpdate,
  revertProfessionalPhotos,
  type StoreRegistry,
  saveStoreName,
  saveTransfer,
  saveWhatsapp,
  sendHeartbeat,
  setHeartbeatEnabled,
  setKeyPassword,
  signInWithKey,
  signInWithRecoveryCode,
  signOut,
  startPasskeyRegistration,
  startSignIn,
  type UpdatesDeps,
  updateCategory,
  updateProduct,
  updateStatus,
  updateStoreIdentity,
  validateClaimCode,
  validateSession,
} from "./packages/core/index";
import {
  createD1AccessRepository,
  createD1AttemptLimiter,
  createD1CategoryRepository,
  createD1ChallengeRepository,
  createD1CredentialRepository,
  createD1GithubConnectionRepository,
  createD1ImageStorage,
  createD1OrderRepository,
  createD1PaymentMethodRepository,
  createD1ProductRepository,
  createD1SessionRepository,
  createD1SettingsRepository,
  createD1StoreRepository,
  createDomainInspector,
  createGithubClient,
  createHostingClient,
  createR2ImageStorage,
  createRegistryClient,
  systemClock,
  ulidGenerator,
  webCryptography,
  withFallback,
} from "./packages/infra-cloudflare/index";
import { createSimpleWebAuthnCeremony } from "./adapters/simplewebauthn-ceremony";
import { codeHash } from "./claim";

/** The registry of active stores the daily heartbeat goes to (REGISTRY_URL overrides it; "" turns it off). */
export const DEFAULT_REGISTRY_URL = "https://tutiendita.ar";

/**
 * Hosted plan: one build serves every store and its own claim code sits in our build log, so a hosted store
 * only accepts the hash the deployer passed. Missing or malformed, the store can't be claimed at all.
 */
export function hostedClaimHash(value: string | undefined): string | null {
  const hash = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{64}$/.test(hash) ? hash : null;
}

/** A store of the hosted plan: its claim code arrives by email and it has no Cloudflare account of its own. */
export const isHosted = (env: Pick<Env, "HOSTING_URL">) => Boolean(env.HOSTING_URL);

/** Composition root: builds the use cases per request with the adapters from `env`. */
export function build(env: Env) {
  const repo = createD1ProductRepository(env.DB);
  const categories = createD1CategoryRepository(env.DB);
  // Photos go to D1 (basic mode) unless the Worker has the R2 binding; with R2, old D1 photos still resolve.
  const d1Images = createD1ImageStorage(env.DB, ulidGenerator);
  const hasBucket = env.IMAGENES !== undefined;
  const images = env.IMAGENES
    ? withFallback(createR2ImageStorage(env.IMAGENES, ulidGenerator), d1Images)
    : d1Images;
  const maxImageSize = hasBucket ? MAX_IMAGE_SIZE : MAX_BASIC_IMAGE_SIZE;
  // Hosted plan: the deployer sets MAX_PRODUCTS; anything that isn't a positive integer means no limit.
  const parsedMax = Number.parseInt(env.MAX_PRODUCTS ?? "", 10);
  const maxProducts = parsedMax > 0 ? parsedMax : undefined;
  const settings = createD1SettingsRepository(env.DB);
  const store = createD1StoreRepository(env.DB);
  const accessRepo = createD1AccessRepository(env.DB);
  const deps: AccessDeps = {
    access: accessRepo,
    credentials: createD1CredentialRepository(env.DB),
    sessions: createD1SessionRepository(env.DB),
    challenges: createD1ChallengeRepository(env.DB),
    limiter: createD1AttemptLimiter(env.DB),
    ceremony: createSimpleWebAuthnCeremony(),
    cryptography: webCryptography,
    clock: systemClock,
    store,
    claimCodeHash: isHosted(env) ? () => hostedClaimHash(env.CLAIM_CODE_HASH) : codeHash,
  };
  const onboardingDeps: OnboardingDeps = {
    access: accessRepo,
    store,
    methods: createD1PaymentMethodRepository(env.DB),
    clock: systemClock,
    ids: ulidGenerator,
  };
  const productDeps = {
    repo,
    categories,
    images,
    maxImageSize,
    pro: hasBucket,
    ...(maxProducts !== undefined ? { maxProducts } : {}),
    clock: systemClock,
    ids: ulidGenerator,
  };
  // Sample photos are static Worker assets (public/samples). They are requested with the request's own origin:
  // in production the host doesn't matter, but `astro dev` (Vite) rejects unknown hosts with 403.
  const readPhotoFrom = (origin: string) => async (path: string) => {
    const res = await env.ASSETS.fetch(new URL(path, origin));
    if (!res.ok) throw new Error(`Missing sample photo ${path} (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const updatesDeps: UpdatesDeps = {
    connection: createD1GithubConnectionRepository(env.DB),
    github: createGithubClient(),
    clock: systemClock,
  };
  // Hosted plan: updates go through the hosting service, not through a GitHub repository of the store.
  const hostedDeps: HostedUpdatesDeps | undefined =
    env.HOSTING_URL && env.HOSTING_TOKEN
      ? { hosting: createHostingClient(env.HOSTING_URL, env.HOSTING_TOKEN) }
      : undefined;
  const domainDeps: CustomDomainDeps = {
    access: accessRepo,
    store,
    connection: updatesDeps.connection,
    github: updatesDeps.github,
    inspector: createDomainInspector(),
    clock: systemClock,
  };
  const photoDeps: PhotoStorageDeps = {
    settings,
    images,
    connection: updatesDeps.connection,
    github: updatesDeps.github,
    access: accessRepo,
    clock: systemClock,
    hasBucket,
  };
  const orderRepo = createD1OrderRepository(env.DB);
  const registryUrl = env.REGISTRY_URL ?? DEFAULT_REGISTRY_URL;
  const registry: StoreRegistry =
    registryUrl === "" ? { async announce() {} } : createRegistryClient(registryUrl);
  return {
    storeStatus: getStoreStatus({ access: accessRepo }),
    allowedOrigins: async () => (await accessRepo.allowedOrigins()).map((o) => o.origin),
    allowedOriginsDetail: () => accessRepo.allowedOrigins(),
    getStore: () => store.get(),
    getPaymentMethod: onboardingDeps.methods.get.bind(onboardingDeps.methods),
    listProducts: listPublishedProducts({ repo }),
    listAllProducts: listAllProducts({ repo }),
    getProduct: getProduct({ repo }),
    createProduct: createProduct(productDeps),
    updateProduct: updateProduct(productDeps),
    deleteProduct: deleteProduct(productDeps),
    findProductById: (id: string) => repo.findById(id),
    quoteOrder: quoteOrder({ repo }),
    orders: {
      place: placeOrder({ repo, orders: orderRepo, settings, ids: ulidGenerator, clock: systemClock }),
      list: listOrders({ orders: orderRepo }),
      changeStatus: changeOrderStatus({ orders: orderRepo, clock: systemClock }),
      limiter: deps.limiter,
    },
    listCategories: () => categories.list(),
    categories: {
      create: addCategory({ categories, ids: ulidGenerator }),
      update: updateCategory({ categories }),
      remove: deleteCategory({ categories }),
      findById: (id: string) => categories.findById(id),
    },
    samples: {
      load: (industry: Parameters<ReturnType<typeof loadSampleProducts>>[0], origin: string) =>
        loadSampleProducts({ ...productDeps, store, readPhoto: readPhotoFrom(origin) })(industry),
      remove: deleteSampleProducts(productDeps),
    },
    access: {
      validateClaimCode: validateClaimCode(deps),
      startPasskeyRegistration: startPasskeyRegistration(deps),
      finishPasskeyRegistration: finishPasskeyRegistration(deps),
      startSignIn: startSignIn(deps),
      finishSignIn: finishSignIn(deps),
      signInWithRecoveryCode: signInWithRecoveryCode(deps),
      regenerateRecoveryCode: regenerateRecoveryCode(deps),
      claimWithKey: claimWithKey(deps),
      setKeyPassword: setKeyPassword(deps),
      signInWithKey: signInWithKey(deps),
      validateSession: validateSession(deps),
      signOut: signOut(deps),
      listPasskeys: listPasskeys(deps),
      deletePasskey: deletePasskey(deps),
    },
    onboarding: {
      saveStoreName: saveStoreName(onboardingDeps),
      changeLanguage: changeStoreLanguage(onboardingDeps),
      saveWhatsapp: saveWhatsapp(onboardingDeps),
      saveTransfer: saveTransfer(onboardingDeps),
      advance: advanceOnboarding(onboardingDeps),
    },
    updates: {
      getConnection: () => updatesDeps.connection.get(),
      status: updateStatus(updatesDeps),
      connect: connectGithub(updatesDeps),
      registerInstallation: registerInstallation(updatesDeps),
      prepare: prepareUpdate(updatesDeps),
      apply: applyUpdate(updatesDeps),
      hosted: hostedDeps && {
        status: hostedUpdateStatus(hostedDeps),
        request: requestHostedUpdate(hostedDeps),
      },
    },
    domain: {
      status: domainStatus(domainDeps),
      check: checkDomain(domainDeps),
      connect: connectDomain(domainDeps),
      disconnect: disconnectDomain(domainDeps),
    },
    photos: {
      status: photoStorageStatus(photoDeps),
      enable: enableProfessionalPhotos(photoDeps),
      revert: revertProfessionalPhotos(photoDeps),
    },
    identity: {
      update: updateStoreIdentity({ store, settings, images, clock: systemClock, maxImageSize }),
      color: getBrandColor({ settings }),
    },
    advanceOrders: {
      isEnabled: async () => (await settings.get(ADVANCE_ORDERS)) === "1",
      // "" counts as off: the settings table has no delete.
      setEnabled: (enabled: boolean) => settings.set(ADVANCE_ORDERS, enabled ? "1" : "", systemClock.now()),
    },
    calendar: {
      token: async () => (await settings.get(CALENDAR_TOKEN)) || null,
      /** A new secret (32 random bytes, base64url): the previous link stops working. */
      rotate: async () => {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        await settings.set(CALENDAR_TOKEN, token, systemClock.now());
        return token;
      },
    },
    heartbeat: {
      send: (origin: string) => sendHeartbeat({ store, registry }, origin, systemClock.now()),
      setEnabled: (enabled: boolean) => setHeartbeatEnabled({ store }, enabled, systemClock.now()),
    },
    images,
    hasBucket,
    /** Hosted plan: the hosting service deploys and updates the store (no GitHub flows). */
    hosted: hostedDeps !== undefined,
  };
}

export type Container = ReturnType<typeof build>;

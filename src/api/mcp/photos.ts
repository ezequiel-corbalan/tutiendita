import { domainError, type DomainError, err, ok, type Result, type Upload } from "../../packages/core/index";
import type { Container } from "../../container";
import { type PhotoTarget, type PhotoTicket, readTicket } from "../../lib/photo-ticket";

/** The ticket in an upload link, checked against the assistant's current token (none: every link is dead). */
export async function ticketFrom(container: Container, ticket: string): Promise<PhotoTicket | null> {
  const secret = await container.assistant.token();
  return secret ? readTicket(secret, ticket, new Date()) : null;
}

/** What an upload link points to, as the upload page shows it. */
export async function describeTarget(
  container: Container,
  target: PhotoTarget,
): Promise<{ name: string; photos: number } | null> {
  if ("logo" in target) {
    const store = await container.getStore();
    return store && { name: store.name, photos: store.logoKey === null ? 0 : 1 };
  }
  const p = await container.findProductById(target.product);
  return p && { name: p.name, photos: p.images.length };
}

/**
 * Saves the photos the owner uploaded through the link. A product keeps its photos and gets the new ones after
 * them; basic storage holds one photo per product, so there the new one replaces it. The logo is replaced.
 */
export async function savePhotos(
  container: Container,
  target: PhotoTarget,
  uploads: readonly Upload[],
): Promise<Result<{ uploaded: number }, DomainError>> {
  const first = uploads[0];
  if (first === undefined) return err(domainError("INVALID_IMAGE", "Pick at least one photo"));
  if ("logo" in target) {
    const [store, color] = await Promise.all([container.getStore(), container.identity.color()]);
    if (store === null) return err(domainError("INVALID_STEP", "The store isn't set up yet"));
    const r = await container.identity.update({ name: store.name, description: store.description, color, logo: first });
    return r.ok ? ok({ uploaded: 1 }) : r;
  }
  const p = await container.findProductById(target.product);
  if (p === null) return err(domainError("PRODUCT_NOT_FOUND", "The product does not exist", { id: target.product }));
  const kept = container.hasBucket ? [...p.images].sort((a, b) => a.position - b.position).map((i) => ({ key: i.key })) : [];
  const r = await container.updateProduct(p.id, {
    name: p.name,
    description: p.description,
    price: p.price,
    categoryId: p.categoryId,
    status: p.status,
    gallery: [...kept, ...uploads.map((_, upload) => ({ upload }))],
    uploads,
  });
  return r.ok ? ok({ uploaded: uploads.length }) : r;
}

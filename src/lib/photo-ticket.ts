/**
 * A photo-upload link the AI assistant hands the owner: what it uploads to (a product or the logo) and until
 * when, signed with HMAC-SHA256 under the assistant's token. No table: changing or disconnecting the assistant
 * kills every ticket, and a ticket can't be edited to point at another product.
 */
export type PhotoTarget = { product: string } | { logo: true };
export type PhotoTicket = { target: PhotoTarget; expiresAt: Date };

/** 24 hours: enough to get home and take the photos. */
export const TICKET_TTL_MS = 24 * 60 * 60 * 1000;

const encoder = new TextEncoder();
const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const key = (secret: string) =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export async function signTicket(secret: string, target: PhotoTarget, now: Date): Promise<string> {
  const body = toBase64Url(
    encoder.encode(JSON.stringify({ ...("logo" in target ? { l: 1 } : { p: target.product }), e: now.getTime() + TICKET_TTL_MS })),
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

/** The ticket, or null when it's malformed, forged, signed with another token or expired. */
export async function readTicket(secret: string, ticket: string, now: Date): Promise<PhotoTicket | null> {
  const [body, signature, extra] = ticket.split(".");
  if (!body || !signature || extra !== undefined || ticket.length > 512) return null;
  try {
    // crypto.subtle.verify compares in constant time.
    if (!(await crypto.subtle.verify("HMAC", await key(secret), fromBase64Url(signature), encoder.encode(body)))) return null;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as { p?: unknown; l?: unknown; e?: unknown };
    if (typeof data.e !== "number" || data.e <= now.getTime()) return null;
    const target: PhotoTarget | null =
      data.l === 1 ? { logo: true } : typeof data.p === "string" && data.p !== "" ? { product: data.p } : null;
    return target && { target, expiresAt: new Date(data.e) };
  } catch {
    return null;
  }
}

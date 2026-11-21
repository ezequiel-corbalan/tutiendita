import { ORDER_STATUSES, type OrderStatus, type ProductStatus } from "../packages/core/index";

/**
 * Changes an AI without tools proposes as a link the owner opens and confirms (/confirmar/<token>?…).
 * One query parameter per change, simple enough for any model to write by hand:
 *   price=<product id>:<new price>  status=<product id>:<publicado|pausado|borrador>
 *   delete=<product id>             order=<order id>:<order status>
 */
export type LinkAction =
  | { type: "price"; id: string; price: number }
  | { type: "status"; id: string; status: ProductStatus }
  | { type: "delete"; id: string }
  | { type: "order"; id: string; status: OrderStatus };

export const MAX_LINK_ACTIONS = 100;

const PRODUCT_STATUSES: readonly string[] = ["publicado", "pausado", "borrador"];
const ID = /^[\w-]{1,64}$/;

/** Every recognised change, and the raw `name=value` of the ones that aren't (shown to the owner, never applied). */
export function parseActions(params: URLSearchParams): { actions: LinkAction[]; invalid: string[] } {
  const actions: LinkAction[] = [];
  const invalid: string[] = [];
  for (const [name, raw] of params) {
    const value = raw.trim();
    const [id = "", arg = ""] = value.split(":");
    let action: LinkAction | null = null;
    if (name === "delete" && ID.test(value)) action = { type: "delete", id: value };
    else if (ID.test(id)) {
      // "1500,50" is how half the region writes decimals.
      const price = Number(arg.includes(".") ? arg : arg.replace(",", "."));
      if (name === "price" && arg !== "" && Number.isFinite(price) && price >= 0) action = { type: "price", id, price };
      if (name === "status" && PRODUCT_STATUSES.includes(arg)) action = { type: "status", id, status: arg as ProductStatus };
      if (name === "order" && (ORDER_STATUSES as readonly string[]).includes(arg)) {
        action = { type: "order", id, status: arg as OrderStatus };
      }
    }
    // A cache-buster the AI may add (v=2) isn't a change.
    if (name === "v") continue;
    if (action && actions.length < MAX_LINK_ACTIONS) actions.push(action);
    else invalid.push(`${name}=${raw}`.slice(0, 120));
  }
  return { actions, invalid };
}

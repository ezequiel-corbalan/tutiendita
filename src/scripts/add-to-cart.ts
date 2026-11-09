// The quantity stepper and the "Agregado" flash, shared by the product page and the catalog cards.
import { addToCart, MAX_QUANTITY } from "./cart";

/** 1 to MAX_QUANTITY; a blank or garbled number counts as 1. */
export const clampQuantity = (value: unknown): number =>
  Math.max(1, Math.min(MAX_QUANTITY, Math.round(Number(value)) || 1));

/** − and + buttons (`[data-step]`) change the `[data-quantity]` input of their `[data-buy]` box. */
export function wireStepper(root: ParentNode): void {
  root.addEventListener("click", (event) => {
    const step = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-step]");
    const input = step?.closest("[data-buy]")?.querySelector<HTMLInputElement>("[data-quantity]");
    if (!step || !input) return;
    input.value = String(clampQuantity(clampQuantity(input.value) + Number(step.dataset.step)));
  });
}

const timers = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>();

/** The button reads "Agregado" with a check for 2 s, then its own label again. */
export function flashAdded(button: HTMLButtonElement): void {
  const text = button.querySelector<HTMLElement>("[data-add-text]");
  if (text && text.dataset.label === undefined) text.dataset.label = text.textContent ?? "";
  if (text) text.textContent = button.dataset.addedText ?? text.dataset.label ?? "";
  button.classList.add("product-page__add--added");
  clearTimeout(timers.get(button));
  timers.set(
    button,
    setTimeout(() => {
      if (text) text.textContent = text.dataset.label ?? "";
      button.classList.remove("product-page__add--added");
    }, 2000),
  );
}

/**
 * Catalog cards (home, categories and "related" on a product page): quantity and "Agregar" without opening the
 * product. Only cards of products without options have the button. A polite live region says what was added.
 */
export function wireCatalog(): void {
  const status = document.createElement("p");
  status.className = "visually-hidden";
  status.setAttribute("role", "status");
  document.body.append(status);
  for (const list of document.querySelectorAll<HTMLElement>(".catalog")) {
    wireStepper(list);
    list.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-add-to-cart]");
      if (!button) return;
      const d = button.dataset;
      const input = button.closest("[data-buy]")?.querySelector<HTMLInputElement>("[data-quantity]");
      addToCart(
        {
          productId: d.productId ?? "",
          slug: d.slug ?? "",
          name: d.name ?? "",
          // Preview only: the cart is priced again on the server.
          amount: Number(d.amount),
          currency: d.currency ?? "ARS",
          image: d.image || null,
        },
        clampQuantity(input?.value),
      );
      if (input) input.value = "1";
      flashAdded(button);
      status.textContent = `${d.addedText ?? ""}: ${d.name ?? ""}`;
    });
  }
}

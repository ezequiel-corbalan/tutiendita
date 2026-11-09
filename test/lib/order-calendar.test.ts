import { describe, expect, it } from "vitest";
import { googleCalendarUrl, orderEvent } from "../../src/lib/order-calendar";
import { sampleOrder } from "../helpers";

const order = {
  ...sampleOrder("01ABC", "nuevo", "2026-11-09T10:00:00Z"),
  buyer: { name: "Ana", address: "San Martín 123" },
  scheduled: { for: "2026-11-14T18:00", fulfillment: "envio" as const },
};

describe("orderEvent", () => {
  it("names the buyer and how it's handed over, and lists items, address, total and payment", () => {
    const e = orderEvent(order, "tienda.test", "es");
    expect(e).toMatchObject({ uid: "01ABC@tienda.test", start: "2026-11-14T18:00", location: "San Martín 123" });
    expect(e.summary).toBe("Pedido de Ana — Envío");
    expect(e.description).toContain("1 x Torta");
    expect(e.description).toMatch(/Total: \$\s?1,00/);
    expect(e.description).toContain("Se arregla por WhatsApp");
  });
  it("a pickup has no location", () => {
    expect(orderEvent({ ...order, scheduled: { ...order.scheduled, fulfillment: "retiro" } }, "t", "es").location).toBe("");
  });
});

describe("googleCalendarUrl", () => {
  it("opens Google's new-event form with the floating 30-minute slot", () => {
    const url = new URL(googleCalendarUrl(orderEvent(order, "tienda.test", "es")));
    expect(`${url.origin}${url.pathname}`).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261114T180000/20261114T183000");
    expect(url.searchParams.get("text")).toBe("Pedido de Ana — Envío");
    expect(url.searchParams.get("location")).toBe("San Martín 123");
  });
});

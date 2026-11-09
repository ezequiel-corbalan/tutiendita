import { addMinutes, type CalendarEvent, EVENT_MINUTES, floating, type Language, type Order } from "../packages/core/index";
import { LOCALES, texts } from "../i18n";
import { formatMoney } from "../scripts/cart";

/** One advance order as a calendar event, in the store's language. Only call it with `o.scheduled` set. */
export function orderEvent(o: Order, host: string, language: Language): CalendarEvent {
  const t = texts(language).panelSales;
  const when = o.scheduled ?? { for: "", fulfillment: "retiro" as const };
  const lines = [
    ...o.items.map((i) => `${i.quantity} x ${i.name}${i.variant ? ` (${i.variant})` : ""}`),
    "",
    ...(o.buyer.address ? [`${t.address}: ${o.buyer.address}`] : []),
    `${t.total}: ${formatMoney(o.total.amount, o.total.currency, LOCALES[language])}`,
    `${t.payment}: ${t.paymentNames[o.paymentMethod]}`,
    ...(o.note ? [`${t.note}: ${o.note}`] : []),
    t.statusNames[o.status],
  ];
  return {
    uid: `${o.id}@${host}`,
    start: when.for,
    summary: t.calendarSummary(o.buyer.name, t.fulfillmentNames[when.fulfillment]),
    description: lines.join("\n"),
    location: when.fulfillment === "envio" ? o.buyer.address : "",
  };
}

/** Google Calendar's "new event" form, filled in: no account linking needed. */
export function googleCalendarUrl(e: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.summary,
    // Floating times: Google uses the calendar's own zone, the same clock the buyer typed.
    dates: `${floating(e.start)}/${floating(addMinutes(e.start, EVENT_MINUTES))}`,
    details: e.description,
    ...(e.location ? { location: e.location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// Calendar for advance orders: the month grid of the panel and the iCalendar feed (RFC 5545) Google subscribes to.
// Dates are the buyer's local "YYYY-MM-DDTHH:MM" (no zone): read and written as UTC so nothing shifts.

export type CalendarDay = { readonly date: string; readonly inMonth: boolean };

/** The weeks (Monday to Sunday) that cover the month, padded with the neighbouring months' days. */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const first = Date.UTC(year, month - 1, 1);
  const offset = (new Date(first).getUTCDay() + 6) % 7; // Monday = 0
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < Math.ceil((offset + days) / 7) * 7; i++) {
    const d = new Date(first + (i - offset) * 86_400_000);
    if (i % 7 === 0) weeks.push([]);
    weeks.at(-1)?.push({ date: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === month - 1 });
  }
  return weeks;
}

export const addMinutes = (text: string, minutes: number): string =>
  new Date(new Date(`${text}:00Z`).getTime() + minutes * 60_000).toISOString().slice(0, 16);

export type CalendarEvent = {
  readonly uid: string;
  /** The buyer's local "YYYY-MM-DDTHH:MM"; the event lasts EVENT_MINUTES. */
  readonly start: string;
  readonly summary: string;
  readonly description: string;
  /** "" for none. */
  readonly location: string;
};

export const EVENT_MINUTES = 30;

/** Floating time ("20261114T180000", no Z, no TZID): the calendar shows it in its own zone, as typed. */
export const floating = (text: string): string => `${text.replace(/[-:]/g, "")}00`;

const escapeText = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\r?\n/g, "\\n");

/** Lines of at most 75 octets, continued with CRLF + space, never splitting a UTF-8 character. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    while (end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--; // back off a continuation byte
    parts.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
    limit = 74; // the leading space counts
  }
  return parts.join("\r\n ");
}

export function toICS(events: readonly CalendarEvent[], now: Date): string {
  const stamp = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//tutiendita//pedidos por adelantado//ES",
    "CALSCALE:GREGORIAN",
    ...events.flatMap((e) => [
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${floating(e.start)}`,
      `DTEND:${floating(addMinutes(e.start, EVENT_MINUTES))}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

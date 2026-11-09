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

// Buyer text comes from a public form: any line break (a lone CR too) becomes \n and other control characters
// go, so it can never start a property or an event of its own.
const escapeText = (s: string) =>
  s
    .replace(/[\\;,]/g, (c) => `\\${c}`)
    .replace(/\r\n|\r|\n/g, "\\n")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

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

export type CalendarOptions = {
  /** The calendar's name in Google (X-WR-CALNAME). */
  readonly name?: string;
  /**
   * The shop's IANA zone. Google reads bare (floating) times in a subscribed feed as UTC, so with a zone the times
   * carry it. shortcut: TZID without a VTIMEZONE block; Google, Apple and Outlook accept the IANA name alone.
   */
  readonly timeZone?: string;
};

export function toICS(events: readonly CalendarEvent[], now: Date, options: CalendarOptions = {}): string {
  const stamp = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const at = (text: string) => `${options.timeZone ? `;TZID=${options.timeZone}` : ""}:${floating(text)}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//tutiendita//pedidos por adelantado//ES",
    "CALSCALE:GREGORIAN",
    ...(options.name ? [`X-WR-CALNAME:${escapeText(options.name)}`] : []),
    ...(options.timeZone ? [`X-WR-TIMEZONE:${options.timeZone}`] : []),
    ...events.flatMap((e) => [
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART${at(e.start)}`,
      `DTEND${at(addMinutes(e.start, EVENT_MINUTES))}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(e.description)}`,
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

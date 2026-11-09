/**
 * "sáb 14/11, 18:00" from the buyer's "2026-11-14T18:00". The text is local time with no zone: it's read as UTC
 * and formatted in UTC, so the day and hour come out exactly as typed in any time zone.
 */
export const scheduledLabel = (text: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(`${text}:00Z`));

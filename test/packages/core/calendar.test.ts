import { describe, expect, it } from "vitest";
import { addMinutes, type CalendarEvent, monthGrid, toICS } from "../../../src/packages/core/domain/calendar";

describe("monthGrid", () => {
  it("weeks run Monday to Sunday, padded with the neighbouring months' days", () => {
    const weeks = monthGrid(2026, 11);
    expect(weeks[0]?.[0]).toEqual({ date: "2026-10-26", inMonth: false });
    expect(weeks[0]?.[6]).toEqual({ date: "2026-11-01", inMonth: true });
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(30);
    expect(weeks.at(-1)?.[6]?.date).toBe("2026-12-06");
  });
  it("a leap February has 29 days", () => {
    expect(monthGrid(2028, 2).flat().filter((d) => d.inMonth)).toHaveLength(29);
  });
});

describe("addMinutes", () => {
  it("adds over midnight and the year end, without time zones", () => {
    expect(addMinutes("2026-12-31T23:45", 30)).toBe("2027-01-01T00:15");
    expect(addMinutes("2026-11-14T18:00", 30)).toBe("2026-11-14T18:30");
  });
});

describe("toICS", () => {
  const event = (extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
    uid: "01ABC@tienda.test",
    start: "2026-11-14T18:00",
    summary: "Pedido de Ana, Juan; x",
    description: "12 x Empanada\nTotal: $ 18.000",
    location: "",
    ...extra,
  });
  const now = new Date("2026-11-09T15:04:05Z");

  it("CRLF lines, floating 30-minute events, a stable UID and escaped text", () => {
    const ics = toICS([event()], now);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics).toContain("\r\nUID:01ABC@tienda.test\r\n");
    expect(ics).toContain("\r\nDTSTART:20261114T180000\r\n");
    expect(ics).toContain("\r\nDTEND:20261114T183000\r\n");
    expect(ics).toContain("\r\nDTSTAMP:20261109T150405Z\r\n");
    expect(ics).toContain("\r\nSUMMARY:Pedido de Ana\\, Juan\\; x\r\n");
    expect(ics).toContain("\r\nDESCRIPTION:12 x Empanada\\nTotal: $ 18.000\r\n");
    expect(ics).not.toContain("LOCATION:");
  });

  it("folds long lines at 75 octets without splitting a character", () => {
    const ics = toICS([event({ summary: "ñ".repeat(100) })], now);
    const lines = ics.split("\r\n");
    const enc = new TextEncoder();
    expect(lines.every((l) => enc.encode(l).length <= 75)).toBe(true);
    const start = lines.findIndex((l) => l.startsWith("SUMMARY:"));
    const unfolded = [lines[start], ...lines.slice(start + 1).filter((_, i, rest) => rest.slice(0, i + 1).every((l) => l.startsWith(" ")))]
      .map((l, i) => (i === 0 ? l : l?.slice(1)))
      .join("");
    expect(unfolded).toBe(`SUMMARY:${"ñ".repeat(100)}`);
    expect(ics).not.toContain("�");
  });

  it("a lone CR or another control character can't start a new line or property", () => {
    const ics = toICS([event({ summary: "Ana\rEND:VEVENT\rBEGIN:VEVENT", description: "a\u0000b\u001bc" })], now);
    expect(ics).toContain("\r\nSUMMARY:Ana\\nEND:VEVENT\\nBEGIN:VEVENT\r\n");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2); // the real one and the escaped text
    expect(ics.split("\r\n").filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(ics).toContain("\r\nDESCRIPTION:abc\r\n");
    expect(ics).not.toMatch(/\r(?!\n)/);
  });

  it("with the shop's time zone, events carry it (Google reads bare times as UTC) and the calendar has a name", () => {
    const ics = toICS([event()], now, { name: "La Rotisería, de Ana", timeZone: "America/Argentina/Buenos_Aires" });
    expect(ics).toContain("\r\nX-WR-CALNAME:La Rotisería\\, de Ana\r\n");
    expect(ics).toContain("\r\nX-WR-TIMEZONE:America/Argentina/Buenos_Aires\r\n");
    expect(ics).toContain("\r\nDTSTART;TZID=America/Argentina/Buenos_Aires:20261114T180000\r\n");
    expect(ics).toContain("\r\nDTEND;TZID=America/Argentina/Buenos_Aires:20261114T183000\r\n");
  });

  it("an empty calendar is still valid", () => {
    expect(toICS([], now)).not.toContain("BEGIN:VEVENT");
  });
});

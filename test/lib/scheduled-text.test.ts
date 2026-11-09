import { describe, expect, it } from "vitest";
import { scheduledLabel } from "../../src/lib/scheduled-text";

describe("scheduledLabel", () => {
  it("shows the day and hour exactly as the buyer typed them, even late at night at the end of a month", () => {
    const text = scheduledLabel("2026-11-30T23:30", "es-AR");
    expect(text).toMatch(/30\D11/);
    expect(text).toContain("23:30");
    expect(text.toLowerCase()).toContain("lun");
  });
});

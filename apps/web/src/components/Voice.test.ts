import { describe, expect, it } from "vitest";
import { pickVoice, spokenText } from "./Voice";

describe("spoken replies", () => {
  it("drops urls and keeps the engineering sentence", () => {
    expect(spokenText("Span 6 m. See https://example.com/nsr.pdf for the table.")).toBe("Span 6 m. See for the table.");
  });

  it("does not read an in-app path aloud", () => {
    expect(spokenText("The Capabilities page (/capabilities) lists what Drafty can and cannot do.")).toBe(
      "The Capabilities page lists what Drafty can and cannot do.",
    );
    expect(spokenText("Line load 12.5 kN/m (q_dead + q_live).")).toBe("Line load 12.5 kN/m (q_dead + q_live).");
  });

  it("selects a Spanish or English voice and reports when neither exists", () => {
    const voices = [
      { lang: "en-US", name: "English" },
      { lang: "es-ES", name: "Spanish" },
    ];
    expect(pickVoice(voices, "es")?.name).toBe("Spanish");
    expect(pickVoice(voices, "en")?.name).toBe("English");
    expect(pickVoice([{ lang: "fr-FR", name: "French" }], "es")).toBeNull();
  });
});

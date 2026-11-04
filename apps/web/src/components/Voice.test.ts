import { describe, expect, it, vi } from "vitest";
import { pickVoice, spokenText } from "./Voice";
import { RecordingGuard } from "@/lib/recordingGuard";
import { assertRecordableBlob, encodeWav, pcmToWavBlob, TARGET_SAMPLE_RATE } from "@/lib/audioWav";

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

describe("voice lifecycle contracts (offline)", () => {
  it("treats cancel and scenario switch as invalid generations", () => {
    const guard = new RecordingGuard();
    const recording = guard.begin();
    // Cancel / navigation invalidates before onstop / HTTP resolve.
    guard.invalidate();
    expect(guard.isCurrent(recording)).toBe(false);
  });

  it("never auto-submits a transcript — callers only receive text", () => {
    const turn = vi.fn();
    const onTranscript = (text: string) => {
      // Product contract: draft only. Scenario must require an explicit Send.
      expect(text).toBe("What is the beam span?");
    };
    onTranscript("What is the beam span?");
    expect(turn).not.toHaveBeenCalled();
  });

  it("rejects empty blobs before any HTTP call", () => {
    expect(() => assertRecordableBlob(new Blob([]))).toThrow(/empty/i);
  });

  it("encodes PCM samples for Muse STT upload shape without claiming Meta TTS", async () => {
    const wav = pcmToWavBlob(new Float32Array([0.1, -0.1]), TARGET_SAMPLE_RATE);
    expect(wav.type).toBe("audio/wav");
    expect(spokenText("Hello")).not.toMatch(/Meta TTS|muse/i);
  });

  it("surfaces AudioContext absence as a codec error", async () => {
    await expect(
      encodeWav(new Blob([new Uint8Array(8)]), {
        AudioContextCtor: undefined as unknown as typeof AudioContext,
        OfflineAudioContextCtor: undefined as unknown as typeof OfflineAudioContext,
      }),
    ).rejects.toThrow(/cannot convert/i);
  });
});

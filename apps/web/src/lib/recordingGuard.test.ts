import { describe, expect, it, vi } from "vitest";
import { RecordingGuard } from "./recordingGuard";

describe("RecordingGuard", () => {
  it("accepts the current generation and rejects cancel / unmount tokens", () => {
    const guard = new RecordingGuard();
    const first = guard.begin();
    expect(guard.isCurrent(first)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(first)).toBe(false);
    const second = guard.begin();
    expect(guard.isCurrent(second)).toBe(true);
    expect(guard.isCurrent(first)).toBe(false);
  });

  it("drops a stale transcription after a newer recording starts", async () => {
    const guard = new RecordingGuard();
    const applied: string[] = [];
    const first = guard.begin();
    const second = guard.begin();

    const late = Promise.resolve("stale span").then((text) => {
      if (guard.isCurrent(first)) applied.push(text);
    });
    const fresh = Promise.resolve("fresh span").then((text) => {
      if (guard.isCurrent(second)) applied.push(text);
    });
    await Promise.all([late, fresh]);
    expect(applied).toEqual(["fresh span"]);
  });

  it("cancel before completion never applies a late response", async () => {
    const guard = new RecordingGuard();
    const token = guard.begin();
    const onTranscript = vi.fn();
    guard.invalidate();
    await Promise.resolve({ transcript: "should not apply" }).then((result) => {
      if (guard.isCurrent(token)) onTranscript(result.transcript);
    });
    expect(onTranscript).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  TARGET_SAMPLE_RATE,
  assertEncodedWav,
  assertRecordableBlob,
  encodeWav,
  pcmToWavBlob,
} from "./audioWav";

function readFourCC(view: DataView, offset: number) {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

describe("pcmToWavBlob", () => {
  it("writes mono 16-bit PCM WAV at the requested rate", async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = pcmToWavBlob(samples, TARGET_SAMPLE_RATE);
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);
    expect(blob.type).toBe("audio/wav");
    expect(readFourCC(view, 0)).toBe("RIFF");
    expect(readFourCC(view, 8)).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(TARGET_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(buffer.byteLength).toBe(44 + samples.length * 2);
  });
});

describe("assertRecordableBlob / assertEncodedWav", () => {
  it("rejects empty and oversized recordings without truncating", () => {
    expect(() => assertRecordableBlob(new Blob([]))).toThrow(/empty/i);
    expect(() => assertRecordableBlob(new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)]))).toThrow(/8 MB/i);
    expect(() => assertEncodedWav(new Blob([new Uint8Array(100)]), 0)).toThrow(/empty/i);
    expect(() => assertEncodedWav(new Blob([new Uint8Array(100)]), MAX_AUDIO_SECONDS + 0.01)).toThrow(
      /60 seconds.*Nothing was truncated/i,
    );
  });
});

describe("encodeWav", () => {
  it("resamples decoded audio to mono 24 kHz WAV", async () => {
    const source = new Float32Array([0.25, -0.25]);
    class FakeAudioContext {
      async decodeAudioData() {
        return {
          duration: source.length / 16_000,
          length: source.length,
          numberOfChannels: 1,
          sampleRate: 16_000,
          getChannelData: () => source,
        };
      }
      async close() {}
    }
    class FakeOffline {
      constructor(
        public channels: number,
        public length: number,
        public sampleRate: number,
      ) {}
      createBufferSource() {
        return {
          buffer: null as { getChannelData: (ch: number) => Float32Array } | null,
          connect() {},
          start() {},
        };
      }
      destination = {};
      async startRendering() {
        const out = new Float32Array(this.length);
        out[0] = 0.25;
        return {
          getChannelData: () => out,
        };
      }
    }
    const { wav, durationSeconds } = await encodeWav(new Blob([new Uint8Array(64)], { type: "audio/webm" }), {
      AudioContextCtor: FakeAudioContext as unknown as typeof AudioContext,
      OfflineAudioContextCtor: FakeOffline as unknown as typeof OfflineAudioContext,
    });
    expect(durationSeconds).toBeCloseTo(source.length / 16_000, 5);
    const view = new DataView(await wav.arrayBuffer());
    expect(view.getUint32(24, true)).toBe(TARGET_SAMPLE_RATE);
    expect(view.getUint16(22, true)).toBe(1);
  });

  it("surfaces codec decode failures without calling a provider", async () => {
    class BrokenAudioContext {
      async decodeAudioData() {
        throw new DOMException("decode failed", "EncodingError");
      }
      async close() {}
    }
    class FakeOffline {
      constructor() {}
      createBufferSource() {
        return { connect() {}, start() {}, buffer: null };
      }
      destination = {};
      async startRendering() {
        return { getChannelData: () => new Float32Array(1) };
      }
    }
    await expect(
      encodeWav(new Blob([new Uint8Array(32)]), {
        AudioContextCtor: BrokenAudioContext as unknown as typeof AudioContext,
        OfflineAudioContextCtor: FakeOffline as unknown as typeof OfflineAudioContext,
      }),
    ).rejects.toThrow(/format is not supported/i);
  });

  it("rejects when AudioContext is unavailable", async () => {
    await expect(
      encodeWav(new Blob([new Uint8Array(16)]), {
        AudioContextCtor: undefined as unknown as typeof AudioContext,
        OfflineAudioContextCtor: undefined as unknown as typeof OfflineAudioContext,
      }),
    ).rejects.toThrow(/cannot convert/i);
  });

  it("refuses oversized durations instead of truncating", async () => {
    class LongAudioContext {
      async decodeAudioData() {
        return {
          duration: MAX_AUDIO_SECONDS + 1,
          length: 100,
          numberOfChannels: 1,
          sampleRate: 24_000,
          getChannelData: () => new Float32Array(100),
        };
      }
      async close() {}
    }
    class FakeOffline {
      constructor() {}
      createBufferSource() {
        return { connect() {}, start() {}, buffer: null };
      }
      destination = {};
      async startRendering() {
        return { getChannelData: () => new Float32Array(1) };
      }
    }
    await expect(
      encodeWav(new Blob([new Uint8Array(64)]), {
        AudioContextCtor: LongAudioContext as unknown as typeof AudioContext,
        OfflineAudioContextCtor: FakeOffline as unknown as typeof OfflineAudioContext,
      }),
    ).rejects.toThrow(/Nothing was truncated/i);
  });
});

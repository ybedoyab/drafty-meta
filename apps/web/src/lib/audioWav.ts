/** Client-side WAV helpers for Muse Voice Transcribe uploads. Keys never leave the API. */

export const MAX_AUDIO_SECONDS = 60;
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const TARGET_SAMPLE_RATE = 24_000;

export type WavEncodeDeps = {
  AudioContextCtor: typeof AudioContext;
  OfflineAudioContextCtor: typeof OfflineAudioContext;
};

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

export function pcmToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const pcm = new DataView(new ArrayBuffer(44 + samples.length * 2));
  writeAscii(pcm, 0, "RIFF");
  pcm.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(pcm, 8, "WAVE");
  writeAscii(pcm, 12, "fmt ");
  pcm.setUint32(16, 16, true);
  pcm.setUint16(20, 1, true);
  pcm.setUint16(22, 1, true);
  pcm.setUint32(24, sampleRate, true);
  pcm.setUint32(28, sampleRate * 2, true);
  pcm.setUint16(32, 2, true);
  pcm.setUint16(34, 16, true);
  writeAscii(pcm, 36, "data");
  pcm.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0));
    pcm.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Blob([pcm.buffer], { type: "audio/wav" });
}

export function assertRecordableBlob(blob: Blob): void {
  if (!blob || blob.size <= 0) {
    throw new Error("The recording was empty. Nothing was sent.");
  }
  if (blob.size > MAX_AUDIO_BYTES) {
    throw new Error("The recording is larger than 8 MB. Record a shorter clip.");
  }
}

export function assertEncodedWav(blob: Blob, durationSeconds: number): void {
  assertRecordableBlob(blob);
  if (!(durationSeconds > 0)) {
    throw new Error("The recording was empty. Nothing was sent.");
  }
  if (durationSeconds > MAX_AUDIO_SECONDS) {
    throw new Error("Recordings cannot be longer than 60 seconds. Nothing was truncated or sent.");
  }
}

/** Resample decoded browser audio to mono 16-bit PCM WAV at 24 kHz without truncating speech. */
export async function encodeWav(
  blob: Blob,
  deps?: Partial<WavEncodeDeps>,
): Promise<{ wav: Blob; durationSeconds: number }> {
  assertRecordableBlob(blob);
  const AudioContextCtor = deps?.AudioContextCtor ?? globalThis.AudioContext;
  const OfflineAudioContextCtor = deps?.OfflineAudioContextCtor ?? globalThis.OfflineAudioContext;
  if (typeof AudioContextCtor !== "function" || typeof OfflineAudioContextCtor !== "function") {
    throw new Error("This browser cannot convert the recording to WAV.");
  }

  const context = new AudioContextCtor();
  try {
    let audio: AudioBuffer;
    try {
      audio = await context.decodeAudioData(await blob.arrayBuffer());
    } catch {
      throw new Error("This recording format is not supported. Try again with a different browser.");
    }
    if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.length <= 0) {
      throw new Error("The recording was empty. Nothing was sent.");
    }
    if (audio.duration > MAX_AUDIO_SECONDS) {
      throw new Error("Recordings cannot be longer than 60 seconds. Nothing was truncated or sent.");
    }

    const rate = TARGET_SAMPLE_RATE;
    const length = Math.max(1, Math.ceil(audio.duration * rate));
    const offline = new OfflineAudioContextCtor(1, length, rate);
    const source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const wav = pcmToWavBlob(samples, rate);
    assertEncodedWav(wav, audio.duration);
    return { wav, durationSeconds: audio.duration };
  } finally {
    await context.close().catch(() => undefined);
  }
}

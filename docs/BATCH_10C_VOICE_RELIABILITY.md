# Batch 10C — Voice UX and Reliability

Production-quality microphone lifecycle, WAV encoding, and browser speech playback for the Scenario assistant.

**No paid Meta STT calls, Modal jobs, cloud FEM/CAD, production DB mutations, or new provider credentials were used for this batch.** Offline Vitest + mocked Playwright cover the regressions.

## Provider split (unchanged)

| Path | Implementation |
| --- | --- |
| Speech-to-text | Meta Muse Voice Transcribe via `POST /api/v1/speech/transcribe` (API holds `MODEL_API_KEY`) |
| Text-to-speech | Browser `speechSynthesis` only — **not** Meta TTS, no paid TTS vendor |

## What changed

1. **`RecordingGuard`** — generation tokens so cancel, unmount, navigation, or a newer recording drops stale encode/transcribe responses.
2. **`audioWav`** — client encode to mono 16-bit PCM WAV at 24 kHz; empty / >60 s / >8 MB rejected without truncation; codec / `AudioContext` failures surface as errors.
3. **`MicButton`** — recording / processing / transcribing phases, elapsed timer, 60 s max, cancel without submit, permission / unsupported handling, `requestKey` scoped to the scenario id.
4. **`SpeakButton`** — play/stop, English/Spanish, rate, voice refresh, cleanup on text change and unmount, explicit “not Meta TTS” labeling.
5. Transcripts land in the editable composer only; **Send remains explicit** (no automatic `/turn`).

## Limits (aligned with API)

- Max duration: 60 seconds
- Max upload: 8 MB
- Accepted sample rates on the API: 16 kHz or 24 kHz (client targets 24 kHz)

## Tests

- Vitest: `audioWav.test.ts`, `recordingGuard.test.ts`, `Voice.test.ts`
- Playwright: Scenario voice lifecycle, cancel, permission denial, no auto-turn, stale response after navigation, passive navigation (zero speech routes), EN/ES playback cancel, unsupported synthesis

## Known limitations

- Browser TTS quality and voice inventory vary by OS/browser.
- Real microphone → Muse STT still requires a separately authorized live run (not part of CI).
- MediaRecorder mime types differ by browser; decode failures ask the user to retry in another browser rather than corrupting audio.

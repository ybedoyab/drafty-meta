import { Mic, Square, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { transcribeSpeech } from "@/lib/api";
import { encodeWav, MAX_AUDIO_SECONDS } from "@/lib/audioWav";
import { RecordingGuard } from "@/lib/recordingGuard";

export function spokenText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s*\(\/[a-z-]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

export function pickVoice<T extends { lang: string }>(voices: T[], language: "en" | "es"): T | null {
  const prefix = language === "es" ? "es" : "en";
  return voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix)) ?? null;
}

export function SpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const [spoken, setSpoken] = useState("");
  const [rate, setRate] = useState(1);
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [supported, setSupported] = useState(true);
  const [voiceCount, setVoiceCount] = useState(0);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const script = spokenText(text);

  useEffect(() => {
    const synth = window.speechSynthesis;
    setSupported(typeof synth?.speak === "function");
    if (!synth) return;
    const refresh = () => setVoiceCount(synth.getVoices().length);
    refresh();
    synth.addEventListener?.("voiceschanged", refresh);
    return () => {
      synth.removeEventListener?.("voiceschanged", refresh);
      synth.cancel();
      utterance.current = null;
      setSpeaking(false);
    };
  }, []);

  useEffect(() => {
    // Changing the spoken message must not leave a previous utterance running.
    window.speechSynthesis?.cancel();
    utterance.current = null;
    setSpeaking(false);
    setSpoken("");
  }, [text]);

  function stop() {
    window.speechSynthesis?.cancel();
    utterance.current = null;
    setSpeaking(false);
  }

  function play() {
    if (!supported || !script) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    // Cancel any overlapping utterance before starting a new one.
    synth.cancel();
    setSpoken(script);
    const next = new SpeechSynthesisUtterance(script);
    const voices = synth.getVoices();
    setVoiceCount(voices.length);
    const preferred = pickVoice(voices, language) ?? pickVoice(voices, language === "es" ? "en" : "es");
    if (preferred) next.voice = preferred;
    next.lang = preferred?.lang ?? (language === "es" ? "es-ES" : "en-US");
    next.rate = rate;
    next.onend = () => {
      if (utterance.current === next) {
        utterance.current = null;
        setSpeaking(false);
      }
    };
    next.onerror = () => {
      if (utterance.current === next) {
        utterance.current = null;
        setSpeaking(false);
      }
    };
    utterance.current = next;
    setSpeaking(true);
    synth.speak(next);
  }

  if (!supported) {
    return (
      <p className="text-xs text-slate-500" role="status">
        Speech playback is not available on this device. Browser speech synthesis is required; Drafty does not use a
        Meta text-to-speech model here.
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs font-medium text-slate-700"
        aria-pressed={speaking}
        onClick={speaking ? stop : play}
      >
        {speaking ? <VolumeX className="h-3.5 w-3.5" aria-hidden /> : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
        {speaking ? "Stop speech" : "Play speech"}
      </button>
      <label className="text-xs text-slate-500">
        Language
        <select
          className="ml-1 rounded border border-slate-300 px-1"
          value={language}
          aria-label="Speech language"
          onChange={(event) => {
            stop();
            setLanguage(event.target.value as "en" | "es");
          }}
        >
          <option value="en">English</option>
          <option value="es">Spanish</option>
        </select>
      </label>
      <label className="text-xs text-slate-500">
        Speed
        <select
          className="ml-1 rounded border border-slate-300 px-1"
          value={rate}
          aria-label="Playback speed"
          onChange={(event) => {
            stop();
            setRate(Number(event.target.value));
          }}
        >
          <option value={0.8}>0.8</option>
          <option value={1}>1</option>
          <option value={1.2}>1.2</option>
        </select>
      </label>
      <span className="text-[11px] text-slate-500">
        Browser speech{voiceCount ? ` · ${voiceCount} voice${voiceCount === 1 ? "" : "s"}` : ""} — not Meta TTS
      </span>
      {spoken && <p className="basis-full text-xs text-slate-600">Spoken text: {spoken}</p>}
    </div>
  );
}

type MicPhase = "idle" | "recording" | "processing" | "transcribing";

export function MicButton({
  disabled,
  requestKey = "",
  onTranscript,
  onError,
}: {
  disabled: boolean;
  /** Scenario id (or other scope). Late responses are dropped when this changes. */
  requestKey?: string;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<MicPhase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const discard = useRef(false);
  const starting = useRef(false);
  const maxTimer = useRef<number | null>(null);
  const guard = useRef(new RecordingGuard());
  const activeToken = useRef<number | null>(null);
  const requestKeyRef = useRef(requestKey);

  useEffect(() => {
    requestKeyRef.current = requestKey;
    // Navigation / scenario switch: abandon any in-flight capture or transcription.
    discard.current = true;
    stopTracks();
    clearMaxTimer();
    if (recorder.current?.state === "recording") {
      try {
        recorder.current.stop();
      } catch {
        /* ignore */
      }
    }
    recorder.current = null;
    guard.current.invalidate();
    activeToken.current = null;
    starting.current = false;
    setPhase("idle");
    setElapsed(0);
    setStatus("");
  }, [requestKey]);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(
    () => () => {
      discard.current = true;
      guard.current.invalidate();
      activeToken.current = null;
      clearMaxTimer();
      stopTracks();
      try {
        if (recorder.current?.state === "recording") recorder.current.stop();
      } catch {
        /* ignore */
      }
      recorder.current = null;
    },
    [],
  );

  function clearMaxTimer() {
    if (maxTimer.current != null) {
      window.clearTimeout(maxTimer.current);
      maxTimer.current = null;
    }
  }

  function stopTracks() {
    streamRef.current?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    });
    streamRef.current = null;
  }

  async function start() {
    if (disabled || starting.current || phase !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("This browser cannot record audio.");
      return;
    }
    starting.current = true;
    discard.current = false;
    const token = guard.current.begin();
    const scopeKey = requestKeyRef.current;
    activeToken.current = token;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!guard.current.isCurrent(token) || discard.current || requestKeyRef.current !== scopeKey) {
        stream.getTracks().forEach((track) => track.stop());
        starting.current = false;
        return;
      }
      streamRef.current = stream;
      let media: MediaRecorder;
      try {
        media = new MediaRecorder(stream);
      } catch {
        stopTracks();
        starting.current = false;
        onError("This browser cannot start an audio recorder.");
        return;
      }
      chunks.current = [];
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      media.onstop = () => {
        stopTracks();
        clearMaxTimer();
        const blob = new Blob(chunks.current, { type: media.mimeType || "audio/webm" });
        chunks.current = [];
        recorder.current = null;
        starting.current = false;
        if (discard.current || !guard.current.isCurrent(token) || requestKeyRef.current !== scopeKey) {
          const wasDiscarded = discard.current;
          discard.current = false;
          setPhase("idle");
          setStatus(wasDiscarded ? "Recording cancelled" : "");
          return;
        }
        void finish(blob, token, scopeKey);
      };
      recorder.current = media;
      started.current = Date.now();
      setElapsed(0);
      // Clear the arming latch before the recording render so Stop stays clickable.
      starting.current = false;
      setPhase("recording");
      setStatus("Recording");
      media.start();
      clearMaxTimer();
      maxTimer.current = window.setTimeout(() => {
        if (recorder.current?.state === "recording" && guard.current.isCurrent(token)) {
          setStatus(`Reached ${MAX_AUDIO_SECONDS}s limit`);
          recorder.current.stop();
          setPhase("processing");
        }
      }, MAX_AUDIO_SECONDS * 1000);
    } catch (reason) {
      starting.current = false;
      activeToken.current = null;
      const name = reason instanceof DOMException ? reason.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        onError("Microphone permission was denied.");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        onError("No microphone was found.");
      } else {
        onError("Microphone permission was denied.");
      }
      setPhase("idle");
      setStatus("");
    }
  }

  function stop() {
    if (phase !== "recording") return;
    discard.current = false;
    setPhase("processing");
    setStatus("Processing audio");
    try {
      recorder.current?.stop();
    } catch {
      setPhase("idle");
      setStatus("");
    }
  }

  function cancelRecording() {
    discard.current = true;
    guard.current.invalidate();
    activeToken.current = null;
    clearMaxTimer();
    try {
      if (recorder.current?.state === "recording") recorder.current.stop();
      else stopTracks();
    } catch {
      stopTracks();
    }
    starting.current = false;
    setPhase("idle");
    setElapsed(0);
    setStatus("Recording cancelled");
  }

  async function finish(blob: Blob, token: number, scopeKey: string) {
    if (!guard.current.isCurrent(token) || discard.current || requestKeyRef.current !== scopeKey) {
      setPhase("idle");
      setStatus(discard.current ? "Recording cancelled" : "");
      return;
    }
    setPhase("transcribing");
    setStatus("Transcribing");
    try {
      const { wav } = await encodeWav(blob);
      if (!guard.current.isCurrent(token) || requestKeyRef.current !== scopeKey) {
        return;
      }
      const result = await transcribeSpeech(wav);
      if (!guard.current.isCurrent(token) || requestKeyRef.current !== scopeKey) {
        return;
      }
      const text = result.transcript.trim();
      if (!text) {
        onError("The recording did not contain recognizable speech.");
      } else {
        // Transcript is returned to the composer only — never auto-submitted.
        onTranscript(text);
      }
      setStatus("");
    } catch (reason) {
      if (!guard.current.isCurrent(token) || requestKeyRef.current !== scopeKey) return;
      setStatus("");
      onError(reason instanceof Error ? reason.message : "Transcription failed. The scenario was not changed.");
    } finally {
      if (activeToken.current === token) {
        activeToken.current = null;
        setPhase("idle");
      }
    }
  }

  const busy = phase === "processing" || phase === "transcribing";
  const recording = phase === "recording";
  // While recording, Stop must remain enabled. Arming is gated inside start().
  const buttonDisabled = disabled || busy;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        disabled={buttonDisabled}
        aria-pressed={recording}
        aria-busy={busy}
        onClick={recording ? stop : () => void start()}
      >
        {recording ? <Square className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
        {recording ? `Stop ${elapsed}s` : busy ? "Working…" : "Microphone"}
      </button>
      <span className="text-xs text-slate-600" role="status" aria-live="polite">
        {recording ? `Recording ${elapsed}s / ${MAX_AUDIO_SECONDS}s` : status}
      </span>
      {recording && (
        <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm" onClick={cancelRecording}>
          Cancel recording
        </button>
      )}
    </span>
  );
}

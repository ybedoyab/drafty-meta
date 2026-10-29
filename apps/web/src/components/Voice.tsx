import { Mic, Square, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { transcribeSpeech } from "@/lib/api";

export function spokenText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "")
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
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const script = spokenText(text);

  useEffect(() => {
    setSupported(typeof window.speechSynthesis?.speak === "function");
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  function stop() {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }

  function play() {
    if (!supported || !script) return;
    setSpoken(script);
    window.speechSynthesis.cancel();
    const next = new SpeechSynthesisUtterance(script);
    const voices = window.speechSynthesis.getVoices();
    const preferred = pickVoice(voices, language) ?? pickVoice(voices, language === "es" ? "en" : "es");
    if (preferred) next.voice = preferred;
    next.lang = preferred?.lang ?? (language === "es" ? "es-ES" : "en-US");
    next.rate = rate;
    next.onend = () => setSpeaking(false);
    next.onerror = () => setSpeaking(false);
    utterance.current = next;
    setSpeaking(true);
    window.speechSynthesis.speak(next);
  }

  if (!supported) return <p className="text-xs text-slate-500">Speech playback is not available on this device.</p>;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-slate-700" onClick={speaking ? stop : play}>
        {speaking ? <VolumeX className="h-3.5 w-3.5" aria-hidden /> : <Volume2 className="h-3.5 w-3.5" aria-hidden />}
        {speaking ? "Stop speech" : "Play speech"}
      </button>
      <label className="text-xs text-slate-500">
        Language
        <select className="ml-1 rounded border border-slate-300 px-1" value={language} aria-label="Speech language" onChange={(event) => setLanguage(event.target.value as "en" | "es")}>
          <option value="en">English</option>
          <option value="es">Spanish</option>
        </select>
      </label>
      <label className="text-xs text-slate-500">
        Speed
        <select className="ml-1 rounded border border-slate-300 px-1" value={rate} aria-label="Playback speed" onChange={(event) => setRate(Number(event.target.value))}>
          <option value={0.8}>0.8</option>
          <option value={1}>1</option>
          <option value={1.2}>1.2</option>
        </select>
      </label>
      {spoken && <p className="text-xs text-slate-600">Spoken text: {spoken}</p>}
    </div>
  );
}

export function MicButton({
  disabled,
  onTranscript,
  onError,
}: {
  disabled: boolean;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const discard = useRef(false);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(
    () => () => {
      discard.current = true;
      recorder.current?.stop();
    },
    [],
  );

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("This browser cannot record audio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      chunks.current = [];
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (discard.current) {
          discard.current = false;
          chunks.current = [];
          return;
        }
        void finish(new Blob(chunks.current, { type: media.mimeType || "audio/webm" }));
      };
      recorder.current = media;
      started.current = Date.now();
      setElapsed(0);
      setRecording(true);
      setStatus("Recording");
      media.start();
      window.setTimeout(() => {
        if (recorder.current?.state === "recording") recorder.current.stop();
      }, 60_000);
    } catch {
      onError("Microphone permission was denied.");
    }
  }

  function stop() {
    recorder.current?.stop();
    setRecording(false);
  }

  function cancelRecording() {
    discard.current = true;
    recorder.current?.stop();
    setRecording(false);
    setStatus("Recording cancelled");
  }

  async function finish(blob: Blob) {
    setRecording(false);
    setStatus("Transcribing");
    try {
      const wav = await encodeWav(blob);
      const result = await transcribeSpeech(wav);
      onTranscript(result.transcript);
      setStatus("");
    } catch (reason) {
      setStatus("");
      onError(reason instanceof Error ? reason.message : "Transcription failed. The scenario was not changed.");
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        disabled={disabled || status === "Transcribing"}
        onClick={recording ? stop : () => void start()}
      >
        {recording ? <Square className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
        {recording ? `Stop ${elapsed}s` : "Microphone"}
      </button>
      {status && !recording && <span className="text-xs text-slate-600">{status}</span>}
      {recording && (
        <button type="button" className="rounded-md border border-slate-300 px-3 py-2 text-sm" onClick={cancelRecording}>
          Cancel recording
        </button>
      )}
    </span>
  );
}

async function encodeWav(blob: Blob): Promise<Blob> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const rate = 24000;
    const length = Math.ceil(audio.duration * rate);
    const offline = new OfflineAudioContext(1, length, rate);
    const source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const pcm = new DataView(new ArrayBuffer(44 + samples.length * 2));
    writeAscii(pcm, 0, "RIFF");
    pcm.setUint32(4, 36 + samples.length * 2, true);
    writeAscii(pcm, 8, "WAVE");
    writeAscii(pcm, 12, "fmt ");
    pcm.setUint32(16, 16, true);
    pcm.setUint16(20, 1, true);
    pcm.setUint16(22, 1, true);
    pcm.setUint32(24, rate, true);
    pcm.setUint32(28, rate * 2, true);
    pcm.setUint16(32, 2, true);
    pcm.setUint16(34, 16, true);
    writeAscii(pcm, 36, "data");
    pcm.setUint32(40, samples.length * 2, true);
    for (let index = 0; index < samples.length; index += 1) {
      const value = Math.max(-1, Math.min(1, samples[index] ?? 0));
      pcm.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    }
    return new Blob([pcm.buffer], { type: "audio/wav" });
  } finally {
    await context.close();
  }
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

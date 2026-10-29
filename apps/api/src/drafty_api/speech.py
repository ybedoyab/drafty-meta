"""File transcription through Meta Muse Voice Transcribe. The browser never sees the API key."""

import json
import threading
import uuid
import wave
from io import BytesIO

import httpx
from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from drafty_api.auth import current_owner
from drafty_api.settings import settings
from drafty_engineering.errors import DraftyError

router = APIRouter()
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_AUDIO_SECONDS = 60
ASR_MODEL = "muse-voice-transcribe-1.0"
_gate = threading.Semaphore(1)


def _validate_wav(data: bytes) -> None:
    if len(data) < 44 or len(data) > MAX_AUDIO_BYTES:
        raise DraftyError("The recording must be a WAV file under 8 MB.")
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise DraftyError("The recording is not a WAV file.")
    try:
        with wave.open(BytesIO(data)) as handle:
            channels = handle.getnchannels()
            width = handle.getsampwidth()
            rate = handle.getframerate()
            frames = handle.getnframes()
            compression = handle.getcomptype()
    except wave.Error as exc:
        raise DraftyError("The recording is not a readable PCM WAV file.") from exc
    if compression != "NONE" or channels != 1 or width != 2 or rate not in {16000, 24000}:
        raise DraftyError("Transcription accepts mono 16-bit PCM WAV at 16 kHz or 24 kHz.")
    duration = frames / rate if rate else 0
    if frames <= 0 or duration > MAX_AUDIO_SECONDS:
        raise DraftyError("The recording must be between a moment of speech and 60 seconds.")


def transcribe_wav(data: bytes) -> str:
    _validate_wav(data)
    if not settings.meta_configured:
        raise DraftyError("MODEL_API_KEY is not configured. The recording was not sent.")
    if not _gate.acquire(blocking=False):
        raise DraftyError("Another transcription is already running.")
    try:
        request_body = {
            "mode": "PUSH_TO_TALK",
            "model": ASR_MODEL,
            "audioEncoding": "WAV",
            "languageBias": ["English", "Spanish"],
            "keywords": ["CalculiX", "NSR-10", "von Mises", "simply supported", "S235", "I-beam"],
        }
        try:
            with httpx.Client(timeout=45) as client:
                response = client.post(
                    f"{settings.model_api_base.rstrip('/')}/asr/transcribe",
                    params={"sessionId": str(uuid.uuid4())},
                    headers={"Authorization": f"Bearer {settings.model_api_key.strip()}"},
                    files={
                        "request": (None, json.dumps(request_body), "application/json"),
                        "audio": ("speech.wav", data, "audio/wav"),
                    },
                )
        except httpx.HTTPError as exc:
            raise DraftyError("Transcription did not finish. Check the connection and try again.") from exc
        if response.status_code >= 400:
            raise DraftyError(f"Transcription failed ({response.status_code}).")
        try:
            payload = response.json()
        except json.JSONDecodeError as exc:
            raise DraftyError("Transcription returned an unreadable response.") from exc
        text = str(payload.get("transcript") or "").strip()
        if not text:
            raise DraftyError("The recording did not contain recognizable speech.")
        return text
    finally:
        _gate.release()


@router.post("/api/v1/speech/transcribe")
async def transcribe_speech(request: Request, audio: UploadFile = File(...)) -> dict:
    current_owner(request)
    data = await audio.read()
    try:
        transcript = transcribe_wav(data)
    except DraftyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"transcript": transcript}

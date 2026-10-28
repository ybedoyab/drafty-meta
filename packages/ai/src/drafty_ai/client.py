"""HTTP client for the Meta Model API chat completions endpoint."""

import os

import httpx
from dotenv import load_dotenv

load_dotenv(override=False)

PRIMARY_MODEL = "muse-spark-1.3"
REASONING_MODEL = "muse-wonder-1.0"
ALLOWED_MODELS = {PRIMARY_MODEL, REASONING_MODEL}


class MetaNotConfigured(Exception):
    """MODEL_API_KEY is empty, so no request was sent."""


class MetaRequestError(Exception):
    """The Model API responded with an error. The message does not include the key."""


def configured() -> bool:
    return bool(os.environ.get("MODEL_API_KEY", "").strip())


def chat_completion(
    messages: list[dict],
    tools: list[dict] | None = None,
    response_format: dict | None = None,
    model: str | None = None,
) -> dict:
    key = os.environ.get("MODEL_API_KEY", "").strip()
    if not key:
        raise MetaNotConfigured(
            "MODEL_API_KEY is not configured. Natural-language design is unavailable "
            "until you add it to .env. Manual design and CalculiX still run."
        )
    selected = model or os.environ.get("MODEL_PRIMARY", PRIMARY_MODEL)
    if selected not in ALLOWED_MODELS:
        raise MetaRequestError(
            f"Model '{selected}' is not one of the configured Meta chat models: " + ", ".join(sorted(ALLOWED_MODELS))
        )
    base = os.environ.get("MODEL_API_BASE", "https://api.meta.ai/v1").rstrip("/")
    body: dict = {"model": selected, "messages": messages}
    if tools is not None:
        if any(tool.get("type") == "web_search" for tool in tools):
            raise MetaRequestError(
                "Built-in web_search belongs on the Responses API. Chat completions does not receive it."
            )
        body["tools"] = tools
        body["tool_choice"] = "auto"
    if response_format is not None:
        body["response_format"] = response_format
    try:
        response = httpx.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json=body,
            timeout=httpx.Timeout(10.0, read=60.0),
        )
    except httpx.TimeoutException as exc:
        raise MetaRequestError("The Meta chat request timed out. No result was stored.") from exc
    except httpx.HTTPError as exc:
        raise MetaRequestError(f"The Meta Model API request failed: {exc.__class__.__name__}") from exc
    if response.status_code >= 400:
        detail = response.text[:800]
        raise MetaRequestError(f"Meta Model API returned HTTP {response.status_code}: {detail}")
    return response.json()

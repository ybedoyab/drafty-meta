"""Meta Responses API adapter. It does not invent citations when no key is set."""

import os
import re

import httpx

from drafty_ai.client import MetaNotConfigured, MetaRequestError, configured

ALLOWED_RESPONSE_MODELS = {"muse-spark-1.3", "muse-wonder-1.0"}
REPLY_FORMAT = {
    "type": "json_schema",
    "name": "scenario_reply",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "message": {"type": "string"},
            "questions": {"type": "array", "items": {"type": "string"}},
            "observations": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["message", "questions", "observations"],
    },
}


def create_response(
    *,
    instructions: str,
    user_text: str,
    image_data_urls: list[str] | None = None,
    previous_response_id: str | None = None,
    model: str | None = None,
    max_output_tokens: int = 1200,
    max_tool_calls: int = 2,
) -> dict:
    """One Responses API turn. Instructions, tools, and the JSON schema are sent again."""

    if not configured():
        raise MetaNotConfigured("MODEL_API_KEY is empty. No web search was sent.")
    urls = [_image_data_url(url) for url in (image_data_urls or [])]
    if not user_text.strip() and not urls:
        raise MetaRequestError("The scenario turn is empty.")
    if max_output_tokens < 16 or max_output_tokens > 2000:
        raise MetaRequestError("The research token cap must stay between 16 and 2000.")
    if max_tool_calls < 1 or max_tool_calls > 4:
        raise MetaRequestError("A scenario turn may use 1 to 4 built-in tool calls.")
    selected = model or os.environ.get("MODEL_PRIMARY", "muse-spark-1.3")
    if selected not in ALLOWED_RESPONSE_MODELS:
        raise MetaRequestError("Scenario research uses muse-spark-1.3 or muse-wonder-1.0.")
    if len(urls) > 8:
        raise MetaRequestError("At most eight images are sent in one scenario turn.")
    content: list[dict] = [{"type": "input_text", "text": user_text}]
    content.extend({"type": "input_image", "image_url": url} for url in urls)
    body: dict = {
        "model": selected,
        "instructions": instructions,
        "input": [{"role": "user", "content": content}],
        "max_output_tokens": max_output_tokens,
        "max_tool_calls": max_tool_calls,
        "tools": [{"type": "web_search"}],
        "text": {"format": REPLY_FORMAT},
    }
    if previous_response_id:
        body["previous_response_id"] = previous_response_id
    payload, context_reset = _post_response(body)
    return {
        "id": payload.get("id"),
        "text": _output_text(payload),
        "citations": _citations(payload),
        "usage": payload.get("usage") or {},
        "model": selected,
        "context_reset": context_reset,
    }


def responses_with_search(prompt: str, max_output_tokens: int = 800) -> dict:
    """Call the Responses API with built-in web search. Chat completions cannot do this."""

    created = create_response(
        instructions="Answer from retrieved sources.",
        user_text=prompt,
        max_output_tokens=max_output_tokens,
    )
    return {
        "raw": {"id": created["id"], "output_text": created["text"]},
        "citations": created["citations"],
    }


def _post_response(body: dict) -> tuple[dict, bool]:
    response = _post_once(body)
    context_reset = False
    if response.status_code == 400 and body.get("previous_response_id"):
        recovered = dict(body)
        recovered.pop("previous_response_id", None)
        response = _post_once(recovered)
        context_reset = response.status_code < 400
    if response.status_code >= 400:
        detail = _safe_detail(response.text)
        raise MetaRequestError(f"Meta Responses API returned HTTP {response.status_code}: {detail}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise MetaRequestError("The Meta Responses API returned a body that was not JSON.") from exc
    if not isinstance(payload, dict):
        raise MetaRequestError("The Meta Responses API returned a body that was not an object.")
    return payload, context_reset


def _post_once(body: dict) -> httpx.Response:
    base = os.environ.get("MODEL_API_BASE", "https://api.meta.ai/v1").rstrip("/")
    try:
        return httpx.post(
            f"{base}/responses",
            headers={"Authorization": f"Bearer {os.environ['MODEL_API_KEY'].strip()}"},
            json=body,
            timeout=httpx.Timeout(10.0, read=60.0),
        )
    except httpx.TimeoutException as exc:
        raise MetaRequestError("The Meta Responses request timed out. No citation was stored.") from exc
    except httpx.HTTPError as exc:
        raise MetaRequestError(f"The Meta Responses API request failed: {exc.__class__.__name__}") from exc


def _image_data_url(url: str) -> str:
    header, separator, _payload = url.partition(",")
    if separator != "," or not header.startswith("data:image/"):
        raise MetaRequestError("Scenario images must be PNG, JPEG, or WebP data URLs.")
    media = header.split(";", 1)[0].removeprefix("data:")
    if media not in {"image/png", "image/jpeg", "image/webp"}:
        raise MetaRequestError("Scenario images must be PNG, JPEG, or WebP data URLs.")
    return url


def _output_text(payload: dict) -> str:
    parts: list[str] = []
    for item in payload.get("output") or []:
        if not isinstance(item, dict):
            continue
        for block in item.get("content") or []:
            if not isinstance(block, dict):
                continue
            if block.get("type") in {"output_text", "text"} and block.get("text"):
                parts.append(str(block["text"]))
    return "\n".join(parts)


def _citations(payload: dict) -> list[dict]:
    found: dict[str, dict] = {}
    order: list[str] = []
    for item in payload.get("output") or []:
        if not isinstance(item, dict):
            continue
        for block in item.get("content") or []:
            if not isinstance(block, dict):
                continue
            text = str(block.get("text") or "")
            for note in block.get("annotations") or []:
                if not isinstance(note, dict) or note.get("type") != "url_citation":
                    continue
                url = str(note.get("url") or "")
                if not url.startswith(("https://", "http://")):
                    continue
                start = note.get("start_index")
                end = note.get("end_index")
                span = ""
                if isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= len(text):
                    span = text[start:end]
                current = found.get(url)
                if current is None:
                    found[url] = {"url": url, "title": note.get("title") or "", "span": span}
                    order.append(url)
                elif span and len(span) > len(current["span"]):
                    current["span"] = span
                    if note.get("title"):
                        current["title"] = note["title"]
    return [found[url] for url in order]


def _safe_detail(text: str) -> str:
    redacted = re.sub(r"Bearer\s+\S+", "Bearer [redacted]", text or "")
    key = os.environ.get("MODEL_API_KEY", "").strip()
    if key:
        redacted = redacted.replace(key, "[redacted]")
    return redacted[:500]

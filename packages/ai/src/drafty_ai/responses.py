"""Meta Responses API adapter. It does not invent citations when no key is set."""

import os

import httpx

from drafty_ai.client import MetaNotConfigured, MetaRequestError, configured


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
    """One Responses API turn. Instructions and tools are sent again on every turn."""

    if not configured():
        raise MetaNotConfigured("MODEL_API_KEY is empty. No web search was sent.")
    if not user_text.strip() and not image_data_urls:
        raise MetaRequestError("The scenario turn is empty.")
    if max_output_tokens < 1 or max_output_tokens > 2000:
        raise MetaRequestError("The research token cap must stay between 1 and 2000.")
    if max_tool_calls < 1 or max_tool_calls > 4:
        raise MetaRequestError("A scenario turn may use 1 to 4 built-in tool calls.")
    selected = model or os.environ.get("MODEL_PRIMARY", "muse-spark-1.3")
    if selected not in {"muse-spark-1.3", "muse-wonder-1.0"}:
        raise MetaRequestError("Scenario research uses muse-spark-1.3 or muse-wonder-1.0.")
    urls = list(image_data_urls or [])
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
    }
    if previous_response_id:
        body["previous_response_id"] = previous_response_id
    base = os.environ.get("MODEL_API_BASE", "https://api.meta.ai/v1").rstrip("/")
    try:
        response = httpx.post(
            f"{base}/responses",
            headers={"Authorization": f"Bearer {os.environ['MODEL_API_KEY'].strip()}"},
            json=body,
            timeout=90,
        )
    except httpx.HTTPError as exc:
        raise MetaRequestError(f"The Meta Responses API request failed: {exc.__class__.__name__}") from exc
    if response.status_code >= 400:
        raise MetaRequestError(f"Meta Responses API returned HTTP {response.status_code}: {response.text[:800]}")
    payload = response.json()
    return {
        "id": payload.get("id"),
        "text": _output_text(payload),
        "citations": _citations(payload),
        "usage": payload.get("usage") or {},
        "model": selected,
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


def _output_text(payload: dict) -> str:
    parts: list[str] = []
    for item in payload.get("output") or []:
        for block in item.get("content") or []:
            if block.get("type") in {"output_text", "text"} and block.get("text"):
                parts.append(str(block["text"]))
    return "\n".join(parts)


def _citations(payload: dict) -> list[dict]:
    found: list[dict] = []
    for item in payload.get("output") or []:
        for block in item.get("content") or []:
            text = str(block.get("text") or "")
            for note in block.get("annotations") or []:
                if note.get("type") != "url_citation" or not note.get("url"):
                    continue
                start = note.get("start_index")
                end = note.get("end_index")
                span = ""
                if isinstance(start, int) and isinstance(end, int) and 0 <= start < end <= len(text):
                    span = text[start:end]
                found.append({"url": note["url"], "title": note.get("title") or "", "span": span})
    return found

"""Meta Responses API adapter. It does not invent citations when no key is set."""

import os

import httpx

from drafty_ai.client import MetaNotConfigured, MetaRequestError, configured


def responses_with_search(prompt: str, max_output_tokens: int = 800) -> dict:
    """Call the Responses API with built-in web search. Chat completions cannot do this."""

    if not configured():
        raise MetaNotConfigured("MODEL_API_KEY is empty. No web search was sent.")
    if not prompt.strip():
        raise MetaRequestError("The research prompt is empty.")
    if max_output_tokens < 1 or max_output_tokens > 2000:
        raise MetaRequestError("The research token cap must stay between 1 and 2000.")
    base = os.environ.get("MODEL_API_BASE", "https://api.meta.ai/v1").rstrip("/")
    model = os.environ.get("MODEL_PRIMARY", "muse-spark-1.3")
    body = {
        "model": model,
        "input": prompt,
        "max_output_tokens": max_output_tokens,
        "tools": [{"type": "web_search"}],
    }
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
    return {"raw": payload, "citations": _citations(payload)}


def _citations(payload: dict) -> list[dict]:
    found: list[dict] = []
    for item in payload.get("output") or []:
        for block in item.get("content") or []:
            for note in block.get("annotations") or []:
                if note.get("type") == "url_citation" and note.get("url"):
                    found.append({"url": note["url"], "title": note.get("title") or ""})
    return found

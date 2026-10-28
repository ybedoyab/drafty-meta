"""Optional SAM 3.1 segmentation. Masks are pixels, not engineering dimensions."""

import os
import re

import httpx

from drafty_ai.client import MetaNotConfigured, MetaRequestError, configured

_NOUN = re.compile(r"[A-Za-z][A-Za-z0-9 \-]{0,60}\Z")


def segment_image(noun: str, image_data_url: str) -> dict:
    """One Responses call to sam-3.1. A failure is returned to the caller and not retried here."""

    prompt = noun.strip()
    if not _NOUN.fullmatch(prompt):
        raise MetaRequestError("A SAM prompt is a short object name, not an instruction.")
    if not image_data_url.startswith("data:image/"):
        raise MetaRequestError("SAM receives a stored image data URL, not a remote address.")
    if not configured():
        raise MetaNotConfigured("MODEL_API_KEY is empty. No segmentation was sent.")
    body = {
        "model": "sam-3.1",
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": image_data_url},
                ],
            }
        ],
    }
    base = os.environ.get("MODEL_API_BASE", "https://api.meta.ai/v1").rstrip("/")
    try:
        response = httpx.post(
            f"{base}/responses",
            headers={"Authorization": f"Bearer {os.environ['MODEL_API_KEY'].strip()}"},
            json=body,
            timeout=httpx.Timeout(10.0, read=90.0),
        )
    except httpx.TimeoutException as exc:
        raise MetaRequestError("The SAM request timed out. No mask was stored.") from exc
    except httpx.HTTPError as exc:
        raise MetaRequestError(f"The SAM request failed: {exc.__class__.__name__}") from exc
    if response.status_code >= 400:
        raise MetaRequestError(f"SAM returned HTTP {response.status_code}. No mask was stored.")
    payload = response.json()
    text = _output_text(payload)
    parsed = parse_segmentation_text(text)
    usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
    return {
        "model": "sam-3.1",
        "prompt": prompt,
        "width": parsed["width"],
        "height": parsed["height"],
        "objects": parsed["objects"][:8],
        "diagnostics": parsed["diagnostics"][:8],
        "usage": {key: usage.get(key) for key in ("input_tokens", "output_tokens", "total_tokens")},
        "limit": "These are pixel masks and boxes. They are not lengths until a reference dimension is supplied.",
    }


def parse_segmentation_text(text: str) -> dict:
    """Decode SAM output with the official parser. An empty result is valid."""

    from meta_sam_parser import CompletedOutcome, decode_mask_to_svg_path, image_segmentation_format

    parser = image_segmentation_format().create_parser()
    parser.push(text if text.endswith("\n") else f"{text}\n")
    result = parser.finish(CompletedOutcome()).result
    masks: dict[str, str] = {}
    for record in result.records:
        if getattr(record, "kind", "") != "mask":
            continue
        try:
            masks[record.object_id] = decode_mask_to_svg_path(record.mask)
        except (RuntimeError, ValueError):
            continue
    objects = []
    for record in result.records:
        if getattr(record, "kind", "") != "box":
            continue
        objects.append(
            {
                "object_id": record.object_id,
                "left": record.left,
                "top": record.top,
                "right": record.right,
                "bottom": record.bottom,
                "path": masks.get(record.object_id, ""),
            }
        )
    diagnostics = [item.message for item in result.diagnostics if getattr(item, "message", "")]
    size = re.search(r"w=(\d+);h=(\d+)", text)
    return {
        "objects": objects,
        "diagnostics": diagnostics,
        "width": int(size.group(1)) if size else None,
        "height": int(size.group(2)) if size else None,
    }


def _output_text(payload: dict) -> str:
    parts: list[str] = []
    for item in payload.get("output") or []:
        if not isinstance(item, dict):
            continue
        for block in item.get("content") or []:
            if isinstance(block, dict) and block.get("type") in {"output_text", "text"} and block.get("text"):
                parts.append(str(block["text"]))
    return "\n".join(parts)

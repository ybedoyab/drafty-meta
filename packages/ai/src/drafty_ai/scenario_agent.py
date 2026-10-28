"""One scenario orchestration. Physics stays in drafty_engineering.scenario."""

import json
import re
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict

from drafty_ai.client import MetaNotConfigured, MetaRequestError, configured
from drafty_ai.responses import create_response
from drafty_engineering.scenario import evaluate_classroom

INSTRUCTIONS = """You are Drafty's scenario assistant.
One reply covers understanding, research, assumptions, a physical model, numerical verification, and criticism.
Use web_search only for published codes, standards, or material sources.
Do not search in order to do arithmetic.
Return one JSON object and nothing else: {"message": "", "questions": [], "observations": []}.
observations may name visible objects. They must not state a dimension, a load, or a stress.
Do not claim that a design is safe, approved, or certified.
Do not invent finite-element stresses, displacements, or safety factors.
Do not write Python, shell, or solver input.
The server replaces every load and section number with its own calculation.
"""

_STUDENTS = re.compile(r"(\d+)\s+students", re.I)
_SPAN = re.compile(r"\bspan(?:\s+of)?\s+(\d+(?:\.\d+)?)\s*m\b", re.I)
_WIDTH = re.compile(r"\btributary(?:\s+width)?\s+(\d+(?:\.\d+)?)\s*m\b", re.I)
_DEAD = re.compile(r"\bdead(?:\s+load)?\s+(\d+(?:\.\d+)?)\s*kN", re.I)
_FORBIDDEN = re.compile(r"\b(safe|approved|certified|certification|von mises|mpa|factor of safety)\b", re.I)
_MEASURED = re.compile(r"\d.*\b(mm|cm|mpa|kn|metre|meter|dimension)\b|\b(mm|cm|mpa)\b.*\d", re.I)


class ModelReply(BaseModel):
    model_config = ConfigDict(extra="ignore")

    message: str = ""
    questions: list[str] = []
    observations: list[str] = []


def blank_inputs() -> dict:
    return {
        "jurisdiction": "",
        "span_m": None,
        "tributary_width_m": None,
        "dead_n_per_m2": None,
        "live_n_per_m2": None,
        "beam_self_weight_n_per_m": None,
        "depth_m": None,
        "flange_width_m": None,
        "flange_thickness_m": None,
        "web_thickness_m": None,
        "student_count": None,
        "supports": "",
    }


def absorb_message(inputs: dict, message: str) -> dict:
    """Fill only fields the user has not already set. A headcount never becomes a width."""

    found = dict(inputs)
    students = _STUDENTS.search(message)
    if students and found.get("student_count") is None:
        found["student_count"] = int(students.group(1))
    if not str(found.get("jurisdiction") or "").strip() and re.search(r"\bcolombia\b", message, re.I):
        found["jurisdiction"] = "Colombia"
    if found.get("span_m") is None:
        span = _SPAN.search(message)
        if span:
            found["span_m"] = float(span.group(1))
    if found.get("tributary_width_m") is None:
        width = _WIDTH.search(message)
        if width:
            found["tributary_width_m"] = float(width.group(1))
    if found.get("dead_n_per_m2") is None:
        dead = _DEAD.search(message)
        if dead:
            found["dead_n_per_m2"] = float(dead.group(1)) * 1000.0
    return found


def advance_scenario(
    state: dict,
    message: str,
    *,
    image_data_urls: list[str] | None = None,
    responder: Any = None,
    model: str | None = None,
) -> dict:
    inputs = absorb_message(state.get("inputs") or blank_inputs(), message)
    study = evaluate_classroom(**inputs)
    image_count = len(state.get("evidence") or [])
    summary = _summary(study, inputs, image_count, bool(image_data_urls))
    mode = "offline-template"
    model_name = None
    response_id = state.get("previous_response_id")
    usage = None
    withheld = ""
    accepted = ""
    questions: list[str] = []
    observations: list[str] = []
    search_sources: list[dict] = []
    caller = responder
    if caller is None and configured():
        selected_model = model

        def caller(**kwargs: Any) -> dict:
            return create_response(model=selected_model, **kwargs)

    if caller is not None:
        try:
            result = caller(
                instructions=INSTRUCTIONS,
                user_text=_model_prompt(message, inputs, image_count),
                image_data_urls=(image_data_urls or [])[:8],
                previous_response_id=response_id,
            )
        except MetaNotConfigured:
            result = None
        except MetaRequestError as exc:
            result = None
            withheld = (
                f"The Meta request failed ({exc}). No citation was stored from that attempt. "
                "The numbers below are the local calculation."
            )
        if result:
            mode = "meta-responses"
            model_name = result.get("model")
            response_id = result.get("id") or response_id
            usage = result.get("usage")
            parsed = _parse_model(str(result.get("text") or ""))
            if parsed is None:
                withheld = (
                    "The model reply was not a valid engineering record, so its wording was not used. "
                    "The numbers below are the local calculation."
                )
            else:
                accepted = parsed.message
                questions = parsed.questions[:6]
                observations = parsed.observations[:6]
            for item in result.get("citations") or []:
                if not item.get("url"):
                    continue
                search_sources.append(
                    {
                        "title": item.get("title") or item["url"],
                        "url": item["url"],
                        "span": item.get("span") or "",
                        "status": "search result, not a compliance finding",
                        "origin": "meta web_search",
                        "retrieved_at": datetime.now(UTC).isoformat(),
                        "limit": "A retrieved page is not a checked code provision and it is not a certification.",
                    }
                )
    assistant = " ".join(part for part in (accepted, withheld, summary) if part).strip()
    messages = list(state.get("messages") or [])
    if message.strip():
        messages.append({"role": "user", "text": message.strip()})
    messages.append({"role": "assistant", "text": assistant})
    return {
        "inputs": inputs,
        "messages": messages[-40:],
        "missing": study["missing"],
        "errors": study["errors"],
        "assumptions": study["assumptions"],
        "sources": [*study["sources"], *search_sources],
        "calculation": study["line"],
        "section": study["section"],
        "beam": study["beam"],
        "model_proposal": {
            "family": "simply supported classroom I-beam, preliminary",
            "ready_for_3d_simulation": False,
            "reason": study["reason"],
        },
        "verification": study["verification"],
        "model_questions": questions,
        "observations": observations,
        "mode": mode,
        "model": model_name,
        "previous_response_id": response_id,
        "usage": usage,
        "ai": "responses" if mode == "meta-responses" else "not called",
    }


def _model_prompt(message: str, inputs: dict, image_count: int) -> str:
    return (
        f"User message: {message or 'Review the current inputs.'}\n"
        f"Known inputs, which you must not replace: {json.dumps(inputs)}\n"
        f"Stored images: {image_count}. Describe only what is visible. Do not measure them."
    )


def _parse_model(text: str) -> ModelReply | None:
    match = None
    for candidate in re.finditer(r"\{.*\}", text, re.S):
        match = candidate
    if match is None:
        return None
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    try:
        reply = ModelReply.model_validate(payload)
    except ValueError:
        return None
    if _FORBIDDEN.search(reply.message):
        reply.message = ""
    reply.observations = [item for item in reply.observations if item and not _MEASURED.search(item)]
    reply.questions = [item[:240] for item in reply.questions if item.strip()]
    return reply


def _summary(study: dict, inputs: dict, image_count: int, images_sent: bool) -> str:
    parts: list[str] = []
    if image_count:
        sent = "sent to the vision model" if images_sent else "not sent to a vision model"
        parts.append(f"{image_count} image(s) are stored and were {sent}. They were not measured.")
    if inputs.get("student_count"):
        parts.append(f"I noted {inputs['student_count']} students. A headcount is not a floor load.")
    if study["missing"]:
        parts.append("Still needed: " + ", ".join(study["missing"]) + ".")
    line = study.get("line")
    if line:
        parts.append(f"q = (q_dead + q_live) * tributary width + beam self-weight = {line['q_line_n_per_m']:.1f} N/m.")
    else:
        parts.append("No line load is calculated until the tributary width, dead load, and live load are known.")
    beam = study.get("beam")
    if beam:
        parts.append(
            "Candidate simple-span elastic results, not finite-element results: "
            f"M = {beam['max_moment_n_m']:.1f} N·m, each reaction = {beam['end_shear_n']:.1f} N, "
            f"midspan deflection = {beam['midspan_deflection_m'] * 1000:.3f} mm."
        )
    parts.append(study["reason"])
    parts.extend(study["errors"])
    return " ".join(parts)

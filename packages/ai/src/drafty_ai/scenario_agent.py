"""One scenario orchestration. Physics stays in drafty_engineering."""

import json
import re
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError

from drafty_ai.client import MetaNotConfigured, MetaRequestError, configured
from drafty_ai.responses import create_response
from drafty_engineering.scenario import evaluate_classroom

INSTRUCTIONS = """You are Drafty's scenario assistant.
One reply covers understanding, research, assumptions, a physical model, numerical verification, and criticism.
Use web_search only for published codes, standards, or material sources.
Do not search in order to do arithmetic.
Return only the JSON object required by the schema: message, questions, and observations.
observations may name visible objects. They must not state a dimension, a load, or a stress.
Do not claim that a design is safe, approved, or certified.
Do not invent finite-element stresses, displacements, or safety factors.
Do not write Python, shell, or solver input.
The server replaces every load and section number with its own calculation.
"""

MAX_META_TURNS = 8
MAX_SESSION_OUTPUT_TOKENS = 6000
_COMPARE_KEYS = (
    "jurisdiction",
    "span_m",
    "tributary_width_m",
    "dead_n_per_m2",
    "live_n_per_m2",
    "beam_self_weight_n_per_m",
    "depth_m",
    "flange_width_m",
    "flange_thickness_m",
    "web_thickness_m",
    "supports",
)
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
    analysis = _fresh_analysis(state.get("analysis"), inputs)
    comparison = None if analysis is None or analysis.get("stale") else state.get("comparison")
    image_count = len(state.get("evidence") or [])
    images_sent = bool(image_data_urls)
    summary = _summary(study, inputs, image_count, images_sent)
    mode = state.get("mode") if state.get("mode") in {"offline-template", "meta-responses"} else "offline-template"
    model_name = state.get("model") if mode == "meta-responses" else None
    response_id = state.get("previous_response_id")
    usage = state.get("usage")
    meta_turns = int(state.get("meta_turns") or 0)
    output_tokens = int(state.get("output_tokens") or 0)
    context_reset = False
    withheld = ""
    accepted = ""
    questions: list[str] = []
    observations: list[str] = []
    search_sources: list[dict] = []
    over_budget = _over_budget(meta_turns, output_tokens)
    caller = responder
    if caller is None and configured() and not over_budget:
        selected_model = model

        def caller(**kwargs: Any) -> dict:
            return create_response(model=selected_model, **kwargs)

    if over_budget and (responder is not None or configured()):
        withheld = (
            "This session reached its Meta research limit of 8 turns or 6000 output tokens. "
            "No further model call was sent. The numbers below are the local calculation."
        )
    elif caller is not None:
        try:
            result = caller(
                instructions=INSTRUCTIONS,
                user_text=_model_prompt(message, inputs, image_count, study["missing"]),
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
        else:
            if not isinstance(result, dict):
                result = None
                withheld = "The model reply was empty, so its wording was not used."
        if result:
            mode = "meta-responses"
            model_name = result.get("model") or model_name
            response_id = result.get("id") or response_id
            usage_payload = result.get("usage") if isinstance(result.get("usage"), dict) else {}
            context_reset = bool(result.get("context_reset"))
            meta_turns += 1
            output_tokens += int(usage_payload.get("output_tokens") or 0)
            if usage_payload:
                usage = usage_payload
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
                if not isinstance(item, dict) or not item.get("url"):
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
            if context_reset:
                withheld = (
                    "The previous Meta conversation could not be resumed, so this turn started a new one. "
                    "Saved inputs were kept. " + withheld
                ).strip()
    phase = _phase(
        study,
        images_sent=images_sent,
        searched=bool(search_sources),
        analysis_current=bool(analysis) and not analysis.get("stale"),
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
        "sources": _merge_sources(study["sources"], state.get("sources") or [], search_sources),
        "calculation": study["line"],
        "section": study["section"],
        "beam": study["beam"],
        "model_proposal": {
            "family": "simply supported classroom I-beam, preliminary",
            "ready_for_3d_simulation": False,
            "ready_for_beam_elements": study["ready_for_beam_elements"],
            "reason": study["reason"],
        },
        "verification": study["verification"],
        "model_questions": questions,
        "observations": observations,
        "mode": mode,
        "model": model_name,
        "previous_response_id": response_id,
        "usage": usage,
        "meta_turns": meta_turns,
        "output_tokens": output_tokens,
        "context_reset": context_reset,
        "phase": phase,
        "analysis": analysis,
        "comparison": comparison,
        "ai": "responses" if mode == "meta-responses" else "not called",
    }


def _model_prompt(message: str, inputs: dict, image_count: int, missing: list[str]) -> str:
    return (
        f"User message: {message or 'Review the current inputs.'}\n"
        f"Known inputs, which you must not replace: {json.dumps(inputs)}\n"
        f"Missing fields: {', '.join(missing) if missing else 'none'}.\n"
        f"Stored images: {image_count}. Describe only what is visible. Do not measure them."
    )


def _parse_model(text: str) -> ModelReply | None:
    for candidate in _json_candidates(text):
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue
        try:
            reply = ModelReply.model_validate(payload)
        except ValidationError:
            continue
        if _FORBIDDEN.search(reply.message):
            reply.message = ""
        reply.message = reply.message.strip()[:1200]
        reply.observations = [item for item in reply.observations if item and not _MEASURED.search(item)][:6]
        reply.questions = [
            item.strip()[:240]
            for item in reply.questions
            if item.strip() and not _MEASURED.search(item) and not _FORBIDDEN.search(item)
        ][:6]
        return reply
    return None


def _json_candidates(text: str) -> list[str]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    found = [cleaned] if cleaned else []
    found.extend(_balanced_objects(cleaned))
    return found


def _balanced_objects(text: str) -> list[str]:
    objects: list[str] = []
    start: int | None = None
    depth = 0
    in_string = False
    escape = False
    for index, character in enumerate(text):
        if in_string:
            if escape:
                escape = False
            elif character == "\\":
                escape = True
            elif character == '"':
                in_string = False
            continue
        if character == '"':
            in_string = True
        elif character == "{":
            if depth == 0:
                start = index
            depth += 1
        elif character == "}" and depth:
            depth -= 1
            if depth == 0 and start is not None:
                objects.append(text[start : index + 1])
                start = None
    return objects


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
    if study["ready_for_beam_elements"]:
        parts.append(
            "Confirmed simple supports can be sent to Euler-Bernoulli beam elements. "
            "They are not sent to the solid cantilever solver."
        )
    parts.append(study["reason"])
    parts.extend(study["errors"])
    return " ".join(parts)


def _phase(study: dict, *, images_sent: bool, searched: bool, analysis_current: bool) -> str:
    if analysis_current:
        return "verifying"
    if study.get("beam") or study.get("ready_for_beam_elements"):
        return "building-model"
    if searched:
        return "searching"
    if images_sent:
        return "interpreting-evidence"
    if study.get("missing"):
        return "asking"
    return "collecting"


def _over_budget(meta_turns: int, output_tokens: int) -> bool:
    return meta_turns >= MAX_META_TURNS or output_tokens >= MAX_SESSION_OUTPUT_TOKENS


def _fresh_analysis(analysis: dict | None, inputs: dict) -> dict | None:
    if not analysis:
        return None
    snapshot = analysis.get("inputs") or {}
    stale = any(not _same(snapshot.get(key), inputs.get(key)) for key in _COMPARE_KEYS)
    return {**analysis, "stale": stale}


def _same(left: Any, right: Any) -> bool:
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        scale = max(1.0, abs(float(left)), abs(float(right)))
        return abs(float(left) - float(right)) <= 1e-9 * scale
    return left == right


def _merge_sources(authoritative: list[dict], prior: list[dict], fresh: list[dict]) -> list[dict]:
    merged: list[dict] = []
    index: dict[str, dict] = {}
    protected: set[str] = set()

    def add(item: dict, *, protect: bool = False, refresh: bool = False) -> None:
        url = str(item.get("url") or "").strip()
        key = url or f"{item.get('origin')}|{item.get('title')}"
        current = index.get(key)
        if current is not None:
            if key in protected or not refresh:
                return
            for field in ("span", "retrieved_at", "title", "status", "limit"):
                if item.get(field) not in (None, ""):
                    current[field] = item[field]
            return
        copy = dict(item)
        index[key] = copy
        merged.append(copy)
        if protect:
            protected.add(key)

    for item in authoritative:
        add(item, protect=True)
    for item in prior:
        if item.get("origin") == "checked template":
            continue
        add(item)
    for item in fresh:
        add(item, refresh=True)
    return merged

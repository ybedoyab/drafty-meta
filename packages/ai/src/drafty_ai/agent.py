"""Engineering agent. The model may only call the allowlisted tools."""

import json
import os
import re
from typing import Any

from pydantic import ValidationError

from drafty_ai.client import ALLOWED_MODELS, MetaNotConfigured, chat_completion
from drafty_engineering.materials import MATERIALS
from drafty_engineering.spec import DesignSpec

ALLOWLIST = {"ask_clarification", "propose_design"}
SYSTEM_PROMPT = """You are the mechanical design assistant inside Drafty.
Call ask_clarification or propose_design. Do not answer with a design that was not passed through a tool.
Never write Python, shell, CalculiX, Gmsh, or OpenSCAD for the user to execute.
Never invent stresses, displacements, safety factors, or other physical results.
Never estimate a precise dimension from an image.
An image may only suggest a topology such as a beam, plate, bracket, or holes.
Use only numbers that appear in the user's text. Convert millimeters to meters exactly.
Internal units are meters, newtons, and pascals.
A design needs one encastre support, one load, a material id, and explicit geometry.
Load direction is a unit vector. The load magnitude is separate.
Available material ids: {materials}.
""".format(materials=", ".join(sorted(MATERIALS)))


def interpret(message: str, image_data_url: str | None = None, model: str | None = None) -> dict:
    if image_data_url and not re.search(r"\d", message):
        return {
            "action": "clarify",
            "message": (
                "Exact dimensions, material, supports, and loads have to be typed. "
                "They are not estimated from the reference image."
            ),
            "missing_fields": ["dimensions", "material", "support", "load"],
            "spec": None,
        }
    if model is not None and model not in ALLOWED_MODELS:
        raise MetaNotConfigured(f"Model '{model}' is not available. Use muse-spark-1.3 or muse-wonder-1.0.")
    messages: list[dict] = [
        {"role": "developer", "content": SYSTEM_PROMPT},
        {"role": "user", "content": _user_content(message, image_data_url)},
    ]
    tools = tool_definitions()
    for _ in range(2):
        payload = chat_completion(messages, tools=tools, model=model)
        choice = payload["choices"][0]["message"]
        tool_calls = choice.get("tool_calls") or []
        if not tool_calls:
            return {
                "action": "clarify",
                "message": choice.get("content") or "The model did not return a design.",
                "missing_fields": [],
                "spec": None,
            }
        messages.append(choice)
        for call in tool_calls:
            name = call.get("function", {}).get("name")
            raw_arguments = call.get("function", {}).get("arguments") or "{}"
            try:
                arguments = json.loads(raw_arguments)
            except json.JSONDecodeError:
                arguments = {}
            outcome = execute_tool(name, arguments)
            if outcome["action"] in {"clarify", "propose"}:
                return outcome
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.get("id"),
                    "content": json.dumps(outcome),
                }
            )
    return {
        "action": "clarify",
        "message": "The model did not return a valid design specification.",
        "missing_fields": [],
        "spec": None,
    }


def execute_tool(name: str | None, arguments: dict[str, Any]) -> dict:
    if name not in ALLOWLIST:
        return {
            "action": "rejected",
            "message": f"Tool '{name}' is not allowlisted. No code was executed.",
            "spec": None,
        }
    if name == "ask_clarification":
        return {
            "action": "clarify",
            "message": str(arguments.get("message") or "More engineering inputs are required."),
            "missing_fields": list(arguments.get("missing_fields") or []),
            "spec": None,
        }
    try:
        spec = DesignSpec.model_validate(arguments)
    except ValidationError as exc:
        return {
            "action": "invalid_spec",
            "message": json.loads(exc.json()),
            "spec": None,
        }
    return {
        "action": "propose",
        "message": "Review the specification before running analysis.",
        "spec": spec.model_dump(),
    }


def tool_definitions() -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": "ask_clarification",
                "description": "Ask for missing dimensions, material, support, or load. Use this instead of guessing.",
                "parameters": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["message", "missing_fields"],
                    "properties": {
                        "message": {"type": "string"},
                        "missing_fields": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "propose_design",
                "description": (
                    "Submit a design specification using only numbers from the user. "
                    "This does not run a solver."
                ),
                "parameters": _design_schema(),
            },
        },
    ]


def propose_next_thickness(history: list[dict], lower_m: float, upper_m: float) -> float | None:
    if not os.environ.get("MODEL_API_KEY", "").strip():
        return None
    schema = {
        "type": "json_schema",
        "json_schema": {
            "name": "thickness_proposal",
            "schema": {
                "type": "object",
                "additionalProperties": False,
                "required": ["thickness_m", "rationale"],
                "properties": {
                    "thickness_m": {"type": "number"},
                    "rationale": {"type": "string"},
                },
            },
        },
    }
    payload = chat_completion(
        [
            {
                "role": "developer",
                "content": (
                    "Propose the next thickness in meters for a finite element sizing loop. "
                    "Stay inside the bounds. Do not report stress, mass, or displacement; "
                    "the solver computes those."
                ),
            },
            {
                "role": "user",
                "content": json.dumps({"history": history, "lower_m": lower_m, "upper_m": upper_m}),
            },
        ],
        response_format=schema,
    )
    content = payload["choices"][0]["message"].get("content") or "{}"
    parsed = json.loads(content)
    return float(parsed["thickness_m"])


def _design_schema() -> dict:
    schema = DesignSpec.model_json_schema()
    definitions = schema.pop("$defs", {})
    for definition in definitions.values():
        if definition.get("type") == "object":
            definition["additionalProperties"] = False
    inlined = _inline(schema, definitions)
    if inlined.get("type") == "object":
        inlined["additionalProperties"] = False
    return inlined


def _inline(node: Any, definitions: dict) -> Any:
    if isinstance(node, dict):
        if "$ref" in node:
            name = node["$ref"].rsplit("/", 1)[-1]
            return _inline(json.loads(json.dumps(definitions[name])), definitions)
        return {key: _inline(value, definitions) for key, value in node.items()}
    if isinstance(node, list):
        return [_inline(value, definitions) for value in node]
    return node


def _user_content(message: str, image_data_url: str | None) -> str | list[dict]:
    if not image_data_url:
        return message
    return [
        {"type": "text", "text": message},
        {"type": "image_url", "image_url": {"url": image_data_url}},
    ]

"""A typed engineering scenario. The model may propose a plan. It does not supply results."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from drafty_engineering.materials import MATERIALS
from drafty_engineering.spec import BracketGeometry, DesignSpec, Direction, Load, Support

Domain = Literal["structural", "mechanical", "unknown"]
System = Literal["simply_supported_ibeam", "l_bracket", "unknown"]
QuantityStatus = Literal["confirmed", "assumed", "researched", "calculated", "unknown"]
ToolName = Literal[
    "inspect_scenario",
    "research_engineering_reference",
    "propose_engineering_model",
    "validate_model_inputs",
    "calculate_section_properties",
    "evaluate_beam",
    "create_supported_cad",
    "run_supported_simulation",
    "compare_design_variants",
    "explain_results",
]
TOOL_NAMES = {
    "inspect_scenario",
    "research_engineering_reference",
    "propose_engineering_model",
    "validate_model_inputs",
    "calculate_section_properties",
    "evaluate_beam",
    "create_supported_cad",
    "run_supported_simulation",
    "compare_design_variants",
    "explain_results",
}
STRUCTURAL_TOOLS = {"calculate_section_properties", "evaluate_beam"}
MECHANICAL_TOOLS = {"create_supported_cad", "run_supported_simulation"}
_FACES = {"xmin", "xmax", "ymin", "ymax", "zmin", "zmax"}

_MECHANICAL = re.compile(r"\b(bracket|aluminum|aluminium|aluminio|masa|mass)\b", re.I)
_STRUCTURAL = re.compile(
    r"\b(classroom|students?|estudiantes|aula|i-?beam|viga|floor|piso|losa)\b",
    re.I,
)
_ALUMINUM = re.compile(r"\b(aluminum|aluminium|aluminio)\b", re.I)


class EngineeringQuantity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    value_si: float | None = None
    unit: str
    status: QuantityStatus
    source: str = ""


class EngineeringScenario(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = ""
    objective: str = ""
    domain: Domain = "unknown"
    physical_system: System = "unknown"
    quantities: list[EngineeringQuantity] = Field(default_factory=list)
    assumptions: list[dict] = Field(default_factory=list)
    evidence_count: int = 0
    sources: list[dict] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    suitable_methods: list[str] = Field(default_factory=list)
    unsupported: list[str] = Field(default_factory=list)
    validation_status: Literal["incomplete", "ready", "checked", "blocked"] = "incomplete"
    next_actions: list[str] = Field(default_factory=list)
    simulator: Literal["none", "analytical", "beam-element", "calculix"] = "none"


def classify_problem(message: str, prior_domain: str = "") -> tuple[Domain, System]:
    """Choose a system from the words in the request. Numbers are not invented."""

    mechanical = bool(_MECHANICAL.search(message))
    structural = bool(_STRUCTURAL.search(message))
    if mechanical and _ALUMINUM.search(message):
        return "mechanical", "l_bracket"
    if mechanical and not structural:
        return "mechanical", "l_bracket"
    if structural:
        return "structural", "simply_supported_ibeam"
    if prior_domain == "mechanical":
        return "mechanical", "l_bracket"
    if prior_domain == "structural":
        return "structural", "simply_supported_ibeam"
    return "unknown", "unknown"


def neutral_study() -> dict:
    return {
        "missing": ["a structural or mechanical description"],
        "errors": [],
        "assumptions": [],
        "sources": [],
        "line": None,
        "section": None,
        "beam": None,
        "ready_for_3d_simulation": False,
        "ready_for_beam_elements": False,
        "reason": "The problem is not classified yet. No solver was selected.",
        "verification": [],
    }


def evaluate_bracket(inputs: dict) -> dict:
    """Record what an L-bracket still needs. This does not run CalculiX."""

    missing: list[str] = []
    assumptions: list[dict] = []
    if inputs.get("force_n") is None:
        missing.append("force")
    else:
        assumptions.append(_assumption("force", "The force was typed by the user.", "confirmed", "user"))
    if inputs.get("displacement_limit_m") is None:
        missing.append("displacement limit")
    else:
        assumptions.append(
            _assumption("displacement limit", "The displacement limit was typed by the user.", "confirmed", "user")
        )
    material_id = str(inputs.get("material_id") or "")
    if material_id not in MATERIALS:
        missing.append("material")
    else:
        material = MATERIALS[material_id]
        assumptions.append(
            _assumption(
                "material",
                f"{material.name} comes from the stored library ({material.source}). It is not a lot certificate.",
                "assumed",
                "stored material library",
            )
        )
    for name, key in (
        ("leg length along x", "leg_x_m"),
        ("leg length along z", "leg_z_m"),
        ("thickness", "bracket_thickness_m"),
        ("width", "bracket_width_m"),
    ):
        if inputs.get(key) is None:
            missing.append(name)
    if not str(inputs.get("support_face") or "").strip() or not str(inputs.get("load_face") or "").strip():
        missing.append("fixed face and load face")
        assumptions.append(
            _assumption(
                "faces",
                "A fixed face on xmin and a load on zmax are a candidate only. They are not confirmed.",
                "assumed",
                "candidate CAD schema",
            )
        )
    ready = not missing
    return {
        "missing": missing,
        "errors": [],
        "assumptions": assumptions,
        "sources": [],
        "line": None,
        "section": None,
        "beam": None,
        "ready_for_3d_simulation": False,
        "ready_for_beam_elements": False,
        "ready_for_cad": ready,
        "reason": (
            "This is an aluminum L-bracket for the existing solid schema. "
            "CalculiX starts only after the model is approved in Studio. "
            "It is not the classroom beam and it is not a certified minimum-mass design."
            if ready
            else "The bracket is incomplete. No solid mesh and no CalculiX job are created."
        ),
        "verification": [
            "No solid solve has been started from this scenario.",
            "A photograph or a mask is not a dimension.",
            "Minimum mass is an objective, not a result, until compared solves exist.",
        ],
    }


def proposed_bracket_spec(inputs: dict) -> dict | None:
    """Build a DesignSpec only from stored numbers. Missing geometry stays missing."""

    keys = ("leg_x_m", "leg_z_m", "bracket_thickness_m", "bracket_width_m", "force_n")
    if any(inputs.get(key) is None for key in keys):
        return None
    material_id = str(inputs.get("material_id") or "")
    if material_id not in MATERIALS:
        return None
    support = str(inputs.get("support_face") or "").strip()
    load_face = str(inputs.get("load_face") or "").strip()
    if support not in _FACES or load_face not in _FACES or support == load_face:
        return None
    smallest = min(float(inputs[key]) for key in keys[:4])
    mesh = smallest * 0.3
    try:
        spec = DesignSpec(
            name="aluminum-bracket",
            kind="l_bracket",
            material_id=material_id,
            mesh_size_m=mesh,
            element_order=2,
            supports=[Support(surface=support)],  # type: ignore[arg-type]
            loads=[
                Load(
                    surface=load_face,  # type: ignore[arg-type]
                    mode="force",
                    magnitude=float(inputs["force_n"]),
                    direction=Direction(x=0, y=0, z=-1),
                )
            ],
            bracket=BracketGeometry(
                leg_x_m=float(inputs["leg_x_m"]),
                leg_z_m=float(inputs["leg_z_m"]),
                thickness_m=float(inputs["bracket_thickness_m"]),
                width_m=float(inputs["bracket_width_m"]),
            ),
        )
    except (ValueError, TypeError):
        return None
    return spec.model_dump()


def build_scenario(
    *,
    description: str,
    inputs: dict,
    study: dict,
    sources: list[dict],
    evidence_count: int,
    analysis: dict | None,
    comparison: dict | None,
) -> EngineeringScenario:
    domain = inputs.get("domain") if inputs.get("domain") in {"structural", "mechanical"} else "unknown"
    system = inputs.get("physical_system") if inputs.get("physical_system") in {
        "simply_supported_ibeam",
        "l_bracket",
    } else "unknown"
    quantities = _quantities(inputs, study, domain)
    simulator = "none"
    validation = "incomplete"
    if comparison:
        simulator = "beam-element" if domain == "structural" else "calculix"
        validation = "checked"
    elif analysis:
        simulator = "beam-element"
        validation = "checked"
    elif study.get("beam"):
        simulator = "analytical"
        validation = "ready" if not study.get("missing") else "incomplete"
    elif study.get("ready_for_cad"):
        validation = "ready"
    unsupported = []
    suitable: list[str] = []
    if system == "simply_supported_ibeam":
        suitable = ["analytical simple-span formulas", "Euler-Bernoulli beam elements"]
        unsupported = ["CalculiX solid job for this line-loaded floor beam", "cantilever conversion"]
    elif system == "l_bracket":
        suitable = ["parametric L-bracket in the CAD schema", "CalculiX solid FEM after approval"]
        unsupported = ["classroom beam-element solver", "pixel measurements without a reference dimension"]
    actions = []
    if study.get("missing"):
        actions.append("Ask for the missing quantities before any solve.")
    elif system == "simply_supported_ibeam" and analysis is None:
        actions.append("Run Euler-Bernoulli beam elements after the supports are confirmed.")
    elif system == "l_bracket" and study.get("ready_for_cad"):
        actions.append("Approve the CAD model and open Studio before CalculiX.")
    if domain == "unknown":
        actions.append("Describe the part or the structure.")
    return EngineeringScenario(
        description=description[:500],
        objective=str(inputs.get("objective") or description[:240]),
        domain=domain,
        physical_system=system,
        quantities=quantities,
        assumptions=list(study.get("assumptions") or []),
        evidence_count=evidence_count,
        sources=sources,
        missing=list(study.get("missing") or []),
        suitable_methods=suitable,
        unsupported=unsupported,
        validation_status=validation,
        next_actions=actions,
        simulator=simulator,
    )


def route_tool(
    requested: str | None,
    *,
    domain: str,
    system: str,
    missing: list[str],
    has_analysis: bool,
    has_spec: bool,
) -> tuple[str, str]:
    """Pick one allowlisted tool. A simulation request waits for confirmation."""

    if requested and requested not in TOOL_NAMES:
        return str(requested), "rejected"
    if requested in STRUCTURAL_TOOLS and system != "simply_supported_ibeam":
        return str(requested), "rejected"
    if requested in MECHANICAL_TOOLS and system != "l_bracket":
        return str(requested), "rejected"
    if requested in {"evaluate_beam", "run_supported_simulation"}:
        return str(requested), "needs_confirmation"
    if requested in TOOL_NAMES:
        return str(requested), "ok"
    if domain == "unknown":
        return "inspect_scenario", "ok"
    if missing:
        return "propose_engineering_model", "ok"
    if system == "simply_supported_ibeam" and has_analysis:
        return "explain_results", "ok"
    if system == "simply_supported_ibeam":
        return "validate_model_inputs", "ok"
    if system == "l_bracket" and has_spec:
        return "create_supported_cad", "ok"
    return "propose_engineering_model", "ok"


def workflow_stage(
    *,
    domain: str,
    missing: list[str],
    searched: bool,
    has_model: bool,
    has_analysis: bool,
    has_comparison: bool,
) -> str:
    if has_comparison:
        return "optimize"
    if has_analysis:
        return "simulate"
    if has_model and not missing:
        return "validate"
    if has_model:
        return "model"
    if searched:
        return "research"
    if domain == "unknown":
        return "understand"
    return "model"


def _assumption(name: str, statement: str, status: str, provenance: str) -> dict:
    return {"name": name, "statement": statement, "status": status, "provenance": provenance, "source": provenance}


def _quantities(inputs: dict, study: dict, domain: str) -> list[EngineeringQuantity]:
    rows: list[EngineeringQuantity] = []
    if domain == "structural":
        rows.extend(
            [
                _quantity("span", inputs.get("span_m"), "m", "confirmed"),
                _quantity("tributary width", inputs.get("tributary_width_m"), "m", "confirmed"),
                _quantity("dead load", inputs.get("dead_n_per_m2"), "Pa", "confirmed"),
                _quantity(
                    "live load",
                    inputs.get("live_n_per_m2"),
                    "Pa",
                    "confirmed" if inputs.get("live_n_per_m2") is not None else "unknown",
                ),
                _quantity("students", inputs.get("student_count"), "count", "unknown"),
            ]
        )
        line = study.get("line") or {}
        if line.get("q_line_n_per_m") is not None:
            rows.append(_quantity("line load", line["q_line_n_per_m"], "N/m", "calculated", "q_line formula"))
    elif domain == "mechanical":
        material = str(inputs.get("material_id") or "")
        rows.extend(
            [
                _quantity("force", inputs.get("force_n"), "N", "confirmed"),
                _quantity("displacement limit", inputs.get("displacement_limit_m"), "m", "confirmed"),
                _quantity("leg x", inputs.get("leg_x_m"), "m", "confirmed"),
                _quantity("leg z", inputs.get("leg_z_m"), "m", "confirmed"),
                _quantity("thickness", inputs.get("bracket_thickness_m"), "m", "confirmed"),
                _quantity("width", inputs.get("bracket_width_m"), "m", "confirmed"),
            ]
        )
        if material in MATERIALS:
            rows.append(
                EngineeringQuantity(
                    name="material",
                    value_si=None,
                    unit=material,
                    status="assumed",
                    source="stored material library",
                )
            )
    return rows


def _quantity(
    name: str,
    value: float | None,
    unit: str,
    status: QuantityStatus,
    source: str = "user",
) -> EngineeringQuantity:
    if value is None and status == "confirmed":
        status = "unknown"
        source = ""
    stored = None if value is None else float(value)
    return EngineeringQuantity(name=name, value_si=stored, unit=unit, status=status, source=source)


def score_planning_reply(reply: dict) -> dict:
    """Score one planning reply. A passing score does not authorize a calculation."""

    claims = reply.get("claims") if isinstance(reply.get("claims"), list) else []
    text = " ".join(
        [str(reply.get("message") or "")]
        + [str(item) for item in (reply.get("questions") or [])]
    ).lower()
    numeric_claim = any(
        any(character.isdigit() for character in str(item.get("statement") or ""))
        for item in claims
        if isinstance(item, dict)
    )
    checks = {
        "structural_domain": reply.get("domain") == "structural",
        "simply_supported": reply.get("physical_system") == "simply_supported_ibeam",
        "planning_tool": reply.get("tool") in TOOL_NAMES - {"evaluate_beam", "run_supported_simulation"},
        "no_numeric_claims": not numeric_claim,
        "asks_for_span": "span" in text or "luz" in text,
    }
    return {"checks": checks, "passed": sum(1 for item in checks.values() if item), "total": len(checks)}

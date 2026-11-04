"""A typed engineering scenario. The model may propose a plan. It does not supply results."""

import re
from typing import Literal, NamedTuple

from pydantic import BaseModel, ConfigDict, Field

from drafty_engineering.catalog import (
    AMBIGUOUS,
    PARTS,
    UNSUPPORTED,
    ambiguous_sentence,
    get_part,
    keyword_pattern,
    part_tools,
    scenario_parts,
    unsupported_sentence,
)
from drafty_engineering.materials import MATERIALS
from drafty_engineering.spec import (
    BeamGeometry,
    BracketGeometry,
    DesignSpec,
    Direction,
    HolePattern,
    Load,
    PlateGeometry,
    Support,
)

Domain = Literal["structural", "mechanical", "geometry", "unsupported", "ambiguous", "unknown"]
System = Literal[
    "simply_supported_ibeam",
    "l_bracket",
    "revolved_profile",
    "cantilever_beam",
    "plate",
    "perforated_plate",
    "unsupported",
    "ambiguous",
    "unknown"
]
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
_FACES = {"xmin", "xmax", "ymin", "ymax", "zmin", "zmax"}
_ALUMINUM = re.compile(r"\b(aluminum|aluminium|aluminio)\b", re.I)

# A request names a concrete object when a design verb is followed by an article and a noun.
_LETTERS = r"[^\W\d_][^\W\d_'\-]*"
_NOUN = rf"({_LETTERS}(?:[ \-]{_LETTERS}){{0,5}})"
_ARTICLE = r"(?:an?|the|some|one|my|our|un|una|el|la|mi)"
_STRONG = (
    r"design|model|make|build|create|render|draw|print|3d[- ]print|generate|sculpt|"
    r"dise[ñn]ar|dise[ñn]a|modelar|modela|crear|crea|hacer|haz|construir|imprimir"
)
_WEAK = r"need|want|would like|'d like|necesito|quiero"
_MODEL_OF = re.compile(
    rf"\b(?:3d\s+)?(?:model|drawing|render|file|cad|step|stl|mesh|modelo)\s+(?:file\s+)?(?:of|de)\s+{_ARTICLE}\s+{_NOUN}",
    re.I,
)
_STRONG_REQUEST = re.compile(rf"\b(?:{_STRONG})\s+(?:me\s+|us\s+)?{_ARTICLE}\s+{_NOUN}", re.I)
_WEAK_REQUEST = re.compile(rf"\b(?:{_WEAK})\s+{_ARTICLE}\s+{_NOUN}", re.I)
_STOP_WORDS = {
    "to", "for", "that", "which", "with", "in", "on", "at", "using", "from", "and", "or", "by", "so", "please",
    "para", "que", "con", "en", "y", "o", "por",
}  # fmt: skip
_FILLER = {
    "basic", "simple", "small", "little", "new", "custom", "quick", "nice", "cool", "good", "decorative",
    "básico", "básica", "sencillo", "sencilla", "pequeño", "pequeña", "nuevo", "nueva",
}  # fmt: skip
_GENERIC = {
    "part", "parts", "thing", "object", "design", "model", "structure", "something", "piece", "component",
    "shape", "file", "drawing", "3d", "cad", "geometry", "pieza", "objeto", "diseño", "modelo", "estructura",
    "it", "this", "one", "look", "problem", "question", "calculation", "check", "analysis", "simulation",
}  # fmt: skip


class Request(NamedTuple):
    """The part a message points at. requested is the user's own noun when Drafty cannot build it."""

    domain: str
    system: str
    requested: str = ""


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
    requested_part: str = ""
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


def classify_problem(message: str, prior_domain: str = "") -> tuple[str, str]:
    """Choose a system from the words in the request. Numbers are not invented."""

    found = classify_request(message, prior_domain)
    return found.domain, found.system


def classify_request(
    message: str,
    prior_domain: str = "",
    prior_system: str = "",
    prior_requested: str = "",
) -> Request:
    """Match the message to a registry part, or record the part the user asked for that Drafty cannot build.

    When several registry parts match, return ambiguous instead of silently picking the first.
    Aluminum wording may narrow bracket vs beam, but only when that leaves exactly one hit.
    """

    hits = [part for part in scenario_parts() if part.keywords and keyword_pattern(part).search(message)]
    if len(hits) > 1 and _ALUMINUM.search(message):
        narrowed = [part for part in hits if part.domain == "mechanical"]
        if len(narrowed) == 1:
            hits = narrowed
    if len(hits) > 1:
        # Only a keyword that contains another hit's keyword is more specific ("perforated plate" over "plate").
        matched = {
            p.id: [w for w in p.keywords if re.search(rf"\b{re.escape(w)}\b", message, re.I)] for p in hits
        }
        specific = [
            p
            for p in hits
            if any(
                other != p.id and any(o in w for w in matched[p.id] for o in matched[other]) for other in matched
            )
        ]
        if len(specific) == 1:
            return Request(specific[0].domain, specific[0].id)
        return Request(AMBIGUOUS, AMBIGUOUS, _candidate_labels(hits))
    if len(hits) == 1:
        return Request(hits[0].domain, hits[0].id)
    open_request = prior_domain in {"", "unknown", UNSUPPORTED, AMBIGUOUS}
    noun = requested_noun(message, weak=open_request)
    if noun:
        return Request(UNSUPPORTED, UNSUPPORTED, noun)
    if prior_domain == UNSUPPORTED:
        return Request(UNSUPPORTED, UNSUPPORTED, prior_requested)
    if prior_domain == AMBIGUOUS:
        return Request(AMBIGUOUS, AMBIGUOUS, prior_requested)
    prior = get_part(prior_system)
    if prior is not None and prior.in_scenario:
        return Request(prior.domain, prior.id)
    domain_hits = [part for part in scenario_parts() if part.domain == prior_domain]
    if len(domain_hits) == 1:
        return Request(domain_hits[0].domain, domain_hits[0].id)
    if len(domain_hits) > 1:
        return Request(AMBIGUOUS, AMBIGUOUS, _candidate_labels(domain_hits))
    return Request("unknown", "unknown")


def _candidate_labels(parts: list) -> str:
    names = [part.phrase for part in parts]
    if len(names) <= 1:
        return names[0] if names else ""
    return ", ".join(names[:-1]) + f", or {names[-1]}"


def requested_noun(message: str, *, weak: bool = True) -> str:
    """The object a design request names, in the user's words. Empty when nothing concrete is named."""

    patterns = [_MODEL_OF, _STRONG_REQUEST] + ([_WEAK_REQUEST] if weak else [])
    for pattern in patterns:
        for match in pattern.finditer(message):
            noun = _clean_noun(match.group(1))
            if noun:
                return noun
    return ""


def _clean_noun(raw: str) -> str:
    words: list[str] = []
    for word in raw.lower().replace("-", " - ").split():
        if word in _STOP_WORDS:
            break
        words.append(word)
    text = " ".join(words).replace(" - ", "-").strip(" -")
    words = text.split()
    while words and words[0] in _FILLER:
        words.pop(0)
    if not words or all(word in _GENERIC for word in words):
        return ""
    return " ".join(words)[:40].strip()


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


def unsupported_study(noun: str) -> dict:
    """A request for a part outside the registry. Nothing is collected, built, or solved."""

    return {
        "missing": [],
        "errors": [],
        "assumptions": [],
        "sources": [],
        "line": None,
        "section": None,
        "beam": None,
        "ready_for_3d_simulation": False,
        "ready_for_beam_elements": False,
        "reason": unsupported_sentence(noun),
        "verification": ["No geometry, file, or calculation was created for this request."],
    }


def ambiguous_study(candidates: str) -> dict:
    """Several registry parts matched. Ask which one; do not pick silently or start a solver."""

    return {
        "missing": ["which registered part to build"],
        "errors": [],
        "assumptions": [],
        "sources": [],
        "line": None,
        "section": None,
        "beam": None,
        "ready_for_3d_simulation": False,
        "ready_for_beam_elements": False,
        "reason": ambiguous_sentence(candidates),
        "verification": ["No geometry, file, or calculation was created until the part is chosen."],
    }


def evaluate_bracket(inputs: dict) -> dict:
    """Record what an L-bracket still needs. This does not run CalculiX."""

    missing: list[str] = []
    assumptions: list[dict] = []
    demo = inputs.get("value_origin") == "demo"
    origin = "demo preset" if demo else "user"
    state = "assumed" if demo else "confirmed"
    if inputs.get("force_n") is None:
        missing.append("force")
    else:
        assumptions.append(
            _assumption(
                "force",
                "The bracket demo sets this force. It is not a measured load and not an approved design."
                if demo
                else "The force was typed by the user.",
                state,
                origin,
            )
        )
    if inputs.get("displacement_limit_m") is None:
        missing.append("displacement limit")
    else:
        assumptions.append(
            _assumption(
                "displacement limit",
                "The bracket demo sets this exploratory displacement limit. It is not a code limit."
                if demo
                else "The displacement limit was typed by the user.",
                state,
                origin,
            )
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
    if demo:
        assumptions.append(
            _assumption(
                "bracket demo",
                "The aluminum L-bracket numbers are bracket-v1 demo assumptions unless you edit them. "
                "Quadratic elements are requested. Support and load faces stay unconfirmed until you choose them. "
                "A later CalculiX peak at the fixed edge is not a converged stress and not a certification.",
                "assumed",
                "demo preset",
            )
        )
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


_STUDIO_GEOMETRY = {
    "cantilever_beam": (("beam.length_m", "length"), ("beam.width_m", "width"), ("beam.height_m", "height")),
    "plate": (("plate.length_m", "length"), ("plate.width_m", "width"), ("plate.thickness_m", "thickness")),
    "perforated_plate": (
        ("plate.length_m", "length"),
        ("plate.width_m", "width"),
        ("plate.thickness_m", "thickness"),
        ("holes.radius_m", "hole radius"),
        ("holes.count_x", "holes along length"),
        ("holes.count_y", "holes along width"),
        ("holes.margin_m", "hole margin"),
    ),
}


def evaluate_mechanical(inputs: dict) -> dict:
    """Record what a mechanical part still needs. The L-bracket keeps its own study."""

    system = str(inputs.get("physical_system") or "")
    if system == "l_bracket":
        return evaluate_bracket(inputs)
    part = get_part(system)
    fields = _STUDIO_GEOMETRY.get(system, ())
    missing: list[str] = []
    assumptions: list[dict] = []
    for key, label in fields:
        if inputs.get(key) is None:
            missing.append(label)
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
    if inputs.get("load_magnitude") is None:
        missing.append("force or pressure")
    if not str(inputs.get("support_face") or "").strip() or not str(inputs.get("load_face") or "").strip():
        missing.append("fixed face and load face")
        assumptions.append(
            _assumption("faces", "The fixed and load faces are not confirmed yet.", "assumed", "candidate CAD schema")
        )
    ready = not missing
    name = part.phrase if part is not None else "this part"
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
            f"This is {name} for the existing solid schema. CalculiX starts only after the model is approved "
            "in Studio. It is not the classroom beam and it is not a certified design."
            if ready
            else f"The {name} is incomplete. No solid mesh and no CalculiX job are created."
        ),
        "verification": [
            "No solid solve has been started from this scenario.",
            "A photograph or a mask is not a dimension.",
        ],
    }


def proposed_studio_spec(inputs: dict) -> dict | None:
    """Build a DesignSpec for any mechanical part, only from stored numbers."""

    system = str(inputs.get("physical_system") or "")
    if system == "l_bracket":
        return proposed_bracket_spec(inputs)
    fields = _STUDIO_GEOMETRY.get(system)
    if fields is None:
        return None
    if any(inputs.get(key) is None for key, _label in fields):
        return None
    if inputs.get("load_magnitude") is None:
        return None
    material_id = str(inputs.get("material_id") or "")
    if material_id not in MATERIALS:
        return None
    support = str(inputs.get("support_face") or "").strip()
    load_face = str(inputs.get("load_face") or "").strip()
    if support not in _FACES or load_face not in _FACES or support == load_face:
        return None
    mode = str(inputs.get("load_mode") or "force")
    if mode not in {"force", "pressure"}:
        mode = "force"
    dims = [float(inputs[key]) for key, _label in fields if not key.startswith("holes.count")]
    mesh = min(dims) * 0.3
    try:
        geometry: dict = {}
        if system == "cantilever_beam":
            geometry["beam"] = BeamGeometry(
                length_m=float(inputs["beam.length_m"]),
                width_m=float(inputs["beam.width_m"]),
                height_m=float(inputs["beam.height_m"]),
            )
        else:
            geometry["plate"] = PlateGeometry(
                length_m=float(inputs["plate.length_m"]),
                width_m=float(inputs["plate.width_m"]),
                thickness_m=float(inputs["plate.thickness_m"]),
            )
        if system == "perforated_plate":
            geometry["holes"] = HolePattern(
                radius_m=float(inputs["holes.radius_m"]),
                count_x=int(float(inputs["holes.count_x"])),
                count_y=int(float(inputs["holes.count_y"])),
                margin_m=float(inputs["holes.margin_m"]),
            )
        spec = DesignSpec(
            name=f"ai-{system.replace('_', '-')}",
            kind=system,  # type: ignore[arg-type]
            material_id=material_id,
            mesh_size_m=mesh,
            element_order=2,
            supports=[Support(surface=support)],  # type: ignore[arg-type]
            loads=[
                Load(
                    surface=load_face,  # type: ignore[arg-type]
                    mode=mode,  # type: ignore[arg-type]
                    magnitude=float(inputs["load_magnitude"]),
                    direction=Direction(x=0, y=0, z=-1),
                )
            ],
            **geometry,
        )
    except (ValueError, TypeError):
        return None
    return spec.model_dump()


# Scenario input keys a Studio spec can overwrite on return. Every geometry
# key of every Studio kind is cleared first, so changing the kind in Studio
# never resurrects the previous kind's dimensions on the next chat turn.
STUDIO_INPUT_KEYS = (
    "beam.length_m",
    "beam.width_m",
    "beam.height_m",
    "plate.length_m",
    "plate.width_m",
    "plate.thickness_m",
    "holes.radius_m",
    "holes.count_x",
    "holes.count_y",
    "holes.margin_m",
    "leg_x_m",
    "leg_z_m",
    "bracket_thickness_m",
    "bracket_width_m",
    "additions.width_m",
    "additions.height_m",
    "additions.depth_m",
    "force_n",
    "load_magnitude",
    "load_mode",
    "material_id",
    "support_face",
    "load_face",
)


def inputs_from_studio_spec(spec: dict) -> dict | None:
    """Scenario inputs for one validated Studio spec. None when it is not a DesignSpec."""

    try:
        design = DesignSpec.model_validate(spec)
    except (ValueError, TypeError):
        return None
    load = design.loads[0]
    patch: dict = {
        "domain": "mechanical",
        "physical_system": design.kind,
        "requested_part": "",
        "material_id": design.material_id,
        "support_face": design.supports[0].surface,
        "load_face": load.surface,
        "load_mode": load.mode,
        "load_magnitude": load.magnitude,
    }
    if design.kind == "l_bracket" and design.bracket is not None:
        patch.update(
            leg_x_m=design.bracket.leg_x_m,
            leg_z_m=design.bracket.leg_z_m,
            bracket_thickness_m=design.bracket.thickness_m,
            bracket_width_m=design.bracket.width_m,
            force_n=load.magnitude if load.mode == "force" else None,
        )
    elif design.kind == "cantilever_beam" and design.beam is not None:
        patch.update(
            **{
                "beam.length_m": design.beam.length_m,
                "beam.width_m": design.beam.width_m,
                "beam.height_m": design.beam.height_m,
            }
        )
    elif design.kind in {"plate", "perforated_plate"} and design.plate is not None:
        patch.update(
            **{
                "plate.length_m": design.plate.length_m,
                "plate.width_m": design.plate.width_m,
                "plate.thickness_m": design.plate.thickness_m,
            }
        )
        if design.holes is not None:
            patch.update(
                **{
                    "holes.radius_m": design.holes.radius_m,
                    "holes.count_x": design.holes.count_x,
                    "holes.count_y": design.holes.count_y,
                    "holes.margin_m": design.holes.margin_m,
                }
            )
    elif design.kind == "sketch_prism" and design.additions:
        addition = design.additions[0]
        patch.update(
            **{
                "additions.width_m": addition.width_m,
                "additions.height_m": addition.height_m,
                "additions.depth_m": addition.depth_m,
            }
        )
    return patch


def apply_studio_spec(inputs: dict, spec: dict) -> dict | None:
    """Inputs updated from a returned Studio spec. None when the spec is invalid."""

    patch = inputs_from_studio_spec(spec)
    if patch is None:
        return None
    merged = dict(inputs)
    for key in STUDIO_INPUT_KEYS:
        merged[key] = None if key not in {"material_id", "support_face", "load_face", "load_mode"} else ""
    merged.update(patch)
    return merged


def _changed(label: str, old: object, new: object, fmt) -> list[str]:
    if old is None or new is None:
        return [f"{label} set to {fmt(new)}"] if new is not None and old != new else []
    return [] if _same_number(old, new) else [f"{label} {fmt(old)} → {fmt(new)}"]


def _same_number(old: object, new: object) -> bool:
    if isinstance(old, (int, float)) and isinstance(new, (int, float)):
        return abs(float(old) - float(new)) <= 1e-9 * max(1.0, abs(float(old)), abs(float(new)))
    return old == new


def _mm(value: object) -> str:
    return f"{float(value) * 1000:g} mm"


def _load_text(spec: dict) -> str:
    load = (spec.get("loads") or [{}])[0]
    unit = "Pa" if load.get("mode") == "pressure" else "N"
    return f"{load.get('mode', 'force')} {float(load.get('magnitude') or 0):g} {unit} on {load.get('surface', '?')}"


def describe_studio_changes(old: dict, new: dict) -> list[str]:
    """Human-readable differences between the proposed spec and a Studio-returned one."""

    changes: list[str] = []
    if old.get("kind") != new.get("kind"):
        changes.append(f"part changed from {old.get('kind', 'unset')} to {new.get('kind', 'unset')}")
    else:
        geometry = {
            "beam": (("length_m", "length"), ("width_m", "width"), ("height_m", "height")),
            "plate": (("length_m", "length"), ("width_m", "width"), ("thickness_m", "thickness")),
            "bracket": (
                ("leg_x_m", "leg along x"),
                ("leg_z_m", "leg along z"),
                ("thickness_m", "thickness"),
                ("width_m", "width"),
            ),
        }
        for block, fields in geometry.items():
            before, after = old.get(block) or {}, new.get(block) or {}
            for key, label in fields:
                changes.extend(_changed(label, before.get(key), after.get(key), _mm))
        before, after = old.get("holes") or {}, new.get("holes") or {}
        for key, label in (("radius_m", "hole radius"), ("margin_m", "hole margin")):
            changes.extend(_changed(label, before.get(key), after.get(key), _mm))
        for key, label in (("count_x", "holes along length"), ("count_y", "holes along width")):
            changes.extend(_changed(label, before.get(key), after.get(key), lambda v: f"{int(v)}"))
    changes.extend(_changed("material", old.get("material_id"), new.get("material_id"), str))
    changes.extend(_changed("mesh size", old.get("mesh_size_m"), new.get("mesh_size_m"), _mm))
    changes.extend(
        _changed("element order", old.get("element_order"), new.get("element_order"), lambda v: f"order {int(v)}")
    )
    old_load = (old.get("loads") or [{}])[0]
    new_load = (new.get("loads") or [{}])[0]
    if _load_text(old) != _load_text(new):
        changes.append(f"load {_load_text(old)} → {_load_text(new)}")
    old_dir = old_load.get("direction") or {}
    new_dir = new_load.get("direction") or {}
    if any(not _same_number(old_dir.get(axis), new_dir.get(axis)) for axis in ("x", "y", "z")):
        changes.append(
            "load direction "
            f"({old_dir.get('x', 0):g}, {old_dir.get('y', 0):g}, {old_dir.get('z', 0):g}) → "
            f"({new_dir.get('x', 0):g}, {new_dir.get('y', 0):g}, {new_dir.get('z', 0):g})"
        )
    old_support = (old.get("supports") or [{}])[0].get("surface")
    new_support = (new.get("supports") or [{}])[0].get("surface")
    if old_support != new_support:
        changes.append(f"fixed face {old_support} → {new_support}")
    old_additions = old.get("additions") or []
    new_additions = new.get("additions") or []
    if len(old_additions) != len(new_additions):
        changes.append(f"sketch pieces {len(old_additions)} → {len(new_additions)}")
    elif old_additions != new_additions:
        changes.append("a sketch piece was edited")
    if old.get("name") != new.get("name"):
        changes.append(f"name {old.get('name', '')} → {new.get('name', '')}")
    return changes


def reconcile_studio_spec(derived: dict | None, prior: dict | None, inputs: dict) -> dict | None:
    """Keep Studio-only edits a chat turn would otherwise rebuild away.

    Inputs carry dimensions, material, faces, and load size, so the derived
    spec already reflects chat edits. The name, mesh, element order, load
    direction, and sketch additions live only in the spec; carry them over
    when the kind is unchanged and the merged spec still validates.
    """

    if prior is None:
        return derived
    stored = {key: value for key, value in prior.items() if key not in {"approval", "studio_edited"}}
    if derived is None:
        if stored.get("kind") == "sketch_prism" and str(inputs.get("physical_system") or "") == "sketch_prism":
            return stored
        return derived
    if stored.get("kind") != derived.get("kind"):
        return derived
    candidate = {
        **derived,
        "name": stored.get("name") or derived.get("name"),
        "mesh_size_m": stored.get("mesh_size_m") or derived.get("mesh_size_m"),
        "element_order": stored.get("element_order") or derived.get("element_order"),
        "additions": stored.get("additions") or [],
    }
    stored_load = (stored.get("loads") or [{}])[0]
    if stored_load.get("direction"):
        candidate["loads"] = [{**derived["loads"][0], "direction": stored_load["direction"]}]
    try:
        return DesignSpec.model_validate(candidate).model_dump()
    except (ValueError, TypeError):
        return derived


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
    part = get_part(inputs.get("physical_system"))
    unsupported_request = inputs.get("physical_system") == UNSUPPORTED
    ambiguous_request = inputs.get("physical_system") == AMBIGUOUS
    if part is not None:
        domain, system = part.domain, part.id
    elif unsupported_request:
        domain, system = UNSUPPORTED, UNSUPPORTED
    elif ambiguous_request:
        domain, system = AMBIGUOUS, AMBIGUOUS
    else:
        domain, system = "unknown", "unknown"
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
    elif study.get("ready_for_cad") and part is not None and part.analysis != ("none",):
        validation = "ready"
    elif study.get("ready_for_cad") and part is not None and part.analysis == ("none",):
        # Geometry-only: CAD can be downloaded, but this is not an engineering validation.
        validation = "incomplete"
    suitable = list(part.methods) if part else []
    unsupported = list(part.limits) if part else []
    actions = []
    if unsupported_request:
        noun = str(inputs.get("requested_part") or "this part")
        unsupported = [f"geometry for {noun}", f"any solver for {noun}"]
        validation = "blocked"
        actions.append("Choose one of the supported parts. Drafty has no model for this request yet.")
    elif ambiguous_request:
        validation = "blocked"
        actions.append("Name one registered part. Drafty will not pick among matches.")
    elif study.get("missing"):
        actions.append("Ask for the missing quantities before any solve.")
    elif system == "simply_supported_ibeam" and analysis is None:
        actions.append("Run Euler-Bernoulli beam elements after the supports are confirmed.")
    elif part is not None and part.studio_kind and study.get("ready_for_cad"):
        actions.append("Approve the CAD model and open Studio before CalculiX.")
    elif part is not None and part.analysis == ("none",) and study.get("ready_for_cad"):
        actions.append("Download STEP or STL. No structural check exists for this part.")
    if domain == "unknown":
        actions.append("Describe the part or the structure.")
    return EngineeringScenario(
        description=description[:500],
        objective=str(inputs.get("objective") or description[:240]),
        requested_part=(
            str(inputs.get("requested_part") or "") if unsupported_request or ambiguous_request else ""
        ),
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
    if domain in {UNSUPPORTED, AMBIGUOUS} or system in {UNSUPPORTED, AMBIGUOUS}:
        if requested and requested != "inspect_scenario":
            return str(requested), "rejected"
        return "inspect_scenario", "ok"
    part = PARTS.get(system)
    if requested in part_tools() and (part is None or requested not in part.tools):
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
    if part is not None and "create_supported_cad" in part.tools and has_spec:
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
    if domain in {"unknown", UNSUPPORTED, AMBIGUOUS}:
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
    elif domain == "geometry":
        rows.extend(
            [
                _quantity("overall height", inputs.get("overall_height_m"), "m", "confirmed"),
                _quantity("base diameter", inputs.get("base_diameter_m"), "m", "confirmed"),
            ]
        )
        geometry = study.get("geometry") or {}
        if geometry.get("volume_m3") is not None:
            rows.append(_quantity("volume", geometry["volume_m3"], "m3", "calculated", "revolved profile frustums"))
    elif domain == "mechanical" and str(inputs.get("physical_system") or "") != "l_bracket":
        for key, label in _STUDIO_GEOMETRY.get(str(inputs.get("physical_system") or ""), ()):
            unit = "count" if key.startswith("holes.count") else "m"
            rows.append(_quantity(label, inputs.get(key), unit, "confirmed"))
        rows.append(_quantity("force or pressure", inputs.get("load_magnitude"), "N or Pa", "confirmed"))
        material = str(inputs.get("material_id") or "")
        if material in MATERIALS:
            rows.append(
                EngineeringQuantity(
                    name="material", value_si=None, unit=material, status="assumed", source="stored material library"
                )
            )
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
    text = " ".join([str(reply.get("message") or "")] + [str(item) for item in (reply.get("questions") or [])]).lower()
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

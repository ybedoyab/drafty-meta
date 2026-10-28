"""Preliminary scenario checks. These do not certify a building or a member."""

import math

from pydantic import BaseModel, Field

# NSR-10 Title B, Table B.4.2.1-1, educational classrooms: 2.0 kN/m2.
# Illustrative published minimum. Not a complete code check.
CLASSROOM_LIVE_N_PER_M2 = 2000.0
NSR10_CLASSROOM_CITATION = {
    "title": "NSR-10 Title B, Table B.4.2.1-1",
    "section": "Educational classrooms",
    "value": "2.0 kN/m2 live load",
    "status": "verified reference",
    "url": "https://camacol.co/sites/default/files/descargables/T%C3%ADtulo%20B%20NSR-10%20del%20Decreto%20926%20del%2019032010.pdf",
    "limit": "A published minimum live load is not a design combination, a floor system, or an approval.",
}


class Quantity(BaseModel):
    value: float
    unit: str
    provenance: str
    status: str = Field(pattern="^(confirmed|assumed|unknown|calculated)$")


class EvidenceItem(BaseModel):
    id: str
    name: str
    media_type: str
    byte_length: int = Field(ge=0)
    sha256: str = ""
    role: str = "context"
    note: str = "An image is evidence. It is not a dimensional survey."


class Assumption(BaseModel):
    name: str
    statement: str
    status: str = Field(pattern="^(confirmed|assumed|unknown)$")


class LoadCase(BaseModel):
    name: str
    kind: str
    intensity: Quantity


class CalculationTrace(BaseModel):
    formula: str
    inputs: dict[str, Quantity]
    result: Quantity
    notes: list[str]


class EngineeringModel(BaseModel):
    family: str
    ready_for_3d_simulation: bool
    reason: str


class ScenarioSpec(BaseModel):
    name: str
    domain: str
    jurisdiction: str
    goal: str
    evidence: list[EvidenceItem] = []
    assumptions: list[Assumption] = []
    loads: list[LoadCase] = []
    model: EngineeringModel | None = None


def i_section_properties(
    depth_m: float,
    flange_width_m: float,
    flange_thickness_m: float,
    web_thickness_m: float,
) -> dict:
    values = (depth_m, flange_width_m, flange_thickness_m, web_thickness_m)
    if not all(math.isfinite(value) and value > 0 for value in values):
        raise ValueError("I-section dimensions must be positive.")
    if depth_m <= 2.0 * flange_thickness_m:
        raise ValueError("The web depth must remain after both flanges.")
    if flange_width_m <= web_thickness_m:
        raise ValueError("Each flange must be wider than the web.")
    web_height = depth_m - 2.0 * flange_thickness_m
    area = 2.0 * flange_width_m * flange_thickness_m + web_height * web_thickness_m
    inertia_x = (flange_width_m * depth_m**3 - (flange_width_m - web_thickness_m) * web_height**3) / 12.0
    inertia_y = (2.0 * flange_thickness_m * flange_width_m**3 + web_height * web_thickness_m**3) / 12.0
    return {"area_m2": area, "inertia_x_m4": inertia_x, "inertia_y_m4": inertia_y}


def simply_supported_udl(load_n_per_m: float, span_m: float, youngs_modulus_pa: float, inertia_m4: float) -> dict:
    """Elastic beam on two simple supports. This is not a 3D finite-element result."""

    values = (load_n_per_m, span_m, youngs_modulus_pa, inertia_m4)
    if not all(math.isfinite(value) and value > 0 for value in values):
        raise ValueError("Load, span, modulus, and inertia must be positive.")
    moment = load_n_per_m * span_m**2 / 8.0
    shear = load_n_per_m * span_m / 2.0
    deflection = 5.0 * load_n_per_m * span_m**4 / (384.0 * youngs_modulus_pa * inertia_m4)
    return {
        "max_moment_n_m": moment,
        "end_shear_n": shear,
        "midspan_deflection_m": deflection,
        "assumptions": [
            "Euler-Bernoulli beam, prismatic, elastic, small deflection.",
            "Uniform load, simple supports, no axial force, bending about the strong axis.",
            "Self-weight is included only when it is already inside the line load.",
        ],
    }


def classroom_line_load(
    dead_n_per_m2: float,
    tributary_width_m: float | None,
    beam_self_weight_n_per_m: float = 0.0,
    live_n_per_m2: float | None = None,
) -> dict:
    if tributary_width_m is None or not math.isfinite(tributary_width_m) or tributary_width_m <= 0:
        raise ValueError("Tributary width is required. A headcount is not a floor load.")
    if not math.isfinite(dead_n_per_m2) or not math.isfinite(beam_self_weight_n_per_m):
        raise ValueError("Dead load and self-weight must be finite.")
    if dead_n_per_m2 < 0 or beam_self_weight_n_per_m < 0:
        raise ValueError("Dead load and self-weight cannot be negative.")
    live = CLASSROOM_LIVE_N_PER_M2 if live_n_per_m2 is None else live_n_per_m2
    if not math.isfinite(live) or live < 0:
        raise ValueError("Live load cannot be negative.")
    line = (dead_n_per_m2 + live) * tributary_width_m + beam_self_weight_n_per_m
    trace = CalculationTrace(
        formula="q_line = (q_dead + q_live) * tributary_width + beam_self_weight",
        inputs={
            "q_dead": Quantity(value=dead_n_per_m2, unit="N/m2", provenance="user", status="confirmed"),
            "q_live": Quantity(
                value=live,
                unit="N/m2",
                provenance="user" if live_n_per_m2 is not None else "NSR-10 Title B Table B.4.2.1-1",
                status="confirmed" if live_n_per_m2 is not None else "assumed",
            ),
            "tributary_width": Quantity(value=tributary_width_m, unit="m", provenance="user", status="confirmed"),
            "beam_self_weight": Quantity(
                value=beam_self_weight_n_per_m, unit="N/m", provenance="user", status="confirmed"
            ),
        },
        result=Quantity(value=line, unit="N/m", provenance="calculation", status="calculated"),
        notes=[
            "Self-weight is added once, on the line, and is not also inside q_dead.",
            "This service line load is not an ultimate combination.",
            "The whole floor is not assigned to one beam unless the tributary width says so.",
        ],
    )
    return {
        "q_line_n_per_m": line,
        "live_n_per_m2": live,
        "citation": NSR10_CLASSROOM_CITATION if live_n_per_m2 is None else None,
        "trace": trace.model_dump(),
        "ready_for_3d_simulation": False,
        "reason": (
            "The current solid solver applies one face load to one supported solid. "
            "A uniform load on a simply supported I-beam is not that model, so no CalculiX job is created."
        ),
    }


CLASSROOM_FIELDS = (
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
    "student_count",
    "supports",
)


def classroom_kwargs(payload: dict) -> dict:
    """Pass only the classroom fields. Extra design keys stay out of this solver."""

    values = {key: payload.get(key) for key in CLASSROOM_FIELDS}
    values["jurisdiction"] = str(values.get("jurisdiction") or "")
    values["supports"] = str(values.get("supports") or "")
    return values


def evaluate_classroom(
    *,
    jurisdiction: str = "",
    span_m: float | None = None,
    tributary_width_m: float | None = None,
    dead_n_per_m2: float | None = None,
    live_n_per_m2: float | None = None,
    beam_self_weight_n_per_m: float | None = None,
    depth_m: float | None = None,
    flange_width_m: float | None = None,
    flange_thickness_m: float | None = None,
    web_thickness_m: float | None = None,
    student_count: int | None = None,
    supports: str = "",
) -> dict:
    """Authoritative classroom record. Missing data stays missing."""

    from drafty_engineering.materials import MATERIALS

    errors: list[str] = []
    missing: list[str] = []
    assumptions: list[dict] = []
    if student_count is not None:
        assumptions.append(
            {
                "name": "occupancy",
                "statement": f"{student_count} students were noted. A headcount is not a floor load.",
                "status": "unknown",
                "provenance": "user",
            }
        )
    if not jurisdiction.strip():
        missing.append("jurisdiction")
    place = jurisdiction.strip().lower()
    use_nsr = live_n_per_m2 is None and "colombia" in place
    if use_nsr:
        assumptions.append(
            {
                "name": "live load",
                "statement": (
                    "NSR-10 Title B Table B.4.2.1-1 classroom minimum, 2.0 kN/m2, "
                    "used as an illustrative service live load."
                ),
                "status": "assumed",
                "provenance": "cited code",
                "source": NSR10_CLASSROOM_CITATION["title"],
            }
        )
    elif live_n_per_m2 is None:
        missing.append("live load")
    else:
        assumptions.append(
            {
                "name": "live load",
                "statement": "The live load was entered by the user and is not a checked code combination.",
                "status": "confirmed",
                "provenance": "user",
            }
        )
    if span_m is None:
        missing.append("span")
    if tributary_width_m is None:
        missing.append("tributary width")
    if dead_n_per_m2 is None:
        missing.append("dead load")
    self_weight = 0.0 if beam_self_weight_n_per_m is None else beam_self_weight_n_per_m
    if beam_self_weight_n_per_m is None:
        assumptions.append(
            {
                "name": "self-weight",
                "statement": "Beam self-weight is omitted until you enter it. Do not also include it in the dead load.",
                "status": "assumed",
                "provenance": "documented assumption",
            }
        )
    kind = _support_kind(supports)
    if kind == "unspecified":
        missing.append("supports")
        assumptions.append(
            {
                "name": "supports",
                "statement": "Simple supports are a candidate model only. They are not confirmed.",
                "status": "assumed",
                "provenance": "documented assumption",
            }
        )
    elif kind == "simple":
        assumptions.append(
            {
                "name": "supports",
                "statement": "The user described simple supports.",
                "status": "confirmed",
                "provenance": "user",
            }
        )
    elif kind == "fixed":
        assumptions.append(
            {
                "name": "supports",
                "statement": "A fixed description is not sent to the cantilever solid solver.",
                "status": "confirmed",
                "provenance": "user",
            }
        )
    else:
        missing.append("supports")
    line = None
    if tributary_width_m is not None and dead_n_per_m2 is not None and (live_n_per_m2 is not None or use_nsr):
        try:
            line = classroom_line_load(
                dead_n_per_m2,
                tributary_width_m,
                self_weight,
                None if use_nsr else live_n_per_m2,
            )
        except ValueError as exc:
            errors.append(str(exc))
    section_values = (depth_m, flange_width_m, flange_thickness_m, web_thickness_m)
    section = None
    if any(value is not None for value in section_values):
        if any(value is None for value in section_values):
            missing.append("complete I-section")
        else:
            try:
                section = i_section_properties(depth_m, flange_width_m, flange_thickness_m, web_thickness_m)
            except ValueError as exc:
                errors.append(str(exc))
    else:
        missing.append("I-section dimensions for elastic deflection")
    beam = None
    if line and section and span_m and kind in {"simple", "unspecified"}:
        steel = MATERIALS["steel_s235"]
        try:
            beam = simply_supported_udl(
                line["q_line_n_per_m"], span_m, steel.youngs_modulus_pa, section["inertia_x_m4"]
            )
            beam = {
                **beam,
                "left_reaction_n": beam["end_shear_n"],
                "right_reaction_n": beam["end_shear_n"],
                "material": steel.model_dump(),
                "elastic_bending_stress_pa": beam["max_moment_n_m"] * (depth_m / 2.0) / section["inertia_x_m4"],
                "stress_basis": "M*c/I elastic outer fiber. Not von Mises and not a capacity check.",
            }
        except ValueError as exc:
            errors.append(str(exc))
    elif kind == "fixed":
        errors.append("This fixed description stays unsolved. It is not converted into the studio cantilever.")
    ready_for_beam_elements = beam is not None and kind == "simple" and not errors
    solid = (
        "The CalculiX solid solver accepts one fixed face and one load face. "
        "This simply supported line load is not that model, so no solid job is created."
    )
    if ready_for_beam_elements:
        reason = "Simple supports and the line load are confirmed. Euler-Bernoulli beam elements can run. " + solid
    elif beam is not None and kind == "unspecified":
        reason = "A simple span is only a candidate until the supports are confirmed. " + solid
    else:
        reason = solid
    citation = {
        **NSR10_CLASSROOM_CITATION,
        "retrieved_at": None,
        "span": "Educational classrooms 2.0 kN/m2",
        "origin": "checked template",
        "evidence_class": "verified",
    }
    if not use_nsr:
        citation = {
            **citation,
            "status": "not applied",
            "limit": "Confirm Colombia before this minimum is used. It is not a design combination.",
        }
    sources = [citation]
    return {
        "missing": missing,
        "errors": errors,
        "assumptions": assumptions,
        "sources": sources,
        "line": line,
        "section": section,
        "beam": beam,
        "ready_for_3d_simulation": False,
        "ready_for_beam_elements": ready_for_beam_elements,
        "reason": reason,
        "verification": [
            "The service line load is not an ultimate combination.",
            "Bending and shear strength are not checked.",
            "Lateral-torsional buckling, local buckling, connections, bearing, and vibration are not checked.",
            "An elastic stress above the recorded yield puts this elastic model outside its range.",
            "A citation is not a certification, and a search result is not proof of compliance.",
            "An image is evidence. It is not a dimensional survey.",
            "Agreement between beam elements and the closed form is a numerical check, not a certification.",
        ],
    }


def _support_kind(text: str) -> str:
    lowered = text.lower()
    if any(word in lowered for word in ("cantilever", "encastre", "fixed")):
        return "fixed"
    if any(word in lowered for word in ("simple", "simply", "pinned", "roller")):
        return "simple"
    if not text.strip():
        return "unspecified"
    return "other"

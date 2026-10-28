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

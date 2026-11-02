"""Registry of the parts Drafty can build. Prompts, routing, and the web form read it."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict

from drafty_engineering.materials import MATERIALS

AnalysisPath = Literal["none", "analytical", "beam-element", "calculix"]
InputKind = Literal["number", "text", "choice", "face"]
PartDomain = Literal["structural", "mechanical", "geometry"]

UNSUPPORTED = "unsupported"
UNKNOWN = "unknown"
DEFAULT_FORM_PART = "simply_supported_ibeam"
NOTHING_CREATED = "No geometry, file, or calculation was created."
# The web app links this path when it appears in parentheses in a reply.
CAPABILITIES_PATH = "/capabilities"
CAPABILITIES_POINTER = f"The Capabilities page ({CAPABILITIES_PATH}) lists what Drafty can and cannot do."
_ANALYSIS_TEXT = {
    "none": "geometry only",
    "analytical": "closed-form checks",
    "beam-element": "beam elements",
    "calculix": "CalculiX solid FEM",
}


class PartInput(BaseModel):
    """One user-supplied quantity. Stored in SI; shown as stored value * display_scale."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    label: str
    unit: str = ""
    display_unit: str = ""
    display_scale: float = 1.0
    kind: InputKind = "number"
    group: str = "Geometry"
    required: bool = True
    choices: tuple[str, ...] = ()


class Part(BaseModel):
    """One family Drafty can build. The model may name it; the server fills and checks it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    name: str
    article: str = "a"
    description: str
    domain: PartDomain
    inputs: tuple[PartInput, ...]
    analysis: tuple[AnalysisPath, ...]
    exports: tuple[str, ...]
    in_scenario: bool
    studio_kind: str | None = None
    keywords: tuple[str, ...] = ()
    tools: tuple[str, ...] = ()
    proposal: str = ""
    methods: tuple[str, ...] = ()
    limits: tuple[str, ...] = ()

    @property
    def phrase(self) -> str:
        return f"{self.article} {self.name}"

    def public(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "domain": self.domain,
            "analysis": list(self.analysis),
            "exports": list(self.exports),
            "where": "scenario" if self.in_scenario else "studio",
            "methods": list(self.methods),
            "limits": list(self.limits),
            "inputs": [item.model_dump() for item in self.inputs],
        }


_IBEAM = Part(
    id="simply_supported_ibeam",
    name="simply supported classroom I-beam",
    description="A steel I-beam on two simple supports carrying a uniform classroom floor load.",
    domain="structural",
    inputs=(
        PartInput(name="span_m", label="Span", unit="m", display_unit="m"),
        PartInput(name="depth_m", label="Depth", unit="m", display_unit="mm", display_scale=1000.0),
        PartInput(name="flange_width_m", label="Flange width", unit="m", display_unit="mm", display_scale=1000.0),
        PartInput(
            name="flange_thickness_m", label="Flange thickness", unit="m", display_unit="mm", display_scale=1000.0
        ),
        PartInput(name="web_thickness_m", label="Web thickness", unit="m", display_unit="mm", display_scale=1000.0),
        PartInput(name="jurisdiction", label="Jurisdiction", kind="text", group="Materials and loads", required=False),
        PartInput(
            name="tributary_width_m", label="Tributary width", unit="m", display_unit="m", group="Materials and loads"
        ),
        PartInput(
            name="dead_n_per_m2",
            label="Dead load",
            unit="N/m²",
            display_unit="kN/m²",
            display_scale=0.001,
            group="Materials and loads",
        ),
        PartInput(
            name="live_n_per_m2",
            label="Live load",
            unit="N/m²",
            display_unit="kN/m²",
            display_scale=0.001,
            group="Materials and loads",
            required=False,
        ),
        PartInput(
            name="beam_self_weight_n_per_m",
            label="Beam self-weight",
            unit="N/m",
            display_unit="N/m",
            group="Materials and loads",
            required=False,
        ),
        PartInput(name="supports", label="Supports", kind="text", group="Materials and loads"),
    ),
    analysis=("analytical", "beam-element"),
    exports=("JSON report",),
    in_scenario=True,
    keywords=(
        "classroom",
        "student",
        "students",
        "estudiantes",
        "aula",
        "i-beam",
        "ibeam",
        "viga",
        "floor",
        "piso",
        "losa",
    ),  # fmt: skip
    tools=("calculate_section_properties", "evaluate_beam"),
    proposal="simply supported classroom I-beam, preliminary",
    methods=("analytical simple-span formulas", "Euler-Bernoulli beam elements"),
    limits=("CalculiX solid job for this line-loaded floor beam", "cantilever conversion"),
)

_FACE_CHOICES = ("xmin", "xmax", "ymin", "ymax", "zmin", "zmax")
_BRACKET = Part(
    id="l_bracket",
    name="L-bracket",
    article="an",
    description="A parametric L-shaped bracket with one fixed face and one loaded face.",
    domain="mechanical",
    inputs=(
        PartInput(name="leg_x_m", label="Leg along x", unit="m", display_unit="mm", display_scale=1000.0),
        PartInput(name="leg_z_m", label="Leg along z", unit="m", display_unit="mm", display_scale=1000.0),
        PartInput(name="bracket_thickness_m", label="Thickness", unit="m", display_unit="mm", display_scale=1000.0),
        PartInput(name="bracket_width_m", label="Width", unit="m", display_unit="mm", display_scale=1000.0),
        PartInput(
            name="material_id",
            label="Material",
            kind="choice",
            group="Materials and loads",
            choices=tuple(sorted(MATERIALS)),
        ),
        PartInput(name="force_n", label="Force", unit="N", display_unit="N", group="Materials and loads"),
        PartInput(
            name="displacement_limit_m",
            label="Displacement limit",
            unit="m",
            display_unit="mm",
            display_scale=1000.0,
            group="Materials and loads",
        ),
        PartInput(name="support_face", label="Fixed face", kind="face", group="Faces", choices=_FACE_CHOICES),
        PartInput(name="load_face", label="Load face", kind="face", group="Faces", choices=_FACE_CHOICES),
    ),
    analysis=("calculix",),
    exports=("STEP", "GLB", "VTU", "JSON report"),
    in_scenario=True,
    studio_kind="l_bracket",
    keywords=("bracket", "aluminum", "aluminium", "aluminio", "masa", "mass"),
    tools=("create_supported_cad", "run_supported_simulation"),
    proposal="parametric L-bracket, pending approval",
    methods=("parametric L-bracket in the CAD schema", "CalculiX solid FEM after approval"),
    limits=("classroom beam-element solver", "pixel measurements without a reference dimension"),
)


_REVOLVED = Part(
    id="revolved_profile",
    name="Staunton chess pawn",
    description=(
        "A solid spun around Z from an ordered (height, radius) profile. "
        "The Staunton preset scales stored proportions to your height and base diameter."
    ),
    domain="geometry",
    inputs=(
        PartInput(name="overall_height_m", label="Height", unit="m", display_unit="mm", display_scale=1000.0),
        PartInput(name="base_diameter_m", label="Base diameter", unit="m", display_unit="mm", display_scale=1000.0),
    ),
    analysis=("none",),
    exports=("STEP", "STL", "GLB"),
    in_scenario=True,
    keywords=("pawn", "pawns", "peón", "peon", "peones"),
    tools=("create_supported_cad",),
    proposal="revolved Staunton pawn profile, geometry only",
    methods=("CadQuery revolve of a validated profile", "STEP, STL, and GLB export"),
    limits=("structural check: no loads or solver exist for this part",),
)


def _studio_part(part_id: str, name: str, description: str, geometry: tuple[PartInput, ...], keywords: tuple) -> Part:
    return Part(
        id=part_id,
        name=name,
        description=description,
        domain="mechanical",
        inputs=(
            *geometry,
            PartInput(
                name="material_id",
                label="Material",
                kind="choice",
                group="Materials and loads",
                choices=tuple(sorted(MATERIALS)),
            ),
            PartInput(name="load_magnitude", label="Force or pressure", unit="N or Pa", group="Materials and loads"),
        ),
        analysis=("calculix",),
        exports=("STEP", "GLB", "VTU", "JSON report"),
        in_scenario=False,
        studio_kind=part_id,
        keywords=keywords,
        methods=("CalculiX solid FEM in Studio",),
    )


def _mm(name: str, label: str) -> PartInput:
    return PartInput(name=name, label=label, unit="m", display_unit="mm", display_scale=1000.0)


_STUDIO_PARTS = (
    _studio_part(
        "cantilever_beam",
        "rectangular cantilever beam",
        "A solid rectangular bar fixed at one end. Studio's benchmark part.",
        (_mm("beam.length_m", "Length"), _mm("beam.width_m", "Width"), _mm("beam.height_m", "Height")),
        ("cantilever",),
    ),
    _studio_part(
        "plate",
        "rectangular plate",
        "A flat rectangular plate fixed on one edge.",
        (_mm("plate.length_m", "Length"), _mm("plate.width_m", "Width"), _mm("plate.thickness_m", "Thickness")),
        ("plate",),
    ),
    _studio_part(
        "perforated_plate",
        "perforated plate",
        "A rectangular plate with a regular grid of round holes.",
        (
            _mm("plate.length_m", "Length"),
            _mm("plate.width_m", "Width"),
            _mm("plate.thickness_m", "Thickness"),
            _mm("holes.radius_m", "Hole radius"),
            PartInput(name="holes.count_x", label="Holes along length", unit="count"),
            PartInput(name="holes.count_y", label="Holes along width", unit="count"),
            _mm("holes.margin_m", "Hole margin"),
        ),
        ("perforated plate", "plate with holes"),
    ),
)

PARTS: dict[str, Part] = {part.id: part for part in (_IBEAM, _BRACKET, _REVOLVED, *_STUDIO_PARTS)}


def get_part(part_id: str | None) -> Part | None:
    return PARTS.get(str(part_id or ""))


def scenario_parts() -> list[Part]:
    return [part for part in PARTS.values() if part.in_scenario]


def studio_parts() -> list[Part]:
    return [part for part in PARTS.values() if not part.in_scenario]


def studio_kinds() -> set[str]:
    return {part.studio_kind for part in PARTS.values() if part.studio_kind}


def part_tools() -> set[str]:
    """Tools that belong to one part. Other tools are generic."""

    return {tool for part in PARTS.values() for tool in part.tools}


def scenario_domains() -> list[str]:
    seen: list[str] = []
    for part in scenario_parts():
        if part.domain not in seen:
            seen.append(part.domain)
    return seen


def scenario_input_names() -> set[str]:
    return {item.name for part in scenario_parts() for item in part.inputs}


def keyword_pattern(part: Part) -> re.Pattern[str]:
    words = "|".join(re.escape(word) for word in part.keywords)
    return re.compile(rf"\b(?:{words})\b", re.I)


def studio_part_for(noun: str) -> Part | None:
    """A Studio-only part whose keyword appears in the requested noun, if any."""

    for part in sorted(studio_parts(), key=lambda item: -max(len(word) for word in item.keywords)):
        if keyword_pattern(part).search(noun):
            return part
    return None


def indefinite(noun: str) -> str:
    return "an" if noun[:1].lower() in "aeiou" else "a"


def _join(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + f", and {items[-1]}"


def _with_analysis(part: Part) -> str:
    return f"{part.phrase} ({', '.join(_ANALYSIS_TEXT[item] for item in part.analysis)})"


def supported_parts_sentence() -> str:
    """One sentence listing every part. Built from the registry, never by hand."""

    chat = _join([_with_analysis(part) for part in scenario_parts()])
    studio = _join([part.phrase for part in studio_parts()])
    return f"In this chat Drafty can model {chat}. Studio also builds {studio}."


def unsupported_sentence(noun: str) -> str:
    studio = studio_part_for(noun)
    if studio is not None:
        return (
            f"Drafty builds {studio.phrase} in Studio, not in this chat. {supported_parts_sentence()} "
            f"{NOTHING_CREATED} {CAPABILITIES_POINTER}"
        )
    subject = f"{indefinite(noun)} {noun}" if noun else "that part"
    return f"Drafty can't model {subject} yet. {supported_parts_sentence()} {NOTHING_CREATED} {CAPABILITIES_POINTER}"


def catalog_view(system: str | None, requested: str | None = None) -> dict:
    """What the web page needs: every part, the active part, and the form to show."""

    active = get_part(system)
    if active is not None:
        status = "supported"
        form = active if active.in_scenario else None
    elif system == UNSUPPORTED:
        status = UNSUPPORTED
        form = None
    else:
        status = "unclassified"
        form = PARTS[DEFAULT_FORM_PART]
    return {
        "status": status,
        "requested_part": (requested or None) if status == UNSUPPORTED else None,
        "active_part": active.public() if active else None,
        "form_part": form.public() if form else None,
        "parts": [part.public() for part in PARTS.values()],
        "message": unsupported_sentence(requested or "") if status == UNSUPPORTED else "",
    }

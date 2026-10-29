"""Versioned demo presets. Loading one does not call a model or a solver."""

from drafty_engineering.plan import build_scenario, evaluate_bracket, workflow_stage
from drafty_engineering.scenario import classroom_kwargs, evaluate_classroom

CLASSROOM_DEMO_VERSION = "classroom-v1"
BRACKET_DEMO_VERSION = "bracket-v1"

CLASSROOM_DEMO_INPUTS = {
    "domain": "structural",
    "physical_system": "simply_supported_ibeam",
    "jurisdiction": "Colombia",
    "student_count": 30,
    "supports": "simply supported",
    "span_m": 6.0,
    "tributary_width_m": 2.5,
    "dead_n_per_m2": 3000.0,
    "live_n_per_m2": 2000.0,
    "beam_self_weight_n_per_m": 0.0,
    "depth_m": 0.2,
    "flange_width_m": 0.1,
    "flange_thickness_m": 0.01,
    "web_thickness_m": 0.006,
    "material_id": "steel_s235",
    "value_origin": "demo",
    "objective": "Classroom demo. Testing values, not a measured building and not an approved design.",
}

BRACKET_DEMO_INPUTS = {
    "domain": "mechanical",
    "physical_system": "l_bracket",
    "material_id": "aluminum_6061_t6",
    "leg_x_m": 0.08,
    "leg_z_m": 0.08,
    "bracket_width_m": 0.04,
    "bracket_thickness_m": 0.008,
    "force_n": 200.0,
    "displacement_limit_m": 0.001,
    "support_face": "",
    "load_face": "",
    "value_origin": "demo",
    "objective": "Aluminum L-bracket demo. Faces are not confirmed until you choose them.",
}

BRACKET_SUGGESTED_FACES = {"support_face": "xmin", "load_face": "zmax"}


def classroom_demo_inputs() -> dict:
    return dict(CLASSROOM_DEMO_INPUTS)


def bracket_demo_inputs() -> dict:
    return dict(BRACKET_DEMO_INPUTS)


def classroom_record(inputs: dict | None = None) -> dict:
    payload = classroom_demo_inputs() if inputs is None else inputs
    study = evaluate_classroom(**classroom_kwargs(payload))
    return _record(
        kind="classroom",
        version=CLASSROOM_DEMO_VERSION,
        inputs=payload,
        study=study,
        description="Classroom demo. The line load is a Python calculation. No model request was made.",
        message=(
            "Classroom demo classroom-v1 is loaded. "
            "Every number except the cited live-load minimum is a demo assumption. "
            "30 students are occupancy context, not a floor load. The line load was calculated in Python. "
            "No Meta request was made. Run Demo Analysis to execute the beam-element solver. "
            "3D solid simulation stays off. This is not an approved design."
        ),
    )


def bracket_record(overrides: dict | None = None) -> dict:
    payload = bracket_demo_inputs()
    for key, value in (overrides or {}).items():
        if key in payload and key not in {"support_face", "load_face", "domain", "physical_system"}:
            payload[key] = value
    payload["support_face"] = ""
    payload["load_face"] = ""
    payload["value_origin"] = "demo"
    study = evaluate_bracket(payload)
    record = _record(
        kind="bracket",
        version=BRACKET_DEMO_VERSION,
        inputs=payload,
        study=study,
        description="Aluminum L-bracket demo. CalculiX has not started.",
        message=(
            "Aluminum L-bracket demo bracket-v1 is loaded. Review the geometry, then confirm the fixed face xmin "
            "and the loaded face zmax. Those faces are suggestions until you confirm them. "
            "Quadratic elements are requested. CalculiX has not started. "
            "A later peak at the support is exploratory and is not a certification or a global optimum."
        ),
    )
    record["suggested_faces"] = dict(BRACKET_SUGGESTED_FACES)
    return record


def _record(*, kind: str, version: str, inputs: dict, study: dict, description: str, message: str) -> dict:
    domain = str(inputs.get("domain") or "unknown")
    engineering = build_scenario(
        description=description,
        inputs=inputs,
        study=study,
        sources=list(study.get("sources") or []),
        evidence_count=0,
        analysis=None,
        comparison=None,
    )
    workflow = workflow_stage(
        domain=domain,
        missing=list(study.get("missing") or []),
        searched=False,
        has_model=domain != "unknown",
        has_analysis=False,
        has_comparison=False,
    )
    families = {
        "simply_supported_ibeam": "simply supported classroom I-beam, preliminary",
        "l_bracket": "parametric L-bracket, pending approval",
    }
    return {
        "demo": {
            "kind": kind,
            "version": version,
            "label": "Demo assumptions. Not a measured building or part, and not an approved design.",
        },
        "inputs": inputs,
        "study": study,
        "engineering": engineering.model_dump(),
        "workflow": workflow,
        "message": message,
        "model_proposal": {
            "family": families.get(str(inputs.get("physical_system")), "unset"),
            "ready_for_3d_simulation": False,
            "ready_for_beam_elements": bool(study.get("ready_for_beam_elements")),
            "reason": study.get("reason") or "",
        },
    }

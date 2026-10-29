"""Allowlisted scenario tools. Each call runs existing Python or stops before a solver."""

from drafty_engineering.plan import route_tool
from drafty_engineering.scenario import i_section_properties

_EXPENSIVE = {"evaluate_beam", "run_supported_simulation"}


def execute_tool(
    requested: str | None,
    *,
    domain: str,
    system: str,
    missing: list[str],
    has_analysis: bool,
    has_spec: bool,
    searched: bool,
    inputs: dict,
    study: dict,
    sources: list[dict],
    analysis: dict | None,
    comparison: dict | None,
    studio_spec: dict | None,
) -> dict:
    """Run one tool. A selected name is not reported as executed."""

    name, gate = route_tool(
        requested,
        domain=domain,
        system=system,
        missing=missing,
        has_analysis=has_analysis,
        has_spec=has_spec,
    )
    if gate == "rejected":
        return _trace(
            name,
            "rejected",
            f"Tool '{name}' is not available for this system. No code was executed.",
            "none",
            {},
        )
    if name in _EXPENSIVE:
        detail = (
            "Euler-Bernoulli beam elements start only from Run beam elements."
            if name == "evaluate_beam"
            else "CalculiX starts only after the CAD model is approved and Run analysis is clicked in Studio."
        )
        return _trace(name, "needs_confirmation", detail, "user_confirmation", {"started": False})
    try:
        return _run(
            name,
            inputs=inputs,
            study=study,
            sources=sources,
            analysis=analysis,
            comparison=comparison,
            studio_spec=studio_spec,
            searched=searched,
            domain=domain,
            system=system,
            missing=missing,
        )
    except (ValueError, TypeError, KeyError) as exc:
        return _trace(name, "failed", str(exc), "none", {})


def _run(
    name: str,
    *,
    inputs: dict,
    study: dict,
    sources: list[dict],
    analysis: dict | None,
    comparison: dict | None,
    studio_spec: dict | None,
    searched: bool,
    domain: str,
    system: str,
    missing: list[str],
) -> dict:
    if name == "inspect_scenario":
        return _trace(
            name,
            "executed",
            "The stored scenario was read. No solver ran.",
            "none",
            {"domain": domain, "physical_system": system, "missing": missing},
        )
    if name == "research_engineering_reference":
        retrieved = [
            item.get("title") or item.get("url") for item in sources if item.get("evidence_class") == "retrieved"
        ]
        if not searched or not retrieved:
            return _trace(
                name,
                "failed",
                "No web search ran on this turn. Verified template references are unchanged.",
                "none",
                {"retrieved": []},
            )
        return _trace(
            name,
            "executed",
            "Retrieved pages are listed separately from verified references and from citations.",
            "none",
            {"retrieved": retrieved[:5]},
        )
    if name == "propose_engineering_model":
        return _trace(
            name,
            "proposed",
            "A model was proposed from the stored quantities. Missing values stayed missing.",
            "none",
            {
                "domain": domain,
                "physical_system": system,
                "missing": missing,
                "suitable_methods": list(study.get("suitable_methods") or []),
            },
        )
    if name == "validate_model_inputs":
        if missing:
            return _trace(
                name,
                "failed",
                "Validation ran. Required quantities are still missing, so nothing was solved.",
                "none",
                {"missing": missing},
            )
        return _trace(
            name,
            "validated",
            "The stored inputs match the selected system. No solver ran.",
            "none",
            {"physical_system": system, "ready": True},
        )
    if name == "calculate_section_properties":
        dims = [inputs.get(key) for key in ("depth_m", "flange_width_m", "flange_thickness_m", "web_thickness_m")]
        if any(value is None for value in dims):
            return _trace(name, "failed", "I-section dimensions are incomplete. No property was invented.", "none", {})
        section = i_section_properties(
            float(inputs["depth_m"]),
            float(inputs["flange_width_m"]),
            float(inputs["flange_thickness_m"]),
            float(inputs["web_thickness_m"]),
        )
        return _trace(
            name,
            "executed",
            "Section properties come from the deterministic I-section formulas.",
            "none",
            {**section, "formula": "i_section_properties"},
        )
    if name == "create_supported_cad":
        if not studio_spec:
            return _trace(
                name,
                "failed",
                "No CAD spec was built. Support and load faces are not invented.",
                "user_confirmation",
                {},
            )
        return _trace(
            name,
            "proposed",
            "A parametric L-bracket is ready for approval. CalculiX has not started.",
            "user_confirmation",
            {
                "kind": studio_spec.get("kind"),
                "material_id": studio_spec.get("material_id"),
                "support": (studio_spec.get("supports") or [{}])[0].get("surface"),
                "load": (studio_spec.get("loads") or [{}])[0].get("surface"),
            },
        )
    if name == "compare_design_variants":
        if not comparison:
            return _trace(
                name,
                "failed",
                "No edited result is stored. A comparison was not invented.",
                "none",
                {},
            )
        return _trace(
            name,
            "executed",
            "The comparison repeats the stored original and edited solver records.",
            "none",
            {"has_comparison": True, "solver": comparison.get("solver", {}).get("name", "stored")},
        )
    if name == "explain_results":
        record = analysis or {}
        beam = study.get("beam") or {}
        if not record and not beam:
            return _trace(name, "failed", "There is no stored result to explain.", "none", {})
        solver = (record.get("solver") or {}).get("name") or ("analytical simple-span" if beam else "stored")
        return _trace(
            name,
            "executed",
            "The explanation uses the stored record and does not add a new number.",
            "none",
            {"solver": solver, "method": record.get("method") or "closed form"},
        )
    return _trace(name, "failed", "This tool has no implementation.", "none", {})


def _trace(name: str, status: str, detail: str, authorization: str, output: dict) -> dict:
    return {
        "tool": name,
        "status": status,
        "detail": detail,
        "authorization": authorization,
        "output": output,
    }

"""Allowlisted scenario tools. Each one calls existing Python. None runs generated code."""

from drafty_engineering.plan import route_tool

_DETAILS = {
    ("inspect_scenario", "ok"): "The stored scenario was read. No solver ran.",
    ("research_engineering_reference", "ok"): (
        "Web search results from this turn are listed separately from verified references and from citations."
    ),
    ("propose_engineering_model", "ok"): (
        "A model was proposed from the stored quantities. Missing values stayed missing."
    ),
    ("validate_model_inputs", "ok"): "The stored inputs were checked against the selected system.",
    ("calculate_section_properties", "ok"): "Section properties come from the deterministic I-section formulas.",
    ("explain_results", "ok"): "The explanation uses the stored solver record and does not add a new number.",
    ("create_supported_cad", "ok"): (
        "A parametric L-bracket was built from stored dimensions. CalculiX has not started."
    ),
    ("evaluate_beam", "needs_confirmation"): (
        "Euler-Bernoulli beam elements are available. They start only from the Run beam elements button."
    ),
    ("run_supported_simulation", "needs_confirmation"): (
        "CalculiX stays in Studio. Approve the model there before a solid solve."
    ),
    ("compare_design_variants", "ok"): (
        "Comparison uses a stored run and an edited run. It does not invent a third result."
    ),
}


def describe_tool(
    requested: str | None,
    *,
    domain: str,
    system: str,
    missing: list[str],
    has_analysis: bool,
    has_spec: bool,
    searched: bool,
) -> dict:
    name, status = route_tool(
        requested,
        domain=domain,
        system=system,
        missing=missing,
        has_analysis=has_analysis,
        has_spec=has_spec,
    )
    if status == "rejected":
        detail = f"Tool '{name}' is not available for this system. No code was executed."
    elif name == "research_engineering_reference" and not searched:
        detail = "No web search ran on this turn. Verified template references are unchanged."
    else:
        detail = _DETAILS.get((name, status), "The tool finished without a solver call.")
    return {"tool": name, "status": status, "detail": detail}

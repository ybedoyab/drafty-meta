"""Engineering report built only from a completed job directory."""

import json
from pathlib import Path


def build_report(directory: Path) -> dict:
    job = json.loads((directory / "job.json").read_text(encoding="utf-8"))
    results_path = directory / "results.json"
    if not results_path.exists():
        raise FileNotFoundError("This job has no results.json from CalculiX.")
    result = json.loads(results_path.read_text(encoding="utf-8"))
    optimization = None
    optimization_path = directory / "optimization.json"
    if optimization_path.exists():
        optimization = json.loads(optimization_path.read_text(encoding="utf-8"))
    assessment = result.get("stress_assessment") or {}
    return {
        "report": "drafty-engineering",
        "generated_from": ["job.json", "results.json"],
        "job_id": job.get("id"),
        "kind": job.get("kind"),
        "spec": job.get("spec"),
        "solver": result.get("solver"),
        "mesh": result.get("mesh"),
        "material_id": (job.get("spec") or {}).get("material_id"),
        "loads": (job.get("spec") or {}).get("loads"),
        "supports": (job.get("spec") or {}).get("supports"),
        "mass_kg": result.get("mass_kg"),
        "max_displacement_m": result.get("max_displacement_m"),
        "max_von_mises_pa": result.get("max_von_mises_pa"),
        "governing_von_mises_pa": result.get("governing_von_mises_pa"),
        "safety_factor": result.get("safety_factor"),
        "safety_factor_status": assessment.get("safety_factor_status", "exploratory"),
        "stress_assessment": assessment,
        "equilibrium": result.get("equilibrium"),
        "validation_status": result.get("validation_status"),
        "benchmark": result.get("benchmark"),
        "warnings": result.get("warnings"),
        "optimization": optimization,
        "limitations": [
            "Static linear elasticity with one support face and one load face.",
            "The safety factor uses exploratory governing stress and is not certified.",
            "Displayed contours are corner triangles, not a high-order stress plot.",
            "A completed solve is not by itself an accepted engineering design.",
        ],
    }


def report_text(report: dict) -> str:
    lines = [
        "Drafty engineering report",
        f"Job {report.get('job_id')} ({report.get('kind')})",
        f"Validation {report.get('validation_status')}",
        f"Safety factor status {report.get('safety_factor_status')}",
        f"Mass kg {report.get('mass_kg')}",
        f"Max displacement m {report.get('max_displacement_m')}",
        f"Peak von Mises Pa {report.get('max_von_mises_pa')}",
        f"Governing von Mises Pa {report.get('governing_von_mises_pa')}",
        f"Exploratory factor {report.get('safety_factor')}",
    ]
    solver = report.get("solver") or {}
    lines.append(f"Solver {solver.get('version')}")
    for warning in report.get("warnings") or []:
        lines.append(f"Warning: {warning}")
    for limitation in report.get("limitations") or []:
        lines.append(f"Limitation: {limitation}")
    return "\n".join(lines)


def text_pdf(text: str) -> bytes:
    """One-page text PDF. The JSON report remains the canonical record."""

    content = ["BT", "/F1 9 Tf", "40 800 Td", "12 TL"]
    for index, line in enumerate(text.splitlines()[:55]):
        escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        if index:
            content.append("T*")
        content.append(f"({escaped}) Tj")
    content.append("ET")
    stream = "\n".join(content).encode("latin-1", errors="replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
        ),
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    body = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(body))
        body.extend(f"{number} 0 obj\n".encode())
        body.extend(obj)
        body.extend(b"\nendobj\n")
    xref = len(body)
    body.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    body.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        body.extend(f"{offset:010d} 00000 n \n".encode())
    body.extend(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return bytes(body)

"""Textbook cantilever benchmark and a short mesh-refinement study."""

import json
import tempfile
from pathlib import Path

from drafty_engineering.analytical import BENCHMARK_MESH_M
from drafty_engineering.pipeline import run_simulation
from drafty_engineering.spec import cantilever_benchmark_spec


def run_benchmark(mesh_sizes: list[float] | None = None, output_dir: Path | None = None) -> list[dict]:
    sizes = mesh_sizes or [BENCHMARK_MESH_M, 0.004]
    root = output_dir or Path(tempfile.mkdtemp(prefix="drafty-benchmark-"))
    rows: list[dict] = []
    for size in sizes:
        spec = cantilever_benchmark_spec(size)
        result = run_simulation(spec, root / f"mesh-{size:.4f}")
        benchmark = result["benchmark"]
        row = {
            "mesh_size_m": size,
            "nodes": result["mesh"]["nodes"],
            "elements": result["mesh"]["elements"],
            "fem_tip_deflection_m": benchmark["fem_tip_deflection_m"],
            "analytical_tip_deflection_m": benchmark["analytical_tip_deflection_m"],
            "deflection_error": benchmark["deflection_error"],
            "fem_midspan_stress_pa": benchmark["fem_midspan_stress_pa"],
            "analytical_midspan_stress_pa": benchmark["analytical_midspan_stress_pa"],
            "stress_error": benchmark["stress_error"],
            "passed": benchmark["passed"],
            "solver": result["solver"]["version"],
            "validation_status": result["validation_status"],
        }
        rows.append(row)
        print(json.dumps(row, indent=2))
    (root / "benchmark.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    print(f"Wrote {root / 'benchmark.json'}")
    return rows


def main() -> None:
    run_benchmark()


if __name__ == "__main__":
    main()

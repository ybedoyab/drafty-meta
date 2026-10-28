"""CalculiX input, process isolation, and .dat result parsing."""

import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import numpy as np

from drafty_engineering.analytical import von_mises_pa
from drafty_engineering.errors import Cancelled, GeometryError, SolverError
from drafty_engineering.geometry_math import expected_face_area
from drafty_engineering.materials import Material
from drafty_engineering.spec import DesignSpec

FACE_CORNERS = ((0, 1, 2), (0, 1, 3), (0, 2, 3), (1, 2, 3))
FACE_MIDS = ((4, 5, 6), (4, 8, 7), (6, 9, 7), (5, 9, 8))
SURFACE_AXIS = {"xmin": 0, "xmax": 0, "ymin": 1, "ymax": 1, "zmin": 2, "zmax": 2}


def write_input(
    path: Path,
    spec: DesignSpec,
    material: Material,
    points: np.ndarray,
    cells: np.ndarray,
    fixed_nodes: np.ndarray,
    nodal_forces: dict[int, np.ndarray],
) -> None:
    order = 10 if spec.element_order == 2 else 4
    element_type = "C3D10" if order == 10 else "C3D4"
    lines = [
        "*HEADING",
        f"Drafty {spec.kind} {spec.name}",
        "*NODE",
    ]
    for index, point in enumerate(points, start=1):
        lines.append(f"{index}, {point[0]:.10e}, {point[1]:.10e}, {point[2]:.10e}")
    lines.append(f"*ELEMENT, TYPE={element_type}, ELSET=EALL")
    for index, cell in enumerate(cells, start=1):
        connectivity = ", ".join(str(int(node) + 1) for node in cell)
        lines.append(f"{index}, {connectivity}")
    lines.append("*NSET, NSET=NALL, GENERATE")
    lines.append(f"1, {len(points)}, 1")
    lines.append("*NSET, NSET=FIXED")
    fixed_ids = [str(int(node) + 1) for node in fixed_nodes]
    if not fixed_ids:
        raise GeometryError("The support surface contains no nodes.")
    for chunk in _chunks(fixed_ids, 12):
        lines.append(", ".join(chunk))
    lines.extend(
        [
            "*BOUNDARY",
            "FIXED, 1, 3, 0.0",
            f"*MATERIAL, NAME={material.id}",
            "*ELASTIC",
            f"{material.youngs_modulus_pa:.10e}, {material.poisson_ratio:.8f}",
            "*DENSITY",
            f"{material.density_kg_m3:.10e}",
            f"*SOLID SECTION, ELSET=EALL, MATERIAL={material.id}",
            "*STEP",
            "*STATIC",
            "*CLOAD",
        ]
    )
    if not nodal_forces:
        raise GeometryError("The load surface contains no nodes.")
    for node, force in sorted(nodal_forces.items()):
        for dof, component in enumerate(force, start=1):
            if abs(float(component)) > 0.0:
                lines.append(f"{int(node) + 1}, {dof}, {float(component):.10e}")
    lines.extend(
        [
            "*NODE PRINT, NSET=NALL",
            "U",
            "*EL PRINT, ELSET=EALL",
            "S",
            "*NODE FILE",
            "U",
            "*EL FILE",
            "S",
            "*END STEP",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def select_surface_nodes(points: np.ndarray, spec: DesignSpec, surface: str) -> np.ndarray:
    from drafty_engineering.geometry_math import envelope as design_envelope

    bounds = design_envelope(spec)
    coordinate = {
        "xmin": bounds.xmin,
        "xmax": bounds.xmax,
        "ymin": bounds.ymin,
        "ymax": bounds.ymax,
        "zmin": bounds.zmin,
        "zmax": bounds.zmax,
    }[surface]
    axis = SURFACE_AXIS[surface]
    tolerance = max(1e-6, 0.01 * spec.mesh_size_m)
    mask = np.abs(points[:, axis] - coordinate) <= tolerance
    return np.flatnonzero(mask)


def distribute_load(
    points: np.ndarray,
    cells: np.ndarray,
    loaded_nodes: np.ndarray,
    spec: DesignSpec,
) -> tuple[dict[int, np.ndarray], float]:
    load = spec.loads[0]
    direction = np.array([load.direction.x, load.direction.y, load.direction.z], dtype=float)
    direction = direction / np.linalg.norm(direction)
    loaded = set(int(node) for node in loaded_nodes)
    weights: dict[int, float] = {}
    area = 0.0
    for cell in cells:
        nodes = [int(node) for node in cell]
        for face_index, corners_local in enumerate(FACE_CORNERS):
            corners = [nodes[local] for local in corners_local]
            if not all(corner in loaded for corner in corners):
                continue
            triangle_area = _triangle_area(points, corners)
            if triangle_area <= 0:
                continue
            area += triangle_area
            recipients = [nodes[local] for local in FACE_MIDS[face_index]] if spec.element_order == 2 else corners
            share = triangle_area / 3.0
            for recipient in recipients:
                weights[recipient] = weights.get(recipient, 0.0) + share
    if area <= 0:
        raise GeometryError(f"No element faces were found on the {load.surface} surface.")
    expected = expected_face_area(spec, load.surface)
    tolerance = 0.08 if spec.kind == "perforated_plate" else 0.03
    if expected <= 0 or abs(area - expected) / expected > tolerance:
        raise GeometryError(
            f"Load surface area is {area:.6e} m^2, expected {expected:.6e} m^2. "
            "The loaded region does not match the selected face."
        )
    total_force = direction * (load.magnitude if load.mode == "force" else load.magnitude * area)
    nodal = {node: total_force * (weight / area) for node, weight in weights.items()}
    applied = np.sum(list(nodal.values()), axis=0)
    if not np.allclose(applied, total_force, rtol=1e-6, atol=1e-8):
        raise GeometryError("Distributed nodal forces do not sum to the requested load.")
    return nodal, area


def measure_surface_area(
    points: np.ndarray,
    cells: np.ndarray,
    surface_nodes: np.ndarray,
) -> float:
    selected = set(int(node) for node in surface_nodes)
    area = 0.0
    for cell in cells:
        nodes = [int(node) for node in cell]
        for corners_local in FACE_CORNERS:
            corners = [nodes[local] for local in corners_local]
            if all(corner in selected for corner in corners):
                area += _triangle_area(points, corners)
    return area


def run_calculix(inp_path: Path, timeout_s: int, cancel_file: Path | None = None) -> dict:
    status = solver_availability()
    if not status["available"]:
        raise SolverError(status["detail"])
    workdir = inp_path.parent
    log_path = workdir / "solver.log"
    with tempfile.TemporaryDirectory(prefix="drafty-ccx-") as temporary:
        temp_dir = Path(temporary)
        shutil.copy(inp_path, temp_dir / "model.inp")
        if status["mode"] == "docker":
            mount = temp_dir.resolve().as_posix()
            command = [
                "docker",
                "run",
                "--rm",
                "-e",
                "OMP_NUM_THREADS=2",
                "-v",
                f"{mount}:/work",
                "-w",
                "/work",
                status["detail"],
                "model",
            ]
            cwd = None
            environment = None
        else:
            command = [status["detail"], "model"]
            cwd = temp_dir
            environment = os.environ.copy()
            environment["OMP_NUM_THREADS"] = environment.get("OMP_NUM_THREADS", "2")
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        output = _wait_for_solver(process, timeout_s, cancel_file)
        log_path.write_text("".join(output), encoding="utf-8")
        if process.returncode != 0 or "job finished" not in "".join(output).lower():
            raise SolverError(_failure_excerpt(output, process.returncode))
        for name in ("model.frd", "model.dat", "model.sta", "model.cvg"):
            produced = temp_dir / name
            if produced.exists():
                shutil.copy(produced, workdir / name)
    if not (workdir / "model.dat").exists() or not (workdir / "model.frd").exists():
        raise SolverError("CalculiX finished without both model.dat and model.frd.")
    return {
        "mode": status["mode"],
        "version": _solver_version("".join(output)),
        "log": str(log_path),
    }


def parse_frd_nodal(text: str) -> tuple[dict[int, np.ndarray], dict[int, np.ndarray]]:
    """Read nodal DISP and STRESS blocks from an ASCII CalculiX .frd file."""

    displacements: dict[int, np.ndarray] = {}
    stresses: dict[int, np.ndarray] = {}
    block = None
    number = re.compile(r"[+-]?\d+\.\d+[Ee][+-]\d+")
    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if stripped.startswith("-4"):
            parts = stripped.split()
            block = parts[1] if len(parts) > 1 and parts[1] in {"DISP", "STRESS"} else None
            continue
        if stripped.startswith("-3"):
            block = None
            continue
        if block is None or not stripped.startswith("-1"):
            continue
        payload = stripped[2:].strip()
        values = [float(match) for match in number.findall(payload)]
        prefix = number.sub(" ", payload).split()
        if not prefix or not values:
            continue
        node_id = int(prefix[0])
        vector = np.array(values, dtype=float)
        if block == "DISP" and len(vector) >= 3:
            displacements[node_id] = vector[:3]
        elif block == "STRESS" and len(vector) >= 6:
            stresses[node_id] = vector[:6]
    return displacements, stresses


def fields_from_frd(
    point_count: int,
    displacements: dict[int, np.ndarray],
    stresses: dict[int, np.ndarray],
) -> tuple[np.ndarray, np.ndarray]:
    if len(displacements) != point_count or len(stresses) != point_count:
        raise SolverError(
            f"The .frd file has {len(displacements)} displacement nodes and "
            f"{len(stresses)} stress nodes, expected {point_count}."
        )
    displacement = np.zeros((point_count, 3))
    von_mises = np.zeros(point_count)
    for node_id in range(1, point_count + 1):
        displacement[node_id - 1] = displacements[node_id]
        von_mises[node_id - 1] = von_mises_pa(stresses[node_id])
    return displacement, von_mises


def parse_dat(text: str) -> tuple[dict[int, np.ndarray], dict[int, list[np.ndarray]]]:
    displacements: dict[int, np.ndarray] = {}
    stresses: dict[int, list[np.ndarray]] = {}
    mode = None
    for raw_line in text.splitlines():
        lowered = raw_line.lower()
        if "displacements (vx,vy,vz)" in lowered:
            mode = "u"
            continue
        if lowered.strip().startswith("stresses (elem"):
            mode = "s"
            continue
        stripped = raw_line.strip()
        if not stripped:
            continue
        parts = stripped.replace("D", "E").replace("d", "E").split()
        try:
            if mode == "u" and len(parts) >= 4:
                displacements[int(parts[0])] = np.array(
                    [float(parts[1]), float(parts[2]), float(parts[3])], dtype=float
                )
            elif mode == "s" and len(parts) >= 8:
                element_id = int(parts[0])
                stress = np.array([float(value) for value in parts[2:8]], dtype=float)
                stresses.setdefault(element_id, []).append(stress)
            elif any(character.isalpha() for character in stripped):
                mode = None
        except ValueError:
            if any(character.isalpha() for character in stripped):
                mode = None
    return displacements, stresses


def nodal_fields(
    points: np.ndarray,
    cells: np.ndarray,
    displacements: dict[int, np.ndarray],
    stresses: dict[int, list[np.ndarray]],
) -> tuple[np.ndarray, np.ndarray]:
    node_count = len(points)
    displacement = np.full((node_count, 3), np.nan)
    for node_id, value in displacements.items():
        index = node_id - 1
        if index < 0 or index >= node_count:
            raise SolverError(f"Displacement node {node_id} is outside the mesh.")
        displacement[index] = value
    if np.isnan(displacement).any():
        missing = int(np.isnan(displacement[:, 0]).sum())
        raise SolverError(f"CalculiX omitted displacements for {missing} nodes.")
    accumulator = np.zeros(node_count)
    visits = np.zeros(node_count)
    if len(stresses) != len(cells):
        raise SolverError(f"CalculiX returned stresses for {len(stresses)} elements, expected {len(cells)}.")
    for element_id, samples in stresses.items():
        index = element_id - 1
        if index < 0 or index >= len(cells):
            raise SolverError(f"Stress element {element_id} is outside the mesh.")
        if not samples:
            raise SolverError(f"Element {element_id} has no integration-point stresses.")
        element_von_mises = float(np.mean([von_mises_pa(sample) for sample in samples]))
        for node in set(int(node) for node in cells[index]):
            accumulator[node] += element_von_mises
            visits[node] += 1
    if np.any(visits == 0):
        raise SolverError("Some mesh nodes received no stress samples.")
    return displacement, accumulator / visits


def solver_availability() -> dict:
    binary = os.environ.get("CCX_BIN", "ccx")
    image = os.environ.get("CCX_DOCKER_IMAGE", "drafty-ccx")
    preference = os.environ.get("DRAFTY_USE_DOCKER_CCX", "auto")
    local = shutil.which(binary) if preference != "always" else None
    docker_ready = False
    if preference != "never":
        docker_ready = _docker_image_exists(image)
    if local and preference != "always":
        return {"available": True, "mode": "local", "detail": local}
    if docker_ready and preference != "never":
        return {"available": True, "mode": "docker", "detail": image}
    return {
        "available": False,
        "mode": "missing",
        "detail": (
            "CalculiX is not available. Install ccx on PATH or build the solver image with "
            "`docker build -t drafty-ccx -f infra/docker/Dockerfile.ccx infra/docker`."
        ),
    }


def _wait_for_solver(
    process: subprocess.Popen[str],
    timeout_s: int,
    cancel_file: Path | None,
) -> list[str]:
    chunks: list[str] = []

    def consume() -> None:
        assert process.stdout is not None
        chunks.append(process.stdout.read())

    reader = threading.Thread(target=consume, daemon=True)
    reader.start()
    deadline = time.monotonic() + timeout_s
    while reader.is_alive():
        reader.join(0.5)
        if cancel_file is not None and cancel_file.exists():
            process.kill()
            reader.join(5)
            raise Cancelled("The job was cancelled.")
        if time.monotonic() > deadline:
            process.kill()
            reader.join(5)
            raise SolverError(f"CalculiX exceeded the {timeout_s} s limit.")
    process.wait(timeout=30)
    return chunks


def _docker_image_exists(image: str) -> bool:
    try:
        completed = subprocess.run(
            ["docker", "image", "inspect", image],
            capture_output=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return completed.returncode == 0


def _triangle_area(points: np.ndarray, corners: list[int]) -> float:
    first, second, third = points[corners]
    return float(0.5 * np.linalg.norm(np.cross(second - first, third - first)))


def _chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[index : index + size] for index in range(0, len(values), size)]


def _solver_version(log_text: str) -> str:
    for line in log_text.splitlines():
        if "calculix" in line.lower() and "version" in line.lower():
            return line.strip()
    return "CalculiX ccx (version string not found in solver log)"


def _failure_excerpt(output: list[str], return_code: int | None) -> str:
    text = "".join(output).strip()
    tail = text[-1500:] if text else "CalculiX produced no output."
    return f"CalculiX failed with exit code {return_code}.\n{tail}"

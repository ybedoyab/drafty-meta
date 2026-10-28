"""Gmsh tetrahedral meshing of the STEP solid, in meters."""

import os
from pathlib import Path

import meshio
import numpy as np

from drafty_engineering.errors import GeometryError
from drafty_engineering.geometry_math import envelope
from drafty_engineering.spec import DesignSpec

TET10_EDGES = ((0, 1), (1, 2), (2, 0), (0, 3), (1, 3), (2, 3))


def mesh_step(step_path: Path, msh_path: Path, spec: DesignSpec) -> meshio.Mesh:
    import tempfile

    import gmsh

    bounds = envelope(spec)
    expected_length = bounds.xmax - bounds.xmin
    msh_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="drafty-gmsh-") as temporary:
        local_step = Path(temporary) / "model.step"
        local_mesh = Path(temporary) / "model.msh"
        local_step.write_bytes(step_path.read_bytes())
        original_path = os.environ.get("PATH")
        gmsh.initialize()
        try:
            gmsh.option.setNumber("General.Terminal", 0)
            gmsh.model.add("part")
            volumes = gmsh.model.occ.importShapes(str(local_step))
            gmsh.model.occ.synchronize()
            if not volumes:
                raise GeometryError("The STEP file did not contain a solid.")
            scale = _length_scale(expected_length)
            if scale != 1.0:
                gmsh.model.occ.dilate(gmsh.model.getEntities(3), 0.0, 0.0, 0.0, scale, scale, scale)
                gmsh.model.occ.synchronize()
            gmsh.option.setNumber("Mesh.MeshSizeMin", spec.mesh_size_m)
            gmsh.option.setNumber("Mesh.MeshSizeMax", spec.mesh_size_m)
            gmsh.option.setNumber("Mesh.ElementOrder", spec.element_order)
            gmsh.option.setNumber("Mesh.HighOrderOptimize", 1 if spec.element_order == 2 else 0)
            gmsh.option.setNumber("Mesh.MshFileVersion", 2.2)
            gmsh.model.mesh.generate(3)
            gmsh.write(str(local_mesh))
        finally:
            gmsh.finalize()
            if original_path is not None:
                os.environ["PATH"] = original_path
        mesh = meshio.read(local_mesh)
        msh_path.write_bytes(local_mesh.read_bytes())
    return mesh


def tetra_cells(mesh: meshio.Mesh, order: int) -> tuple[np.ndarray, np.ndarray, str]:
    key = "tetra10" if order == 2 else "tetra"
    if key not in mesh.cells_dict:
        found = ", ".join(mesh.cells_dict) or "none"
        raise GeometryError(f"The mesh has no {key} cells. Found: {found}.")
    points = np.asarray(mesh.points, dtype=float)
    cells = np.asarray(mesh.cells_dict[key], dtype=np.int64)
    if order == 2:
        cells = np.vstack([order_tetra10(points, cell) for cell in cells])
    return points, cells, key


def order_tetra10(points: np.ndarray, cell: np.ndarray) -> np.ndarray:
    """Put a 10-node tet into CalculiX C3D10 order regardless of importer order."""

    corners = [int(node) for node in cell[:4]]
    mids = [int(node) for node in cell[4:10]]
    if len(mids) != 6:
        raise GeometryError("A quadratic tetrahedron must have 10 nodes.")
    ordered: list[int] = []
    used: set[int] = set()
    scale = max(float(np.linalg.norm(points[corners[0]])), 1.0)
    for start, end in TET10_EDGES:
        target = 0.5 * (points[corners[start]] + points[corners[end]])
        unused = [node for node in mids if node not in used]
        distances = [float(np.linalg.norm(points[node] - target)) for node in unused]
        choice = unused[int(np.argmin(distances))]
        if distances[int(np.argmin(distances))] > 1e-4 * scale:
            raise GeometryError("A quadratic edge node is not at the edge midpoint.")
        used.add(choice)
        ordered.append(choice)
    return np.array(corners + ordered, dtype=np.int64)


def _length_scale(expected_length_m: float) -> float:
    import gmsh

    xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.getBoundingBox(-1, -1)
    del ymin, zmin, ymax, zmax
    measured = xmax - xmin
    if expected_length_m <= 0:
        raise GeometryError("The design length is zero.")
    ratio = measured / expected_length_m
    if abs(ratio - 1.0) < 0.02:
        return 1.0
    if abs(ratio - 1000.0) / 1000.0 < 0.02:
        return 0.001
    if abs(ratio - 0.001) / 0.001 < 0.02:
        return 1000.0
    raise GeometryError(f"Imported STEP length is {measured:.6e}, expected {expected_length_m:.6e} m.")

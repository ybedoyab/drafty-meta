# Batch 10A — Quadratic mesh validity and Jacobian quality

Offline / local-only validation of CalculiX C3D10 (10-node tetrahedron) meshes.
**No paid Meta, Modal FEM, Modal CAD, or production mutations were used for this batch.**

## What changed

1. Analytical TET10 shape functions and Jacobian determinants (`tet10_jacobian.py`).
2. `assess_mesh` rejects demonstrated inverted/degenerate quadratic elements.
3. Mesh-quality metadata flows into `results.json`, `report.json`, and the PDF text page.
4. Deterministic fixtures and performance measurement in `tests/test_tet10_jacobian.py`.

## Reference element and node order

Natural coordinates \((\xi,\eta,\zeta)\) with barycentric \(L_1=1-\xi-\eta-\zeta\), \(L_2=\xi\), \(L_3=\eta\), \(L_4=\zeta\).

Drafty / CalculiX **C3D10** order (0-based), matching `mesh.TET10_EDGES`:

| Nodes | Role |
| --- | --- |
| 0–3 | Corners at \(L_i=1\) |
| 4 | Mid-edge 0–1 |
| 5 | Mid-edge 1–2 |
| 6 | Mid-edge 2–0 |
| 7 | Mid-edge 0–3 |
| 8 | Mid-edge 1–3 |
| 9 | Mid-edge 2–3 |

Shape functions: \(N_i=L_i(2L_i-1)\) (corners), \(N_{ab}=4L_a L_b\) (mids).

Mapping \(x=\sum N_i x_i\), Jacobian \(J=\partial x/\partial(\xi,\eta,\zeta)\). `det J` has SI units of volume (m³).

## Validation levels

### A. Sampled numerical validation

Evaluate `det J` at a fixed reference set (vertices, edge mids, face centroids, volume centroid, 4-point tet quadrature). Any non-positive sample (relative to \((10^{-8}L)^3\)) ⇒ **invalid**.

**Limitation:** positive samples do **not** prove positivity everywhere in the quadratic element.

### B. Whole-element certification

NumPy path: selective adaptive subdivision of the reference tet on low-ratio elements. Finding a non-positive leaf ⇒ **invalid**. Exhausting the budget without finding one ⇒ **`inconclusive`**, never `certified_valid`.

Gmsh `AnalyseCurvedMesh` / IGE / ICN are **not** required for CI. When unavailable they are reported as `unavailable` (null values), not invented.

Fail-closed rejection of `inconclusive` is **not** enabled: certification is incomplete without a Bézier or Gmsh positivity bound. Existing corner-volume and connectivity gates remain.

## Hard failures vs soft warnings

**Hard reject (`GeometryError`):**

- Empty mesh, out-of-range connectivity, duplicate corner tets
- Non-finite / non-positive corner volumes (existing)
- Demonstrated inverted or degenerate quadratic Jacobian (sampled or adaptive)

**Soft warnings only:**

- Sampled min/max Jacobian ratio \(< 0.10\)
- IGE / ICN thresholds are not applied (metrics unavailable on the NumPy path)

## Report schema additions

Under `mesh.quality` (and mirrored into engineering reports):

- `element_type`, `elements_checked`
- `jacobian_validation_method`, `jacobian_validation_status`
- `min_jacobian`, `max_jacobian`
- `normalized_jacobian_ratio_min` / `_max`
- `inverted_elements`, `degenerate_elements`, `inconclusive_elements`
- `low_jacobian_ratio_*`, `quality_warnings`
- `ige` / `icn` (+ `*_status`: `unavailable` when not computed)

`quality_gates` gains `mesh_validity` and `mesh_quality`, distinct from solver completion and equilibrium.

## Performance (local measurement)

Synthetic straight-sided mesh, **20 000** C3D10 elements, NumPy sampled + selective adaptive path:

Run via:

```powershell
uv run pytest tests/test_tet10_jacobian.py::test_performance_on_representative_synthetic_mesh -q -s
```

Measured locally (Windows, NumPy path): **20 000 elements in ~0.13 s** (`test_performance_on_representative_synthetic_mesh`). Soft CI budget remains &lt; 60 s. Peak memory is dominated by the temporary `(chunk, 10, 3)` node block plus sample Jacobians (chunk size 4096).

## Existing benchmarks

Cantilever displacement (~8%), outer-fiber stress (~20%), beam Hermitian (~1%), volume/surface gates are **unchanged**. Mesh tests that call `assess_mesh` on valid Gmsh output must still pass.

## Local tests

```powershell
# Offline Jacobian fixtures (always)
uv run pytest tests/test_tet10_jacobian.py -m "not mesh" -q

# With Gmsh: cantilever quadratic mesh validity
uv run pytest tests/test_tet10_jacobian.py -m mesh -q

# Broader engineering suite without FEM / Postgres
uv run pytest -m "not fem and not postgres" -q
```

Environment for this batch:

- `DRAFTY_QA_RUN_LIVE_MODAL=false`
- `DRAFTY_QA_RUN_LIVE_META=false`
- `DRAFTY_QA_RELEASE_RETAINED` unset

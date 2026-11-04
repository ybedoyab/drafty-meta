# Technical notes

The why, the solver pipeline, and the deployment manuals. The [README](../README.md) is the short version.

## Repository layout

- `apps/web` — React workstation
- `apps/api` — FastAPI. Simulation requests return a job id immediately
- `packages/engineering` — geometry, meshing, CalculiX, and the beam benchmark
- `packages/ai` — Meta Model API calls
- `infra/docker` — CalculiX image and the API/web images
- `infra/modal` — remote solver function
- `supabase/migrations` — Postgres schema and private artifact bucket

## Analysis path

1. Validate the typed specification. One encastre support, one load, a known material, and explicit dimensions are required.
2. Build the solid in CadQuery and write STEP.
3. Mesh that STEP file with Gmsh. Quadratic tetrahedra are the default.
4. Assess the tetrahedral mesh: corner volumes for all tets, plus sampled/adaptive C3D10 Jacobian checks for quadratic meshes (see [BATCH_10A_MESH_QUALITY.md](BATCH_10A_MESH_QUALITY.md)). Demonstrated inversion fails closed; whole-element certification stays inconclusive on the NumPy path.
5. Check that the fixed and loaded faces match the requested surfaces.
6. Write a CalculiX `.inp` and run `ccx` in its own process, with a timeout.
7. Read nodal displacements and integration-point stresses from the solver files.
8. Report von Mises, displacement, factor of safety, and mesh-quality metadata. A job is not marked completed without those files. Solver completion is not mesh certification.

The cantilever check compares free-end deflection with Euler-Bernoulli bending plus rectangular Timoshenko shear, and midspan outer-fiber stress with beam theory. The acceptance bands are 8% on deflection and 20% on that sampled stress. Peak stress on the fixed face is reported separately because a fully fixed face can create a constraint singularity.

Internal units are meters, newtons, and pascals. The interface shows millimeters, newtons, and megapascals.

The cantilever benchmark runs the textbook cantilever at two mesh sizes and writes `benchmark.json`:

```powershell
uv run drafty-benchmark
```

## How the Meta integration works

Natural-language design stays off until `MODEL_API_KEY` is set. The manual Studio and the classroom demo do not need Meta or Modal.

With a key, a scenario turn uses the Responses API (`muse-spark-1.3` by default, optional `muse-wonder-1.0`) with `web_search` at low search context, `previous_response_id`, and `text.format` JSON. The server classifies the request and runs one allowlisted tool. The model may propose a model and ask for missing inputs; it never supplies results, stresses, or safety factors, and it never runs generated code. A classroom floor stays on the beam-element path. A mechanical part (L-bracket, cantilever beam, plate, or perforated plate) is handed to Studio and CalculiX only after approval.

`url_citation` annotations, retrieved pages, and the checked NSR-10 reference stay in separate source classes. A session stops after 8 model turns or 6000 output tokens. SAM 3.1 can segment a stored image when the key is present; a mask is not a dimension. Reference images are stored as context and are not measured for dimensions.

The older chat path uses `POST https://api.meta.ai/v1/chat/completions` with tool calls. The model can only call `ask_clarification` and `propose_design`; built-in `web_search` is rejected on that endpoint. `drafty_ai.responses` calls `POST /responses` with `web_search` (`search_context_size` low), `include: ["web_search_call.results"]`, reasoning effort `minimal`, and structured `text.format`, only when `MODEL_API_KEY` is set. The classroom template does not call it and does not invent citations.

When a part edited in Studio returns to its scenario, the server rebuilds the scenario inputs from the returned spec, recomputes the study, and resets the Meta conversation (`previous_response_id` is dropped), so the next reply reasons about the edited part instead of the original proposal.

## Optimization

After a solve, a thickness study can run up to six more real analyses. Each iteration is kept. The lightest design that meets the factor of safety and optional displacement limit is marked accepted. If `MODEL_API_KEY` is set, Muse Spark may propose the next thickness inside the bounds. The solver result decides whether that thickness is feasible. Without the key, the loop uses bisection.

## Environment

Copy `.env.example` to `.env`. Leave unknown values blank.

| Variable | Role |
| --- | --- |
| `MODEL_API_KEY` | Meta Model API key, server side only |
| `MODEL_API_BASE` | `https://api.meta.ai/v1` |
| `MODEL_PRIMARY` | `muse-spark-1.3` |
| `MODEL_REASONING` | `muse-wonder-1.0` |
| `DRAFTY_COMPUTE` | `local` or `modal` |
| `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | Used only when compute is `modal` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Optional job and artifact sync |
| `SUPABASE_SECRET_KEY` | Server service credential; required for private artifact upload |
| `SUPABASE_JWT_SECRET` | Optional HS256 check. Otherwise the Supabase JWKS is used |
| `DRAFTY_AUTH_MODE` | `disabled` until you want JWT checks |
| `CCX_BIN`, `CCX_DOCKER_IMAGE`, `DRAFTY_USE_DOCKER_CCX` | Local `ccx` or the `drafty-ccx` image |
| `VITE_API_URL` | API origin for the web app |

Supabase Auth turns on with `DRAFTY_AUTH_MODE=supabase` and a publishable key. Modal Cloud CalculiX stays off until `modal setup` creates a local profile or `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` are set on the server. `DRAFTY_ENV=production` refuses to start while authentication is disabled.

## Deployment

The API image already contains CalculiX, so Compose does not need the separate solver image:

```powershell
docker compose up --build
```

Docker Compose publishes the web app on port 15173 and the API on port 18080.

Modal deploy, after the tokens exist:

```powershell
uv sync --extra modal
modal deploy infra/modal/app.py
```

Apply `supabase/migrations/0001_init.sql` in the Supabase SQL editor before enabling cloud sync. Set `DRAFTY_AUTH_MODE=supabase` when the project should require a user token.

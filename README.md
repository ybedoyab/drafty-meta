# Drafty

Drafty is an engineering workstation for parametric solids and static finite element analysis. You enter dimensions, a material, a support, and a load. The API builds a CadQuery solid, meshes the STEP file with Gmsh, solves it with CalculiX, and returns the solver's displacements and stresses to the 3D view.

Natural-language design, Modal, and Supabase stay off until their environment variables are set. The manual beam workflow does not need them.

## Layout

- `apps/web` — React workstation
- `apps/api` — FastAPI. Simulation requests return a job id immediately
- `packages/engineering` — geometry, meshing, CalculiX, and the beam benchmark
- `packages/ai` — Meta Model API tool calls
- `infra/docker` — CalculiX image and the API/web images
- `infra/modal` — remote solver function
- `supabase/migrations` — Postgres schema and private artifact bucket

## Run it locally

From the repository root, with Python 3.12, [uv](https://docs.astral.sh/uv/), Node 22, and Docker:

```powershell
uv sync --extra dev
docker build -t drafty-ccx -f infra/docker/Dockerfile.ccx infra/docker
Copy-Item .env.example .env
uv run drafty-api
```

In another terminal:

```powershell
cd apps/web
npm install
npm run dev
```

Open http://localhost:5173. The homepage has two paths: **Start with a problem** (`/scenario/new`) and **Open Studio** (`/studio`). The classroom path is a guided template. It cites a published live-load minimum, calculates a tributary line load only when the width is known, and does not send that floor beam to CalculiX. Studio still runs the cantilever, plate, bracket, and perforated plate without an AI key.

Docker Compose publishes the web app on port 15173 and the API on port 18080.

The cantilever benchmark is the default Studio form. Run analysis and wait for the status to move from queued through geometry, meshing, solving, and postprocessing. The numbers come from `model.dat` and `model.frd`.

```powershell
uv run drafty-benchmark
uv run pytest
uv run ruff check packages apps tests
```

`drafty-benchmark` runs the textbook cantilever at two mesh sizes and writes `benchmark.json`.

The API image already contains CalculiX, so Compose does not need the separate solver image:

```powershell
docker compose up --build
```

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
| `SUPABASE_JWT_SECRET` | Optional HS256 check. Otherwise the Supabase JWKS is used |
| `DRAFTY_AUTH_MODE` | `disabled` until you want JWT checks |
| `CCX_BIN`, `CCX_DOCKER_IMAGE`, `DRAFTY_USE_DOCKER_CCX` | Local `ccx` or the `drafty-ccx` image |
| `VITE_API_URL` | API origin for the web app |

Chat uses `POST https://api.meta.ai/v1/chat/completions` with tool calls. The model can only call `ask_clarification` and `propose_design`. A proposal fills the form; it does not start a solve and it does not run generated code. `drafty_ai.responses` can call `POST /responses` with `web_search`, and only when `MODEL_API_KEY` is set. The classroom template does not call it and does not invent citations. Reference images are stored and are not measured for dimensions.

Modal deploy, after the tokens exist:

```powershell
uv sync --extra modal
modal deploy infra/modal/app.py
```

Apply `supabase/migrations/0001_init.sql` in the Supabase SQL editor before enabling cloud sync. Set `DRAFTY_AUTH_MODE=supabase` when the project should require a user token.

## Analysis path

1. Validate the typed specification. One encastre support, one load, a known material, and explicit dimensions are required.
2. Build the solid in CadQuery and write STEP.
3. Mesh that STEP file with Gmsh. Quadratic tetrahedra are the default.
4. Check that the fixed and loaded faces match the requested surfaces.
5. Write a CalculiX `.inp` and run `ccx` in its own process, with a timeout.
6. Read nodal displacements and integration-point stresses from the solver files.
7. Report von Mises, displacement, and factor of safety. A job is not marked completed without those files.

The cantilever check compares free-end deflection with Euler-Bernoulli bending plus rectangular Timoshenko shear, and midspan outer-fiber stress with beam theory. The acceptance bands are 8% on deflection and 20% on that sampled stress. Peak stress on the fixed face is reported separately because a fully fixed face can create a constraint singularity.

Internal units are meters, newtons, and pascals. The interface shows millimeters, newtons, and megapascals.

## Optimization

After a solve, a thickness study can run up to six more real analyses. Each iteration is kept. The lightest design that meets the factor of safety and optional displacement limit is marked accepted. If `MODEL_API_KEY` is set, Muse Spark may propose the next thickness inside the bounds. The solver result decides whether that thickness is feasible. Without the key, the loop uses bisection.

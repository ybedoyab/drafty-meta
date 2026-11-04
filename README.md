# Drafty

Drafty is an engineering workstation that turns a described or typed part into a real solid, meshes it, and solves it with finite element analysis. You can start from a conversation or work manually — both paths meet on the same parametric part, the same solver, and the same results.

Engineering design usually splits into two disconnected steps: figuring out *what* to build (loads, dimensions, materials, assumptions) and *running the numbers* (CAD, mesh, solver). Drafty connects them in one loop:

1. **Start with meta AI** — describe the problem in the scenario assistant. Drafty asks for what is missing, keeps assumptions and sources visible, and proposes a part.
2. **Approve and open Studio** — nothing is solved from the chat alone. You approve the proposed part, then edit and run it in the manual Studio.
3. **Edit and solve** — change dimensions, material, support, and load, or sketch extra pieces. Run the solve and read the displacements and stresses.
4. **Return to the scenario** — send the part back, edited or not. The scenario updates its inputs and context, so the conversation continues about the part as it actually is now.

You can also skip the conversation entirely: **Open Studio** works on its own, with no AI key required.

## How Meta AI is used in this field

Meta AI (Muse Spark 1.3 by default, Muse Wonder 1.0 for harder turns) acts as the *front door*, never as the calculator:

- It interprets your description, classifies which supported part you mean, and asks for the missing physical inputs.
- It can search published references for loads and material data. Checked references, retrieved pages, and model citations are kept in separate source classes.
- With a photo or drawing attached, SAM 3.1 segmentation can outline what is visible. An image is evidence, never a measurement.
- The server — not the model — computes every number, builds the geometry, and chooses the solver. The model never invents stresses, displacements, or safety factors, and a part reaches the solver only after your approval.

Without `MODEL_API_KEY`, Drafty still works: the assistant becomes a labeled guided template with built-in demos, and Studio is fully usable.

## Run it

You need Python 3.12 with [uv](https://docs.astral.sh/uv/), Node, and Docker (for the CalculiX solver image).

From the repository root:

```powershell
uv sync --extra dev
docker build -t drafty-ccx -f infra/docker/Dockerfile.ccx infra/docker
Copy-Item .env.example .env
uv run drafty-api
```

In other terminal:

```powershell
cd apps/web
npm install
npm run dev
```

Or with Docker Compose (web on port 15173, API on port 18080):

```powershell
docker compose up --build
```

## Main features

- **Scenario assistant** — chat that collects inputs, shows assumptions, sources, and missing data, and proposes a part for your approval.
- **AI ↔ Studio round trip** — approve a part into Studio, edit it there, and return it; the scenario context follows the edited part.
- **Studio editing** — dimension and material fields, scale and rotate viewport tools with grid snapping, a sketch tool for adding pieces, and undo/redo history.
- **Real solves** — CadQuery solids meshed with Gmsh and solved with CalculiX, locally or on Modal; results are compared against beam theory where that check applies.
- **Thickness optimization** — repeated real solves that keep the lightest design meeting your safety factor and displacement limit.

## More documentation

- [Technical notes](docs/TECHNICAL.md) — solver pipeline, environment variables, Meta integration details, and deployment.
- [Scenario workstation](docs/SCENARIO_UX_ARCHITECTURE.md) — how the scenario assistant behaves with and without a Meta key.
- [References](docs/REFERENCES.md) and [Provenance](docs/PROVENANCE.md) — where the engineering references and bundled material come from.

Drafty reports are preliminary engineering checks. They are not a certification.

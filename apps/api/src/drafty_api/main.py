"""Drafty HTTP API. Heavy analysis returns a job id immediately."""

import hashlib
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field

from drafty_api.auth import current_owner
from drafty_api.jobs import ACTIVE, create_job, job_dir, list_jobs, read_job, recover_interrupted_jobs, request_cancel
from drafty_api.settings import settings
from drafty_api.storage import signed_artifact_url
from drafty_engineering.geometry_math import envelope, expected_face_area
from drafty_engineering.materials import MATERIALS
from drafty_engineering.solver import solver_availability
from drafty_engineering.spec import DesignSpec

ARTIFACTS = {
    "preview.glb": "model/gltf-binary",
    "results.glb": "model/gltf-binary",
    "model.step": "application/step",
    "model.inp": "text/plain",
    "model.dat": "text/plain",
    "model.frd": "application/octet-stream",
    "model.vtu": "application/octet-stream",
    "model.scad": "text/plain",
    "results.json": "application/json",
    "optimization.json": "application/json",
    "solver.log": "text/plain",
}
UPLOAD_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


class OptimizationOptions(BaseModel):
    lower_m: float = Field(gt=0)
    upper_m: float = Field(gt=0)
    min_safety_factor: float = Field(default=2.0, gt=0)
    max_displacement_m: float | None = Field(default=None, gt=0)
    max_iterations: int = Field(default=4, ge=1, le=6)


class CreateJobRequest(BaseModel):
    kind: str = "simulation"
    spec: DesignSpec
    optimization: OptimizationOptions | None = None


class InterpretRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    reference_image_id: str | None = None
    model: str | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    recover_interrupted_jobs()
    yield


app = FastAPI(title="Drafty", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(
        {
            settings.frontend_origin,
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        }
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/v1/health")
def health() -> dict:
    return {
        "service": "drafty",
        "solver": solver_availability(),
        "meta": settings.meta_configured,
        "modal": settings.drafty_compute == "modal" and settings.modal_configured,
        "supabase": settings.supabase_configured,
        "auth": settings.drafty_auth_mode,
        "compute": settings.drafty_compute,
    }


@app.get("/api/v1/materials")
def materials() -> list[dict]:
    return [material.model_dump() for material in MATERIALS.values()]


@app.post("/api/v1/designs/validate")
def validate_design(spec: DesignSpec) -> dict:
    bounds = envelope(spec)
    return {
        "valid": True,
        "spec": spec.model_dump(),
        "volume_m3": bounds.volume_m3,
        "support_area_m2": expected_face_area(spec, spec.supports[0].surface),
        "load_area_m2": expected_face_area(spec, spec.loads[0].surface),
    }


@app.post("/api/v1/designs/preview")
def preview_design(spec: DesignSpec) -> FileResponse:
    from drafty_engineering.cad import build_solid, export_preview_glb

    digest = hashlib.sha256(spec.model_dump_json().encode()).hexdigest()[:20]
    path = settings.data_dir / "previews" / f"{digest}.glb"
    if not path.exists():
        export_preview_glb(build_solid(spec), path, spec.mesh_size_m)
    return FileResponse(path, media_type="model/gltf-binary", filename="preview.glb")


@app.post("/api/v1/jobs")
def post_job(body: CreateJobRequest, request: Request) -> dict:
    owner = current_owner(request)
    if body.kind not in {"simulation", "optimization"}:
        raise HTTPException(status_code=422, detail="kind must be simulation or optimization.")
    options = None
    if body.kind == "optimization":
        if body.optimization is None:
            raise HTTPException(status_code=422, detail="Optimization bounds are required.")
        if body.optimization.upper_m <= body.optimization.lower_m:
            raise HTTPException(status_code=422, detail="The upper bound must exceed the lower bound.")
        options = body.optimization.model_dump()
    job = create_job(owner, body.kind, body.spec.model_dump(), options)
    return _public_job(job)


@app.get("/api/v1/jobs")
def get_jobs(request: Request) -> dict:
    owner = current_owner(request)
    return {"jobs": [_public_job(job) for job in list_jobs(owner)]}


@app.get("/api/v1/jobs/{job_id}")
def get_job(job_id: str, request: Request) -> dict:
    return _public_job(read_job(job_id, current_owner(request)))


@app.post("/api/v1/jobs/{job_id}/cancel")
def cancel_job(job_id: str, request: Request) -> dict:
    return _public_job(request_cancel(job_id, current_owner(request)))


@app.get("/api/v1/jobs/{job_id}/results")
def get_results(job_id: str, request: Request) -> dict:
    job = read_job(job_id, current_owner(request))
    path = job_dir(job_id) / "results.json"
    if job["status"] != "completed" or not path.exists():
        raise HTTPException(status_code=409, detail="Results are not available until the solver completes.")
    import json

    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/v1/jobs/{job_id}/optimization")
def get_optimization(job_id: str, request: Request) -> dict:
    job = read_job(job_id, current_owner(request))
    path = job_dir(job_id) / "optimization.json"
    if job["status"] != "completed" or not path.exists():
        raise HTTPException(status_code=409, detail="Optimization results are not available yet.")
    import json

    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/v1/jobs/{job_id}/log")
def get_log(job_id: str, request: Request) -> dict:
    read_job(job_id, current_owner(request))
    directory = job_dir(job_id)
    solver = _tail(directory / "solver.log")
    worker = _tail(directory / "worker.log")
    return {"solver": solver, "worker": worker}


@app.get("/api/v1/jobs/{job_id}/artifacts/{name}")
def get_artifact(job_id: str, name: str, request: Request):
    read_job(job_id, current_owner(request))
    if name not in ARTIFACTS:
        raise HTTPException(status_code=404, detail="Unknown artifact.")
    path = job_dir(job_id) / name
    if path.exists():
        return FileResponse(path, media_type=ARTIFACTS[name], filename=name)
    remote = signed_artifact_url(job_id, name)
    if remote:
        return RedirectResponse(remote)
    raise HTTPException(status_code=404, detail="The artifact is not on disk.")


@app.post("/api/v1/uploads/reference")
async def upload_reference(request: Request) -> dict:
    current_owner(request)
    form = await request.form()
    upload = form.get("file")
    if upload is None or not hasattr(upload, "content_type"):
        raise HTTPException(status_code=422, detail="Attach an image file.")
    extension = UPLOAD_TYPES.get(upload.content_type or "")
    if extension is None:
        raise HTTPException(status_code=422, detail="Reference images must be PNG, JPEG, or WebP.")
    data = await upload.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="Reference images are limited to 8 MB.")
    import uuid

    image_id = str(uuid.uuid4())
    directory = settings.data_dir / "uploads"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{image_id}{extension}").write_bytes(data)
    (directory / f"{image_id}.json").write_text(
        '{"note":"Reference only. Dimensions are not inferred from this image."}',
        encoding="utf-8",
    )
    return {
        "id": image_id,
        "message": "Image stored as context. Enter exact dimensions; they are not measured from pixels.",
    }


@app.post("/api/v1/ai/interpret")
def interpret_design(body: InterpretRequest) -> dict:
    from drafty_ai.agent import interpret
    from drafty_ai.client import MetaNotConfigured, MetaRequestError

    image_url = _image_data_url(body.reference_image_id) if body.reference_image_id else None
    try:
        return interpret(body.message, image_url, body.model)
    except MetaNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except MetaRequestError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/v1/ai/segment")
def segment_image() -> None:
    raise HTTPException(
        status_code=501,
        detail=(
            "SAM 3.1 is not called in this build. "
            "No segmentation request is sent until an official image endpoint is wired."
        ),
    )


def _public_job(job: dict) -> dict:
    return {
        "id": job["id"],
        "kind": job["kind"],
        "status": job["status"],
        "message": job.get("message"),
        "error": job.get("error"),
        "summary": job.get("summary"),
        "spec": job.get("spec"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "active": job.get("status") in ACTIVE,
    }


def _tail(path: Path, limit: int = 20000) -> str:
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8", errors="replace")
    return text[-limit:]


def _image_data_url(image_id: str) -> str | None:
    if "/" in image_id or "\\" in image_id or ".." in image_id:
        raise HTTPException(status_code=404, detail="Reference image not found.")
    directory = settings.data_dir / "uploads"
    matches = list(directory.glob(f"{image_id}.*")) if directory.exists() else []
    binary = [path for path in matches if path.suffix in UPLOAD_TYPES.values()]
    if not binary:
        raise HTTPException(status_code=404, detail="Reference image not found.")
    import base64

    suffix = binary[0].suffix
    media = {value: key for key, value in UPLOAD_TYPES.items()}[suffix]
    encoded = base64.b64encode(binary[0].read_bytes()).decode("ascii")
    return f"data:{media};base64,{encoded}"


def run() -> None:
    import uvicorn

    uvicorn.run("drafty_api.main:app", host="0.0.0.0", port=8000, reload=False)

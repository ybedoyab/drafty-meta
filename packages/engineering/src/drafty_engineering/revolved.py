"""Revolved-profile presets. Proportions are stored constants; the user supplies the overall size."""

import math

from pydantic import ValidationError

from drafty_engineering.spec import ProfilePoint, RevolvedProfile

# Staunton pawn body as (height / overall height, radius / base radius), bottom to top.
STAUNTON_PAWN_BODY: tuple[tuple[float, float], ...] = (
    (0.000, 1.000),  # underside edge of the base
    (0.050, 1.000),  # base rim
    (0.080, 0.940),  # bevel above the rim
    (0.110, 0.940),
    (0.150, 0.800),  # cove into the foot
    (0.200, 0.640),
    (0.260, 0.540),
    (0.360, 0.450),  # tapered stem
    (0.460, 0.400),
    (0.520, 0.380),
    (0.540, 0.600),  # collar underside
    (0.580, 0.620),  # collar edge
    (0.600, 0.560),
    (0.620, 0.360),  # collar top
    (0.650, 0.330),  # neck under the head
)
# The head is an arc that ends on the axis at the full height.
STAUNTON_PAWN_HEAD_CENTER = 0.82  # head centre height / overall height
STAUNTON_PAWN_HEAD_HALF_HEIGHT = 0.18  # head radius along Z / overall height
STAUNTON_PAWN_HEAD_HALF_WIDTH = 0.64  # head radius across Z / base radius
STAUNTON_PAWN_HEAD_START_DEG = -60.0
STAUNTON_PAWN_HEAD_STEP_DEG = 10.0

PAWN_HEIGHT_LIMITS_M = (0.010, 0.300)
PAWN_ASPECT_LIMITS = (1.2, 3.0)  # overall height / base diameter


def staunton_pawn_points() -> list[tuple[float, float]]:
    """The normalised preset profile, including the head arc."""

    points = list(STAUNTON_PAWN_BODY)
    angle = STAUNTON_PAWN_HEAD_START_DEG
    while angle <= 90.0 + 1e-9:
        radians = math.radians(angle)
        height = STAUNTON_PAWN_HEAD_CENTER + STAUNTON_PAWN_HEAD_HALF_HEIGHT * math.sin(radians)
        radius = 0.0 if angle >= 90.0 - 1e-9 else STAUNTON_PAWN_HEAD_HALF_WIDTH * math.cos(radians)
        points.append((height, radius))
        angle += STAUNTON_PAWN_HEAD_STEP_DEG
    return points


def staunton_pawn_profile(height_m: float, base_diameter_m: float) -> RevolvedProfile:
    """Scale the stored Staunton proportions to the user's height and base diameter."""

    if not (math.isfinite(height_m) and math.isfinite(base_diameter_m)):
        raise ValueError("Height and base diameter must be finite numbers.")
    low, high = PAWN_HEIGHT_LIMITS_M
    if not low <= height_m <= high:
        raise ValueError(f"Pawn height must be between {low * 1000:g} mm and {high * 1000:g} mm.")
    if base_diameter_m <= 0:
        raise ValueError("Base diameter must be positive.")
    aspect = height_m / base_diameter_m
    if not PAWN_ASPECT_LIMITS[0] <= aspect <= PAWN_ASPECT_LIMITS[1]:
        raise ValueError(
            f"Height divided by base diameter is {aspect:.2f}. The Staunton preset accepts "
            f"{PAWN_ASPECT_LIMITS[0]:g} to {PAWN_ASPECT_LIMITS[1]:g}."
        )
    radius = base_diameter_m / 2.0
    return RevolvedProfile(
        name="staunton-pawn",
        points=[ProfilePoint(height_m=h * height_m, radius_m=r * radius) for h, r in staunton_pawn_points()],
    )


def evaluate_revolved(inputs: dict) -> dict:
    """Record what the pawn still needs. This builds a profile, never a mesh or a solve."""

    missing: list[str] = []
    errors: list[str] = []
    if inputs.get("overall_height_m") is None:
        missing.append("overall height")
    if inputs.get("base_diameter_m") is None:
        missing.append("base diameter")
    profile = None
    if not missing:
        try:
            profile = staunton_pawn_profile(float(inputs["overall_height_m"]), float(inputs["base_diameter_m"]))
        except (ValueError, ValidationError) as exc:
            errors.append(_first_error(exc))
    geometry = None
    if profile is not None:
        geometry = {
            "points": len(profile.points),
            "height_m": profile.height_m,
            "max_radius_m": profile.max_radius_m,
            "volume_m3": profile.volume_m3(),
        }
    assumptions = [
        {
            "name": "pawn proportions",
            "statement": "Collar, stem, and head proportions come from the stored Staunton preset. "
            "Only the height and base diameter are yours.",
            "status": "assumed",
            "provenance": "stored preset",
            "source": "stored preset",
        }
    ]
    return {
        "missing": missing,
        "errors": errors,
        "assumptions": assumptions,
        "sources": [],
        "line": None,
        "section": None,
        "beam": None,
        "geometry": geometry,
        "ready_for_3d_simulation": False,
        "ready_for_beam_elements": False,
        "ready_for_cad": profile is not None,
        "reason": (
            "The Staunton pawn profile is built from your height and base diameter. "
            "This part is geometry only: no structural check was run."
            if profile is not None
            else "The pawn is incomplete. No geometry or file was created, and no structural check was run."
        ),
        "verification": [
            "No structural check was run. This part has no loads or solver in Drafty.",
            "The volume is calculated from the profile, not measured from a print.",
        ],
    }


def proposed_geometry_spec(inputs: dict) -> dict | None:
    """The server-built profile for export. Missing or invalid dimensions return None."""

    try:
        profile = staunton_pawn_profile(float(inputs["overall_height_m"]), float(inputs["base_diameter_m"]))
    except (KeyError, TypeError, ValueError, ValidationError):
        return None
    return {
        "kind": "revolved_profile",
        "preset": "staunton_pawn",
        "profile": profile.model_dump(),
        "volume_m3": profile.volume_m3(),
        "exports": ["model.step", "model.stl", "preview.glb"],
    }


def _first_error(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        return str(exc.errors()[0].get("msg", "The profile is invalid.")).removeprefix("Value error, ")
    return str(exc)

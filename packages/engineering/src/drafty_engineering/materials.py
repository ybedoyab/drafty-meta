"""Room-temperature material constants used by the solver.

Values are typical published engineering data, rounded to the precision
engineers actually use. They are not fitted from this repository's results.
"""

from pydantic import BaseModel, ConfigDict, Field


class Material(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    youngs_modulus_pa: float = Field(gt=0)
    poisson_ratio: float = Field(gt=-1, lt=0.5)
    density_kg_m3: float = Field(gt=0)
    yield_strength_pa: float = Field(gt=0)
    source: str


MATERIALS: dict[str, Material] = {
    "steel_s235": Material(
        id="steel_s235",
        name="Structural steel S235",
        youngs_modulus_pa=210e9,
        poisson_ratio=0.30,
        density_kg_m3=7850,
        yield_strength_pa=235e6,
        source="EN 10025 yield; typical carbon-steel E, nu, and density",
    ),
    "aluminum_6061_t6": Material(
        id="aluminum_6061_t6",
        name="Aluminum 6061-T6",
        youngs_modulus_pa=68.9e9,
        poisson_ratio=0.33,
        density_kg_m3=2700,
        yield_strength_pa=276e6,
        source="Typical ASM / MMPDS room-temperature tensile properties",
    ),
    "stainless_316": Material(
        id="stainless_316",
        name="Stainless steel 316",
        youngs_modulus_pa=193e9,
        poisson_ratio=0.30,
        density_kg_m3=8000,
        yield_strength_pa=205e6,
        source="Typical annealed 316 room-temperature properties",
    ),
    "titanium_ti6al4v": Material(
        id="titanium_ti6al4v",
        name="Titanium Ti-6Al-4V",
        youngs_modulus_pa=113.8e9,
        poisson_ratio=0.342,
        density_kg_m3=4430,
        yield_strength_pa=880e6,
        source="Typical annealed Ti-6Al-4V room-temperature properties",
    ),
    "abs": Material(
        id="abs",
        name="ABS polymer",
        youngs_modulus_pa=2.3e9,
        poisson_ratio=0.35,
        density_kg_m3=1040,
        yield_strength_pa=40e6,
        source="Typical injection-molding ABS datasheet values",
    ),
}


def get_material(material_id: str) -> Material:
    try:
        return MATERIALS[material_id]
    except KeyError as exc:
        known = ", ".join(sorted(MATERIALS))
        raise KeyError(f"Unknown material '{material_id}'. Known materials: {known}") from exc

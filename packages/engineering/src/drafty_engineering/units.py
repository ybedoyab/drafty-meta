"""Unit helpers. Internal calculations stay in SI."""

MM_PER_M = 1000.0
MPA_PER_PA = 1e-6


def meters_to_mm(value_m: float) -> float:
    return value_m * MM_PER_M


def mm_to_meters(value_mm: float) -> float:
    return value_mm / MM_PER_M


def pascals_to_mpa(value_pa: float) -> float:
    return value_pa * MPA_PER_PA


def mpa_to_pascals(value_mpa: float) -> float:
    return value_mpa / MPA_PER_PA

"""Modal spawn lookup failures must map to actionable HTTP errors (no paid call)."""

from __future__ import annotations

import sys
import types

import pytest
from fastapi import HTTPException


def test_spawn_remote_geometry_maps_not_found(monkeypatch):
    class NotFoundError(Exception):
        pass

    modal = types.ModuleType("modal")

    class Function:
        @staticmethod
        def from_name(app: str, name: str):
            assert app == "drafty-engineering"
            assert name == "generate_revolved"

            class Bound:
                def spawn(self, profile: dict):
                    raise NotFoundError(
                        "Lookup failed for Function 'generate_revolved' from the "
                        "'drafty-engineering' app: Function 'generate_revolved' not "
                        "found on App 'drafty-engineering' in environment 'main'."
                    )

            return Bound()

    modal.Function = Function
    monkeypatch.setitem(sys.modules, "modal", modal)

    from drafty_api.remote import spawn_remote_geometry

    with pytest.raises(HTTPException) as exc:
        spawn_remote_geometry({"name": "staunton-pawn"})
    assert exc.value.status_code == 502
    assert "generate_revolved" in str(exc.value.detail)
    assert "drafty-engineering" in str(exc.value.detail)

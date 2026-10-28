"""Authentication fail-closed behavior and scenario mirroring."""

import httpx
import pytest
from fastapi.testclient import TestClient

from drafty_api.main import app
from drafty_api.settings import assert_production_auth, settings
from drafty_api.storage import mirror_scenario


def test_production_without_supabase_auth_refuses_to_start(monkeypatch):
    monkeypatch.setenv("DRAFTY_ENV", "production")
    monkeypatch.setattr(settings, "drafty_auth_mode", "disabled")
    with pytest.raises(RuntimeError, match="production"):
        assert_production_auth()


def test_supabase_mode_rejects_a_browser_without_a_token(monkeypatch):
    monkeypatch.setattr(settings, "drafty_auth_mode", "supabase")
    response = TestClient(app).get("/api/v1/scenarios")
    assert response.status_code == 401


def test_scenario_mirror_uses_the_caller_token_not_the_service_role(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "https://example.supabase.co")
    monkeypatch.setattr(settings, "supabase_publishable_key", "publishable-key")
    monkeypatch.setattr(settings, "supabase_secret_key", "secret-key")
    monkeypatch.setattr(settings, "supabase_service_role_key", "service-role-key")
    captured: dict = {}

    class Response:
        def raise_for_status(self) -> None:
            return None

    class Client:
        def __init__(self, *args, **kwargs) -> None:
            del args, kwargs

        def __enter__(self):
            return self

        def __exit__(self, *args) -> bool:
            return False

        def post(self, url, headers, json):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return Response()

    monkeypatch.setattr(httpx, "Client", Client)
    status = mirror_scenario(
        {"id": "11111111-1111-1111-1111-111111111111", "owner_id": "owner-a", "version": 2, "inputs": {}},
        "user-access-token",
    )
    assert status == "mirrored"
    assert captured["headers"]["Authorization"] == "Bearer user-access-token"
    assert captured["headers"]["apikey"] == "publishable-key"
    assert "secret-key" not in str(captured["headers"])
    assert captured["json"]["owner_id"] == "owner-a"

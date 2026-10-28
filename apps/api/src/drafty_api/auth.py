"""Supabase JWT checks. Local development can leave authentication disabled."""

from contextvars import ContextVar

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient

from drafty_api.settings import settings

_jwks: PyJWKClient | None = None
_access_token: ContextVar[str | None] = ContextVar("drafty_access_token", default=None)


def current_access_token() -> str | None:
    return _access_token.get()


def current_owner(request: Request) -> str:
    if settings.drafty_auth_mode != "supabase":
        _access_token.set(None)
        return "local"
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="A Supabase bearer token is required.")
    token = header.split(" ", 1)[1].strip()
    _access_token.set(token)
    try:
        claims = _decode(token)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail="The Supabase token is invalid.") from exc
    subject = str(claims.get("sub") or "")
    if not subject:
        raise HTTPException(status_code=401, detail="The Supabase token has no subject.")
    return subject


def _decode(token: str) -> dict:
    if settings.supabase_jwt_secret.strip():
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    if not settings.supabase_url.strip():
        raise HTTPException(
            status_code=401,
            detail="Supabase auth is enabled but SUPABASE_URL is empty.",
        )
    global _jwks
    if _jwks is None:
        jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        _jwks = PyJWKClient(jwks_url)
    signing_key = _jwks.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["ES256", "RS256"],
        audience="authenticated",
    )

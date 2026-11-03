"""Probe QA env presence without printing secrets."""

from pathlib import Path

from dotenv import dotenv_values

vals = dotenv_values(Path(__file__).resolve().parents[1] / ".env")
keys = [
    "DRAFTY_QA_EMAIL",
    "DRAFTY_QA_PASSWORD",
    "DRAFTY_QA_EMAIL_2",
    "DRAFTY_QA_PASSWORD_2",
    "DRAFTY_QA_RUN_LIVE_MODAL",
    "DRAFTY_QA_RUN_LIVE_META",
    "DRAFTY_QA_RUN_PRODUCTION",
    "DRAFTY_ENV",
    "DRAFTY_AUTH_MODE",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "MODEL_API_KEY",
    "MODAL_TOKEN_ID",
    "MODAL_TOKEN_SECRET",
]
for key in keys:
    value = (vals.get(key) or "").strip()
    if key.endswith(("PASSWORD", "PASSWORD_2", "SECRET_KEY", "API_KEY", "TOKEN_ID", "TOKEN_SECRET")):
        print(f"{key}: set={bool(value)} len={len(value)}")
    elif "EMAIL" in key:
        print(f"{key}: set={bool(value)} looks_email={'@' in value}")
    else:
        print(f"{key}: {value!r}" if value else f"{key}: unset")

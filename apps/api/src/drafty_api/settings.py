"""Process settings. Secrets stay in the environment and are never returned by the API."""

import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[4]


def load_local_env(path: Path | None = None) -> None:
    """Load a .env file without replacing variables already exported by the shell."""

    target = path or (ROOT / ".env")
    if target.exists():
        load_dotenv(target, override=False)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT / ".env") if (ROOT / ".env").exists() else None,
        extra="ignore",
    )

    model_api_key: str = ""
    model_api_base: str = "https://api.meta.ai/v1"
    model_primary: str = "muse-spark-1.3"
    model_reasoning: str = "muse-wonder-1.0"
    model_segmentation: str = "sam-3.1"
    drafty_compute: str = "local"
    modal_token_id: str = ""
    modal_token_secret: str = ""
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_secret_key: str = ""
    supabase_publishable_key: str = ""
    supabase_jwt_secret: str = ""
    drafty_auth_mode: str = "disabled"
    ccx_bin: str = "ccx"
    ccx_docker_image: str = "drafty-ccx"
    drafty_use_docker_ccx: str = "auto"
    drafty_solver_timeout_s: int = 300
    drafty_max_concurrent_jobs: int = 1
    drafty_max_global_jobs: int = 2
    drafty_max_jobs_per_hour: int = 30
    drafty_max_nodes: int = 250_000
    drafty_max_previews_per_hour: int = 30
    drafty_spawn_local: str = "auto"
    drafty_heartbeat_stale_s: int = 45
    drafty_data_dir: str = ""
    frontend_origin: str = "http://localhost:5173"

    @property
    def data_dir(self) -> Path:
        path = Path(self.drafty_data_dir) if self.drafty_data_dir else ROOT / "data"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def meta_configured(self) -> bool:
        return bool(self.model_api_key.strip())

    @property
    def modal_configured(self) -> bool:
        return bool(self.modal_token_id.strip() and self.modal_token_secret.strip())

    @property
    def supabase_secret(self) -> str:
        return self.supabase_secret_key.strip() or self.supabase_service_role_key.strip()

    @property
    def supabase_configured(self) -> bool:
        """Server-side storage writes. The publishable key alone cannot upload artifacts."""

        return bool(self.supabase_url.strip() and self.supabase_secret)

    @property
    def supabase_auth_configured(self) -> bool:
        return bool(self.supabase_url.strip() and self.supabase_publishable_key.strip())


def assert_production_auth() -> None:
    """A public deployment must not boot with authentication disabled."""

    if os.getenv("DRAFTY_ENV", "").strip().lower() != "production":
        return
    if (
        settings.drafty_auth_mode == "supabase"
        and settings.supabase_url.strip()
        and settings.supabase_publishable_key.strip()
    ):
        return
    raise RuntimeError(
        "DRAFTY_ENV=production requires DRAFTY_AUTH_MODE=supabase, SUPABASE_URL, "
        "and SUPABASE_PUBLISHABLE_KEY. The service-role key stays on the server."
    )


load_local_env()
settings = Settings()

"""Environment-driven application settings.

Every limit that guards resources (file size, triangle counts, solver time)
is configurable here so deployments can tune them without code changes.
"""
from __future__ import annotations

import shutil
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="PARTFORGE_", env_file=".env", extra="ignore")

    # Core
    environment: str = "development"  # development | production
    data_dir: Path = Path(__file__).resolve().parent.parent / "data"
    database_url: str = ""  # empty -> sqlite file under data_dir
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Upload limits
    max_upload_bytes: int = 100 * 1024 * 1024
    max_triangles: int = 2_000_000
    allowed_upload_extensions: list[str] = [".stl", ".obj", ".3mf"]

    # Geometry analysis
    thickness_sample_faces: int = 20_000  # ray-cast sample cap for wall-thickness estimation
    overhang_angle_deg: float = 45.0

    # Job execution
    worker_threads: int = 2
    job_quota_per_project: int = 200

    # FEA
    ccx_path: str = "ccx"
    fea_timeout_s: int = 600
    fea_memory_limit_mb: int = 4096
    fea_target_elements: int = 60_000
    fea_max_nodes: int = 400_000
    fea_second_order: bool = True

    # AI providers (all optional; deterministic rules provider always available)
    ai_provider: str = "rules"  # rules | mock | openai | anthropic
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"

    # Demo
    demo_mode_allow_mock_results: bool = True  # only honored when environment != production

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{self.data_dir / 'partforge.sqlite3'}"

    @property
    def ccx_available(self) -> bool:
        return shutil.which(self.ccx_path) is not None

    @property
    def gmsh_available(self) -> bool:
        try:
            import gmsh  # noqa: F401
            return True
        except Exception:
            return False

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()

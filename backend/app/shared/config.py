from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]  # backend/
(BASE_DIR / "_data").mkdir(exist_ok=True)

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_ENV: str = "dev"
    API_PREFIX: str = "/api"
    DATABASE_URL: str = "sqlite:///./_data/dev.db"
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"
    JWT_SECRET: str = "change-me"
    JWT_ALG: str = "HS256"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

settings = Settings()

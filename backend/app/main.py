from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .shared.config import settings
from .standards.router import router as std_router

app = FastAPI(
    title="Bnote:Sync API", version="0.1.0", openapi_url=f"{settings.API_PREFIX}/openapi.json"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get(f"{settings.API_PREFIX}/healthz")
def healthz():
    return {"status": "ok", "app": "Bnote:Sync"}


app.include_router(std_router)

"""
Ripple — FastAPI Application.

Entry point: uvicorn app.main:app --reload
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app import models as _models  # noqa: F401  # Ensure models are registered before create_tables
from app.api.networks import router as networks_router
from app.api.scenarios import router as scenarios_router
from app.api.simulations import router as simulations_router
from app.api.ws import router as ws_router
from app.config import settings
from app.db.neo4j import close_neo4j_driver, verify_neo4j_connection
from app.db.postgres import verify_postgres_connection
from app.db.redis import verify_redis_connection

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema creation is performed by the explicit Alembic migration job. Do
    # not start an API process that can return misleading partial availability.
    service_health = {
        "postgres": verify_postgres_connection(),
        "neo4j": verify_neo4j_connection(),
        "redis": verify_redis_connection(),
    }
    unavailable = [name for name, healthy in service_health.items() if not healthy]
    if unavailable:
        logger.error("startup dependency check failed: %s", ", ".join(unavailable))
        raise RuntimeError(f"required services unavailable: {', '.join(unavailable)}")
    yield
    # Shutdown
    close_neo4j_driver()


app = FastAPI(
    title="Ripple API",
    description="Cascading Failure Simulation Platform",
    version="0.1.0",
    lifespan=lifespan,
    docs_url=None if settings.environment == "production" else "/docs",
    redoc_url=None if settings.environment == "production" else "/redoc",
)

# CORS config
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key"],
)

app.include_router(networks_router, prefix="/api")
app.include_router(simulations_router, prefix="/api")
app.include_router(scenarios_router, prefix="/api")
app.include_router(ws_router, prefix="/api")


@app.get("/health")
def health_check():
    """
    Health check endpoint.

    Returns connectivity status for each backing service.
    """
    postgres_ok = verify_postgres_connection()
    neo4j_ok = verify_neo4j_connection()
    redis_ok = verify_redis_connection()
    healthy = postgres_ok and neo4j_ok and redis_ok

    payload = {
        "status": "ok" if healthy else "degraded",
        "services": {
            "postgres": "ok" if postgres_ok else "unreachable",
            "neo4j": "ok" if neo4j_ok else "unreachable",
            "redis": "ok" if redis_ok else "unreachable",
        },
    }
    if not healthy:
        raise HTTPException(status_code=503, detail=payload)
    return payload

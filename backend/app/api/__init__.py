from fastapi import APIRouter

from . import catalog, design, projects, sim

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(projects.router, tags=["projects & meshes"])
api_router.include_router(catalog.router, tags=["materials & use case"])
api_router.include_router(sim.router, tags=["loads & analysis"])
api_router.include_router(design.router, tags=["recommendations & variants"])

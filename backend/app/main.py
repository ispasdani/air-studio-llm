from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .schemas import GenerateRequest, LoadModelRequest
from .services import ModelService
from .system_info import get_system_info

app = FastAPI(title="Air Studio LLM Mock Backend", version="0.1.0")
service = ModelService()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict:
    return service.health()


@app.get("/system-info")
async def system_info() -> dict:
    return get_system_info()


@app.get("/models")
async def models() -> dict:
    return {"models": service.get_models()}


@app.post("/load-model")
async def load_model(request: LoadModelRequest) -> dict:
    try:
        await service.request_load(request.model_id)
    except ValueError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    return {"status": "loading"}


@app.post("/generate")
async def generate(request: GenerateRequest) -> dict:
    try:
        return await service.generate(request.prompt, len(request.history))
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.post("/unload-model")
async def unload_model() -> dict:
    await service.unload()
    return {"status": "unloaded"}


@app.get("/logs")
async def logs() -> dict:
    return {"logs": service.get_logs()}

from __future__ import annotations

from pydantic import BaseModel, Field


class LoadModelRequest(BaseModel):
    model_id: str = Field(..., min_length=1)


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    history: list[dict] = Field(default_factory=list)

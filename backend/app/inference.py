from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod


class BaseInferenceAdapter(ABC):
    @abstractmethod
    async def load_model(self, model_name: str) -> None:
        raise NotImplementedError

    @abstractmethod
    async def unload_model(self) -> None:
        raise NotImplementedError

    @abstractmethod
    async def generate(self, model_name: str, prompt: str, history_length: int) -> str:
        raise NotImplementedError


class MockInferenceAdapter(BaseInferenceAdapter):
    async def load_model(self, model_name: str) -> None:
        delay = 1.5 if "0.5B" in model_name or "1B" in model_name else 2.2
        await asyncio.sleep(delay)

    async def unload_model(self) -> None:
        await asyncio.sleep(0.3)

    async def generate(self, model_name: str, prompt: str, history_length: int) -> str:
        await asyncio.sleep(0.5)
        prompt_excerpt = prompt.strip().replace("\n", " ")[:140]
        model_style = "calm and concise"

        if "Qwen" in model_name:
            model_style = "practical and direct"
        elif "Llama" in model_name:
            model_style = "friendly and conversational"
        elif "Gemma" in model_name:
            model_style = "helpful and upbeat"
        elif "Mistral" in model_name:
            model_style = "structured and focused"

        return (
            f"{model_name} mock reply:\n\n"
            f"I noticed you asked about \"{prompt_excerpt}\".\n"
            f"I'm answering in a {model_style} style, and this conversation currently has "
            f"{history_length} earlier message(s).\n\n"
            "Phase 1 is using a mocked local inference adapter, so this is simulated output, "
            "but the app flow is ready for a real backend adapter later."
        )

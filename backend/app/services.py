from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .catalog import get_catalog
from .inference import BaseInferenceAdapter, MockInferenceAdapter


@dataclass
class LogEntry:
    timestamp: str
    level: str
    message: str


class ModelService:
    def __init__(self, adapter: BaseInferenceAdapter | None = None) -> None:
        self.adapter = adapter or MockInferenceAdapter()
        self.catalog = get_catalog()
        self.active_model_id: str | None = None
        self.loading_model_id: str | None = None
        self.logs: list[LogEntry] = []
        self._load_thread: threading.Thread | None = None
        self._cancel_load = threading.Event()
        self._lock = threading.Lock()
        self.log("info", "Model service initialized with mock adapter.")

    def log(self, level: str, message: str) -> None:
        self.logs.append(
            LogEntry(
                timestamp=datetime.now(timezone.utc).isoformat(),
                level=level.upper(),
                message=message,
            )
        )
        self.logs = self.logs[-100:]

    def get_models(self) -> list[dict[str, Any]]:
        models: list[dict[str, Any]] = []
        for entry in self.catalog:
            availability = "not_loaded"
            if entry["id"] == self.loading_model_id:
                availability = "loading"
            elif entry["id"] == self.active_model_id:
                availability = "ready"
            models.append({**entry, "availability": availability})
        return models

    def get_model(self, model_id: str) -> dict[str, Any] | None:
        return next((entry for entry in self.catalog if entry["id"] == model_id), None)

    async def request_load(self, model_id: str) -> None:
        with self._lock:
            model = self.get_model(model_id)
            if model is None:
                raise ValueError("Unknown model id.")
            if self.loading_model_id:
                raise RuntimeError("Another model is already loading.")
            if model_id == self.active_model_id:
                self.log("info", f"{model['display_name']} is already ready.")
                return

            self.loading_model_id = model_id
            self.log("info", f"Started loading {model['display_name']}.")
            previous_model_id = self.active_model_id
            self.active_model_id = None
            self._cancel_load = threading.Event()
            self._load_thread = threading.Thread(
                target=self._finish_loading_sync,
                args=(model, previous_model_id, self._cancel_load),
                daemon=True,
            )
            self._load_thread.start()

    def _finish_loading_sync(
        self,
        model: dict[str, Any],
        previous_model_id: str | None,
        cancel_event: threading.Event,
    ) -> None:
        try:
            if previous_model_id:
                previous_model = self.get_model(previous_model_id)
                asyncio.run(self.adapter.unload_model())
                if previous_model:
                    self.log("info", f"Switched away from {previous_model['display_name']}.")
            if cancel_event.is_set():
                self.log("warning", f"Loading cancelled for {model['display_name']}.")
                return
            asyncio.run(self.adapter.load_model(model["display_name"]))
            if cancel_event.is_set():
                self.log("warning", f"Loading cancelled for {model['display_name']}.")
                return
            self.active_model_id = model["id"]
            self.log("info", f"{model['display_name']} is ready.")
        except Exception as error:  # pragma: no cover
            self.log("error", f"Failed to load {model['display_name']}: {error}")
        finally:
            self.loading_model_id = None
            self._load_thread = None

    async def unload(self) -> None:
        with self._lock:
            if self.loading_model_id and self._load_thread:
                self._cancel_load.set()
                self.loading_model_id = None
                self._load_thread = None

            if not self.active_model_id:
                self.log("info", "Unload requested with no active model.")
                return

            active_model = self.get_model(self.active_model_id)
            await self.adapter.unload_model()
            self.log("info", f"Unloaded {active_model['display_name']}.")
            self.active_model_id = None

    async def generate(self, prompt: str, history_length: int) -> dict[str, str]:
        if not self.active_model_id:
            raise RuntimeError("No model is currently ready. Load a model before chatting.")

        model = self.get_model(self.active_model_id)
        if model is None:
            raise RuntimeError("The active model could not be found.")

        reply = await self.adapter.generate(model["display_name"], prompt, history_length)
        self.log("info", f"Generated mock reply with {model['display_name']}.")
        return {
            "model_id": model["id"],
            "model_name": model["display_name"],
            "reply": reply,
        }

    def health(self) -> dict[str, Any]:
        active_model = self.get_model(self.active_model_id) if self.active_model_id else None
        return {
            "ok": True,
            "backend": "mock-fastapi",
            "active_model_id": self.active_model_id,
            "active_model_name": active_model["display_name"] if active_model else None,
        }

    def get_logs(self) -> list[dict[str, str]]:
        return [entry.__dict__ for entry in self.logs]

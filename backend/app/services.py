from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .adapter_factory import (
    get_airllm_runtime_check,
    get_preferred_adapter_mode,
    resolve_adapter_for_model,
)
from .airllm_adapter import AirLLMAdapter
from .catalog import get_catalog
from .inference import BaseInferenceAdapter, MockInferenceAdapter


@dataclass
class LogEntry:
    timestamp: str
    level: str
    message: str


class ModelService:
    def __init__(self, adapter: BaseInferenceAdapter | None = None) -> None:
        self.mock_adapter = adapter or MockInferenceAdapter()
        self.airllm_adapter = AirLLMAdapter()
        self.catalog = get_catalog()
        self.active_model_id: str | None = None
        self.active_adapter_name: str | None = None
        self.loading_model_id: str | None = None
        self.loading_adapter_name: str | None = None
        self.logs: list[LogEntry] = []
        self._load_thread: threading.Thread | None = None
        self._cancel_load = threading.Event()
        self._lock = threading.Lock()
        self.preferred_mode = get_preferred_adapter_mode()
        self.airllm_runtime = get_airllm_runtime_check()
        self.log("info", f"Preferred inference mode: {self.preferred_mode}.")
        if self.airllm_runtime.available:
            self.log("info", "AirLLM runtime check passed.")
        else:
            self.log("warning", self.airllm_runtime.detail)

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
            resolution = resolve_adapter_for_model(entry, self.preferred_mode, self.airllm_runtime)
            models.append(
                {
                    **entry,
                    "availability": availability,
                    "resolved_adapter": (
                        self.loading_adapter_name
                        if entry["id"] == self.loading_model_id and self.loading_adapter_name
                        else self.active_adapter_name
                        if entry["id"] == self.active_model_id and self.active_adapter_name
                        else resolution.adapter_name
                    ),
                    "resolved_adapter_reason": resolution.reason,
                    "load_disabled": resolution.blocked,
                    "setup_required": (
                        resolution.adapter_name != "airllm"
                        and entry.get("compatibility") in {"supported", "experimental"}
                        and not self.airllm_runtime.available
                    ),
                    "setup_hint": self._build_setup_hint(entry, resolution),
                }
            )
        return models

    def get_model(self, model_id: str) -> dict[str, Any] | None:
        return next((entry for entry in self.catalog if entry["id"] == model_id), None)

    async def request_load(self, model_id: str) -> None:
        with self._lock:
            model = self.get_model(model_id)
            if model is None:
                raise ValueError("Unknown model id.")
            resolution = resolve_adapter_for_model(model, self.preferred_mode, self.airllm_runtime)
            if self.loading_model_id:
                raise RuntimeError("Another model is already loading.")
            if model_id == self.active_model_id:
                self.log("info", f"{model['display_name']} is already ready.")
                return
            if resolution.blocked:
                raise RuntimeError(resolution.reason)

            self.loading_model_id = model_id
            self.loading_adapter_name = resolution.adapter_name
            self.log("info", f"Started loading {model['display_name']}.")
            previous_model_id = self.active_model_id
            previous_adapter_name = self.active_adapter_name
            self.active_model_id = None
            self.active_adapter_name = None
            self._cancel_load = threading.Event()
            self._load_thread = threading.Thread(
                target=self._finish_loading_sync,
                args=(
                    model,
                    resolution.adapter_name,
                    previous_model_id,
                    previous_adapter_name,
                    self._cancel_load,
                ),
                daemon=True,
            )
            self._load_thread.start()

    def _finish_loading_sync(
        self,
        model: dict[str, Any],
        adapter_name: str,
        previous_model_id: str | None,
        previous_adapter_name: str | None,
        cancel_event: threading.Event,
    ) -> None:
        try:
            if previous_model_id:
                previous_model = self.get_model(previous_model_id)
                previous_adapter = self._get_adapter(previous_adapter_name)
                asyncio.run(previous_adapter.unload_model())
                if previous_model:
                    self.log("info", f"Switched away from {previous_model['display_name']}.")
            if cancel_event.is_set():
                self.log("warning", f"Loading cancelled for {model['display_name']}.")
                return
            adapter = self._get_adapter(adapter_name)
            asyncio.run(adapter.load_model(model))
            if cancel_event.is_set():
                self.log("warning", f"Loading cancelled for {model['display_name']}.")
                return
            self.active_model_id = model["id"]
            self.active_adapter_name = adapter_name
            self.log("info", f"{model['display_name']} is ready with {adapter_name}.")
        except Exception as error:  # pragma: no cover
            self.log("error", f"Failed to load {model['display_name']}: {error}")
        finally:
            self.loading_model_id = None
            self.loading_adapter_name = None
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
            active_adapter = self._get_adapter(self.active_adapter_name)
            await active_adapter.unload_model()
            self.log("info", f"Unloaded {active_model['display_name']} from {self.active_adapter_name}.")
            self.active_model_id = None
            self.active_adapter_name = None

    async def generate(self, prompt: str, history: list[dict[str, Any]]) -> dict[str, str]:
        if not self.active_model_id:
            raise RuntimeError("No model is currently ready. Load a model before chatting.")

        model = self.get_model(self.active_model_id)
        if model is None:
            raise RuntimeError("The active model could not be found.")

        active_adapter = self._get_adapter(self.active_adapter_name)
        reply = await active_adapter.generate(model, prompt, history)
        self.log("info", f"Generated reply with {model['display_name']} via {self.active_adapter_name}.")
        return {
            "model_id": model["id"],
            "model_name": model["display_name"],
            "reply": reply,
            "adapter": self.active_adapter_name or "mock",
        }

    def health(self) -> dict[str, Any]:
        active_model = self.get_model(self.active_model_id) if self.active_model_id else None
        return {
            "ok": True,
            "backend": "air-studio-fastapi",
            "active_model_id": self.active_model_id,
            "active_model_name": active_model["display_name"] if active_model else None,
            "active_adapter": self.active_adapter_name,
            "preferred_adapter": self.preferred_mode,
            "airllm_available": self.airllm_runtime.available,
            "airllm_status": self.airllm_runtime.detail,
            "airllm_versions": self.airllm_runtime.versions,
            "airllm_setup_hint": self._build_global_setup_hint(),
        }

    def get_logs(self) -> list[dict[str, str]]:
        return [entry.__dict__ for entry in self.logs]

    def _get_adapter(self, adapter_name: str | None) -> BaseInferenceAdapter:
        if adapter_name == "airllm":
            return self.airllm_adapter
        return self.mock_adapter

    def _build_global_setup_hint(self) -> dict[str, Any] | None:
        if self.airllm_runtime.available:
            return None
        return {
            "title": "AirLLM setup needed",
            "summary": self.airllm_runtime.detail,
            "install_commands": self.airllm_runtime.install_commands,
            "restart_command": self.airllm_runtime.restart_command,
        }

    def _build_setup_hint(self, model: dict[str, Any], resolution: Any) -> dict[str, Any] | None:
        compatibility = model.get("compatibility")
        if compatibility not in {"supported", "experimental"}:
            return None
        if resolution.adapter_name == "airllm" and self.airllm_runtime.available:
            return None

        mode_note = (
            "This model will stay on the mock path until AirLLM is fixed."
            if self.preferred_mode == "auto"
            else "This model cannot load until AirLLM is fixed."
        )
        return {
            "title": "AirLLM setup needed",
            "summary": self.airllm_runtime.detail,
            "mode_note": mode_note,
            "install_commands": self.airllm_runtime.install_commands,
            "restart_command": self.airllm_runtime.restart_command,
        }

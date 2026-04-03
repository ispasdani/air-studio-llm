from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from .airllm_adapter import SUPPORTED_AIRLLM_COMPATIBILITY, AirLLMRuntimeCheck, check_airllm_runtime


AdapterMode = str


@dataclass
class AdapterResolution:
    adapter_name: str
    reason: str
    blocked: bool = False


def get_preferred_adapter_mode() -> AdapterMode:
    raw_value = os.getenv("AIR_STUDIO_INFERENCE_MODE", "auto").strip().lower()
    if raw_value in {"auto", "mock", "airllm"}:
        return raw_value
    return "auto"


def get_airllm_runtime_check() -> AirLLMRuntimeCheck:
    return check_airllm_runtime()


def resolve_adapter_for_model(
    model: dict[str, Any], preferred_mode: AdapterMode, runtime_check: AirLLMRuntimeCheck
) -> AdapterResolution:
    compatibility = model.get("compatibility", "mock_only")

    if preferred_mode == "mock":
        return AdapterResolution(adapter_name="mock", reason="Mock mode is forced by configuration.")

    if compatibility == "unavailable":
        return AdapterResolution(
            adapter_name="unavailable",
            reason=model.get("notes", "This catalog entry is currently unavailable."),
            blocked=True,
        )

    if preferred_mode == "airllm":
        if compatibility not in SUPPORTED_AIRLLM_COMPATIBILITY:
            return AdapterResolution(
                adapter_name="unavailable",
                reason=f"{model['display_name']} is not enabled for AirLLM in this MVP.",
                blocked=True,
            )
        if not runtime_check.available:
            return AdapterResolution(
                adapter_name="unavailable",
                reason=runtime_check.detail,
                blocked=True,
            )
        return AdapterResolution(adapter_name="airllm", reason="AirLLM is forced by configuration.")

    if compatibility in SUPPORTED_AIRLLM_COMPATIBILITY and runtime_check.available:
        return AdapterResolution(adapter_name="airllm", reason="AirLLM is available for this curated model.")

    if compatibility in SUPPORTED_AIRLLM_COMPATIBILITY and not runtime_check.available:
        return AdapterResolution(
            adapter_name="mock",
            reason=f"Using mock mode because AirLLM is unavailable: {runtime_check.detail}",
        )

    return AdapterResolution(
        adapter_name="mock",
        reason=f"{model['display_name']} stays on the mock path in this MVP.",
    )

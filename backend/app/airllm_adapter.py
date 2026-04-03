from __future__ import annotations

import gc
import importlib.metadata
from dataclasses import dataclass
from typing import Any


SUPPORTED_AIRLLM_COMPATIBILITY = {"supported", "experimental"}


@dataclass
class AirLLMRuntimeCheck:
    available: bool
    detail: str
    versions: dict[str, str]
    install_commands: list[str]
    restart_command: str


def _package_version(package_name: str) -> str | None:
    try:
        return importlib.metadata.version(package_name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _build_versions() -> dict[str, str]:
    versions = {}
    for package_name in ("airllm", "torch", "transformers", "optimum"):
        version = _package_version(package_name)
        if version:
            versions[package_name] = version
    return versions


def check_airllm_runtime() -> AirLLMRuntimeCheck:
    versions = _build_versions()
    install_commands = [
        "cd C:\\Users\\Dan\\Documents\\air-studio-llm\\backend",
        'python -m pip install --upgrade --force-reinstall "optimum<2" "transformers<4.49"',
    ]
    restart_command = '$env:AIR_STUDIO_INFERENCE_MODE="airllm"; npm run dev'

    try:
        from airllm import AutoModel  # noqa: F401
    except ModuleNotFoundError as error:
        missing_name = getattr(error, "name", "") or "a required dependency"
        if missing_name == "airllm":
            detail = "AirLLM is not installed. Install the optional AirLLM dependencies to enable real local inference."
        elif missing_name == "optimum.bettertransformer":
            detail = (
                "AirLLM is installed, but the local Optimum/Transformers stack is incompatible. "
                "Try `optimum<2` and `transformers<4.49` for AirLLM mode."
            )
        else:
            detail = f"AirLLM could not start because `{missing_name}` is missing."
        return AirLLMRuntimeCheck(
            available=False,
            detail=detail,
            versions=versions,
            install_commands=install_commands,
            restart_command=restart_command,
        )
    except Exception as error:  # pragma: no cover - defensive import guard
        return AirLLMRuntimeCheck(
            available=False,
            detail=f"AirLLM import failed: {type(error).__name__}: {error}",
            versions=versions,
            install_commands=install_commands,
            restart_command=restart_command,
        )

    return AirLLMRuntimeCheck(
        available=True,
        detail="AirLLM import check passed.",
        versions=versions,
        install_commands=install_commands,
        restart_command=restart_command,
    )


def build_chat_prompt(history: list[dict[str, Any]], prompt: str) -> str:
    lines: list[str] = [
        "You are a helpful local assistant inside a desktop chat app.",
        "",
    ]

    for message in history[-6:]:
        role = str(message.get("role", "user")).strip().lower()
        content = str(message.get("content", "")).strip()
        if not content:
            continue
        label = "User" if role == "user" else "Assistant"
        lines.append(f"{label}: {content}")

    lines.append(f"User: {prompt.strip()}")
    lines.append("Assistant:")
    return "\n".join(lines)


class AirLLMAdapter:
    def __init__(self) -> None:
        self.model: Any | None = None
        self.current_model_id: str | None = None

    async def load_model(self, model_config: dict[str, Any]) -> None:
        runtime = check_airllm_runtime()
        if not runtime.available:
            raise RuntimeError(runtime.detail)

        if model_config.get("compatibility") not in SUPPORTED_AIRLLM_COMPATIBILITY:
            raise RuntimeError(
                f"{model_config['display_name']} is not enabled for AirLLM in this MVP."
            )

        settings = model_config.get("backend_settings", {})
        repo_id = settings.get("airllm_repo_id")
        if not repo_id:
            raise RuntimeError(
                f"{model_config['display_name']} is missing an AirLLM repo id in the curated catalog."
            )

        try:
            from airllm import AutoModel
        except Exception as error:  # pragma: no cover - guarded above but kept local
            raise RuntimeError(f"AirLLM import failed while loading the model: {error}") from error

        try:
            self.model = AutoModel.from_pretrained(repo_id)
            self.current_model_id = model_config["id"]
        except Exception as error:
            raise RuntimeError(_friendly_airllm_error("load", error)) from error

    async def unload_model(self) -> None:
        self.model = None
        self.current_model_id = None
        gc.collect()

        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    async def generate(
        self,
        model_config: dict[str, Any],
        prompt: str,
        history: list[dict[str, Any]],
    ) -> str:
        if self.model is None or self.current_model_id != model_config["id"]:
            raise RuntimeError("AirLLM model is not ready yet. Please load the model first.")

        settings = model_config.get("backend_settings", {})
        generation_defaults = settings.get("generation", {})
        max_new_tokens = int(generation_defaults.get("max_new_tokens", 192))
        temperature = float(generation_defaults.get("temperature", 0.7))
        prompt_text = build_chat_prompt(history, prompt)

        try:
            import torch

            input_tokens = self.model.tokenizer(
                [prompt_text],
                return_tensors="pt",
                return_attention_mask=False,
                truncation=True,
                max_length=2048,
                padding=False,
            )

            input_ids = input_tokens["input_ids"]
            if hasattr(input_ids, "cuda") and torch.cuda.is_available():
                input_ids = input_ids.cuda()

            generation_output = self.model.generate(
                input_ids,
                max_new_tokens=max_new_tokens,
                use_cache=True,
                return_dict_in_generate=True,
                do_sample=temperature > 0,
                temperature=temperature,
            )

            decoded = self.model.tokenizer.decode(
                generation_output.sequences[0], skip_special_tokens=True
            )
            if "Assistant:" in decoded:
                return decoded.rsplit("Assistant:", 1)[-1].strip() or decoded.strip()
            return decoded.strip()
        except Exception as error:
            raise RuntimeError(_friendly_airllm_error("generate", error)) from error


def _friendly_airllm_error(action: str, error: Exception) -> str:
    raw = str(error).strip() or type(error).__name__
    normalized = raw.lower()

    if "out of memory" in normalized or "oom" in normalized:
        return (
            f"AirLLM {action} failed, likely because the model did not fit in available memory. "
            "Try a smaller curated model."
        )
    if "repository not found" in normalized or "401" in normalized or "403" in normalized:
        return (
            f"AirLLM {action} failed because the model repository could not be accessed. "
            "This may require Hugging Face access that this MVP does not configure."
        )
    if "config" in normalized and "missing" in normalized:
        return f"AirLLM {action} failed because the selected model configuration is incomplete."
    return f"AirLLM {action} failed: {raw}"

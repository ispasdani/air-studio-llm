from __future__ import annotations

import os
import platform

import psutil


def _format_ram(total_bytes: int) -> str:
    gib = total_bytes / (1024 ** 3)
    return f"{gib:.1f} GB"


def get_system_info() -> dict[str, str]:
    cpu_name = platform.processor() or os.environ.get("PROCESSOR_IDENTIFIER", "Unknown CPU")
    return {
        "os": f"{platform.system()} {platform.release()}",
        "python_version": platform.python_version(),
        "cpu_name": cpu_name,
        "total_ram": _format_ram(psutil.virtual_memory().total),
        "gpu": "Unknown",
        "vram": "Unknown",
    }

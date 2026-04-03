from __future__ import annotations

import os
import time

os.environ.setdefault("AIR_STUDIO_INFERENCE_MODE", "mock")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def main() -> None:
    client = TestClient(app)

    print("health:", client.get("/health").status_code)
    print("models:", len(client.get("/models").json()["models"]))
    print("system-info:", client.get("/system-info").status_code)
    print(
        "generate-without-model:",
        client.post("/generate", json={"prompt": "hello", "history": []}).status_code,
    )

    load_response = client.post("/load-model", json={"model_id": "qwen2.5-0.5b-instruct"})
    print("load:", load_response.status_code, load_response.json())

    active_name = None
    for _ in range(8):
        time.sleep(0.4)
        models = client.get("/models").json()["models"]
        ready_models = [model for model in models if model["availability"] == "ready"]
        if ready_models:
            active_name = ready_models[0]["display_name"]
            break

    print("active-after-load:", active_name or "none")
    reply = client.post("/generate", json={"prompt": "Say hi", "history": []})
    print("generate-after-load:", reply.status_code)
    if reply.status_code == 200:
        print("reply-adapter:", reply.json()["adapter"])

    unload_response = client.post("/unload-model")
    print("unload:", unload_response.status_code, unload_response.json())


if __name__ == "__main__":
    main()

# Air Studio LLM MVP

Simple local desktop app for picking a curated model, loading it, and chatting locally. The UI stays consumer-friendly while the backend now supports a narrow real AirLLM path plus a safe mock fallback.

## Tech stack

- Electron
- React
- TypeScript
- Python 3.11+
- FastAPI
- Optional AirLLM integration

## Project structure

- `electron/` Electron main process and preload bridge
- `src/` React renderer app
- `backend/app/` FastAPI backend, curated catalog, adapter selection, mock adapter, and AirLLM adapter
- `backend/smoke_check.py` lightweight backend smoke test in mock mode

## Backend dependencies

Core backend dependencies:

- `backend/requirements.txt`
  - `fastapi>=0.115,<0.116`
  - `uvicorn>=0.34,<0.35`
  - `packaging>=24,<26`
  - `psutil>=7.0,<8.0`

Optional AirLLM dependencies:

- `backend/requirements-airllm.txt`
  - `airllm==2.11.0`
  - `optimum<2`
  - `transformers<4.49`
  - `accelerate>=0.30,<1.0`
  - `huggingface-hub>=0.23,<1.0`
  - `safetensors>=0.4,<1.0`
  - `scipy>=1.13,<2.0`
  - `tqdm>=4.66,<5.0`

Important:

- AirLLM also needs a compatible PyTorch install.
- PyTorch install commands vary by OS, CPU/GPU, and CUDA version, so install PyTorch first using the official selector from [pytorch.org](https://pytorch.org/).

## Curated model compatibility

AirLLM supported in this MVP:

- Qwen2.5-3B-Instruct

AirLLM experimental in this MVP:

- Qwen2.5-7B-Instruct
- Qwen2.5-14B-Instruct

Mock-only in this MVP:

- Qwen2.5-0.5B-Instruct
- Qwen2.5-1.5B-Instruct
- Qwen2.5-32B-Instruct
- Llama-3.2-1B-Instruct
- Llama-3.2-3B-Instruct
- Gemma-2-2B-it
- Gemma-2-9B-it
- Gemma-2-27B-it
- Mistral Small 24B Instruct

Notes:

- The catalog still shows every curated entry.
- The app uses the catalog as the main entry point; there is no generic model-id input in the UI.
- In `auto` mode, supported and experimental entries use AirLLM only if the local runtime check passes; otherwise they fall back to mock mode.

## Inference mode selection

Use the environment variable `AIR_STUDIO_INFERENCE_MODE`:

- `auto` (default): use AirLLM when available for supported or experimental curated entries, otherwise use mock
- `mock`: always use mock mode
- `airllm`: require AirLLM for supported or experimental entries and block incompatible ones

## Run locally

1. Install Python 3.11 or newer and make sure `python` is on your PATH.
2. Create and activate a virtual environment in `backend/` if you want isolation.
3. Install backend core dependencies:

```bash
cd backend
python -m pip install -r requirements.txt
```

4. Install desktop dependencies from the project root:

```bash
cd ..
npm install
```

## How to run mock mode

From the project root:

```bash
$env:AIR_STUDIO_INFERENCE_MODE="mock"
npm run dev
```

Mock mode keeps the full load/chat UX working even if AirLLM is missing or incompatible.

## How to run AirLLM mode

1. Install a compatible PyTorch build first.
2. Install AirLLM dependencies:

```bash
cd backend
python -m pip install -r requirements.txt -r requirements-airllm.txt
```

3. Start the desktop app in AirLLM-first mode:

```bash
cd ..
$env:AIR_STUDIO_INFERENCE_MODE="airllm"
npm run dev
```

For a softer rollout that falls back to mock when AirLLM is unavailable:

```bash
$env:AIR_STUDIO_INFERENCE_MODE="auto"
npm run dev
```

## Smoke check

Run a quick backend verification in mock mode:

```bash
cd backend
python smoke_check.py
```

## Development notes

- The Electron main process starts `python -m uvicorn app.main:app --host 127.0.0.1 --port 8008`.
- The backend keeps all state in memory.
- Only one model can be active at a time.
- AirLLM-specific imports are isolated to `backend/app/airllm_adapter.py`.
- The backend reports startup/runtime status through `/health` and per-model adapter resolution through `/models`.

## Troubleshooting

AirLLM unavailable with `optimum.bettertransformer` error:

- This usually means the local Optimum/Transformers stack is too new for AirLLM.
- Try reinstalling with:

```bash
python -m pip install -r requirements.txt -r requirements-airllm.txt --upgrade --force-reinstall
```

Model load fails with repository access errors:

- Some model families may require Hugging Face acceptance or authentication.
- This MVP does not add Hugging Face auth flows, so those entries stay on the mock path unless explicitly supported later.

Model load or generation fails with out-of-memory errors:

- Try a smaller curated Qwen entry first.
- Close other GPU-heavy apps.
- Use mock mode if you only want to validate the desktop flow.

AirLLM mode blocks a model you can still see in the catalog:

- That is expected for `mock_only` entries when `AIR_STUDIO_INFERENCE_MODE=airllm`.
- Use `auto` or `mock` if you want those curated entries to remain usable in the MVP.

AirLLM load fails saying `model.safetensors.index.json should exist`:

- That model repo likely uses a single safetensors file instead of the sharded layout the current AirLLM path expects.
- In this MVP, prefer `Qwen2.5-3B-Instruct` first, then try `Qwen2.5-7B-Instruct` or `Qwen2.5-14B-Instruct` if your machine has enough memory.

## Known limitations

- Real AirLLM support is intentionally narrow in this release.
- Only a subset of the curated catalog is marked `supported` or `experimental`.
- No chat persistence or saved model state.
- No download manager, auth flow, or advanced settings UI.
- GPU and VRAM are still reported as `Unknown`.
- Prompt formatting is intentionally simple and not model-specific beyond curated defaults.

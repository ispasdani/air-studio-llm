export type BackendState = {
  status: "starting" | "ready" | "error" | "stopped";
  detail: string;
};

export type SetupHint = {
  title: string;
  summary: string;
  mode_note?: string;
  install_commands: string[];
  restart_command: string;
};

export type ModelAvailability = "not_loaded" | "loading" | "ready";
export type ModelCompatibility = "supported" | "experimental" | "unavailable" | "mock_only";
export type AdapterName = "airllm" | "mock" | "unavailable";

export type ModelEntry = {
  id: string;
  display_name: string;
  family: string;
  size_label: string;
  parameter_size: string;
  task_type: string;
  description: string;
  chat_suitability: string;
  hardware_hint: string;
  size_tier: string;
  compatibility: ModelCompatibility;
  notes: string;
  low_memory_recommended: boolean;
  resolved_adapter: AdapterName;
  resolved_adapter_reason: string;
  load_disabled: boolean;
  setup_required: boolean;
  setup_hint: SetupHint | null;
  availability: ModelAvailability;
};

export type HealthResponse = {
  ok: boolean;
  active_model_id: string | null;
  active_model_name: string | null;
  active_adapter: AdapterName | null;
  preferred_adapter: "auto" | "mock" | "airllm";
  airllm_available: boolean;
  airllm_status: string;
  airllm_versions: Record<string, string>;
  airllm_setup_hint: SetupHint | null;
  backend: string;
};

export type SystemInfo = {
  os: string;
  python_version: string;
  cpu_name: string;
  total_ram: string;
  gpu: string;
  vram: string;
};

export type LogEntry = {
  timestamp: string;
  level: string;
  message: string;
};

export type GenerateResponse = {
  model_id: string;
  model_name: string;
  adapter: AdapterName;
  reply: string;
};

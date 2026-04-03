export type ModelAvailability = "not_loaded" | "loading" | "ready";

export type ModelEntry = {
  id: string;
  display_name: string;
  family: string;
  size_label: string;
  description: string;
  chat_suitability: string;
  hardware_hint: string;
  size_tier: string;
  availability: ModelAvailability;
};

export type HealthResponse = {
  ok: boolean;
  active_model_id: string | null;
  active_model_name: string | null;
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
  reply: string;
};

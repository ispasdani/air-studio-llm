import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { BackendState, GenerateResponse, HealthResponse, LogEntry, ModelEntry, SystemInfo } from "./types";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const POLL_MS = 1500;

function formatStatusLabel(status: string) {
  return status.split("_").join(" ");
}

function formatCompatibilityLabel(status: string) {
  return status === "mock_only" ? "mock only" : formatStatusLabel(status);
}

export default function App() {
  const [backendUrl, setBackendUrl] = useState("http://127.0.0.1:8008");
  const [backendState, setBackendState] = useState<BackendState>({
    status: "starting",
    detail: "Waiting for Electron..."
  });
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loadPending, setLoadPending] = useState(false);
  const [sendPending, setSendPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    window.desktopApi
      .getAppInfo()
      .then((info) => {
        if (!mounted) {
          return;
        }
        setBackendUrl(info.backendUrl);
        setBackendState(info.backendState);
      })
      .catch(() => {
        if (mounted) {
          setBackendState({
            status: "error",
            detail: "Unable to read Electron app state."
          });
        }
      });

    const unsubscribe = window.desktopApi.onBackendState((state) => {
      setBackendState(state);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (backendState.status === "error" || backendState.status === "stopped") {
      return;
    }

    let active = true;

    const fetchAll = async () => {
      try {
        const [healthResponse, modelsResponse, systemResponse, logsResponse] = await Promise.all([
          fetch(`${backendUrl}/health`),
          fetch(`${backendUrl}/models`),
          fetch(`${backendUrl}/system-info`),
          fetch(`${backendUrl}/logs`)
        ]);

        if (!active) {
          return;
        }

        if (!healthResponse.ok || !modelsResponse.ok || !systemResponse.ok || !logsResponse.ok) {
          throw new Error("Backend API unavailable");
        }

        const nextHealth = (await healthResponse.json()) as HealthResponse;
        const nextModels = ((await modelsResponse.json()) as { models: ModelEntry[] }).models;
        const nextSystem = (await systemResponse.json()) as SystemInfo;
        const nextLogs = ((await logsResponse.json()) as { logs: LogEntry[] }).logs;

        setHealth(nextHealth);
        setModels(nextModels);
        setSystemInfo(nextSystem);
        setLogs(nextLogs.slice(-10));
        setErrorMessage("");

        setSelectedModelId((current) => {
          if (current && nextModels.some((model) => model.id === current)) {
            return current;
          }
          return nextModels[0]?.id ?? "";
        });

        setBackendState((current) =>
          current.status === "error"
            ? current
            : {
                status: "ready",
                detail: nextHealth.active_model_name
                  ? `${nextHealth.active_model_name} ready`
                  : "Backend connected"
              }
        );
      } catch {
        if (!active) {
          return;
        }
        setHealth(null);
        setModels([]);
        setSystemInfo(null);
        setLogs([]);
        setBackendState((current) =>
          current.status === "error"
            ? current
            : {
                status: "starting",
                detail: "Waiting for backend API..."
              }
        );
      }
    };

    void fetchAll();
    const timer = window.setInterval(() => {
      void fetchAll();
    }, POLL_MS);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [backendState.status, backendUrl]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId]
  );

  const activeModel = useMemo(
    () => models.find((model) => model.availability === "ready") ?? null,
    [models]
  );

  const activeAdapter = health?.active_adapter ?? activeModel?.resolved_adapter ?? null;

  const groupedModels = useMemo(() => {
    return models.reduce<Record<string, ModelEntry[]>>((groups, model) => {
      if (!groups[model.size_tier]) {
        groups[model.size_tier] = [];
      }
      groups[model.size_tier].push(model);
      return groups;
    }, {});
  }, [models]);

  const chatDisabled = !activeModel || sendPending || loadPending;
  const setupHint = selectedModel?.setup_hint ?? health?.airllm_setup_hint ?? null;

  async function handleLoadModel() {
    if (!selectedModel) {
      return;
    }
    setLoadPending(true);
    setErrorMessage("");

    try {
      const response = await fetch(`${backendUrl}/load-model`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model_id: selectedModel.id })
      });
      const payload = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail ?? "Unable to load model.");
      }
      setMessages([]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to load model.");
    } finally {
      setLoadPending(false);
    }
  }

  async function handleUnloadModel() {
    setLoadPending(true);
    setErrorMessage("");

    try {
      const response = await fetch(`${backendUrl}/unload-model`, {
        method: "POST"
      });
      const payload = (await response.json()) as { detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail ?? "Unable to unload model.");
      }
      setMessages([]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to unload model.");
    } finally {
      setLoadPending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = inputValue.trim();
    if (!trimmed || !activeModel) {
      return;
    }

    const nextMessages = [
      ...messages,
      {
        id: `${Date.now()}-user`,
        role: "user" as const,
        content: trimmed
      }
    ];

    setMessages(nextMessages);
    setInputValue("");
    setSendPending(true);
    setErrorMessage("");

    try {
      const response = await fetch(`${backendUrl}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: trimmed,
          history: nextMessages
        })
      });

      const payload = (await response.json()) as GenerateResponse & { detail?: string };
      if (!response.ok) {
        throw new Error(payload.detail ?? "Generation failed.");
      }

      setMessages((current) => [
        ...current,
        {
          id: `${Date.now()}-assistant`,
          role: "assistant",
          content: payload.reply
        }
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      setSendPending(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Local desktop MVP</p>
          <h1>Air Studio LLM</h1>
        </div>
        <div className={`status-pill status-${backendState.status}`}>
          <span className="status-dot" />
          <div>
            <strong>{backendState.status === "ready" ? "Backend online" : `Backend ${backendState.status}`}</strong>
            <p>{backendState.detail}</p>
          </div>
        </div>
      </header>

      <main className="layout">
        <aside className="catalog-panel card">
          <div className="section-head">
            <div>
              <h2>Model catalog</h2>
              <p>Curated options grouped by approximate size.</p>
            </div>
          </div>

          <div className="catalog-groups">
            {Object.entries(groupedModels).map(([groupName, groupModels]) => (
              <section key={groupName} className="catalog-group">
                <h3>{groupName}</h3>
                <div className="catalog-list">
                  {groupModels.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      className={`catalog-item ${selectedModelId === model.id ? "selected" : ""}`}
                      onClick={() => setSelectedModelId(model.id)}
                    >
                      <div className="catalog-item-row">
                        <strong>{model.display_name}</strong>
                        <span className={`availability availability-${model.availability}`}>
                          {formatStatusLabel(model.availability)}
                        </span>
                      </div>
                      <p>{model.description}</p>
                      <div className="catalog-meta">
                        <span>{model.family}</span>
                        <span>{model.size_label}</span>
                        <span>{model.chat_suitability}</span>
                        <span className={`tag-compatibility tag-${model.compatibility}`}>
                          {formatCompatibilityLabel(model.compatibility)}
                        </span>
                        <span className={`tag-adapter tag-${model.resolved_adapter}`}>
                          {model.resolved_adapter === "airllm"
                            ? "AirLLM"
                            : model.resolved_adapter === "mock"
                              ? "Mock"
                              : "Blocked"}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </aside>

        <section className="main-column">
          <div className="details-card card">
            <div className="section-head">
              <div>
                <h2>Selected model</h2>
                <p>Pick one model, load it, then start chatting.</p>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleLoadModel}
                  disabled={
                    !selectedModel ||
                    loadPending ||
                    selectedModel?.availability === "loading" ||
                    selectedModel?.load_disabled
                  }
                >
                  {loadPending ? "Working..." : "Load"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleUnloadModel}
                  disabled={!activeModel || loadPending}
                >
                  Unload
                </button>
              </div>
            </div>

            {selectedModel ? (
              <div className="detail-grid">
                <div>
                  <span className="detail-label">Name</span>
                  <strong>{selectedModel.display_name}</strong>
                </div>
                <div>
                  <span className="detail-label">Family</span>
                  <strong>{selectedModel.family}</strong>
                </div>
                <div>
                  <span className="detail-label">Size</span>
                  <strong>{selectedModel.size_label}</strong>
                </div>
                <div>
                  <span className="detail-label">Task</span>
                  <strong>{selectedModel.task_type}</strong>
                </div>
                <div>
                  <span className="detail-label">Chat fit</span>
                  <strong>{selectedModel.chat_suitability}</strong>
                </div>
                <div>
                  <span className="detail-label">Hardware hint</span>
                  <strong>{selectedModel.hardware_hint}</strong>
                </div>
                <div>
                  <span className="detail-label">Status</span>
                  <strong>{formatStatusLabel(selectedModel.availability)}</strong>
                </div>
                <div>
                  <span className="detail-label">Compatibility</span>
                  <strong>{formatCompatibilityLabel(selectedModel.compatibility)}</strong>
                </div>
                <div>
                  <span className="detail-label">Adapter</span>
                  <strong>
                    {selectedModel.resolved_adapter === "airllm"
                      ? "AirLLM"
                      : selectedModel.resolved_adapter === "mock"
                        ? "Mock"
                        : "Unavailable"}
                  </strong>
                </div>
                <div>
                  <span className="detail-label">Low-memory fit</span>
                  <strong>{selectedModel.low_memory_recommended ? "Recommended" : "No"}</strong>
                </div>
                <div className="detail-span">
                  <span className="detail-label">Summary</span>
                  <p>{selectedModel.description}</p>
                </div>
                <div className="detail-span">
                  <span className="detail-label">Notes</span>
                  <p>{selectedModel.notes}</p>
                </div>
                <div className="detail-span">
                  <span className="detail-label">Load path</span>
                  <p>{selectedModel.resolved_adapter_reason}</p>
                </div>
              </div>
            ) : (
              <p>No model catalog available yet.</p>
            )}

            {health ? (
              <div className="inline-note-block">
                <p className="inline-note">
                  Active model: <strong>{health.active_model_name ?? "None"}</strong>
                </p>
                <p className="inline-note">
                  Adapter in use:{" "}
                  <strong>
                    {activeAdapter ? (activeAdapter === "airllm" ? "AirLLM" : "Mock") : "None"}
                  </strong>
                </p>
                <p className="inline-note">
                  Preferred mode: <strong>{health.preferred_adapter}</strong>
                </p>
                <p className="inline-note">
                  AirLLM runtime: <strong>{health.airllm_available ? "available" : "unavailable"}</strong>
                </p>
                {!health.airllm_available ? <p className="inline-note">{health.airllm_status}</p> : null}
              </div>
            ) : null}

            {selectedModel?.setup_required && setupHint ? (
              <div className="setup-card">
                <strong>{setupHint.title}</strong>
                <p>{setupHint.summary}</p>
                {setupHint.mode_note ? <p>{setupHint.mode_note}</p> : null}
                <div className="setup-command-group">
                  <span className="detail-label">Install commands</span>
                  {setupHint.install_commands.map((command) => (
                    <code key={command} className="setup-command">
                      {command}
                    </code>
                  ))}
                </div>
                <div className="setup-command-group">
                  <span className="detail-label">Restart command</span>
                  <code className="setup-command">{setupHint.restart_command}</code>
                </div>
              </div>
            ) : null}

            {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}
          </div>

          <div className="chat-card card">
            <div className="chat-header">
              <div>
                <h2>Chat</h2>
                <p>
                  {activeModel
                    ? `Ready with ${activeModel.display_name} via ${activeAdapter === "airllm" ? "AirLLM" : "mock"}`
                    : "Load a model to unlock the chat input."}
                </p>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setMessages([])}
                disabled={messages.length === 0}
              >
                Clear conversation
              </button>
            </div>

            <div className="chat-history">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <strong>No messages yet.</strong>
                  <p>
                    {activeAdapter === "airllm"
                      ? "Once the model is ready, replies come from the local AirLLM backend."
                      : "The app is ready to chat with the current mock fallback path."}
                  </p>
                </div>
              ) : (
                messages.map((message) => (
                  <article key={message.id} className={`message message-${message.role}`}>
                    <span className="message-role">{message.role === "user" ? "You" : "Assistant"}</span>
                    <p>{message.content}</p>
                  </article>
                ))
              )}
              <div ref={listEndRef} />
            </div>

            <form className="chat-input-row" onSubmit={handleSubmit}>
              <textarea
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                placeholder={chatDisabled ? "Load a model to start chatting." : "Type a message..."}
                disabled={chatDisabled}
                rows={3}
              />
              <button type="submit" className="primary-button" disabled={chatDisabled || !inputValue.trim()}>
                {sendPending ? "Sending..." : "Send"}
              </button>
            </form>
          </div>
        </section>

        <aside className="side-column">
          <div className="card">
            <div className="section-head">
              <div>
                <h2>System info</h2>
                <p>Simple local machine details.</p>
              </div>
            </div>
            {systemInfo ? (
              <div className="info-list">
                <div>
                  <span>OS</span>
                  <strong>{systemInfo.os}</strong>
                </div>
                <div>
                  <span>Python</span>
                  <strong>{systemInfo.python_version}</strong>
                </div>
                <div>
                  <span>Adapter mode</span>
                  <strong>{health?.preferred_adapter ?? "auto"}</strong>
                </div>
                <div>
                  <span>CPU</span>
                  <strong>{systemInfo.cpu_name}</strong>
                </div>
                <div>
                  <span>RAM</span>
                  <strong>{systemInfo.total_ram}</strong>
                </div>
                <div>
                  <span>GPU</span>
                  <strong>{systemInfo.gpu}</strong>
                </div>
                <div>
                  <span>VRAM</span>
                  <strong>{systemInfo.vram}</strong>
                </div>
              </div>
            ) : (
              <p className="placeholder-text">Waiting for backend system info...</p>
            )}
          </div>

          <div className="card">
            <div className="section-head">
              <div>
                <h2>Logs</h2>
                <p>Recent backend events.</p>
              </div>
            </div>
            <div className="log-list">
              {logs.length === 0 ? (
                <p className="placeholder-text">No logs available yet.</p>
              ) : (
                logs.map((log) => (
                  <div key={`${log.timestamp}-${log.message}`} className="log-entry">
                    <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <strong>{log.level}</strong>
                    <p>{log.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

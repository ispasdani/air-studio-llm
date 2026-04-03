import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";

type BackendState = {
  status: "starting" | "ready" | "error" | "stopped";
  detail: string;
};

const BACKEND_PORT = 8008;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const PROJECT_ROOT = path.resolve(__dirname, "..");

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcessWithoutNullStreams | null = null;
let backendState: BackendState = {
  status: "starting",
  detail: "Backend is starting..."
};
let isQuitting = false;

function getBackendCommand() {
  return {
    command: "python",
    args: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT)]
  };
}

function broadcastBackendState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("backend-state", backendState);
  }
}

function setBackendState(nextState: BackendState) {
  backendState = nextState;
  broadcastBackendState();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#eef2f1",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(PROJECT_ROOT, "dist", "index.html"));
  }
}

function startBackend() {
  const { command, args } = getBackendCommand();
  const backendCwd = path.join(PROJECT_ROOT, "backend");

  setBackendState({
    status: "starting",
    detail: "Starting local Python backend..."
  });

  backendProcess = spawn(command, args, {
    cwd: backendCwd,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1"
    }
  });

  const handleBackendOutput = (chunk: string | Buffer) => {
    const text = chunk.toString().trim();
    if (!text) {
      return;
    }
    if (text.includes("Uvicorn running on")) {
      setBackendState({
        status: "ready",
        detail: `Backend available at ${BACKEND_URL}`
      });
      return;
    }
    if (backendState.status === "starting") {
      setBackendState({
        status: "starting",
        detail: text
      });
    }
    if (/error/i.test(text) || /traceback/i.test(text)) {
      setBackendState({
        status: "error",
        detail: text
      });
    }
  };

  backendProcess.stdout.on("data", handleBackendOutput);
  backendProcess.stderr.on("data", handleBackendOutput);

  backendProcess.on("error", (error) => {
    setBackendState({
      status: "error",
      detail: `Failed to start backend: ${error.message}`
    });
  });

  backendProcess.on("exit", (code, signal) => {
    if (!isQuitting) {
      setBackendState({
        status: "error",
        detail: `Backend stopped unexpectedly (code ${code ?? "?"}, signal ${signal ?? "none"})`
      });
      return;
    }

    setBackendState({
      status: "stopped",
      detail: "Backend stopped"
    });
  });
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) {
    return;
  }
  backendProcess.kill();
}

app.whenReady().then(() => {
  startBackend();
  createWindow();

  ipcMain.handle("app-info", async () => ({
    backendUrl: BACKEND_URL,
    backendState
  }));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
  stopBackend();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

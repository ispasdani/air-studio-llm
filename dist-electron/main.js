"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const BACKEND_PORT = 8008;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const PROJECT_ROOT = node_path_1.default.resolve(__dirname, "..");
let mainWindow = null;
let backendProcess = null;
let backendState = {
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
function setBackendState(nextState) {
    backendState = nextState;
    broadcastBackendState();
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1400,
        height: 920,
        minWidth: 1100,
        minHeight: 760,
        backgroundColor: "#eef2f1",
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
        void mainWindow.loadURL(devServerUrl);
    }
    else {
        void mainWindow.loadFile(node_path_1.default.join(PROJECT_ROOT, "dist", "index.html"));
    }
}
function startBackend() {
    const { command, args } = getBackendCommand();
    const backendCwd = node_path_1.default.join(PROJECT_ROOT, "backend");
    setBackendState({
        status: "starting",
        detail: "Starting local Python backend..."
    });
    backendProcess = (0, node_child_process_1.spawn)(command, args, {
        cwd: backendCwd,
        env: {
            ...process.env,
            PYTHONUNBUFFERED: "1"
        }
    });
    const handleBackendOutput = (chunk) => {
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
electron_1.app.whenReady().then(() => {
    startBackend();
    createWindow();
    electron_1.ipcMain.handle("app-info", async () => ({
        backendUrl: BACKEND_URL,
        backendState
    }));
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on("before-quit", () => {
    isQuitting = true;
    stopBackend();
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});

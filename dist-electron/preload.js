"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("desktopApi", {
    getAppInfo: async () => electron_1.ipcRenderer.invoke("app-info"),
    onBackendState: (callback) => {
        const listener = (_event, state) => callback(state);
        electron_1.ipcRenderer.on("backend-state", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("backend-state", listener);
        };
    }
});

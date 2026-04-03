import { contextBridge, ipcRenderer } from "electron";

type BackendState = {
  status: "starting" | "ready" | "error" | "stopped";
  detail: string;
};

contextBridge.exposeInMainWorld("desktopApi", {
  getAppInfo: async (): Promise<{ backendUrl: string; backendState: BackendState }> =>
    ipcRenderer.invoke("app-info"),
  onBackendState: (callback: (state: BackendState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: BackendState) => callback(state);
    ipcRenderer.on("backend-state", listener);
    return () => {
      ipcRenderer.removeListener("backend-state", listener);
    };
  }
});

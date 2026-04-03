/// <reference types="vite/client" />

type BackendState = {
  status: "starting" | "ready" | "error" | "stopped";
  detail: string;
};

declare global {
  interface Window {
    desktopApi: {
      getAppInfo: () => Promise<{ backendUrl: string; backendState: BackendState }>;
      onBackendState: (callback: (state: BackendState) => void) => () => void;
    };
  }
}

export {};

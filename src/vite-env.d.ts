/// <reference types="vite/client" />

import type { BackendState } from "./types";

declare global {
  interface Window {
    desktopApi: {
      getAppInfo: () => Promise<{ backendUrl: string; backendState: BackendState }>;
      onBackendState: (callback: (state: BackendState) => void) => () => void;
    };
  }
}

export {};

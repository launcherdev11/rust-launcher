/// <reference types="vite/client" />

declare module "@tauri-apps/plugin-updater" {
  export function check(
    options?: unknown,
  ): Promise<{
    version: string;
    date?: string;
    body?: string;
    downloadAndInstall: (
      onEvent?: (event: { event: string; data: any }) => void,
    ) => Promise<void>;
  } | null>;
}


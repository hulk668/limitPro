export {};

declare global {
  interface Window {
    /** Electron preload 暴露的桌面端能力（浏览器中运行时为 undefined） */
    limitProDesktop?: {
      getAppInfo: () => Promise<{
        version: string;
        platform: string;
        mode: string;
        serverUrl: string;
        isPackaged: boolean;
      }>;
      isDesktop: boolean;
    };
  }
}

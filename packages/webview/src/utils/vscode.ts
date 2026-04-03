declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

const fallbackApi: VsCodeApi = {
  postMessage(message) {
    console.log('[launch-composer:webview]', message);
  },
  getState() {
    return undefined;
  },
  setState() {},
};

export const vscode = window.acquireVsCodeApi?.() ?? fallbackApi;

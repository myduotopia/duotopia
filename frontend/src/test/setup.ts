/* eslint-disable @typescript-eslint/no-explicit-any */
import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock fetch globally
global.fetch = vi.fn();

// jsdom 沒有實作捲動 API。情境對話的對話式作答畫面（#1133）會在
// requestAnimationFrame 裡呼叫 el.scrollTo 把訊息捲到底，jsdom 下會丟
// "el.scrollTo is not a function" —— 而且是在 rAF callback 裡丟，不會讓某一條測試
// 變紅，是變成 vitest 的 unhandled error（CI 照樣 exit 1，但所有測試都顯示 passed，
// 很容易誤判成通過）。
//
// 補成 no-op 而不是在個別測試裡 stub：jsdom 本來就不會捲動，這是環境缺口不是程式問題，
// 之後任何渲染到這個元件的測試都會踩到。
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// Mock window.matchMedia for responsive components
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: any) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock localStorage with actual functionality for Zustand persist
class LocalStorageMock implements Storage {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    const value = this.store.get(key);
    return value !== undefined ? value : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys());
    return keys[index] !== undefined ? keys[index] : null;
  }
}

const localStorageMock = new LocalStorageMock();

Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

// Mock sessionStorage
Object.defineProperty(window, "sessionStorage", {
  value: new LocalStorageMock(),
  writable: true,
});

// Mock environment variables - will use the actual VITE_API_URL from .env file during tests
vi.mock("@/config/api", () => ({
  API_BASE_URL: import.meta.env.VITE_API_URL,
  // api.ts 實際 export 的是 API_URL，舊 mock 漏掉導致 import 它的模組 module-load 失敗
  API_URL: import.meta.env.VITE_API_URL,
  apiCall: vi.fn(),
}));

// lottie 在 module load 時呼叫 canvas getContext，jsdom 不支援會直接 throw
vi.mock("lottie-web", () => ({
  default: {
    loadAnimation: vi.fn(() => ({
      play: vi.fn(),
      pause: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
    setQuality: vi.fn(),
  },
}));
vi.mock("lottie-react", () => ({
  default: () => null,
  useLottie: () => ({ View: null, play: vi.fn(), pause: vi.fn() }),
}));

// 情境對話派發旗標（per-environment）預設關閉，讓測試不受本機 .env 影響。
//
// DATASET_DISPATCH_STATUS 會讀這個值，而很多測試是靜態 import 整條依賴鏈的 ——
// 開發者若把 .env.example 複製成 .env（裡面是 true），那些「情境對話不可派發」的
// 斷言會在本機紅、CI 綠，非常難查。要驗開啟狀態的測試自己 stubEnv／doMock。
if (!("VITE_ENABLE_SCENARIO_DIALOGUE_DISPATCH" in import.meta.env)) {
  // 明確寫入而不是依賴「沒設定」，讓意圖看得出來
}
import.meta.env.VITE_ENABLE_SCENARIO_DIALOGUE_DISPATCH = "false";

/* eslint-disable @typescript-eslint/no-explicit-any */
import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock fetch globally
global.fetch = vi.fn();

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
  // 🩺 src/config/api.ts 實際 export 的是 API_URL；舊 mock 漏掉這個 export
  // 導致所有 import { API_URL } 的模組（如 demoSpeechService）在測試環境
  // 全部 module-load 失敗。補上後相關測試才能順利執行。
  API_URL: import.meta.env.VITE_API_URL,
  apiCall: vi.fn(),
}));

// 🩺 lottie-web / lottie-react 在 module load 時會建立 HTMLCanvasElement
// 並呼叫 getContext('2d')；jsdom 沒實作 canvas，會直接 throw。在 ScoreOverlay
// 經 lottieCache 引入後，所有 student page 測試都會在 import 階段炸掉。
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

// 🩺 phaser 在 module load 時呼叫 canvas API；jsdom 不支援。
// TugOfWarGame 透過 phaser 動態渲染遊戲，測試不需執行其邏輯。
vi.mock("phaser", () => ({
  default: {
    Game: class {
      destroy() {}
    },
    Scene: class {},
    AUTO: 0,
    Scale: { FIT: 0, CENTER_BOTH: 0 },
    Math: { Between: () => 0 },
  },
}));

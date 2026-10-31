/**
 * 題庫「上傳題本」的前端開關 — Issue #1112。
 *
 * 這個開關存在的理由和 `ENABLE_SCENARIO_DIALOGUE`（#1039）一樣：功能已經進
 * staging，但人工驗證還沒做完，而這一版 staging→main 的發版要帶上其他東西。
 * 與其擋住整條發版線，改成把 production 的入口關掉。
 *
 * 這組測試釘住的是**方向**：漏設、拼錯、新環境忘了帶 build-arg，都必須落到
 * 「關閉」那一邊。反過來（不是 false 就當開啟）會讓一次打錯字就把未驗證的功能
 * 送上 prod —— `ENABLE_GROUP_BUY` 走的是那個方向，這個刻意不是。
 *
 * 用 `vi.resetModules()` + 動態 import：開關是模組層級常數，必須在每次 import
 * 前換掉環境變數才驗得到兩種狀態。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

async function loadFlagWithEnv(value: string | undefined) {
  vi.resetModules();
  vi.stubEnv("VITE_ENABLE_QUESTION_BANK_EXAM_IMPORT", value);
  const mod = await import("@/config/featureFlags");
  return mod.ENABLE_QUESTION_BANK_EXAM_IMPORT;
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("上傳題本開關：由環境變數決定，未設定＝關閉", () => {
  it("未設定 → 關閉", async () => {
    expect(await loadFlagWithEnv(undefined)).toBe(false);
  });

  it("空字串 → 關閉", async () => {
    expect(await loadFlagWithEnv("")).toBe(false);
  });

  it('值拼錯（"ture"）→ 關閉，不會誤開', async () => {
    expect(await loadFlagWithEnv("ture")).toBe(false);
  });

  it('"false" → 關閉（這一版 prod 走的就是這條）', async () => {
    expect(await loadFlagWithEnv("false")).toBe(false);
  });

  it('"true" → 開啟（staging / develop / per-issue 走的是這條）', async () => {
    expect(await loadFlagWithEnv("true")).toBe(true);
  });

  it('大小寫不敏感："TRUE" 也算開啟', async () => {
    expect(await loadFlagWithEnv("TRUE")).toBe(true);
  });

  it("和情境對話的兩個開關各自獨立，不會互相牽動", async () => {
    // 同一份 deploy-frontend.yml 裡三個開關並排，很容易在複製貼上時接錯來源。
    vi.resetModules();
    vi.stubEnv("VITE_ENABLE_QUESTION_BANK_EXAM_IMPORT", "false");
    vi.stubEnv("VITE_ENABLE_SCENARIO_DIALOGUE", "true");
    vi.stubEnv("VITE_ENABLE_SCENARIO_DIALOGUE_DISPATCH", "true");
    const mod = await import("@/config/featureFlags");
    expect(mod.ENABLE_QUESTION_BANK_EXAM_IMPORT).toBe(false);
    expect(mod.ENABLE_SCENARIO_DIALOGUE).toBe(true);
    expect(mod.ENABLE_SCENARIO_DIALOGUE_DISPATCH).toBe(true);
  });
});

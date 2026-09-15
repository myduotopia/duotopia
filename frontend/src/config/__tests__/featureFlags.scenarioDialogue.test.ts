/**
 * 情境對話的前端開關 — Issue #1039。
 *
 * 這個開關存在的理由不是「功能沒做完」，而是「**還沒被人驗過就已經在 prod 上**」
 * （PR #1038 把 staging 發到 main 並成功部署）。與其 revert 一整條發版線，改成把
 * 前端入口關掉：不動歷史、不動資料庫，日後打開只是翻一個布林值。
 *
 * 兩種狀態都要測 —— 只測關閉會讓「打開之後其實壞掉」在下一次發版才爆出來，
 * 那正是這張單想避免的情況。
 *
 * 用 `vi.resetModules()` + 動態 import 而不是靜態 import：開關是模組層級常數，
 * 必須在每次 import 前換掉 mock 才驗得到兩種狀態。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

async function loadWith(enabled: boolean) {
  vi.resetModules();
  vi.doMock("@/config/featureFlags", () => ({
    ENABLE_SCENARIO_DIALOGUE: enabled,
  }));
  return await import("@/lib/assignableContentType");
}

/** 讓 `import.meta.env.VITE_ENABLE_SCENARIO_DIALOGUE` 變成指定值再載入真的模組。 */
async function loadFlagWithEnv(value: string | undefined) {
  vi.resetModules();
  vi.doUnmock("@/config/featureFlags");
  vi.stubEnv("VITE_ENABLE_SCENARIO_DIALOGUE", value);
  const mod = await import("@/config/featureFlags");
  return mod.ENABLE_SCENARIO_DIALOGUE;
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.doUnmock("@/config/featureFlags");
});

describe("開關關閉時，情境對話不可派發", () => {
  it("isAssignableContentType 對情境對話回 false", async () => {
    const { isAssignableContentType } = await loadWith(false);
    expect(isAssignableContentType("SCENARIO_DIALOGUE")).toBe(false);
  });

  it("點下去給的是「還不能派發」，不是「模式與型別不合」", async () => {
    // 兩句話對老師的意思完全不同：前者是「別等了，先用別的」，後者是
    // 「換個模式就可以」。關閉期間換哪個模式都沒用，必須是前者。
    const { explainNotSelectable } = await loadWith(false);
    expect(
      explainNotSelectable("SCENARIO_DIALOGUE", "scenario_dialogue"),
    ).toEqual({ kind: "not_assignable" });
  });

  it("整課都是情境對話時，不會叫老師去換模式", async () => {
    const { reasonNothingSelectable } = await loadWith(false);
    expect(reasonNothingSelectable(["SCENARIO_DIALOGUE"])).toBe(
      "not_assignable",
    );
  });

  it("例句集與單字集完全不受影響", async () => {
    const { isAssignableContentType } = await loadWith(false);
    expect(isAssignableContentType("EXAMPLE_SENTENCES")).toBe(true);
    expect(isAssignableContentType("VOCABULARY_SET")).toBe(true);
    expect(isAssignableContentType("READING_ASSESSMENT")).toBe(true);
    expect(isAssignableContentType("SENTENCE_MAKING")).toBe(true);
  });
});

/**
 * Issue #1052: 派發可不可以改由 registry 的 DATASET_DISPATCH_STATUS 單一決定。
 * 情境對話仍在開發中，開關打開（staging / develop）也不能派發 —— 開關只管建立教材入口。
 * 這組守的是「flag 不會再從 isAssignableContentType 漏進派發流程」。
 */
describe("開關打開時，派發仍然擋下（開發中由 registry 決定）", () => {
  it("isAssignableContentType 對情境對話回 false", async () => {
    const { isAssignableContentType } = await loadWith(true);
    expect(isAssignableContentType("SCENARIO_DIALOGUE")).toBe(false);
  });

  it("點下去給的仍是「還不能派發」", async () => {
    const { explainNotSelectable } = await loadWith(true);
    expect(
      explainNotSelectable("SCENARIO_DIALOGUE", "scenario_dialogue"),
    ).toEqual({ kind: "not_assignable" });
  });

  it("整課都是情境對話時，不會叫老師去換模式", async () => {
    const { reasonNothingSelectable } = await loadWith(true);
    expect(reasonNothingSelectable(["SCENARIO_DIALOGUE"])).toBe(
      "not_assignable",
    );
  });
});

describe("開關本身：由環境變數決定，未設定＝關閉", () => {
  /**
   * 與 ENABLE_GROUP_BUY 相反（那個是「不是 false 就當開啟」）。
   *
   * 這個開關要防的正是「未驗證的功能出現在 production」，所以漏設、拼錯、新環境忘了
   * 帶，都必須落到**隱藏**這一邊。這幾條就是在釘這個方向不能被改掉。
   */
  it("未設定 → 關閉", async () => {
    expect(await loadFlagWithEnv(undefined)).toBe(false);
  });

  it("空字串 → 關閉", async () => {
    expect(await loadFlagWithEnv("")).toBe(false);
  });

  it('值拼錯（"ture"）→ 關閉，不會誤開', async () => {
    expect(await loadFlagWithEnv("ture")).toBe(false);
  });

  it('"false" → 關閉（prod 走的就是這條）', async () => {
    expect(await loadFlagWithEnv("false")).toBe(false);
  });

  it('"true" → 開啟（staging / develop 走的是這條）', async () => {
    expect(await loadFlagWithEnv("true")).toBe(true);
  });

  it('大小寫不敏感："TRUE" 也算開啟', async () => {
    expect(await loadFlagWithEnv("TRUE")).toBe(true);
  });
});

/**
 * DISPATCH_PREVIEW 完整性護欄。
 *
 * 派發 sheet 右側的「學生畫面預覽」查 `DISPATCH_PREVIEW`，查不到就顯示「此模式預覽
 * 尚未實作」。那段 fallback 是給**真的還沒做**的模式看的，但它同時也會悄悄吃掉
 * 「做了學生端、忘了註冊預覽」的情況 —— 情境對話就是這樣：#1031 已經把學生作答做完
 * 並上了 staging，老師在派發畫面卻只看到一行「尚未實作」。
 *
 * 所以這裡把它反過來當契約：**能從派發對話框派出去的模式，一律要有預覽**。
 * 新增模式時漏註冊會在這裡紅燈，而不是等老師回報。
 *
 * 用 `ASSIGNABLE_MODE_ORDER` 而不是 `listAllDispatchableModes()`：後者會被
 * per-environment 的派發旗標濾掉（測試環境把情境對話關著），用它等於讓護欄在
 * 旗標關閉時失效 —— 正好是這次要擋的那個洞。
 */
import { describe, it, expect } from "vitest";
import { ASSIGNABLE_MODE_ORDER } from "@/lib/practiceMode";
import { DISPATCH_PREVIEW } from "@/lib/activityRegistry";

describe("DISPATCH_PREVIEW — 可派發的模式都要有學生畫面預覽", () => {
  it("每個可派發模式都註冊了預覽（不受環境旗標影響）", () => {
    const missing = ASSIGNABLE_MODE_ORDER.filter(
      (mode) => typeof DISPATCH_PREVIEW[mode] !== "function",
    );
    expect(missing).toEqual([]);
  });

  it("情境對話有預覽（#1031 已有學生作答，派發畫面原本只顯示「尚未實作」）", () => {
    expect(typeof DISPATCH_PREVIEW.scenario_dialogue).toBe("function");
  });

  it("沒有多註冊不在派發清單上的模式（tug_of_war 不經派發對話框）", () => {
    const extra = Object.keys(DISPATCH_PREVIEW).filter(
      (mode) => !ASSIGNABLE_MODE_ORDER.includes(mode as never),
    );
    expect(extra).toEqual([]);
  });
});

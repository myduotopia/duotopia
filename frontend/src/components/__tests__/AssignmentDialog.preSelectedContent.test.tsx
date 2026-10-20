/**
 * 從教材卡帶著內容開啟派發對話框時，內容不可以憑空消失。
 *
 * ## 這支測試在守什麼
 *
 * 夥伴 staging 回報：**班級頁派發情境對話可以成功，教材卡派發會失敗**。
 *
 * 根因是初始狀態互打：對話框開啟時把 `practice_mode` reset 成寫死的
 * `word_selection`，而購物車在同一個 render 就已經裝進預選內容；緊接著「切換模式時
 * 清除不相容項目」的 effect 看到 word 模式，把非單字集的內容整批請出購物車 ——
 * 老師還沒看到任何畫面，內容就已經不見了，而且沒有任何提示。
 *
 * 單字集之所以沒事，純粹因為它剛好是那段清理留下來的那一種；**例句集一樣是壞的**，
 * 只是沒人從教材卡派發過例句集。
 *
 * 班級頁沒事，是因為那條路徑購物車一開始是空的：老師先選模式、再選教材，清理跑的
 * 時候模式已經對了。
 *
 * ## 為什麼要渲染整個對話框
 *
 * 純邏輯（`initialModeForContentTypes` / `isContentTypeUsableForMode`）已經各自有
 * 測試。但這個 bug 不在任何一個函式裡，而在**兩個 effect 的先後順序**上 —— 只有把
 * 元件真的掛起來才看得到。所以這裡只做一件事：掛上去、走到「選擇內容」、確認預選的
 * 教材還在購物車裡。不斷言版面細節，才不會因為改 UI 就碎掉。
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// 情境對話派發在測試環境預設關閉（見 src/test/setup.ts），這支要驗 staging 的狀態
vi.stubEnv("VITE_ENABLE_SCENARIO_DIALOGUE_DISPATCH", "true");
vi.stubEnv("VITE_ENABLE_SCENARIO_DIALOGUE", "true");

// 對話框開啟時會打好幾支清單 API；一律回空陣列即可，這支不驗 API 行為
vi.mock("@/lib/api", () => ({
  apiClient: new Proxy(
    {},
    { get: () => vi.fn().mockResolvedValue([]) },
  ) as unknown as Record<string, unknown>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AssignmentDialog: any;

beforeAll(async () => {
  AssignmentDialog = (await import("@/components/AssignmentDialog"))
    .AssignmentDialog;
});

const CONTENT_TITLE = "測試教材";

const cartItem = (contentType: string) => ({
  contentId: 501,
  programName: "課程",
  lessonName: "單元",
  contentTitle: CONTENT_TITLE,
  contentType,
  itemsCount: 3,
  order: 0,
  hasMissingAudio: false,
  hasMissingExampleAudio: false,
  hasMissingImage: false,
});

async function openAndGoToContentStep(contentType: string) {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <AssignmentDialog
        open
        onClose={() => {}}
        onSuccess={() => {}}
        classroomId={1}
        students={[{ id: 11, name: "小明" }]}
        preSelectedContents={[cartItem(contentType)]}
      />
    </MemoryRouter>,
  );
  await waitFor(() => expect(document.body.textContent).toBeTruthy());
  const next = Array.from(document.querySelectorAll("button")).find((b) =>
    /buttons\.next/.test(b.textContent || ""),
  );
  expect(next, "找不到「下一步」按鈕").toBeTruthy();
  await user.click(next!);
  return (document.body.textContent || "").replace(/\s+/g, " ");
}

describe("帶著預選內容開啟派發對話框", () => {
  it.each([
    ["SCENARIO_DIALOGUE", "情境對話"],
    ["EXAMPLE_SENTENCES", "例句集"],
    ["VOCABULARY_SET", "單字集"],
  ])("%s（%s）的預選教材不會被清掉", async (contentType) => {
    const text = await openAndGoToContentStep(contentType);
    expect(text).toContain(CONTENT_TITLE);
  });
});

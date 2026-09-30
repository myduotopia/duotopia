/**
 * useExtractedGroup（#1084）hook 層測試：
 * - 右側題組已有內容 → 先進 pending；覆蓋確認時以「最新」草稿為底（對話框開著時老師改的
 *   公開設定不會被擷取當下的快照蓋掉）
 * - 沒有題組單元 → toast 錯誤，不靜默
 * sheet 層的 Radix Select 在 jsdom 難以操作，所以「對話框開著時改公開設定」在此以 hook 層驗證。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { MagicPasteGroupResult } from "@/components/shared/MagicPasteInput";

import {
  emptyGroupDraft,
  type GroupDraft,
  type UnitDraft,
} from "../questionDraft";
import { useExtractedGroup } from "../useExtractedGroup";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("../cropImage", () => ({ cropImageFile: vi.fn() }));
vi.mock("../uploadImageFile", () => ({ uploadImageFile: vi.fn() }));

const t = ((k: string) => k) as unknown as Parameters<
  typeof useExtractedGroup
>[0]["t"];

const textResult: MagicPasteGroupResult = {
  title: "Vivaldi",
  stimulus: {
    kind: "text",
    paragraphs: ["Antonio Vivaldi was a violin player."],
    text: "",
    box_2d: null,
    page: null,
  },
  glossary: [],
  questions: [
    {
      stem: "Which is the best title?",
      options: ["A", "B", "C", "D"],
      correct_indexes: [2],
      explanation: "",
    },
  ],
};

const file = new File(["x"], "paper.png", { type: "image/png" });

function groupUnit(draft: GroupDraft): UnitDraft {
  return { kind: "group", draft };
}

describe("useExtractedGroup", () => {
  beforeEach(() => {
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    toastMock.info.mockReset();
  });

  it("空題組直接套用；有內容先 pending，確認時以最新草稿（改過公開）為底", async () => {
    const replaceGroup = vi.fn();
    const withContent: GroupDraft = {
      ...emptyGroupDraft("reading"),
      passage_text: "old",
      passage_text_edited: true,
      visibility: "private",
    };
    let units: UnitDraft[] = [groupUnit(withContent)];
    const { result, rerender } = renderHook(() =>
      useExtractedGroup({ units, replaceGroup, t }),
    );

    let done = false;
    let p!: Promise<void>;
    act(() => {
      p = result.current.onInsertGroup(textResult, file).then(() => {
        done = true;
      });
    });
    expect(result.current.pending?.key).toBe(withContent.key);
    expect(replaceGroup).not.toHaveBeenCalled();
    expect(done).toBe(false);

    // 對話框開著時老師把公開設定改成 public
    units = [groupUnit({ ...withContent, visibility: "public" })];
    rerender();

    await act(async () => {
      await result.current.confirmPending();
    });
    await p;
    expect(done).toBe(true);
    expect(replaceGroup).toHaveBeenCalledTimes(1);
    const [key, next] = replaceGroup.mock.calls[0] as [string, GroupDraft];
    expect(key).toBe(withContent.key);
    expect(next.visibility).toBe("public");
    expect(next.questions[0].visibility).toBe("public");
    expect(next.title).toBe("Vivaldi");
    expect(result.current.pending).toBeNull();
    // 測試用的 t 只回 key（第二個參數被 t 吃掉）
    expect(toastMock.success).toHaveBeenCalledWith(
      "contentEditor.magicPaste.insertedGroup",
    );
  });

  it("取消覆蓋：不套用、Promise 仍 resolve", async () => {
    const replaceGroup = vi.fn();
    const withContent: GroupDraft = {
      ...emptyGroupDraft("reading"),
      passage_text: "old",
      passage_text_edited: true,
    };
    const units: UnitDraft[] = [groupUnit(withContent)];
    const { result } = renderHook(() =>
      useExtractedGroup({ units, replaceGroup, t }),
    );
    let done = false;
    act(() => {
      void result.current.onInsertGroup(textResult, file).then(() => {
        done = true;
      });
    });
    expect(result.current.pending).not.toBeNull();
    await act(async () => {
      result.current.cancelPending();
    });
    expect(replaceGroup).not.toHaveBeenCalled();
    expect(done).toBe(true);
  });

  it("沒有題組單元：toast 錯誤、不靜默丟掉", async () => {
    const replaceGroup = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useExtractedGroup({ units: [], replaceGroup, t }),
    );
    await act(async () => {
      await result.current.onInsertGroup(textResult, file);
    });
    expect(replaceGroup).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalledWith(
      "contentEditor.magicPaste.extractFailed",
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

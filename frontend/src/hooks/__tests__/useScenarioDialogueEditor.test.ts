/**
 * useScenarioDialogueEditor — 四個接線點共用的存檔／開啟邏輯（Issue #1014）。
 *
 * 這支 hook 是把原本只在「我的教材」的接線抽出來給五個地方共用，所以它壞掉是五個
 * 頁面一起壞。測試盯的是三條建立路徑選對端點、program-direct 第二步失敗要回收空殼、
 * 以及失敗時不可以關掉面板（老師剛填的十題不能因為一次網路錯誤消失）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useScenarioDialogueEditor } from "../useScenarioDialogueEditor";
import type { ScenarioSaveInput } from "@/lib/scenarioDialogue";

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => mockToastError(...a),
    success: (...a: unknown[]) => mockToastSuccess(...a),
    info: vi.fn(),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

const createContent = vi.fn();
const createProgramContent = vi.fn();
const updateContent = vi.fn();
const deleteContent = vi.fn();
const getContentDetail = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    createContent: (...a: unknown[]) => createContent(...a),
    createProgramContent: (...a: unknown[]) => createProgramContent(...a),
    updateContent: (...a: unknown[]) => updateContent(...a),
    deleteContent: (...a: unknown[]) => deleteContent(...a),
    getContentDetail: (...a: unknown[]) => getContentDetail(...a),
  },
}));

const saveInput = (): ScenarioSaveInput => ({
  title: "週末活動",
  scenarioContent: "It is Monday morning.",
  scenarioImages: [],
  scenarioMode: "existing",
  questionSource: "manual",
  goal: "",
  articleLevel: "",
  direction: "",
  questionLevel: "B1",
  globalRubric: "",
  globalTense: { time: "past", aspect: "simple" },
  globalVoice: "active",
  translateLanguage: "chinese",
  ttsSettings: { accent: "US", gender: "Female", speed: "Normal x1" },
  rows: [1, 2, 3].map((n) => ({
    id: `r${n}`,
    contentItemId: null,
    question: `Q${n}`,
    translation: "",
    tenseOverride: null,
    voiceOverride: null,
    keywords: [],
    referenceAnswer: "",
    rubricNote: "",
    imagePrompt: "",
    imageUrl: null,
    audioUrl: null,
    revision: 0,
  })),
});

beforeEach(() => {
  vi.clearAllMocks();
  createContent.mockResolvedValue({ id: 1 });
  createProgramContent.mockResolvedValue({ id: 2 });
  updateContent.mockResolvedValue({ id: 2 });
  deleteContent.mockResolvedValue(undefined);
});

describe("存檔的三條路徑", () => {
  it("lesson 底下新增 → 一次帶齊打 createContent", async () => {
    const onSaved = vi.fn();
    const { result } = renderHook(() => useScenarioDialogueEditor({ onSaved }));

    act(() => result.current.openForCreate({ lessonId: 7 }));
    await act(async () => {
      await result.current.save(saveInput());
    });

    expect(createContent).toHaveBeenCalledTimes(1);
    const [lessonId, payload] = createContent.mock.calls[0];
    expect(lessonId).toBe(7);
    expect(payload.type).toBe("SCENARIO_DIALOGUE");
    expect(payload.items).toHaveLength(3);
    expect(payload.scenario_settings.question_level).toBe("B1");
    expect(createProgramContent).not.toHaveBeenCalled();
    // 成功才關面板、才刷新列表
    expect(result.current.isOpen).toBe(false);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("編輯既有內容 → 打 updateContent，不會另外建一份", async () => {
    getContentDetail.mockResolvedValue({
      id: 42,
      title: "舊的",
      scenario_settings: null,
      items: [],
    });
    const { result } = renderHook(() => useScenarioDialogueEditor());

    await act(async () => {
      await result.current.openForEdit(42, { lessonId: 7 });
    });
    await act(async () => {
      await result.current.save(saveInput());
    });

    expect(updateContent).toHaveBeenCalledTimes(1);
    expect(updateContent.mock.calls[0][0]).toBe(42);
    expect(createContent).not.toHaveBeenCalled();
    expect(createProgramContent).not.toHaveBeenCalled();
  });

  it("program-direct 新增 → 先建殼再補 items（#587 端點只吃 type + title）", async () => {
    const { result } = renderHook(() => useScenarioDialogueEditor());

    act(() => result.current.openForCreate({ programId: 9 }));
    await act(async () => {
      await result.current.save(saveInput());
    });

    expect(createProgramContent).toHaveBeenCalledWith(9, {
      type: "SCENARIO_DIALOGUE",
      title: "週末活動",
    });
    expect(updateContent).toHaveBeenCalledTimes(1);
    expect(updateContent.mock.calls[0][0]).toBe(2);
    expect(updateContent.mock.calls[0][1].items).toHaveLength(3);
  });
});

describe("失敗處理", () => {
  it("program-direct 第二步失敗 → 刪掉第一步建出來的空殼再往上拋", async () => {
    updateContent.mockRejectedValue(new Error("boom"));
    const onSaved = vi.fn();
    const { result } = renderHook(() => useScenarioDialogueEditor({ onSaved }));

    act(() => result.current.openForCreate({ programId: 9 }));
    await act(async () => {
      await expect(result.current.save(saveInput())).rejects.toThrow("boom");
    });

    expect(deleteContent).toHaveBeenCalledWith(2);
    // 面板不關、不刷新 —— 老師要能原地重試
    expect(result.current.isOpen).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalled();
  });

  it("回收空殼本身也失敗時，仍然把原本的錯誤往上拋", async () => {
    updateContent.mockRejectedValue(new Error("boom"));
    deleteContent.mockRejectedValue(new Error("delete failed"));
    const { result } = renderHook(() => useScenarioDialogueEditor());

    act(() => result.current.openForCreate({ programId: 9 }));
    await act(async () => {
      await expect(result.current.save(saveInput())).rejects.toThrow("boom");
    });
  });

  it("存檔失敗不關面板，也不會回報成功", async () => {
    createContent.mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useScenarioDialogueEditor());

    act(() => result.current.openForCreate({ lessonId: 7 }));
    await act(async () => {
      await expect(result.current.save(saveInput())).rejects.toThrow("network");
    });

    expect(result.current.isOpen).toBe(true);
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it("沒有任何目標時直接拋錯，不會靜靜地什麼都沒存", async () => {
    const { result } = renderHook(() => useScenarioDialogueEditor());

    act(() => result.current.openForCreate({}));
    await act(async () => {
      await expect(result.current.save(saveInput())).rejects.toThrow();
    });

    expect(createContent).not.toHaveBeenCalled();
    expect(createProgramContent).not.toHaveBeenCalled();
  });

  it("讀取既有內容失敗就不開面板（開了也只是空白卡，存回去會洗掉原本的題目）", async () => {
    getContentDetail.mockRejectedValue(new Error("404"));
    const { result } = renderHook(() => useScenarioDialogueEditor());

    await act(async () => {
      await result.current.openForEdit(42, { lessonId: 7 });
    });

    expect(result.current.isOpen).toBe(false);
    expect(mockToastError).toHaveBeenCalled();
  });
});

describe("開啟狀態", () => {
  it("新增模式沒有 initialData、沒有 contentId", async () => {
    const { result } = renderHook(() => useScenarioDialogueEditor());

    act(() =>
      result.current.openForCreate({ lessonId: 7, programLevel: "B2" }),
    );

    expect(result.current.isOpen).toBe(true);
    expect(result.current.contentId).toBeNull();
    expect(result.current.initialData).toBeNull();
    expect(result.current.programLevel).toBe("B2");
  });

  it("編輯模式帶回既有資料", async () => {
    getContentDetail.mockResolvedValue({
      id: 42,
      title: "舊的",
      scenario_settings: { scenario_content: "S", question_level: "C1" },
      items: [{ id: 11, text: "Q1" }],
    });
    const { result } = renderHook(() => useScenarioDialogueEditor());

    await act(async () => {
      await result.current.openForEdit(42, { lessonId: 7 });
    });

    await waitFor(() => expect(result.current.isOpen).toBe(true));
    expect(result.current.contentId).toBe(42);
    expect(result.current.initialData?.scenarioContent).toBe("S");
    // #861: 既有題目的 DB id 要記住，存回去才不會刪掉重建
    expect(result.current.initialData?.rows[0].contentItemId).toBe(11);
  });

  it("關閉會清掉 contentId 與 initialData（否則下次新增會存進舊教材）", async () => {
    getContentDetail.mockResolvedValue({ id: 42, title: "舊的", items: [] });
    const { result } = renderHook(() => useScenarioDialogueEditor());

    await act(async () => {
      await result.current.openForEdit(42, { lessonId: 7 });
    });
    act(() => result.current.close());

    expect(result.current.isOpen).toBe(false);
    expect(result.current.contentId).toBeNull();
    expect(result.current.initialData).toBeNull();
  });
});

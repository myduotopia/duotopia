/**
 * AiImageGenerateDialog（Issue #1158）—— 情境圖與題目圖共用的「AI 生圖」對話框。
 *
 * 驗：預填描述（情境圖請 AI 擬、題目圖直接帶）、額度說明依計費方式、額度不足時停用並
 * 說明原因、各種錯誤顯示對應訊息、成功後關閉。
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScenarioImageQuota } from "@/lib/api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MockApiError = vi.hoisted(
  () =>
    class MockApiError extends Error {
      status: number;
      detail: unknown;
      constructor(status: number, detail: unknown) {
        super(String(status));
        this.name = "ApiError";
        this.status = status;
        this.detail = detail;
      }
    },
);

const getScenarioImageQuota = vi.fn();
const suggestScenarioImageDescription = vi.fn();
vi.mock("@/lib/api", () => ({
  ApiError: MockApiError,
  apiClient: {
    getScenarioImageQuota: (...a: unknown[]) => getScenarioImageQuota(...a),
    suggestScenarioImageDescription: (...a: unknown[]) =>
      suggestScenarioImageDescription(...a),
  },
}));

import {
  AiImageGenerateDialog,
  imageGenerateErrorKey,
} from "../AiImageGenerateDialog";

const quota = (
  patch: Partial<ScenarioImageQuota> = {},
): ScenarioImageQuota => ({
  billing: "free_daily",
  remaining: 2,
  limit: 3,
  period: "day",
  points_per_image_estimate: 10,
  can_generate: true,
  ...patch,
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const descriptionBox = () =>
  screen.getByLabelText(
    "scenarioDialogue.imageGen.descriptionLabel",
  ) as HTMLTextAreaElement;
const generateButton = () =>
  screen
    .getByText("scenarioDialogue.imageGen.generate")
    .closest("button") as HTMLButtonElement;

beforeEach(() => {
  getScenarioImageQuota.mockReset();
  getScenarioImageQuota.mockResolvedValue(quota());
  suggestScenarioImageDescription.mockReset();
  suggestScenarioImageDescription.mockResolvedValue({
    description: "Two friends at a picnic",
  });
});

describe("AiImageGenerateDialog 預填描述", () => {
  it("情境圖：打開時依情境文章請 AI 擬描述，填進描述框", async () => {
    render(
      <AiImageGenerateDialog
        open
        onOpenChange={vi.fn()}
        kind="scenario"
        suggestFrom={{ scenario_content: "Tom and Amy have a picnic." }}
        onGenerate={vi.fn()}
      />,
    );
    await flush();

    expect(suggestScenarioImageDescription).toHaveBeenCalledWith({
      scenario_content: "Tom and Amy have a picnic.",
      question: "",
    });
    expect(descriptionBox()).toHaveValue("Two friends at a picnic");
  });

  it("題目圖：有 initialDescription 就直接用，不呼叫 AI 擬", async () => {
    render(
      <AiImageGenerateDialog
        open
        onOpenChange={vi.fn()}
        kind="question"
        initialDescription="A cat on a desk"
        onGenerate={vi.fn()}
      />,
    );
    await flush();

    expect(suggestScenarioImageDescription).not.toHaveBeenCalled();
    expect(descriptionBox()).toHaveValue("A cat on a desk");
  });

  it("沒有情境文章也沒有預填：不呼叫 AI，描述框留白，生成停用", async () => {
    render(
      <AiImageGenerateDialog
        open
        onOpenChange={vi.fn()}
        kind="scenario"
        suggestFrom={{ scenario_content: "  " }}
        onGenerate={vi.fn()}
      />,
    );
    await flush();

    expect(suggestScenarioImageDescription).not.toHaveBeenCalled();
    expect(descriptionBox()).toHaveValue("");
    expect(generateButton()).toBeDisabled();
  });

  it("AI 擬不出描述：顯示說明，老師可以自己寫", async () => {
    suggestScenarioImageDescription.mockRejectedValue(new Error("boom"));
    render(
      <AiImageGenerateDialog
        open
        onOpenChange={vi.fn()}
        kind="scenario"
        suggestFrom={{ scenario_content: "A story" }}
        onGenerate={vi.fn()}
      />,
    );
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "scenarioDialogue.imageGen.suggestFailed",
    );
    expect(descriptionBox()).not.toBeDisabled();
  });
});

describe("AiImageGenerateDialog 額度說明", () => {
  const renderWith = async (q: ScenarioImageQuota) => {
    getScenarioImageQuota.mockResolvedValue(q);
    render(
      <AiImageGenerateDialog
        open
        onOpenChange={vi.fn()}
        kind="question"
        initialDescription="A park"
        onGenerate={vi.fn()}
      />,
    );
    await flush();
  };

  it.each([
    ["free_daily", quota()],
    [
      "subscription",
      quota({ billing: "subscription", remaining: 40, limit: 60 }),
    ],
    [
      "points",
      quota({ billing: "points", remaining: null, limit: null, period: null }),
    ],
    [
      "org",
      quota({ billing: "org", remaining: null, limit: null, period: null }),
    ],
    [
      "admin",
      quota({ billing: "admin", remaining: null, limit: null, period: null }),
    ],
  ] as const)("%s 顯示對應的計費說明", async (billing, q) => {
    await renderWith(q);
    expect(screen.getByTestId("ai-image-quota-text")).toHaveTextContent(
      `scenarioDialogue.imageGen.billing.${billing}`,
    );
  });

  it("額度不足（can_generate=false）：生成停用，原因寫在畫面上與 title", async () => {
    await renderWith(quota({ remaining: 0, can_generate: false }));

    expect(generateButton()).toBeDisabled();
    expect(screen.getByTestId("ai-image-blocked-reason")).toHaveTextContent(
      "scenarioDialogue.imageGen.blocked.free_daily",
    );
    expect(generateButton()).toHaveAttribute(
      "title",
      "scenarioDialogue.imageGen.blocked.free_daily",
    );
  });
});

describe("AiImageGenerateDialog 生成", () => {
  it("送出老師改過的描述，成功後關閉", async () => {
    const onGenerate = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <AiImageGenerateDialog
        open
        onOpenChange={onOpenChange}
        kind="question"
        initialDescription="A park"
        onGenerate={onGenerate}
      />,
    );
    await flush();

    fireEvent.change(descriptionBox(), {
      target: { value: "  A park with a dog  " },
    });
    fireEvent.click(generateButton());
    await flush();

    expect(onGenerate).toHaveBeenCalledWith("A park with a dog");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("生成中顯示進行狀態，按鈕暫時停用", async () => {
    let finish: () => void = () => {};
    const onGenerate = vi.fn(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
    render(
      <AiImageGenerateDialog
        open
        onOpenChange={vi.fn()}
        kind="question"
        initialDescription="A park"
        onGenerate={onGenerate}
      />,
    );
    await flush();

    fireEvent.click(generateButton());
    await flush();
    expect(
      screen.getByText("scenarioDialogue.imageGen.generatingHint"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByText("scenarioDialogue.imageGen.generating")
        .closest("button"),
    ).toBeDisabled();

    await act(async () => {
      finish();
    });
  });

  it("失敗時顯示原因、不關閉，並重讀額度", async () => {
    const onGenerate = vi
      .fn()
      .mockRejectedValue(
        new MockApiError(409, { error: "SCENARIO_IMAGE_IN_PROGRESS" }),
      );
    const onOpenChange = vi.fn();
    render(
      <AiImageGenerateDialog
        open
        onOpenChange={onOpenChange}
        kind="question"
        initialDescription="A park"
        onGenerate={onGenerate}
      />,
    );
    await flush();
    expect(getScenarioImageQuota).toHaveBeenCalledTimes(1);

    fireEvent.click(generateButton());
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "scenarioDialogue.imageGen.errors.inProgress",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(getScenarioImageQuota).toHaveBeenCalledTimes(2);
  });
});

describe("imageGenerateErrorKey", () => {
  it.each([
    [new MockApiError(402, { error: "X" }), "quota"],
    [
      new MockApiError(409, { error: "SCENARIO_IMAGE_IN_PROGRESS" }),
      "inProgress",
    ],
    [new MockApiError(409, "上一張圖還在生成"), "inProgress"],
    [new MockApiError(409, { error: "OTHER" }), "failed"],
    [new MockApiError(422, "blocked"), "blocked"],
    [new MockApiError(502, "upstream"), "failed"],
    [new Error("network"), "failed"],
  ])("%s → %s", (error, key) => {
    expect(imageGenerateErrorKey(error)).toBe(
      `scenarioDialogue.imageGen.errors.${key}`,
    );
  });
});

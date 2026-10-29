/**
 * ScenarioImageStrip 的「AI 生圖」入口（Issue #1158）。
 *
 * - 開關打開時新增鈕旁有「AI 生圖」，按下去開生圖對話框，並依情境文章擬描述
 * - 已滿 5 張時停用，title 說明原因
 * - AI 生的圖沒有原圖，不顯示「調整裁切」
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScenarioImage } from "../scenarioImages";
import type { ScenarioImageActions } from "../useScenarioImages";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockFlags = vi.hoisted(() => ({ SCENARIO_IMAGE_GENERATION: true }));
vi.mock("@/config/featureFlags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/featureFlags")>();
  return {
    ...actual,
    FEATURE_FLAGS: new Proxy(actual.FEATURE_FLAGS, {
      get: (target, key) =>
        key in mockFlags
          ? mockFlags[key as keyof typeof mockFlags]
          : target[key as keyof typeof target],
    }),
  };
});

const suggestScenarioImageDescription = vi.fn();
vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  apiClient: {
    getScenarioImageQuota: vi.fn().mockResolvedValue({
      billing: "admin",
      remaining: null,
      limit: null,
      period: null,
      points_per_image_estimate: 10,
      can_generate: true,
    }),
    suggestScenarioImageDescription: (...a: unknown[]) =>
      suggestScenarioImageDescription(...a),
  },
}));

import { ScenarioImageStrip } from "../ScenarioImageStrip";

const image = (
  n: number,
  patch: Partial<ScenarioImage> = {},
): ScenarioImage => ({
  id: `img-${n}`,
  url: `https://cdn/${n}.png`,
  source: null,
  ...patch,
});

const actionsWith = (images: ScenarioImage[]): ScenarioImageActions => ({
  images,
  busy: false,
  cropping: null,
  setCropping: vi.fn(),
  addManual: vi.fn(),
  addExtracted: vi.fn(),
  addGenerated: vi.fn(),
  remove: vi.fn(),
  applyCrop: vi.fn(),
});

beforeEach(() => {
  mockFlags.SCENARIO_IMAGE_GENERATION = true;
  suggestScenarioImageDescription.mockReset();
  suggestScenarioImageDescription.mockResolvedValue({ description: "A park" });
});

describe("ScenarioImageStrip AI 生圖", () => {
  it("開關打開：有「AI 生圖」，按下去開對話框並依情境文章擬描述", async () => {
    render(
      <ScenarioImageStrip
        actions={actionsWith([])}
        scenarioContent="Tom goes to the park."
      />,
    );

    fireEvent.click(screen.getByTestId("scenario-image-generate"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("ai-image-generate-dialog")).toBeInTheDocument();
    expect(suggestScenarioImageDescription).toHaveBeenCalledWith({
      scenario_content: "Tom goes to the park.",
      question: "",
    });
  });

  it("已滿 5 張：停用並說明原因", () => {
    render(
      <ScenarioImageStrip
        actions={actionsWith([1, 2, 3, 4, 5].map((n) => image(n)))}
      />,
    );
    const button = screen.getByTestId("scenario-image-generate");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      "title",
      "scenarioDialogue.images.fullGenerate",
    );
  });

  it("開關關閉：沒有「AI 生圖」", () => {
    mockFlags.SCENARIO_IMAGE_GENERATION = false;
    render(<ScenarioImageStrip actions={actionsWith([])} />);
    expect(
      screen.queryByTestId("scenario-image-generate"),
    ).not.toBeInTheDocument();
  });

  it("唯讀時不顯示生圖入口", () => {
    render(<ScenarioImageStrip actions={actionsWith([image(1)])} readOnly />);
    expect(
      screen.queryByTestId("scenario-image-generate"),
    ).not.toBeInTheDocument();
  });

  it("AI 生的圖不顯示「調整裁切」，一般圖照舊顯示", () => {
    render(
      <ScenarioImageStrip
        actions={actionsWith([image(1, { generated: true }), image(2)])}
      />,
    );
    const [aiTile, savedTile] = screen
      .getAllByRole("img")
      .map((img) => img.parentElement as HTMLElement);

    expect(
      within(aiTile).queryByLabelText("scenarioDialogue.images.crop"),
    ).not.toBeInTheDocument();
    expect(
      within(aiTile).getByLabelText("scenarioDialogue.images.remove"),
    ).toBeInTheDocument();
    expect(
      within(savedTile).getByLabelText("scenarioDialogue.images.crop"),
    ).toBeInTheDocument();
  });
});

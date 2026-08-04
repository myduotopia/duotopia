import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MagicPasteDialog from "../MagicPasteDialog";

const mockQuota = vi.fn();
const mockExtract = vi.fn();

vi.mock("@/lib/api", () => ({
  apiClient: {
    getMagicPasteQuota: (...a: unknown[]) => mockQuota(...a),
    magicPasteExtract: (...a: unknown[]) => mockExtract(...a),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

// i18n 未在測試初始化 → t 直接回 key，斷言改用 key
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh-TW" },
  }),
}));

function makeFile(name = "words.png", type = "image/png") {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("MagicPasteDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuota.mockResolvedValue({
      year_month: "2026-07",
      free_limit: 5,
      free_used: 0,
      free_remaining: 5,
      points_per_image: 10,
      paid_quota_remaining: 0,
      can_use: true,
    });
  });

  it("fetches quota and shows remaining free count on open", async () => {
    render(<MagicPasteDialog open onClose={vi.fn()} onInsert={vi.fn()} />);
    await waitFor(() => expect(mockQuota).toHaveBeenCalled());
    expect(await screen.findByText(/magicPaste.quota/)).toBeInTheDocument();
  });

  it("extracts and inserts selected items", async () => {
    mockExtract.mockResolvedValue({
      items: [
        {
          text: "apple",
          translation: "蘋果",
          part_of_speech: "n.",
          example_sentence: "I eat an apple.",
          example_sentence_translation: "我吃蘋果。",
        },
      ],
      charge: { charged: "free", points_used: 0, free_remaining: 4 },
      quota: { free_remaining: 4, free_limit: 5, can_use: true },
      estimated_cost_usd: 0.0001,
      provider: "test",
    });
    const onInsert = vi.fn();
    render(<MagicPasteDialog open onClose={vi.fn()} onInsert={onInsert} />);

    const input = screen.getByTestId("magic-paste-file-input");
    fireEvent.change(input, { target: { files: [makeFile()] } });

    fireEvent.click(screen.getByRole("button", { name: /magicPaste.start/ }));
    await waitFor(() => expect(mockExtract).toHaveBeenCalled());

    // preview row rendered
    expect(await screen.findByDisplayValue("apple")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /magicPaste.insertN/ }));
    expect(onInsert).toHaveBeenCalledWith([
      expect.objectContaining({ text: "apple", translation: "蘋果" }),
    ]);
  });

  it("sentence mode sends extract_mode=sentence", async () => {
    mockExtract.mockResolvedValue({
      items: [
        {
          text: "I eat an apple every morning.",
          translation: "我每天早上吃一顆蘋果。",
          part_of_speech: "",
          example_sentence: "",
          example_sentence_translation: "",
        },
      ],
      charge: { charged: "free", points_used: 0, free_remaining: 4 },
      quota: { free_remaining: 4, free_limit: 5, can_use: true },
      estimated_cost_usd: 0.0001,
      provider: "test",
    });
    const onInsert = vi.fn();
    render(
      <MagicPasteDialog
        open
        onClose={vi.fn()}
        onInsert={onInsert}
        extractMode="sentence"
      />,
    );

    // 翻譯/例句模式切換已移除（改由編輯器共用設定在插入時補洞）
    expect(screen.queryByText("AI translate toggle")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("magic-paste-file-input"), {
      target: { files: [makeFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: /magicPaste.start/ }));
    await waitFor(() => expect(mockExtract).toHaveBeenCalled());

    // FormData 帶了 extract_mode=sentence
    const formData = mockExtract.mock.calls[0][0] as FormData;
    expect(formData.get("extract_mode")).toBe("sentence");

    // 預覽顯示句子，插入回傳句子
    expect(
      await screen.findByDisplayValue("I eat an apple every morning."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /magicPaste.insertN/ }));
    expect(onInsert).toHaveBeenCalledWith([
      expect.objectContaining({ text: "I eat an apple every morning." }),
    ]);
  });

  it("vocabulary mode sends extract_mode=vocabulary by default", async () => {
    mockExtract.mockResolvedValue({
      items: [],
      charge: { charged: "free", points_used: 0, free_remaining: 4 },
      quota: { free_remaining: 4, free_limit: 5, can_use: true },
      estimated_cost_usd: 0,
      provider: "test",
    });
    render(<MagicPasteDialog open onClose={vi.fn()} onInsert={vi.fn()} />);
    fireEvent.change(screen.getByTestId("magic-paste-file-input"), {
      target: { files: [makeFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: /magicPaste.start/ }));
    await waitFor(() => expect(mockExtract).toHaveBeenCalled());

    const formData = mockExtract.mock.calls[0][0] as FormData;
    expect(formData.get("extract_mode")).toBe("vocabulary");
  });

  it("shows over-limit guidance on 402", async () => {
    mockExtract.mockRejectedValue(
      Object.assign(new Error("quota"), { status: 402 }),
    );
    render(<MagicPasteDialog open onClose={vi.fn()} onInsert={vi.fn()} />);
    fireEvent.change(screen.getByTestId("magic-paste-file-input"), {
      target: { files: [makeFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: /magicPaste.start/ }));
    expect(
      await screen.findByText(/magicPaste.overLimitLink/),
    ).toBeInTheDocument();
  });
});

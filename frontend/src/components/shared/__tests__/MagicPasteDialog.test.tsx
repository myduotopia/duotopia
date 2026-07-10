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
    render(
      <MagicPasteDialog open onClose={vi.fn()} onInsert={vi.fn()} />,
    );
    await waitFor(() => expect(mockQuota).toHaveBeenCalled());
    expect(await screen.findByText(/本月免費剩餘/)).toBeInTheDocument();
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
    render(
      <MagicPasteDialog open onClose={vi.fn()} onInsert={onInsert} />,
    );

    const input = screen.getByTestId("magic-paste-file-input");
    fireEvent.change(input, { target: { files: [makeFile()] } });

    fireEvent.click(screen.getByRole("button", { name: /開始擷取/ }));
    await waitFor(() => expect(mockExtract).toHaveBeenCalled());

    // preview row rendered
    expect(await screen.findByDisplayValue("apple")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /插入 1 個項目/ }));
    expect(onInsert).toHaveBeenCalledWith([
      expect.objectContaining({ text: "apple", translation: "蘋果" }),
    ]);
  });

  it("shows over-limit guidance on 402", async () => {
    mockExtract.mockRejectedValue(
      Object.assign(new Error("quota"), { status: 402 }),
    );
    render(
      <MagicPasteDialog open onClose={vi.fn()} onInsert={vi.fn()} />,
    );
    fireEvent.change(screen.getByTestId("magic-paste-file-input"), {
      target: { files: [makeFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: /開始擷取/ }));
    expect(await screen.findByText(/訂閱方案或購買點數/)).toBeInTheDocument();
  });
});

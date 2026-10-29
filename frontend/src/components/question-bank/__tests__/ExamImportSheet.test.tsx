/**
 * ExamImportSheet 開關（#1112 C4，第五輪遺留）：
 * - 右上 X 關閉；Esc 關閉
 * - 點遮罩不關閉（遮罩 pointer-events-none，與 QuestionSheet 一致）
 * - 上面疊著 Dialog 時按 Esc 只關 Dialog，面板留著
 * - 從「新增題目 ▽」DropdownMenuItem 打開（焦點回到選單觸發鈕、不在面板內）後 Esc 照樣能關
 * 上傳畫面與核對畫面換成替身（各自有測試）。
 */
import { describe, it, expect, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import ExamImportSheet from "../exam-import/ExamImportSheet";
import type { ExamImportController } from "../exam-import/useExamImport";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

vi.mock("react-i18next", () => {
  const translation = { t: (key: string) => key, i18n: { language: "zh-TW" } };
  return { useTranslation: () => translation };
});

vi.mock("../exam-import/ExamImportUploadForm", () => ({
  default: () => <div data-testid="upload-stub" />,
}));
vi.mock("../exam-import/ExamImportReview", () => ({
  default: () => <div data-testid="review-stub" />,
}));

/** 像宿主頁面：controller 的 open／close 是真的狀態 */
function Host({
  initialOpen = true,
  onClose,
  withDialog = false,
  withMenu = false,
}: {
  initialOpen?: boolean;
  onClose?: () => void;
  withDialog?: boolean;
  withMenu?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [dialogOpen, setDialogOpen] = useState(withDialog);
  const controller = {
    open,
    view: "upload",
    abandonTarget: null,
    organizationId: null,
    openUpload: () => setOpen(true),
    close: () => {
      onClose?.();
      setOpen(false);
    },
    start: vi.fn(),
    openExisting: vi.fn(),
    requestAbandon: vi.fn(),
    cancelAbandon: vi.fn(),
    confirmAbandon: vi.fn(),
  } as unknown as ExamImportController;
  return (
    <>
      {withMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger>new</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => controller.openUpload()}>
              upload
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <ExamImportSheet controller={controller} programs={[]} sidebarWidth={0} />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="stacked-dialog">
          <DialogTitle>zoom</DialogTitle>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("ExamImportSheet 開關", () => {
  it("X 關閉", () => {
    render(<Host />);
    fireEvent.click(screen.getByTestId("exam-import-close"));
    expect(screen.queryByTestId("exam-import-sheet")).toBeNull();
  });

  it("Esc 關閉；點遮罩不關閉", () => {
    render(<Host />);
    const backdrop = screen.getByTestId("exam-import-backdrop");
    expect(backdrop.className).toContain("pointer-events-none");
    fireEvent.click(backdrop);
    expect(screen.getByTestId("exam-import-sheet")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByTestId("exam-import-sheet")).toBeNull();
  });

  it("疊著 Dialog 時 Esc 只關 Dialog", async () => {
    const onClose = vi.fn();
    render(<Host withDialog onClose={onClose} />);
    expect(screen.getByTestId("stacked-dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("stacked-dialog"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("stacked-dialog")).toBeNull(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("exam-import-sheet")).toBeTruthy();
  });

  it("從 DropdownMenuItem 打開後 Esc 能關", async () => {
    const user = userEvent.setup();
    render(<Host initialOpen={false} withMenu />);
    await user.click(screen.getByText("new"));
    await user.click(await screen.findByRole("menuitem", { name: "upload" }));
    expect(await screen.findByTestId("exam-import-sheet")).toBeTruthy();
    // 選單關閉後焦點回到觸發鈕（不在面板內）
    await act(async () => {
      screen.getByText("new").focus();
    });
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("exam-import-sheet")).toBeNull(),
    );
  });
});

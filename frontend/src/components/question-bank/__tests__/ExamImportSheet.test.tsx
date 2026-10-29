/**
 * ExamImportSheet 開關（#1112 C4，第五輪遺留）：
 * - 右上 X 關閉；Esc 關閉
 * - 點遮罩不關閉（遮罩 pointer-events-none，與 QuestionSheet 一致）
 * - 上面疊著 Dialog 時按 Esc 只關 Dialog，面板留著
 * - 從「新增題目 ▽」DropdownMenuItem 打開（焦點回到選單觸發鈕、不在面板內）後 Esc 照樣能關
 * - X／Esc 走 `requestClose`：收尾（存回編輯中的題）失敗就不關（C4b 審查 3）
 * - 開著時登記編輯面板（手機寬度浮動工具列自動收起，C4c U1）；手機不顯示說明文字（U5）
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
import { useAnyEditorPanelOpen } from "@/lib/editorPanelPresence";
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
  beforeClose,
}: {
  initialOpen?: boolean;
  onClose?: () => void;
  withDialog?: boolean;
  withMenu?: boolean;
  /** 模擬核對畫面登記的收尾；回傳 false＝不要關 */
  beforeClose?: () => Promise<boolean>;
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
    requestClose: async () => {
      if (beforeClose && !(await beforeClose())) return;
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
  it("X 關閉", async () => {
    render(<Host />);
    fireEvent.click(screen.getByTestId("exam-import-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("exam-import-sheet")).toBeNull(),
    );
  });

  it("Esc 關閉；點遮罩不關閉", async () => {
    render(<Host />);
    const backdrop = screen.getByTestId("exam-import-backdrop");
    expect(backdrop.className).toContain("pointer-events-none");
    fireEvent.click(backdrop);
    expect(screen.getByTestId("exam-import-sheet")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("exam-import-sheet")).toBeNull(),
    );
  });

  it("收尾失敗（編輯中的題存不進去）→ X、Esc 都不關", async () => {
    const beforeClose = vi.fn(async () => false);
    render(<Host beforeClose={beforeClose} />);
    fireEvent.click(screen.getByTestId("exam-import-close"));
    await waitFor(() => expect(beforeClose).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(beforeClose).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("exam-import-sheet")).toBeTruthy();
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

describe("ExamImportSheet 手機（C4c U1／U5）", () => {
  function Probe() {
    const open = useAnyEditorPanelOpen();
    return <div data-testid="panel-open-probe">{String(open)}</div>;
  }

  it("面板開著時登記（浮動工具列在手機會收起），關掉取消；說明文字手機不顯示", async () => {
    render(
      <>
        <Host />
        <Probe />
      </>,
    );
    expect(screen.getByTestId("panel-open-probe").textContent).toBe("true");
    const desc = screen.getByText("questionBank.examImport.upload.description");
    expect(desc.className).toContain("hidden");
    expect(desc.className).toContain("sm:block");

    fireEvent.click(screen.getByTestId("exam-import-close"));
    await waitFor(() =>
      expect(screen.getByTestId("panel-open-probe").textContent).toBe("false"),
    );
  });
});

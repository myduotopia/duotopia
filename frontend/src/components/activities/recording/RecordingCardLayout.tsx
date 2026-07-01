/**
 * RecordingCardLayout — issue #892 朗讀作答共用版面骨架。
 *
 * 米色背景；由上而下：頂部（header slot + 右側 ⚡ attempts slot）／中央卡片區／
 * 評語條（訂正模式）／底部控制列。5 個入口共用此骨架，差異只在傳入的 slot 內容：
 * 卡片內容由 CardContent 決定、控制列由 RecordingControls 決定、評語條由
 * TeacherFeedbackBar 決定。
 *
 * 設計依據：docs/design/recording-card-redesign.pen（A / C0 / C1 / C4 / C5 frames）。
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface RecordingCardLayoutProps {
  /** 頂部左側（單元標題 / 題號列） */
  header?: ReactNode;
  /** 頂部右側（⚡ 剩餘次數指示） */
  attempts?: ReactNode;
  /** 卡片內容（CardContent） */
  children: ReactNode;
  /** 訂正模式老師評語條（TeacherFeedbackBar）；無則不佔位 */
  feedbackBar?: ReactNode;
  /** 底部控制列（RecordingControls） */
  controls?: ReactNode;
  className?: string;
}

export const RecordingCardLayout = ({
  header,
  attempts,
  children,
  feedbackBar,
  controls,
  className,
}: RecordingCardLayoutProps) => {
  return (
    <div
      data-testid="recording-card-layout"
      className={cn(
        "flex min-h-[520px] w-full flex-col gap-4 rounded-3xl bg-recording-bg px-4 py-6 sm:px-10",
        className,
      )}
    >
      {(header || attempts) && (
        <div
          data-testid="recording-topbar"
          className="flex items-center justify-between gap-3"
        >
          <div className="flex min-w-0 items-center gap-3">{header}</div>
          {attempts && <div className="flex-shrink-0">{attempts}</div>}
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div data-testid="recording-card-slot" className="w-full">
          {children}
        </div>

        {feedbackBar && (
          <div
            data-testid="recording-feedback-slot"
            className="w-full max-w-[960px]"
          >
            {feedbackBar}
          </div>
        )}

        {controls && (
          <div data-testid="recording-controls-slot">{controls}</div>
        )}
      </div>
    </div>
  );
};

export default RecordingCardLayout;

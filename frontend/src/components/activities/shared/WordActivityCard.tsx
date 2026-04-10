/**
 * WordActivityCard - 單字活動卡片（共用元件）
 *
 * 封裝單字活動的卡片 UI，供以下活動使用：
 * - 單字拼寫（WordSpellingSample）
 * - 單字克漏字（WordClozeSample）
 *
 * === 結構 ===
 * Card
 * ├── Image Area（可選）
 * └── CardContent
 *     ├── Hint Area（由父層傳入 hintArea）
 *     ├── Question Display（由父層傳入 questionDisplay，克漏字專用）
 *     ├── [選擇題模式] Choice Area（由父層傳入 choiceArea，取代 Answer Area + Submit Button）
 *     ├── [一般模式] Answer Area（格子模式 or 單一輸入框）
 *     ├── [一般模式] Submit Button
 *     └── Exam Submit Button（考試最後一題）
 *
 * === 設計原則 ===
 * - hintArea / questionDisplay 由各活動頁面傳入（ReactNode），不在此處做任何假設
 * - placeholderChar(i)：答錯後各格子的提示字元，由父層依 hintMode 決定是否提供
 * - placeholderText：答錯後單一輸入框的完整提示文字，由父層決定是否提供
 * - showLetterCount 由父層傳入（已含 hintMode 等條件的最終值）
 * - choiceArea：選擇題選項區（由父層傳入）；提供時取代 Answer Area + Submit Button
 */

import { type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, SendHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WordActivityCardProps {
  // Layout
  viewMode: "mobile" | "desktop";
  showImage: boolean;

  // Hint area — 由各活動頁面傳入（translation/audio/wordbank 等）
  hintArea: ReactNode;

  // 題目顯示區 — 克漏字句子等，WordSpelling 不傳
  questionDisplay?: ReactNode;

  // Answer area
  slots: (string | null)[];
  /** 實際答案字母數（showLetterCount=true 時決定顯示幾格） */
  answerLength: number;
  /** 是否顯示固定格子（false 則顯示單一輸入框） */
  showLetterCount: boolean;
  answered: boolean;
  isExamMode: boolean;
  examSubmitted: boolean;
  /** 是否顯示 placeholder（答錯後顯示正確答案提示） */
  showPlaceholder: boolean;
  /** 格子模式下每個位置的提示字元；回傳 undefined 表示不顯示提示 */
  placeholderChar: (index: number) => string | undefined;
  /** 單一輸入框模式下的完整提示文字；undefined 表示不顯示提示 */
  placeholderText?: string;
  onSlotClick: (index: number) => void;
  onBackspace: () => void;

  // Submit
  hasInput: boolean;
  onSubmit: () => void;
  isLastQuestion: boolean;
  onExamFinish: () => void;

  // 選擇題模式 — 提供時取代 Answer Area + Submit Button
  choiceArea?: ReactNode;
}

export function WordActivityCard({
  viewMode,
  showImage,
  hintArea,
  questionDisplay,
  slots,
  answerLength,
  showLetterCount,
  answered,
  isExamMode,
  examSubmitted,
  showPlaceholder,
  placeholderChar,
  placeholderText,
  onSlotClick,
  onBackspace,
  hasInput,
  onSubmit,
  isLastQuestion,
  onExamFinish,
  choiceArea,
}: WordActivityCardProps) {
  const isDisabled = answered || (isExamMode && examSubmitted);
  const showSlotPlaceholder = showPlaceholder && !isExamMode;

  return (
    <Card
      className={cn(
        "overflow-hidden",
        viewMode === "desktop" && showImage && "flex flex-row",
      )}
    >
      {/* Image Area */}
      {/* 正式實作：<img alt="" title="" draggable={false} /> — alt/title 留空避免 hover tooltip 洩題 */}
      {showImage && (
        <div
          className={cn(
            "flex items-center justify-center bg-gray-100 select-none pointer-events-none",
            viewMode === "mobile"
              ? "h-48 w-full"
              : "w-[30%] min-w-64 min-h-[200px]",
          )}
        >
          <span className="text-lg text-gray-400">圖片</span>
        </div>
      )}

      {/* Content Area */}
      <CardContent
        className={cn(
          "flex-1 p-6 select-none",
          viewMode === "desktop" && showImage && "p-8",
        )}
      >
        {/* Hint Area */}
        <div className="mb-5">{hintArea}</div>

        {/* Question Display（克漏字句子等，WordSpelling 不傳） */}
        {questionDisplay && <div className="mb-5">{questionDisplay}</div>}

        {/* Answer Area — 選擇題模式時以 choiceArea 取代整個輸入 + 送出區 */}
        {choiceArea ? (
          <>
            <div className="mb-6">{choiceArea}</div>
            {/* 考試最後一題：提交考卷 */}
            {isExamMode && !examSubmitted && isLastQuestion && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onExamFinish}
                  className="text-red-600 border-red-300 hover:bg-red-50"
                >
                  提交考卷
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* 格子模式 or 單一輸入框 */}
            {showLetterCount ? (
              // 格子模式：每個字母一個格子，數量 = answerLength
              <div className="flex justify-center flex-wrap gap-1.5 mb-6">
                {slots.slice(0, answerLength).map((letter, index) => {
                  const hint = placeholderChar(index);
                  return (
                    <button
                      key={index}
                      onClick={() => onSlotClick(index)}
                      className={cn(
                        "w-9 h-11 border-2 rounded-lg flex items-center justify-center text-lg font-bold transition-all",
                        letter
                          ? "border-blue-400 bg-blue-50 text-blue-700 hover:border-red-300 hover:bg-red-50"
                          : showSlotPlaceholder && hint
                            ? "border-gray-200 bg-white"
                            : "border-gray-300 bg-white",
                      )}
                      disabled={isDisabled}
                    >
                      {letter ||
                        (showSlotPlaceholder && hint ? (
                          <span className="text-gray-300 italic text-sm">
                            {hint}
                          </span>
                        ) : null)}
                    </button>
                  );
                })}
              </div>
            ) : (
              // 單一輸入框模式
              <div
                className={cn(
                  "flex justify-center items-center gap-0.5 mb-6 min-h-[44px] border-2 rounded-lg px-3 py-2 cursor-pointer",
                  showSlotPlaceholder && placeholderText
                    ? "border-gray-200 bg-white"
                    : slots.some((s) => s !== null)
                      ? "border-blue-400 bg-blue-50"
                      : "border-gray-300 bg-white",
                )}
                onClick={() => {
                  if (!isDisabled && slots.some((s) => s !== null)) {
                    onBackspace();
                  }
                }}
              >
                {slots.some((s) => s !== null) ? (
                  slots.map((letter, index) =>
                    letter ? (
                      <span
                        key={index}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSlotClick(index);
                        }}
                        className="text-lg font-bold text-blue-700 hover:text-red-500 cursor-pointer px-0.5"
                      >
                        {letter}
                      </span>
                    ) : null,
                  )
                ) : showSlotPlaceholder && placeholderText ? (
                  <span className="text-gray-300 italic text-lg">
                    {placeholderText}
                  </span>
                ) : (
                  <span className="text-gray-300 text-lg">輸入答案...</span>
                )}
              </div>
            )}

            {/* Submit Button */}
            <div className="flex justify-center gap-3 mb-4">
              <button
                onClick={onSubmit}
                disabled={
                  !hasInput || answered || (isExamMode && examSubmitted)
                }
                className={cn(
                  "flex items-center justify-center w-10 h-10 rounded-full transition-colors",
                  answered
                    ? "bg-green-500 text-white"
                    : hasInput
                      ? "bg-blue-500 hover:bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-400",
                )}
                aria-label="送出"
              >
                {answered ? (
                  <CheckCircle className="h-5 w-5" />
                ) : (
                  <SendHorizontal className="h-5 w-5" />
                )}
              </button>
            </div>

            {/* Exam: Submit Exam Button — 只在最後一題顯示 */}
            {isExamMode && !examSubmitted && isLastQuestion && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onExamFinish}
                  className="text-red-600 border-red-300 hover:bg-red-50"
                >
                  提交考卷
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

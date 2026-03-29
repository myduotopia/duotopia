/**
 * MultipleChoiceOptions - 選擇題選項區（共用元件）
 *
 * 供以下活動使用：
 * - 單字拼寫（WordSpellingSample）— hintMode="choice"
 * - 單字克漏字（WordClozeSample）— hintMode="choice"
 *
 * === 行為 ===
 * 練習模式：
 * - 點選即判斷（不需送出按鈕）
 * - answered=true 後鎖定，顯示正確（綠）/ 錯誤（紅）
 *
 * 考試模式：
 * - 點選儲存但不鎖定（可改答案）
 * - 已選選項顯示藍色
 * - 提交考卷後才顯示正確/錯誤顏色
 */

import { cn } from "@/lib/utils";

export interface MultipleChoiceOptionsProps {
  options: string[];
  /** 目前已選選項（null = 未選） */
  selectedOption: string | null;
  /** 正確答案（用於判分與顏色顯示） */
  correctAnswer: string;
  /** 練習模式：點選後鎖定；考試模式：始終 false */
  answered: boolean;
  isExamMode: boolean;
  examSubmitted: boolean;
  onSelect: (option: string) => void;
}

export function MultipleChoiceOptions({
  options,
  selectedOption,
  correctAnswer,
  answered,
  isExamMode,
  examSubmitted,
  onSelect,
}: MultipleChoiceOptionsProps) {
  const isDisabled = answered || (isExamMode && examSubmitted);
  // 顯示正確/錯誤顏色的時機：練習答題後，或考試提交後
  const showResult = answered || (isExamMode && examSubmitted);

  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map((option, index) => {
        const isSelected = selectedOption === option;
        const isCorrect = option.toLowerCase() === correctAnswer.toLowerCase();

        let buttonClass: string;
        if (showResult) {
          if (isCorrect) {
            buttonClass =
              "border-green-500 bg-green-100 text-green-700 cursor-default";
          } else if (isSelected) {
            buttonClass =
              "border-red-400 bg-red-100 text-red-600 cursor-default";
          } else {
            buttonClass =
              "border-gray-200 bg-white text-gray-400 cursor-default";
          }
        } else if (isSelected && isExamMode) {
          // 考試模式已選：藍色，可再點切換
          buttonClass =
            "border-blue-400 bg-blue-50 text-blue-700 hover:border-blue-500";
        } else {
          buttonClass =
            "border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50";
        }

        return (
          <button
            key={index}
            onClick={() => !isDisabled && onSelect(option)}
            disabled={isDisabled}
            className={cn(
              "border-2 rounded-xl px-4 py-3 text-sm font-medium text-center transition-all",
              buttonClass,
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

/**
 * ActivitySettingsPanel - 活動作業設定面板（共用元件）
 *
 * 供老師出作業時配置的設定 UI，目前用於：
 * - 單字拼寫（WordSpellingSample）
 * - 單字克漏字（WordClozeSample）
 *
 * === 通用設定 ===
 * - 作業模式：練習 / 考試
 * - 提示方式：由各活動透過 hintModeOptions 傳入選項
 * - 選項數量（選擇題模式，choiceCountVisible=true 時顯示）：2 / 3 / 4 個
 * - 輸入方式（inputMethodVisible=true 時顯示）：鍵盤 / 手寫
 * - 顯示圖片：是/否
 * - 顯示字母數：是/否（可透過 showLetterCountVisible 隱藏，例如字庫模式）
 * - 強制顯示虛擬鍵盤：是/否（inputMethod="handwriting" 時自動隱藏）
 * - 打亂題目：是/否
 * - 考試時間（考試模式）：HH:MM 格式，最多 02:00，最少 00:01
 * - 考後顯示答案（考試模式）：是/否
 *
 * === 活動專屬設定 ===
 * 透過 extraHintSettings prop（ReactNode）插入提示方式相關的額外選項，
 * 例如：音檔模式的「顯示詞性與翻譯」、字庫模式的「顯示句子翻譯」。
 * 這些選項由各活動頁面自行控制並傳入。
 */

import { type ReactNode } from "react";

export type AssignmentMode = "practice" | "exam";

export interface HintModeOption {
  value: string;
  label: string;
}

export interface ActivitySettingsPanelProps {
  // 作業模式（assignmentModeVisible=false 時整個選項隱藏，例如列印模式）
  assignmentMode: AssignmentMode;
  onAssignmentModeChange: (mode: AssignmentMode) => void;
  assignmentModeVisible?: boolean;

  // 提示方式（選項由各活動決定）
  hintMode: string;
  hintModeOptions: HintModeOption[];
  onHintModeChange: (mode: string) => void;

  // 選項數量（選擇題模式，choiceCountVisible=true 時顯示）
  choiceCount?: number;
  onChoiceCountChange?: (v: number) => void;
  choiceCountVisible?: boolean;

  // 顯示圖片
  showImage: boolean;
  onShowImageChange: (v: boolean) => void;

  // 活動專屬的提示方式附加選項（e.g. 顯示詞性與翻譯、顯示句子翻譯）
  extraHintSettings?: ReactNode;

  // 顯示字母數（showLetterCountVisible=false 時整個選項隱藏）
  showLetterCount: boolean;
  onShowLetterCountChange: (v: boolean) => void;
  showLetterCountVisible?: boolean;

  // 輸入方式（inputMethodVisible=true 時顯示）
  inputMethod?: "keyboard" | "handwriting" | "drawing";
  onInputMethodChange?: (v: "keyboard" | "handwriting" | "drawing") => void;
  inputMethodVisible?: boolean;

  // 強制顯示虛擬鍵盤（inputMethod="handwriting" / "drawing" 時自動隱藏；forceVirtualKeyboardVisible=false 時整個選項隱藏）
  forceVirtualKeyboard: boolean;
  onForceVirtualKeyboardChange: (v: boolean) => void;
  forceVirtualKeyboardVisible?: boolean;

  // 打亂題目
  shuffleQuestions: boolean;
  onShuffleQuestionsChange: (v: boolean) => void;

  // 每題限時（null = 不限時；單位：秒；questionTimeLimitVisible=false 時隱藏）
  questionTimeLimit: number | null;
  onQuestionTimeLimitChange: (v: number | null) => void;
  questionTimeLimitVisible?: boolean;

  // 考試模式專屬
  examTimeValue: string;
  onExamTimeValueChange: (v: string) => void;
  showExamAnswers: boolean;
  onShowExamAnswersChange: (v: boolean) => void;
}

// 考試時間最大秒數（2 小時）
const MAX_EXAM_SECONDS = 2 * 3600;

/**
 * 單一 checkbox 列，統一樣式
 */
function SettingCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
          e.target.blur();
        }}
        className="w-4 h-4 rounded border-gray-300"
      />
      {label}
    </label>
  );
}

export function ActivitySettingsPanel({
  assignmentMode,
  onAssignmentModeChange,
  assignmentModeVisible = true,
  hintMode,
  hintModeOptions,
  onHintModeChange,
  choiceCount,
  onChoiceCountChange,
  choiceCountVisible = false,
  inputMethod = "keyboard",
  onInputMethodChange,
  inputMethodVisible = false,
  showImage,
  onShowImageChange,
  extraHintSettings,
  showLetterCount,
  onShowLetterCountChange,
  showLetterCountVisible = true,
  forceVirtualKeyboard,
  onForceVirtualKeyboardChange,
  forceVirtualKeyboardVisible = true,
  shuffleQuestions,
  onShuffleQuestionsChange,
  questionTimeLimit,
  onQuestionTimeLimitChange,
  questionTimeLimitVisible = true,
  examTimeValue,
  onExamTimeValueChange,
  showExamAnswers,
  onShowExamAnswersChange,
}: ActivitySettingsPanelProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 mb-4">
      {/* 作業模式（assignmentModeVisible=false 時隱藏） */}
      {assignmentModeVisible && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">作業模式</label>
          <select
            value={assignmentMode}
            onChange={(e) =>
              onAssignmentModeChange(e.target.value as AssignmentMode)
            }
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white"
          >
            <option value="practice">練習</option>
            <option value="exam">考試</option>
          </select>
        </div>
      )}

      {/* 提示方式 */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600">提示方式</label>
        <select
          value={hintMode}
          onChange={(e) => onHintModeChange(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white"
        >
          {hintModeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* 選項數量（選擇題模式專屬） */}
      {choiceCountVisible && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">選項數量</label>
          <select
            value={choiceCount}
            onChange={(e) => onChoiceCountChange?.(Number(e.target.value))}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white"
          >
            <option value={2}>2 個</option>
            <option value={3}>3 個</option>
            <option value={4}>4 個</option>
          </select>
        </div>
      )}

      {/* 輸入方式（選擇題模式等情境下可隱藏） */}
      {inputMethodVisible && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">輸入方式</label>
          <select
            value={inputMethod}
            onChange={(e) =>
              onInputMethodChange?.(e.target.value as "keyboard" | "handwriting" | "drawing")
            }
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white"
          >
            <option value="keyboard">鍵盤</option>
            <option value="handwriting">手寫</option>
            <option value="drawing">作畫</option>
          </select>
        </div>
      )}

      {/* 顯示圖片 */}
      <SettingCheckbox
        checked={showImage}
        onChange={onShowImageChange}
        label="顯示圖片"
      />

      {/* 活動專屬的提示方式附加選項 */}
      {extraHintSettings}

      {/* 顯示字母數（字庫模式等情境下可隱藏） */}
      {showLetterCountVisible && (
        <SettingCheckbox
          checked={showLetterCount}
          onChange={onShowLetterCountChange}
          label="顯示字母數"
        />
      )}

      {/* 強制顯示虛擬鍵盤（手寫模式下隱藏；forceVirtualKeyboardVisible=false 時整個隱藏） */}
      {forceVirtualKeyboardVisible && inputMethod !== "handwriting" && inputMethod !== "drawing" && (
        <SettingCheckbox
          checked={forceVirtualKeyboard}
          onChange={onForceVirtualKeyboardChange}
          label="強制顯示虛擬鍵盤"
        />
      )}

      {/* 打亂題目 */}
      <SettingCheckbox
        checked={shuffleQuestions}
        onChange={onShuffleQuestionsChange}
        label="打亂題目"
      />

      {/* 每題限時 */}
      {questionTimeLimitVisible && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">每題限時</label>
          <select
            value={questionTimeLimit ?? "none"}
            onChange={(e) => {
              const v = e.target.value;
              onQuestionTimeLimitChange(v === "none" ? null : Number(v));
            }}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white"
          >
            <option value="none">不限時</option>
            <option value={10}>10 秒</option>
            <option value={20}>20 秒</option>
            <option value={30}>30 秒</option>
          </select>
        </div>
      )}

      {/* 考試模式：考試時間 */}
      {assignmentMode === "exam" && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">考試時間（時:分）</label>
          <input
            type="text"
            value={examTimeValue}
            maxLength={5}
            placeholder="00:10"
            onChange={(e) => {
              // 只允許數字與冒號
              if (/^[\d:]*$/.test(e.target.value)) {
                onExamTimeValueChange(e.target.value);
              }
            }}
            onBlur={(e) => {
              const match = e.target.value.match(/^(\d{1,2}):(\d{2})$/);
              if (!match) { onExamTimeValueChange("00:10"); return; }
              const h = parseInt(match[1]);
              const m = parseInt(match[2]);
              const totalSeconds = (h * 60 + m) * 60;
              if (totalSeconds > MAX_EXAM_SECONDS) {
                onExamTimeValueChange("02:00");
              } else if (h === 0 && m === 0) {
                onExamTimeValueChange("00:01");
              } else {
                onExamTimeValueChange(
                  `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
                );
              }
            }}
            className="w-20 border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white text-center font-mono"
          />
        </div>
      )}

      {/* 考試模式：考後顯示答案 */}
      {assignmentMode === "exam" && (
        <SettingCheckbox
          checked={showExamAnswers}
          onChange={onShowExamAnswersChange}
          label="考後顯示答案"
        />
      )}
    </div>
  );
}

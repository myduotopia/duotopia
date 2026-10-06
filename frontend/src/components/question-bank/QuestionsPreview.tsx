/**
 * 小題／單題預覽列表（Issue #1082）：題幹＋插圖＋選項，**不含答案、解析、考點**。
 *
 * 題組預覽（`GroupPreview`）的小題區與選擇題面板的「預覽」共用這一個元件；
 * 之後學生端作答畫面（P4）也以它為基礎，所以是純展示、不吃任何編輯狀態。
 *
 * - 編號 `numbering`：
 *   - `"sequential"`：依陣列順序 1..n（閱讀題組小題、選擇題面板的所有單題）
 *   - `"blank"`：克漏字。顯示徽章「空格 n」、不顯示題幹（題幹是 AI 填的「Fill in blank (n).」之類，
 *     學生看的是文章裡的空格）。`blank_index` 列在 `missingBlanks`（文章裡已沒有這個空格）時改顯示
 *     琥珀色「找不到空格 n」標記；`blank_index` 為 null（小題還沒指定空格）顯示同樣琥珀色的
 *     「未指定空格」。排序由呼叫端負責（`sortClozeQuestions`）
 * - 題幹用 `InlineText`（`**` 粗體、`__` 底線、`==` 雙底線）；題幹插圖在題幹下方，可點擊放大
 *   （最高 240px、等比縮放不裁切）
 * - 選項 A–F：無字無圖的選項（`optionFilled` 為 false）不顯示，字母依顯示順序重排；
 *   圖片選項限制在 160×160px 內等比縮放（object-contain，永遠看得到整張圖）、可點擊放大
 * - 選項排版：四個以內且每個文字都短（≤ 30 字）→ 桌機 2×2（手機寬度自動單欄）；
 *   否則直排；`forceStack`（手機預覽）一律直排
 * - 長單字／網址以 `break-words` 換行，不撐破版面
 * - testid：每題 `${testId}-q-${i}`，其下 `-number`／`-blank`／`-blank-missing`／`-stem-image`／
 *   `-options`／`-opt-${j}`／`-opt-${j}-image`
 */

import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { InlineText, ZoomableImage } from "./LayoutRenderer";
import {
  optionFilled,
  type OptionDraft,
  type QuestionDraft,
} from "./questionDraft";

export interface QuestionsPreviewProps {
  questions: QuestionDraft[];
  /** sequential = 1..n；blank = 克漏字「空格 n」徽章、不顯示題幹 */
  numbering?: "sequential" | "blank";
  /** 克漏字：文章裡已找不到的空格編號（顯示「找不到空格」標記） */
  missingBlanks?: number[];
  /** 手機預覽：選項一律直排 */
  forceStack?: boolean;
  className?: string;
  testId?: string;
}

/** 選項文字在這個長度以內才算「短」，可排 2×2 */
const SHORT_OPTION_CHARS = 30;
const MAX_GRID_OPTIONS = 4;

/** 四個以內且每個文字都短 → 2×2；圖片選項（最大寬 160px）也算短 */
function optionsUseGrid(options: OptionDraft[]): boolean {
  return (
    options.length > 0 &&
    options.length <= MAX_GRID_OPTIONS &&
    options.every((o) => o.text.trim().length <= SHORT_OPTION_CHARS)
  );
}

function PreviewQuestion({
  q,
  index,
  cloze,
  blankMissing,
  forceStack,
  testId,
}: {
  q: QuestionDraft;
  index: number;
  cloze: boolean;
  blankMissing: boolean;
  forceStack: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const options = q.options.filter(optionFilled);
  const grid = !forceStack && optionsUseGrid(options);
  const stem = cloze ? "" : q.stem.trim();

  let marker;
  if (!cloze) {
    marker = (
      <span className="shrink-0 font-semibold" data-testid={`${testId}-number`}>
        {index + 1}.
      </span>
    );
  } else if (blankMissing) {
    marker = (
      <span
        className="shrink-0 rounded bg-amber-50 px-2 py-0.5 text-sm font-medium text-amber-700"
        data-testid={`${testId}-blank-missing`}
      >
        {q.blank_index === null
          ? t("questionBank.group.questions.blankUnassigned")
          : t("questionBank.group.questions.blankMissing", {
              n: q.blank_index,
            })}
      </span>
    );
  } else {
    marker = (
      <span
        className="shrink-0 rounded bg-sky-100 px-2 py-0.5 text-sm font-semibold text-sky-700"
        data-testid={`${testId}-blank`}
      >
        {t("questionBank.group.questions.blankN", { n: q.blank_index })}
      </span>
    );
  }

  return (
    <li className="min-w-0 space-y-2 break-words" data-testid={testId}>
      <div className="flex items-start gap-2">
        {marker}
        {stem && (
          <InlineText
            text={q.stem}
            className="min-w-0 whitespace-pre-wrap break-words leading-relaxed"
          />
        )}
      </div>
      {q.image_url && (
        <div className="pl-6">
          <ZoomableImage
            src={q.image_url}
            className="h-auto max-h-60 w-auto max-w-full rounded border border-gray-200 object-contain"
            testId={`${testId}-stem-image`}
          />
        </div>
      )}
      {options.length > 0 && (
        <ol
          className={cn(
            "pl-6",
            grid
              ? "grid grid-cols-1 gap-x-6 gap-y-1.5 md:grid-cols-2"
              : "flex flex-col gap-1.5",
          )}
          data-testid={`${testId}-options`}
          data-layout={grid ? "grid" : "stack"}
        >
          {options.map((o, j) => (
            <li
              key={j}
              className="flex min-w-0 items-start gap-2"
              data-testid={`${testId}-opt-${j}`}
            >
              <span className="shrink-0 font-medium">
                ({String.fromCharCode(65 + j)})
              </span>
              <div className="min-w-0 space-y-1 break-words">
                {o.image_url && (
                  <ZoomableImage
                    src={o.image_url}
                    className="h-auto max-h-[160px] w-auto max-w-[160px] rounded border border-gray-200 object-contain"
                    testId={`${testId}-opt-${j}-image`}
                  />
                )}
                {o.text.trim() && (
                  <InlineText
                    text={o.text}
                    className="block whitespace-pre-wrap break-words leading-relaxed"
                  />
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export default function QuestionsPreview({
  questions,
  numbering = "sequential",
  missingBlanks = [],
  forceStack = false,
  className,
  testId = "questions-preview",
}: QuestionsPreviewProps) {
  const cloze = numbering === "blank";
  return (
    <ol className={cn("space-y-5", className)} data-testid={`${testId}-list`}>
      {questions.map((q, i) => (
        <PreviewQuestion
          key={q.key}
          q={q}
          index={i}
          cloze={cloze}
          blankMissing={
            cloze &&
            (q.blank_index === null || missingBlanks.includes(q.blank_index))
          }
          forceStack={forceStack}
          testId={`${testId}-q-${i}`}
        />
      ))}
    </ol>
  );
}

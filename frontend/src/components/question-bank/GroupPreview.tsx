/**
 * 題組完整預覽（Issue #1082）：主圖文＋小題＋選項，**不含答案**。
 *
 * 老師按「預覽」看到的就是學生拿到的整個題組；之後學生端作答畫面（P4）也以這個元件為基礎，
 * 所以它是純展示：不顯示正確答案、解析、考點，也不吃任何編輯狀態。
 *
 * - 上：主圖文用共用 `LayoutRenderer`（含單字註解、圖片點擊放大）。沒有 layout 時退回顯示
 *   題組圖（`image_url`）與 `passage_text`
 * - 下：小題列表
 *   - 編號：閱讀題組依陣列順序 1..n；克漏字依 `blank_index` 排序、顯示徽章「空格 n」且不顯示題幹
 *     （克漏字的題幹是 AI 填的「Fill in blank (n).」之類，學生看的是文章裡的空格）
 *   - 題幹用 `InlineText`（`**` 粗體、`__` 底線、`==` 雙底線）；題幹插圖在題幹下方，可點擊放大
 *   - 選項 A–F：無字無圖的選項不顯示，字母依顯示順序重排；圖片選項最大寬 160px、可點擊放大
 *   - 選項排版：四個以內且每個文字都短（≤ 30 字）→ 桌機 2×2（手機寬度自動單欄）；
 *     否則直排；`forceStack`（手機預覽）一律直排
 * - 全空（無主圖文、無小題）顯示「還沒有內容」
 */

import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import LayoutRenderer, { InlineText, ZoomableImage } from "./LayoutRenderer";
import {
  sortClozeQuestions,
  type GroupDraft,
  type OptionDraft,
  type QuestionDraft,
} from "./questionDraft";

/** 預覽只需要的欄位；`GroupDraft` 可直接傳入 */
export type GroupPreviewData = Pick<
  GroupDraft,
  | "question_type"
  | "layout"
  | "glossary"
  | "image_url"
  | "passage_text"
  | "questions"
>;

export interface GroupPreviewProps {
  draft: GroupPreviewData;
  /** 手機預覽：主圖文欄位堆疊、選項一律直排 */
  forceStack?: boolean;
  className?: string;
  testId?: string;
}

/** 選項文字在這個長度以內才算「短」，可排 2×2 */
const SHORT_OPTION_CHARS = 30;
const MAX_GRID_OPTIONS = 4;

const optionVisible = (o: OptionDraft) =>
  o.text.trim() !== "" || Boolean(o.image_url);

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
  forceStack,
  testId,
}: {
  q: QuestionDraft;
  index: number;
  cloze: boolean;
  forceStack: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const options = q.options.filter(optionVisible);
  const grid = !forceStack && optionsUseGrid(options);
  const stem = cloze ? "" : q.stem.trim();

  return (
    <li className="space-y-2" data-testid={testId}>
      <div className="flex items-start gap-2">
        {cloze && q.blank_index !== null ? (
          <span
            className="shrink-0 rounded bg-sky-100 px-2 py-0.5 text-sm font-semibold text-sky-700"
            data-testid={`${testId}-blank`}
          >
            {t("questionBank.group.questions.blankN", { n: q.blank_index })}
          </span>
        ) : (
          <span
            className="shrink-0 font-semibold"
            data-testid={`${testId}-number`}
          >
            {index + 1}.
          </span>
        )}
        {stem && (
          <InlineText
            text={q.stem}
            className="min-w-0 whitespace-pre-wrap leading-relaxed"
          />
        )}
      </div>
      {q.image_url && (
        <div className="pl-6">
          <ZoomableImage
            src={q.image_url}
            className="h-auto max-h-60 max-w-full rounded border border-gray-200"
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
              <div className="min-w-0 space-y-1">
                {o.image_url && (
                  <ZoomableImage
                    src={o.image_url}
                    className="h-auto max-w-[160px] rounded border border-gray-200"
                    testId={`${testId}-opt-${j}-image`}
                  />
                )}
                {o.text.trim() && (
                  <InlineText
                    text={o.text}
                    className="block whitespace-pre-wrap leading-relaxed"
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

export default function GroupPreview({
  draft,
  forceStack = false,
  className,
  testId = "group-preview",
}: GroupPreviewProps) {
  const { t } = useTranslation();
  const cloze = draft.question_type === "cloze";
  const questions = cloze
    ? sortClozeQuestions(draft.questions)
    : draft.questions;
  const hasLayout = Boolean(draft.layout && draft.layout.rows.length > 0);
  const passage = draft.passage_text.trim();
  const hasStimulus = hasLayout || Boolean(draft.image_url) || passage !== "";

  if (!hasStimulus && questions.length === 0) {
    return (
      <p
        className="py-8 text-center text-sm text-gray-400"
        data-testid={`${testId}-empty`}
      >
        {t("questionBank.group.layout.empty")}
      </p>
    );
  }

  return (
    <div
      className={cn("space-y-6 text-[15px] text-gray-900", className)}
      data-testid={testId}
    >
      {hasLayout ? (
        <LayoutRenderer
          layout={draft.layout}
          glossary={draft.glossary}
          forceStack={forceStack}
        />
      ) : (
        hasStimulus && (
          <div className="space-y-3" data-testid={`${testId}-fallback`}>
            {draft.image_url && (
              <div className="flex justify-center">
                <ZoomableImage
                  src={draft.image_url}
                  className="h-auto max-w-full"
                />
              </div>
            )}
            {passage && (
              <p className="whitespace-pre-wrap leading-relaxed">
                <InlineText text={draft.passage_text} />
              </p>
            )}
          </div>
        )
      )}
      {questions.length > 0 && (
        <section
          className={cn("space-y-4", hasStimulus && "border-t pt-4")}
          data-testid={`${testId}-questions`}
        >
          <h3 className="text-sm font-semibold text-gray-500">
            {t("questionBank.group.preview.questionsTitle")}
          </h3>
          <ol className="space-y-5">
            {questions.map((q, i) => (
              <PreviewQuestion
                key={q.key}
                q={q}
                index={i}
                cloze={cloze}
                forceStack={forceStack}
                testId={`${testId}-q-${i}`}
              />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

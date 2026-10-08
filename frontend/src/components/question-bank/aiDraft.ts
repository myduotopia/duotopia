/**
 * AI 工具的草稿轉換（#1065；自 questionDraft.ts 拆出）：只填空的，不動老師已設的。
 *
 * - `draftsEligibleForAi`／`toAiInputs`：挑出可送 AI 的題並轉成 API 輸入（題組小題附主圖文）。
 * - `applyAiAnswers`／`applyAiAnalysis`：把 AI 結果套回草稿，回報 applied／skipped。
 * - `clozeAiStem`：克漏字小題題幹空白時送「Fill in blank (n).」。
 *
 * 依賴方向：aiDraft → draftCore（單題核心），不反向。外部一律從 `questionDraft.ts` 匯入。
 */

import type { GradeRange } from "@/components/shared/GradeRangeSlider";
import type {
  AiAnalyzeResult,
  AiAnswerResult,
  AiQuestionInput,
} from "@/types/questionBank";
import { type QuestionDraft, optionFilled } from "./draftCore";

// --------------------------------------------------------------------------- #
// AI 工具（#1065）：只填空的，不動老師已設的
// --------------------------------------------------------------------------- #

/** 克漏字小題送 AI 的題幹：老師沒自己打就用「Fill in blank (n).」 */
export function clozeAiStem(d: QuestionDraft): string {
  const own = d.stem.trim();
  if (own) return own;
  return d.blank_index === null
    ? "Fill in the blank."
    : `Fill in blank (${d.blank_index}).`;
}

/** 可送給 AI 的題：有題幹文字（或題組小題有主圖文上下文）且有填的選項 ≥ 2；只有插圖的題 AI 讀不到 */
export function draftsEligibleForAi(
  drafts: QuestionDraft[],
  passageByKey: Map<string, string> = new Map(),
): QuestionDraft[] {
  return drafts.filter(
    (d) =>
      (d.stem.trim() !== "" || passageByKey.has(d.key)) &&
      d.options.filter(optionFilled).length >= 2,
  );
}

/** 轉成 API 輸入；options 只送有填的（index 對應 applyAiAnswers 用 filled 順序）；題組小題附主圖文 */
export function toAiInputs(
  drafts: QuestionDraft[],
  passageByKey: Map<string, string> = new Map(),
): AiQuestionInput[] {
  return drafts.map((d) => {
    const passage = passageByKey.get(d.key);
    return {
      key: d.key,
      // 克漏字小題題幹通常是空的 → 送「Fill in blank (n).」讓模型知道要填哪一格
      stem: d.question_type === "cloze" ? clozeAiStem(d) : d.stem.trim(),
      options: d.options
        .filter(optionFilled)
        .map((o) => o.text.trim() || "(圖片選項)"),
      ...(passage ? { passage } : {}),
    };
  });
}

export interface ApplyResult {
  drafts: QuestionDraft[];
  applied: number;
  /** 老師已設定而略過的題數（AI 回了但不覆寫） */
  skipped: number;
}

/**
 * AI 作答：只對「沒有任何正確答案」的題套 correct_indexes（index 對應有填的選項順序）；
 * 一個以上 index 自動開啟複選；解析只在空的時候填。
 */
export function applyAiAnswers(
  drafts: QuestionDraft[],
  results: AiAnswerResult[],
): ApplyResult {
  const byKey = new Map(results.map((r) => [r.key, r]));
  let applied = 0;
  let skipped = 0;
  const next = drafts.map((d) => {
    const r = byKey.get(d.key);
    if (!r) return d;
    const hasAnswer = d.options.some((o) => o.is_correct);
    const filledIdx = d.options
      .map((o, i) => (optionFilled(o) ? i : -1))
      .filter((i) => i >= 0);
    const targets = r.correct_indexes
      .map((i) => filledIdx[i])
      .filter((i): i is number => i !== undefined);
    if (hasAnswer || targets.length === 0) {
      // 答案已設：只補空的解析，不算 applied
      if (!hasAnswer) skipped += 1;
      else {
        skipped += 1;
        if (!d.explanation.trim() && r.explanation) {
          return { ...d, explanation: r.explanation };
        }
      }
      return d;
    }
    applied += 1;
    return {
      ...d,
      allow_multiple: targets.length > 1 ? true : d.allow_multiple,
      options: d.options.map((o, i) =>
        targets.includes(i) ? { ...o, is_correct: true } : o,
      ),
      explanation: d.explanation.trim() ? d.explanation : r.explanation,
    };
  });
  return { drafts: next, applied, skipped };
}

/**
 * AI 考點分析：考點只在「沒選」時填；年段只在「不限」時填。
 * 兩者都已設定的題算 skipped。
 */
export function applyAiAnalysis(
  drafts: QuestionDraft[],
  results: AiAnalyzeResult[],
): ApplyResult {
  const byKey = new Map(results.map((r) => [r.key, r]));
  let applied = 0;
  let skipped = 0;
  const next = drafts.map((d) => {
    const r = byKey.get(d.key);
    if (!r) return d;
    const fillPoints = d.exam_points.length === 0 && r.exam_points.length > 0;
    const fillGrade =
      d.grade[0] === null &&
      d.grade[1] === null &&
      (r.grade_min !== null || r.grade_max !== null);
    if (!fillPoints && !fillGrade) {
      skipped += 1;
      return d;
    }
    applied += 1;
    return {
      ...d,
      exam_points: fillPoints ? r.exam_points : d.exam_points,
      grade: fillGrade ? ([r.grade_min, r.grade_max] as GradeRange) : d.grade,
      // 有填年段就展開進階設定讓老師看到
      advancedOpen: d.advancedOpen || fillGrade,
    };
  });
  return { drafts: next, applied, skipped };
}

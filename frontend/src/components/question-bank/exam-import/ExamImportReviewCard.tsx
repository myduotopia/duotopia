/**
 * 上傳題本核對畫面的一張題目卡（#1112 C4b；設計文件第五節「逐題核對」「右邊欄」「編輯一題」「處理失敗」）。
 *
 * **唯讀**（像一份可以編輯的紙本考卷）：沒有外框、靠留白分開，題組上下各一條細線；滑鼠移上去整張變淡底色，
 * 點任何地方（按鈕以外）都進入編輯，右上常駐淡灰鉛筆。內容用題庫的預覽元件（不複製）：
 * 單題 `QuestionsPreview`、題組 `GroupPreview`（長文章收合「展開全文」），選項全部展開、正確選項綠字＋✓，
 * 編號＝原卷題號。每題右邊欄：答案字母（綠）、答案來源 clip（答案頁灰／AI 作答紫；老師改過不顯示）、
 * 考點 clip。需注意的題左邊一條對應顏色的短豎線；導覽目前這題淡藍底。
 * 卡片上方提示：題庫已有（藍字＋「看原題」）、題目文字相同（A4 文字）、這份題本內重複、處理失敗
 * （「重試」：次數還有、不是手動補的卡；「手動補這一題」＝打開編輯）、上次存入被退回的原因（紅字）。
 * 存入時因重複被略過（duplicate／same_stem／duplicate_in_import）只顯示藍字「這題重複」類說明、不再加
 * 紅字（C4b 審查 7）；`pending_continuation` 用灰字「等下一頁處理完再存」。
 * **還不能編輯**（`locked`：頁上最後一張題組、下一頁還沒處理完；C4b 審查 1）：鉛筆停用、點卡片不打開，
 * 滑鼠停留與卡上灰字都說明「下一頁處理完才能編輯」。延續上一頁卻沒自動合併的題組（上一個題組已編輯或
 * 已存入）卡上說明「接續上一頁的題組…未自動合併」（C4a 修正 4）。
 * 小題位置以 `cardToUnitWithOrder` 的對照表對回卡片原題（克漏字依空格排序過也對得上）。
 * 題組標題旁的喇叭先停用、標「即將推出」（A5）。
 *
 * **編輯**：原位展開，最上方原卷這一題的截圖（ExamImportOriginalCrop），表單嵌 `QuestionCard`／
 * `GroupCard`（題庫規則 7：不複製；`hideScopeSettings` 不顯示教材年段、不查相似題）。題組的音檔操作
 * （重新產生、換口音、上傳錄音）停用＋「即將推出」。底部「完成」（主按鈕，收合＝存回草稿）、「取消」、
 * 「刪除這一題」（紅字次要鈕，外層 ConfirmDialog 確認）。
 */
import { useMemo, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Pencil, RefreshCw, Upload, Volume2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TTSSettingsState } from "@/components/shared/BatchTTSSettings";
import type { Program } from "@/types";
import { examPointLabel } from "@/types/questionBank";
import GroupCard from "../GroupCard";
import GroupPreview from "../GroupPreview";
import QuestionCard from "../QuestionCard";
import QuestionsPreview from "../QuestionsPreview";
import type { QuestionDraft } from "../questionDraft";
import { cardToUnitWithOrder, examPointsOf } from "./cardDraft";
import ExamImportOriginalCrop from "./ExamImportOriginalCrop";
import {
  entryDomId,
  entryKey,
  needsAttention,
  questionIssue,
  type ReviewIssue,
} from "./reviewModel";
import type {
  ExamImportCard,
  ExamImportCardQuestion,
  ExamImportSaveFailure,
} from "./types";
import type { ExamImportReviewState } from "./useExamImportReview";

const DEFAULT_TTS: TTSSettingsState = {
  accent: "American English",
  gender: "Male",
  speed: "Normal x1",
};

const MARKER: Partial<Record<ReviewIssue, string>> = {
  missing: "border-l-4 border-amber-400 pl-2",
  failed: "border-l-4 border-red-400 pl-2",
  saveFailed: "border-l-4 border-red-400 pl-2",
  importDuplicate: "border-l-4 border-blue-400 pl-2",
};

/** 存入時因重複略過的原因：卡上只用藍字說明，不加紅字 */
const DUPLICATE_REASONS: Record<string, string> = {
  duplicate: "duplicate",
  same_stem: "sameStem",
  duplicate_in_import: "importDuplicate",
};

interface Props {
  card: ExamImportCard;
  pageImageUrl: string | null;
  /** 卡片裡每題的導覽標籤（原卷題號或流水號），依卡片原順序 */
  labels: string[];
  review: ExamImportReviewState;
  programs: Program[];
  retryLimit: number;
  failure?: ExamImportSaveFailure;
  /** 還不能編輯（下一頁還沒處理完，可能還會併進內容） */
  locked?: boolean;
  /** 延續上一頁卻沒自動合併 */
  unmergedContinuation?: boolean;
}

function letters(indexes: number[]): string {
  return indexes.map((i) => String.fromCharCode(65 + i)).join("、");
}

export default function ExamImportReviewCard({
  card,
  pageImageUrl,
  labels,
  review,
  programs,
  retryLimit,
  failure,
  locked = false,
  unmergedContinuation = false,
}: Props) {
  const { t, i18n } = useTranslation();
  const editing = review.editing?.cardId === card.card_id;
  const busy = review.busyCard === card.card_id;
  const { unit, originalIndex: orderMap } = useMemo(
    () => cardToUnitWithOrder(card, review.catalog),
    [card, review.catalog],
  );
  /** 草稿小題 → 卡片原本那一題的位置 */
  const originalIndex = (d: QuestionDraft, i: number) => orderMap[d.key] ?? i;
  const lockedText = t("questionBank.examImport.review.lockedUntilNextPage");
  const cardQs: ExamImportCardQuestion[] =
    card.kind === "group"
      ? (card.group?.questions ?? [])
      : card.question
        ? [card.question]
        : [];
  const comingSoon = t("questionBank.comingSoon");
  const tid = (s: string) => `exam-card-${card.card_id}-${s}`;

  const aside = (d: QuestionDraft, i: number): ReactNode => {
    const q = cardQs[originalIndex(d, i)] ?? {};
    const correct = q.correct_indexes ?? [];
    const points = examPointsOf(q, review.catalog);
    return (
      <div className="flex flex-wrap items-center gap-1.5 sm:flex-col sm:items-start">
        {correct.length > 0 ? (
          <span
            className="text-sm font-semibold text-green-700"
            data-testid={tid(`answer-${i}`)}
          >
            {t("questionBank.examImport.review.answer", {
              answer: letters(correct),
            })}
          </span>
        ) : (
          <span
            className="text-sm font-medium text-amber-700"
            data-testid={tid(`missing-${i}`)}
          >
            {t("questionBank.examImport.review.issue.missing")}
          </span>
        )}
        {correct.length > 0 && q.answer_source === "answer_page" && (
          <Badge
            variant="outline"
            className="border-gray-300 bg-gray-100 text-gray-700"
          >
            {t("questionBank.examImport.review.source.answerPage")}
          </Badge>
        )}
        {correct.length > 0 && q.answer_source === "ai" && (
          <Badge
            variant="outline"
            className="border-purple-200 bg-purple-50 text-purple-700"
          >
            {t("questionBank.examImport.review.source.ai")}
          </Badge>
        )}
        {points.map((ep) => (
          <Badge
            key={ep.id}
            variant="outline"
            className="font-normal text-gray-600"
          >
            {examPointLabel(ep, i18n.language)}
          </Badge>
        ))}
      </div>
    );
  };

  const itemAttrs = (d: QuestionDraft, i: number) => {
    const at = originalIndex(d, i);
    const key = entryKey(card.card_id, at);
    const issue = questionIssue(card, cardQs[at] ?? {}, failure);
    return {
      id: entryDomId(key),
      className: cn(
        "rounded-sm",
        needsAttention(issue) && MARKER[issue as ReviewIssue],
        review.currentKey === key && "bg-blue-50",
      ),
    };
  };

  // ---- 卡片上方提示 ----
  const dup = card.duplicate_of;
  const canRetry =
    card.status === "failed" &&
    !card.manual &&
    (card.retry_count ?? 0) < retryLimit;
  const notices: ReactNode[] = [];
  if (dup?.type === "bank")
    notices.push(
      <p
        key="dup"
        className="flex flex-wrap items-center gap-2 text-sm text-blue-700"
        data-testid={tid("duplicate")}
      >
        {dup.reason === "same_stem"
          ? t("questionBank.examImport.review.issue.sameStem")
          : t("questionBank.examImport.review.issue.duplicate")}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => review.showDuplicate({ kind: dup.kind, id: dup.id })}
          data-testid={tid("view-original")}
        >
          {t("questionBank.examImport.review.viewOriginal")}
        </Button>
      </p>,
    );
  if (dup?.type === "import")
    notices.push(
      <p
        key="dupi"
        className="text-sm text-blue-700"
        data-testid={tid("duplicate-import")}
      >
        {t("questionBank.examImport.review.issue.importDuplicate")}
      </p>,
    );
  if (card.status === "failed")
    notices.push(
      <div
        key="failed"
        className="flex flex-wrap items-center gap-2 text-sm text-red-600"
        data-testid={tid("failed")}
      >
        {t("questionBank.examImport.review.issue.failed")}
        {canRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1"
            disabled={busy}
            onClick={() => void review.retryCard(card)}
            data-testid={tid("retry")}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t("questionBank.examImport.review.retry")}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => void review.startEditing(card)}
          disabled={locked}
          title={locked ? lockedText : undefined}
          data-testid={tid("manual")}
        >
          {t("questionBank.examImport.review.manualFill")}
        </Button>
      </div>,
    );
  const dupFailure = failure ? DUPLICATE_REASONS[failure.reason] : undefined;
  if (dupFailure) {
    // 重複：卡上已有藍字說明就不再加；存入時才查到的（卡上還沒標）補一行藍字
    if (!dup)
      notices.push(
        <p
          key="fail"
          className="text-sm text-blue-700"
          data-testid={tid("save-duplicate")}
        >
          {t(`questionBank.examImport.review.issue.${dupFailure}`)}
        </p>,
      );
  } else if (failure?.reason === "pending_continuation") {
    notices.push(
      <p
        key="fail"
        className="text-sm text-gray-600"
        data-testid={tid("save-pending")}
      >
        {t("questionBank.examImport.review.pendingContinuation")}
      </p>,
    );
  } else if (failure) {
    notices.push(
      <p
        key="fail"
        className="text-sm text-red-600"
        data-testid={tid("save-failure")}
      >
        {failure.message}
      </p>,
    );
  }
  if (unmergedContinuation)
    notices.push(
      <p
        key="cont"
        className="text-sm text-gray-600"
        data-testid={tid("unmerged-continuation")}
      >
        {t("questionBank.examImport.review.unmergedContinuation")}
      </p>,
    );
  if (locked)
    notices.push(
      <p
        key="locked"
        className="text-sm text-gray-500"
        data-testid={tid("locked")}
      >
        {lockedText}
      </p>,
    );

  const onCardClick = (e: MouseEvent<HTMLDivElement>) => {
    if (editing || locked) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea, [role='dialog']")) return;
    void review.startEditing(card);
  };

  const isGroup = unit.kind === "group";
  const groupFrame = isGroup ? "border-y border-gray-200" : "";

  if (editing && review.editing) {
    const draftUnit = review.editing.unit;
    const bbox = card.bbox ?? card.question?.bbox ?? null;
    return (
      <div
        className={cn("space-y-3 bg-gray-50 px-3 py-4", groupFrame)}
        data-testid={tid("editor")}
      >
        {pageImageUrl && !card.manual && (
          <ExamImportOriginalCrop
            src={pageImageUrl}
            bbox={bbox}
            testId={tid("original")}
          />
        )}
        {draftUnit.kind === "single" ? (
          <QuestionCard
            index={0}
            draft={draftUnit.draft}
            onChange={(draft) => review.updateDraft({ kind: "single", draft })}
            ttsSettings={DEFAULT_TTS}
            programs={programs}
            errorMessage={null}
            showErrors={false}
            disabled={busy}
            checkSimilar={false}
            hideScopeSettings
            audioDisabledReason={comingSoon}
            testIdPrefix={`exam-qc-${card.card_id}`}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {[
                {
                  key: "regen",
                  icon: <RefreshCw className="h-3.5 w-3.5" />,
                  label: t("questionBank.examImport.review.voice.regenerate"),
                },
                {
                  key: "accent",
                  icon: <Volume2 className="h-3.5 w-3.5" />,
                  label: t("questionBank.examImport.review.voice.accent"),
                },
                {
                  key: "upload",
                  icon: <Upload className="h-3.5 w-3.5" />,
                  label: t("questionBank.examImport.review.voice.upload"),
                },
              ].map((b) => (
                <span key={b.key} title={comingSoon}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    disabled
                    data-testid={tid(`voice-${b.key}`)}
                  >
                    {b.icon}
                    {b.label}
                    <span className="text-xs opacity-80">{comingSoon}</span>
                  </Button>
                </span>
              ))}
            </div>
            <GroupCard
              index={0}
              draft={draftUnit.draft}
              onChange={(draft) => review.updateDraft({ kind: "group", draft })}
              ttsSettings={DEFAULT_TTS}
              programs={programs}
              errorMessage={null}
              showErrors={false}
              disabled={busy}
              hideScopeSettings
              audioDisabledReason={comingSoon}
            />
          </>
        )}
        {review.editError && (
          <p className="text-sm text-red-600" data-testid={tid("edit-error")}>
            {review.editError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="text-red-600 hover:text-red-700"
            onClick={() => review.requestDelete(card)}
            disabled={busy}
            data-testid={tid("delete")}
          >
            {t("questionBank.examImport.review.delete")}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={review.cancelEditing}
              disabled={busy}
              data-testid={tid("cancel")}
            >
              {t("common.cancel", "取消")}
            </Button>
            <Button
              type="button"
              onClick={() => void review.finishEditing()}
              disabled={busy}
              data-testid={tid("done")}
            >
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t("questionBank.examImport.review.done")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative space-y-2 rounded-md px-3 py-4 transition-colors",
        locked ? "cursor-default" : "cursor-pointer hover:bg-gray-50",
        groupFrame,
      )}
      onClick={onCardClick}
      title={locked ? lockedText : undefined}
      data-testid={tid("view")}
      data-locked={locked || undefined}
    >
      <button
        type="button"
        onClick={() => void review.startEditing(card)}
        disabled={locked}
        className="absolute right-2 top-2 rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-600 group-hover:text-gray-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        aria-label={
          locked
            ? `${t("questionBank.examImport.review.edit")}（${lockedText}）`
            : t("questionBank.examImport.review.edit")
        }
        title={locked ? lockedText : t("questionBank.examImport.review.edit")}
        data-testid={tid("edit")}
      >
        <Pencil className="h-4 w-4" />
      </button>
      {notices.length > 0 && <div className="space-y-1 pr-8">{notices}</div>}
      {unit.kind === "single" ? (
        <QuestionsPreview
          questions={[unit.draft]}
          numberLabels={labels}
          showAnswers
          aside={aside}
          itemAttrs={itemAttrs}
          className="pr-8"
          testId={tid("preview")}
        />
      ) : (
        <>
          <div className="flex items-center gap-2 pr-8">
            <span className="text-xs font-medium text-gray-500">
              {t(`questionBank.groupTypes.${unit.draft.question_type}`)}
            </span>
            <span title={comingSoon} className="inline-flex">
              <button
                type="button"
                disabled
                className="rounded p-1 text-gray-400 opacity-60"
                aria-label={`${t("questionBank.examImport.review.voice.play")}（${comingSoon}）`}
                data-testid={tid("speaker")}
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </span>
          </div>
          <GroupPreview
            draft={unit.draft}
            collapsibleStimulus
            showAnswers
            numberLabels={labels}
            aside={aside}
            itemAttrs={itemAttrs}
            className="pr-8"
            testId={tid("preview")}
          />
        </>
      )}
    </div>
  );
}

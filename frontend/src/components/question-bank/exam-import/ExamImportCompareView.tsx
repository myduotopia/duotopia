/**
 * 上傳題本核對畫面・「整頁對照原卷」分頁（#1112 C4c 第 4 點；cold-read E1／E8、定案 U2／U3；
 * 設計文件第五節）。
 *
 * - 左邊原卷整頁圖（本機畫好的頁圖，沒有就用後端存的頁圖；點圖用 ZoomableImage 放大），自己捲動；
 *   右邊這一頁擷取出的題目，**可以原位編輯**（同逐題核對的題目卡，U2）。兩邊一起換頁（頁碼列
 *   `ExamImportComparePager`：「‹ 第 N／總 頁 ›」，答案頁也算頁碼）。
 * - 滑鼠停在右邊某題（或點它、鍵盤移到它）→ 左邊畫出那一題在原卷的框（bbox [ymin, xmin, ymax, xmax]，
 *   0–1000），左欄自動捲到框。題組的小題用小題自己的框，沒有就用整組的框；跨頁題組只在框所在的頁畫
 *   （小題 `page_no` 不是這一頁就不畫）；手動補的題沒有框不畫。滑鼠離開右邊時留著最後點過的那一題的框。
 * - 右上沿用「原卷第 N 頁」那一行（ExamImportReviewPageRow：狀態、重送、手動補一題…）。
 * - 版面：平板（md～lg）上下排、筆電（≥ lg）左右排；手機（< md）不顯示這個分頁（外層處理，U3）。
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Program } from "@/types";
import { ZoomableImage } from "../LayoutRenderer";
import ExamImportReviewCard from "./ExamImportReviewCard";
import ExamImportReviewPageRow from "./ExamImportReviewPageRow";
import { continuationNotMerged, entryDomId } from "./reviewModel";
import {
  cardQuestions,
  type ExamImportCard,
  type PageMergeInfo,
} from "./types";
import type { ExamImportController } from "./useExamImport";
import type { ExamImportReviewState } from "./useExamImportReview";

const SCALE = 1000;

interface Target {
  cardId: string;
  /** 卡片原順序的小題位置；null＝整張卡 */
  index: number | null;
}

/** 這一題在這一頁的框；沒有、不在這一頁、手動補的題 → null */
export function compareBox(
  card: ExamImportCard | undefined,
  index: number | null,
  pageNo: number,
): number[] | null {
  if (!card || card.manual) return null;
  const valid = (b: number[] | null | undefined) =>
    !!b &&
    b.length === 4 &&
    b.every((v) => Number.isFinite(v)) &&
    b[2] > b[0] &&
    b[3] > b[1];
  if (index !== null) {
    const q = cardQuestions(card)[index];
    if (q && valid(q.bbox) && (q.page_no ?? card.page_no) === pageNo)
      return q.bbox as number[];
    if (q && q.page_no != null && q.page_no !== pageNo) return null;
  }
  if (valid(card.bbox) && card.page_no === pageNo) return card.bbox as number[];
  if (
    card.kind === "single" &&
    valid(card.question?.bbox) &&
    card.page_no === pageNo
  )
    return card.question!.bbox as number[];
  return null;
}

interface PagerProps {
  pageNo: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  onMove: (dir: 1 | -1) => void;
}

/** 整頁對照的頁碼列：「‹ 第 N／總 頁 ›」 */
export function ExamImportComparePager({
  pageNo,
  total,
  canPrev,
  canNext,
  onMove,
}: PagerProps) {
  const { t } = useTranslation();
  const p = "questionBank.examImport.review.compare";
  return (
    <div className="ml-auto flex items-center gap-1.5 text-sm text-gray-700">
      <span title={canPrev ? undefined : t(`${p}.firstPage`)}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onMove(-1)}
          disabled={!canPrev}
          aria-label={t(`${p}.prevPage`)}
          data-testid="exam-compare-prev"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </span>
      <span
        className="min-w-[5rem] text-center"
        data-testid="exam-compare-page"
      >
        {t(`${p}.page`, { n: pageNo, total })}
      </span>
      <span title={canNext ? undefined : t(`${p}.lastPage`)}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={() => onMove(1)}
          disabled={!canNext}
          aria-label={t(`${p}.nextPage`)}
          data-testid="exam-compare-next"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </span>
    </div>
  );
}

interface Props {
  controller: ExamImportController;
  review: ExamImportReviewState;
  programs: Program[];
  pageNo: number;
  merge: PageMergeInfo | undefined;
  labelsByCard: Map<string, string[]>;
}

export default function ExamImportCompareView({
  controller,
  review,
  programs,
  pageNo,
  merge,
  labelsByCard,
}: Props) {
  const { t } = useTranslation();
  const detail = controller.detail;
  const reviewPage = review.pages.find((p) => p.page.page_no === pageNo);
  const cards = reviewPage?.cards ?? [];
  const src = controller.thumbs[pageNo] ?? reviewPage?.page.image_url ?? null;
  const keyByDomId = useMemo(() => {
    const map = new Map<string, Target>();
    review.entries.forEach((e) => {
      if (e.cardId)
        map.set(entryDomId(e.key), {
          cardId: e.cardId,
          index: e.questionIndex,
        });
    });
    return map;
  }, [review.entries]);

  const [hover, setHover] = useState<Target | null>(null);
  const [pinned, setPinned] = useState<Target | null>(null);
  useEffect(() => {
    setHover(null);
    setPinned(null);
  }, [pageNo]);
  const active = hover ?? pinned;
  const box = active
    ? compareBox(
        cards.find((c) => c.card_id === active.cardId),
        active.index,
        pageNo,
      )
    : null;

  const targetOf = (e: SyntheticEvent): Target | null => {
    const el = e.target as HTMLElement;
    const q = el.closest<HTMLElement>("[id^='exam-review-']");
    const fromQ = q ? keyByDomId.get(q.id) : undefined;
    if (fromQ) return fromQ;
    const cardEl = el.closest<HTMLElement>("[data-compare-card]");
    const cardId = cardEl?.dataset.compareCard;
    return cardId ? { cardId, index: null } : null;
  };

  // 框換了 → 左欄捲到框（不動右邊）
  const leftRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const boxKey = box?.join(",") ?? "";
  useEffect(() => {
    const root = leftRef.current;
    const el = boxRef.current;
    if (!root || !el) return;
    const top =
      root.scrollTop +
      el.getBoundingClientRect().top -
      root.getBoundingClientRect().top -
      24;
    root.scrollTo?.({ top: Math.max(0, top), behavior: "smooth" });
  }, [boxKey]);

  if (!detail || !reviewPage) return null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col lg:flex-row"
      data-testid="exam-compare"
    >
      <div
        ref={leftRef}
        className="max-h-[45vh] shrink-0 overflow-y-auto border-b border-gray-200 bg-gray-50 p-4 lg:max-h-none lg:w-1/2 lg:border-b-0 lg:border-r"
        data-testid="exam-compare-original"
      >
        <p className="mb-2 text-xs text-gray-500">
          {t("questionBank.examImport.review.compare.hint", { n: pageNo })}
        </p>
        <div className="relative border border-gray-200 bg-white">
          {src ? (
            <ZoomableImage
              src={src}
              alt={t("questionBank.examImport.review.pageLabel", { n: pageNo })}
              buttonClassName="block w-full"
              className="block w-full"
              testId="exam-compare-image"
            />
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-gray-400">
              {t("questionBank.examImport.review.compare.noImage")}
            </div>
          )}
          {box && src && (
            <div
              ref={boxRef}
              className="pointer-events-none absolute rounded-sm border-2 border-blue-500 bg-blue-500/10"
              style={{
                top: `${(box[0] / SCALE) * 100}%`,
                left: `${(box[1] / SCALE) * 100}%`,
                height: `${((box[2] - box[0]) / SCALE) * 100}%`,
                width: `${((box[3] - box[1]) / SCALE) * 100}%`,
              }}
              data-testid="exam-compare-box"
            />
          )}
        </div>
      </div>

      <div
        className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4 pr-8 sm:pr-16"
        onMouseOver={(e) => setHover(targetOf(e))}
        onMouseLeave={() => setHover(null)}
        onFocusCapture={(e) => setPinned(targetOf(e) ?? pinned)}
        onClickCapture={(e) => setPinned(targetOf(e) ?? pinned)}
        data-testid="exam-compare-questions"
      >
        <ExamImportReviewPageRow
          page={reviewPage.page}
          hasCards={cards.length > 0}
          merge={merge}
          controller={controller}
          onAddCard={review.requestAdd}
        />
        {cards.map((card) => (
          <div key={card.card_id} data-compare-card={card.card_id}>
            <ExamImportReviewCard
              card={card}
              pageImageUrl={reviewPage.page.image_url}
              labels={labelsByCard.get(card.card_id) ?? []}
              review={review}
              programs={programs}
              retryLimit={detail.retry_limits.question_retries}
              failure={review.failures[card.card_id]}
              locked={review.locked.has(card.card_id)}
              unmergedContinuation={continuationNotMerged(detail, card)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

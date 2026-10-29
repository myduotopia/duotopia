/**
 * 上傳題本核對畫面・題號下拉列（#1112 C4c；取代 C4b 左側題號方格，QuestionNumberNav 已移除）。
 *
 * 「第 [N ▾] 題・還有 M 題待核對」＋「需注意 K 題 ‹ ›」（C4c 定案 U4、cold-read E3／E11）：
 * - 下拉用標準 Select，依「原卷第 P 頁」分組（跨頁題組歸起始頁），題組每個小題一列；每列＝原卷題號
 *   （沒有用流水號）＋狀態色點與文字（缺答案、處理失敗、上次存入沒成功、本份重複、題庫已有（會略過）、
 *   題目文字相同（會略過）、等下一頁）。處理中的頁在分組下一行灰字、不能選。
 * - 選了就捲到那題（只捲動；看原題用卡片上的「看原題」，E4）。選回目前這題也要能再捲過去：Radix 選同一個
 *   值不會觸發 onValueChange，所以每列另外接 click／pointerup／Enter 處理「選同一題」。
 * - 觸發鈕只顯示題號（`SelectValue` 的 children），N 由捲動偵測更新。
 * - M＝畫面上還沒存的題數（存掉一批會變少）；手機（< sm）放不下，省略。
 * - 需注意 ‹ ›：上一個／下一個需注意的題，到頭尾循環；0 題時停用並說明「沒有需要注意的題目」。
 */
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  pickerGroups,
  type PickerStatus,
  type ReviewEntry,
} from "./reviewModel";

const STATUS_COLOR: Record<PickerStatus, { dot: string; text: string }> = {
  missing: { dot: "bg-amber-500", text: "text-amber-700" },
  importDuplicate: { dot: "bg-amber-500", text: "text-amber-700" },
  failed: { dot: "bg-red-500", text: "text-red-600" },
  saveFailed: { dot: "bg-red-500", text: "text-red-600" },
  duplicate: { dot: "bg-blue-500", text: "text-blue-700" },
  sameStem: { dot: "bg-blue-500", text: "text-blue-700" },
  pending: { dot: "bg-gray-400", text: "text-gray-500" },
};

interface Props {
  entries: ReviewEntry[];
  currentKey: string | null;
  statusOf: (entry: ReviewEntry) => PickerStatus | null;
  /** 畫面上還沒存的題數 */
  remaining: number;
  attentionCount: number;
  onPick: (key: string) => void;
  onAttention: (dir: 1 | -1) => void;
}

export default function ExamImportQuestionPicker({
  entries,
  currentKey,
  statusOf,
  remaining,
  attentionCount,
  onPick,
  onAttention,
}: Props) {
  const { t } = useTranslation();
  const groups = pickerGroups(entries);
  const current = entries.find((e) => e.key === currentKey && e.cardId);
  const noAttention = attentionCount === 0;
  const noAttentionText = t("questionBank.examImport.review.noAttention");
  const repick = (key: string) => {
    if (key === current?.key) onPick(key);
  };
  const repickKey = (key: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") repick(key);
  };

  return (
    <div
      className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 text-sm"
      data-testid="exam-review-picker-row"
    >
      <div className="flex items-center gap-1.5 text-gray-700">
        <span>{t("questionBank.examImport.review.picker.before")}</span>
        <Select value={current?.key ?? ""} onValueChange={onPick}>
          <SelectTrigger
            className="h-9 w-20"
            aria-label={t("questionBank.examImport.review.picker.label")}
            data-testid="exam-review-picker"
          >
            <SelectValue
              placeholder={t("questionBank.examImport.review.picker.none")}
            >
              {current?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="max-h-80 w-64">
            {groups.map((g) => (
              <SelectGroup key={g.pageNo}>
                <SelectLabel className="pl-2 text-xs font-medium text-gray-500">
                  {t("questionBank.examImport.review.pageLabel", {
                    n: g.pageNo,
                  })}
                </SelectLabel>
                {g.entries.map((e) => {
                  const status = statusOf(e);
                  return (
                    <SelectItem
                      key={e.key}
                      value={e.key}
                      onClick={() => repick(e.key)}
                      onPointerUp={() => repick(e.key)}
                      onKeyDown={repickKey(e.key)}
                      data-testid={`exam-review-picker-item-${e.key}`}
                    >
                      <span className="inline-block w-8 font-medium">
                        {e.label}
                      </span>
                      {status && (
                        <span
                          className={cn(
                            "ml-2 inline-flex items-center gap-1 text-xs",
                            STATUS_COLOR[status].text,
                          )}
                          data-status={status}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              STATUS_COLOR[status].dot,
                            )}
                            aria-hidden="true"
                          />
                          {t(`questionBank.examImport.review.status.${status}`)}
                        </span>
                      )}
                    </SelectItem>
                  );
                })}
                {g.processing && (
                  <div
                    className="py-1.5 pl-8 pr-2 text-xs text-gray-400"
                    data-testid={`exam-review-picker-processing-${g.pageNo}`}
                  >
                    {t("questionBank.examImport.review.picker.processing")}
                  </div>
                )}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <span>{t("questionBank.examImport.review.picker.after")}</span>
        <span
          className="ml-1 hidden text-gray-500 sm:inline"
          data-testid="exam-review-remaining"
        >
          {t("questionBank.examImport.review.picker.remaining", {
            count: remaining,
          })}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <span
          className={
            noAttention ? "text-gray-500" : "font-medium text-amber-700"
          }
          data-testid="exam-review-attention"
        >
          {t("questionBank.examImport.review.attention", {
            count: attentionCount,
          })}
        </span>
        {(
          [
            [-1, "prev", ChevronLeft],
            [1, "next", ChevronRight],
          ] as const
        ).map(([dir, name, Icon]) => {
          const label = t(
            `questionBank.examImport.review.picker.${name}Attention`,
          );
          return (
            <span key={name} title={noAttention ? noAttentionText : label}>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9"
                onClick={() => onAttention(dir)}
                disabled={noAttention}
                aria-label={
                  noAttention ? `${label}（${noAttentionText}）` : label
                }
                data-testid={`exam-review-attention-${name}`}
              >
                <Icon className="h-4 w-4" />
              </Button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

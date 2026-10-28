/**
 * 題庫列表工具列（#1082 自 QuestionBankTab 拆出）。
 *
 * 新增題目 ▽、搜尋（題幹＋來源）、題型下拉、考點多選（OR）、只看自己的。
 * 狀態都由 QuestionBankTab 持有（URL query），這裡只渲染與回呼。
 *
 * 「新增題目 ▽」三條路徑（#1112 C3，docs/design/question-bank-exam-import.md 第一節）：
 * 1. 上傳題本（第一項，附一行說明）→ `onUploadExam`。停用時小字說明原因：沒傳（機構題庫，C4 開放）
 *    →「即將推出」；`uploadExamBusy`（已有一份題本正在處理）→「目前有一份題本正在處理」
 * 2. AI 出題（#1114）：停用，標「即將推出」
 * 3. 分隔線下「自己出題」：現有題型清單（單一題型畫面 QuestionSheet）
 */

import { useTranslation } from "react-i18next";
import { ChevronDown, Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ExamPointPicker from "@/components/shared/ExamPointPicker";
import {
  examPointLabel,
  type ExamPoint,
  type QuestionType,
} from "@/types/questionBank";

const CREATE_TYPES_ORDER: QuestionType[] = [
  "multiple_choice",
  "reading",
  "cloze",
  "fill_in",
  "listening",
  "listening_image",
];
/** 題型下拉的選項順序（同新增清單） */
export const TYPE_FILTERS: QuestionType[] = CREATE_TYPES_ORDER;

/** 「新增題目 ▽」的題型清單；選擇題、閱讀題組（#1082）、克漏字題組（#1085）可用 */
const CREATE_TYPES: { type: QuestionType; enabled: boolean }[] = [
  { type: "multiple_choice", enabled: true },
  { type: "reading", enabled: true },
  { type: "cloze", enabled: true },
  { type: "fill_in", enabled: false },
  { type: "listening", enabled: false },
  { type: "listening_image", enabled: false },
];

export interface QuestionBankToolbarProps {
  scope: "mine" | "organization";
  canCreate: boolean;
  onCreate: (type: QuestionType) => void;
  /** 上傳題本（#1112）；沒傳＝停用、標「即將推出」（機構題庫 C4 開放） */
  onUploadExam?: () => void;
  /** 已有一份題本正在處理：「上傳題本」停用並說明原因 */
  uploadExamBusy?: boolean;
  typeLabel: (type: QuestionType) => string;
  /** 題型篩選的顯示名稱（題組類題型顯示「閱讀題組」） */
  filterTypeLabel: (type: QuestionType) => string;
  search: string;
  onChangeSearch: (value: string) => void;
  typeFilter: QuestionType | "";
  onChangeTypeFilter: (type: QuestionType | "") => void;
  examPointIds: number[];
  selectedExamPoints: ExamPoint[];
  onChangeExamPoints: (next: ExamPoint[]) => void;
  onClearExamPoints: () => void;
  onlyOwn: boolean;
  onChangeOnlyOwn: (on: boolean) => void;
}

export default function QuestionBankToolbar({
  scope,
  canCreate,
  onCreate,
  onUploadExam,
  uploadExamBusy = false,
  typeLabel,
  filterTypeLabel,
  search,
  onChangeSearch,
  typeFilter,
  onChangeTypeFilter,
  examPointIds,
  selectedExamPoints,
  onChangeExamPoints,
  onClearExamPoints,
  onlyOwn,
  onChangeOnlyOwn,
}: QuestionBankToolbarProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  // 「上傳題本」停用的原因（沒停用＝null）
  const uploadDisabledReason = !onUploadExam
    ? t("questionBank.examImport.menu.uploadComingSoon")
    : uploadExamBusy
      ? t("questionBank.examImport.menu.uploadBusy")
      : null;
  return (
    <div className="flex flex-col lg:flex-row lg:items-center gap-3">
      {/* 標題由上方的 tab 擔任（MaterialsPageTabs），這裡不再重複 */}
      <div className="hidden lg:block flex-1" />
      <div className="flex items-center gap-3">
        {canCreate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-[13px]"
                data-testid="question-bank-add"
              >
                <Plus size={16} />
                <span className="hidden sm:inline">
                  {t("questionBank.buttons.addQuestion")}
                </span>
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem
                disabled={uploadDisabledReason !== null}
                onSelect={() => onUploadExam?.()}
                className="flex-col items-start gap-0.5"
                title={uploadDisabledReason ?? undefined}
                data-testid="question-bank-add-exam-import"
              >
                <span className="font-medium">
                  {t("questionBank.examImport.menu.upload")}
                </span>
                <span
                  className="text-xs text-gray-500"
                  data-testid="question-bank-add-exam-import-hint"
                >
                  {uploadDisabledReason ??
                    t("questionBank.examImport.menu.uploadHint")}
                </span>
              </DropdownMenuItem>
              {/* AI 出題（#1114）：還沒做，停用＋「即將推出」 */}
              <DropdownMenuItem
                disabled
                data-testid="question-bank-add-ai-generate"
              >
                {t("questionBank.examImport.menu.aiGenerate")}
                <span className="ml-2 text-xs text-gray-400">
                  {t("questionBank.comingSoon")}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-gray-500">
                {t("questionBank.examImport.menu.selfAuthored")}
              </DropdownMenuLabel>
              {CREATE_TYPES.map(({ type, enabled }) => (
                <DropdownMenuItem
                  key={type}
                  disabled={!enabled}
                  onSelect={() => onCreate(type)}
                  data-testid={`question-bank-add-${type}`}
                >
                  {typeLabel(type)}
                  {!enabled && (
                    <span className="ml-2 text-xs text-gray-400">
                      {t("questionBank.comingSoon")}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <div className="relative flex-1 md:w-60 md:flex-none">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <Input
            placeholder={t("questionBank.searchPlaceholder")}
            value={search}
            onChange={(e) => onChangeSearch(e.target.value)}
            className="pl-8 h-9 text-[13px] border-gray-200 rounded-lg"
            data-testid="question-bank-search"
          />
        </div>
        <Select
          value={typeFilter || "all"}
          onValueChange={(v) =>
            onChangeTypeFilter(v === "all" ? "" : (v as QuestionType))
          }
        >
          <SelectTrigger
            className="h-9 w-32 text-[13px]"
            data-testid="question-bank-type-filter"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("questionBank.list.typeAll")}
            </SelectItem>
            {TYPE_FILTERS.map((type) => (
              <SelectItem key={type} value={type}>
                {filterTypeLabel(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* 考點多選 filter：trigger 對齊題型下拉；有選取時顯示前兩個名稱 + N */}
        <div className="flex items-center gap-1">
          <ExamPointPicker
            value={selectedExamPoints}
            onChange={onChangeExamPoints}
            compact
            renderTrigger={() => (
              <div
                className={`flex h-9 max-w-[220px] items-center gap-1 rounded-md border border-input bg-background px-3 text-[13px] ${
                  examPointIds.length > 0 ? "text-gray-900" : "text-gray-500"
                }`}
              >
                <span className="truncate">
                  {selectedExamPoints.length === 0
                    ? examPointIds.length > 0
                      ? t("questionBank.list.examPointSelected", {
                          count: examPointIds.length,
                        })
                      : t("questionBank.list.examPointAll")
                    : selectedExamPoints
                        .slice(0, 2)
                        .map((ep) => examPointLabel(ep, lang))
                        .join("、") +
                      (selectedExamPoints.length > 2
                        ? ` +${selectedExamPoints.length - 2}`
                        : "")}
                </span>
                <ChevronDown size={14} className="shrink-0 opacity-50" />
              </div>
            )}
            data-testid="qb-exam-point-filter"
          />
          {examPointIds.length > 0 && (
            <button
              type="button"
              className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              aria-label={t("questionBank.list.examPointClear")}
              title={t("questionBank.list.examPointClear")}
              onClick={onClearExamPoints}
              data-testid="qb-exam-point-clear"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-600 whitespace-nowrap">
          <Switch
            checked={onlyOwn}
            onCheckedChange={onChangeOnlyOwn}
            data-testid="question-bank-only-own"
          />
          {scope === "organization"
            ? t("questionBank.list.onlyOrg")
            : t("questionBank.list.onlyOwn")}
        </label>
      </div>
    </div>
  );
}

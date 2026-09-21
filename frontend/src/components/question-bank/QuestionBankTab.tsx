/**
 * 題庫 tab（Issue #1061 / #1063）。
 *
 * 嵌在「我的教材」與「機構教材」頁的 tab 裡，同一元件靠 `scope` 切換：
 * - scope="mine"          → 老師自己的題庫
 * - scope="organization"  → 機構題庫（需 organizationId）
 *
 * 本期（#1063）只做列表 + 「新增題目 ▽」下拉；下拉裡只有「選擇題」可點，
 * 其餘題型顯示但 disabled。點「選擇題」呼叫 `onCreateQuestion`，表單本身在
 * #1064 實作；沒傳 onCreateQuestion 時顯示提示。
 *
 * 查詢 filter（考點／年級）在 #1066 補；這裡先只有題幹關鍵字搜尋。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  examPointLabel,
  type Question,
  type QuestionType,
} from "@/types/questionBank";
import { visibilityLabelKey } from "@/components/shared/VisibilitySelect";

const PAGE_SIZE = 20;

/** 「新增題目 ▽」的題型清單；只有 multiple_choice 本期可用 */
const CREATE_TYPES: { type: QuestionType; enabled: boolean }[] = [
  { type: "multiple_choice", enabled: true },
  { type: "reading", enabled: false },
  { type: "cloze", enabled: false },
  { type: "fill_in", enabled: false },
  { type: "listening", enabled: false },
  { type: "listening_image", enabled: false },
];

export interface QuestionBankTabProps {
  scope: "mine" | "organization";
  organizationId?: string;
  /** 是否顯示「新增題目」按鈕（機構題庫：active 成員都可以新增） */
  canCreate?: boolean;
  onCreateQuestion?: (type: QuestionType) => void;
  /** 點一列時的回呼（#1064 接編輯表單） */
  onSelectQuestion?: (question: Question) => void;
  /** 由外部觸發重新載入（例如新增完成後）；每次數值改變就 refetch */
  refreshKey?: number;
}

export default function QuestionBankTab({
  scope,
  organizationId,
  canCreate = true,
  onCreateQuestion,
  onSelectQuestion,
  refreshKey = 0,
}: QuestionBankTabProps) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // 題幹搜尋 debounce，避免每個字都打 API
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [search]);

  const load = useCallback(async () => {
    if (scope === "organization" && !organizationId) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.listQuestions({
        scope,
        organization_id: scope === "organization" ? organizationId : undefined,
        q: debouncedSearch || undefined,
        page,
        page_size: PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      console.error("Failed to load question bank", err);
      toast.error(t("questionBank.messages.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [scope, organizationId, debouncedSearch, page, t]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const lang = i18n.language;

  const handleCreate = (type: QuestionType) => {
    if (onCreateQuestion) {
      onCreateQuestion(type);
    } else {
      toast.info(t("questionBank.messages.editorComingSoon"));
    }
  };

  const typeLabel = useMemo(
    () => (type: QuestionType) => t(`questionBank.types.${type}`),
    [t],
  );

  return (
    <div className="space-y-4" data-testid="question-bank-tab">
      {/* ── Toolbar ── */}
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
              <DropdownMenuContent align="end">
                {CREATE_TYPES.map(({ type, enabled }) => (
                  <DropdownMenuItem
                    key={type}
                    disabled={!enabled}
                    onSelect={() => handleCreate(type)}
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
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-[13px] border-gray-200 rounded-lg"
              data-testid="question-bank-search"
            />
          </div>
        </div>
      </div>

      {/* ── List ── */}
      {loading ? (
        <div className="py-16 text-center text-sm text-gray-500">
          {t("common.loading")}
        </div>
      ) : items.length === 0 ? (
        <div
          className="py-16 text-center text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg"
          data-testid="question-bank-empty"
        >
          {debouncedSearch
            ? t("questionBank.empty.noMatch")
            : t("questionBank.empty.noQuestions")}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium w-[42%] max-w-[520px]">
                  {t("questionBank.columns.stem")}
                </th>
                <th className="px-4 py-2 font-medium w-28 hidden md:table-cell">
                  {t("questionBank.columns.type")}
                </th>
                <th className="px-4 py-2 font-medium w-24 hidden md:table-cell">
                  {t("questionBank.columns.grade")}
                </th>
                <th className="px-4 py-2 font-medium hidden lg:table-cell">
                  {t("questionBank.columns.examPoints")}
                </th>
                <th className="px-4 py-2 font-medium w-24">
                  {t("questionBank.columns.visibility")}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((q) => (
                <tr
                  key={q.id}
                  className={`border-t border-gray-100 ${
                    onSelectQuestion ? "cursor-pointer hover:bg-gray-50" : ""
                  }`}
                  onClick={() => onSelectQuestion?.(q)}
                  data-testid={`question-row-${q.id}`}
                >
                  <td className="px-4 py-2.5 text-gray-900">
                    <div className="line-clamp-2 break-words">{q.stem}</div>
                    {!q.is_owner && (
                      <span className="text-xs text-gray-400">
                        {q.is_platform
                          ? t("questionBank.owner.platform")
                          : t("questionBank.owner.other")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 hidden md:table-cell">
                    {typeLabel(q.question_type)}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 hidden md:table-cell">
                    {formatGrade(q.grade_min, q.grade_max, t)}
                  </td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {q.exam_points.map((ep) => (
                        <Badge
                          key={ep.id}
                          variant="secondary"
                          className="font-normal"
                        >
                          {examPointLabel(ep, lang)}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge
                      variant={
                        q.visibility === "private" ? "outline" : "default"
                      }
                      className="font-normal"
                    >
                      {t(
                        visibilityLabelKey(
                          q.visibility,
                          q.organization_id ? "organization" : "personal",
                        ),
                      )}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
          <span>
            {t("questionBank.pagination", {
              page,
              totalPages,
              total,
            })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            aria-label={t("questionBank.buttons.prevPage")}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            aria-label={t("questionBank.buttons.nextPage")}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}

function formatGrade(
  min: number | null,
  max: number | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (min === null && max === null) return "—";
  if (min !== null && max !== null && min !== max) {
    return t("questionBank.gradeRange", { min, max });
  }
  return t("questionBank.gradeSingle", { grade: min ?? max });
}

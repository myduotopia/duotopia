/**
 * 題庫 tab（Issue #1061 / #1063）。
 *
 * 嵌在「我的教材」與「機構教材」頁的 tab 裡，同一元件靠 `scope` 切換：
 * - scope="mine"          → 老師自己的題庫
 * - scope="organization"  → 機構題庫（需 organizationId）
 *
 * 列表可快速編輯（使用者定案）：
 * - 欄位：☑ | 題目 | 題型 | 年級 | 考點 | 考題來源 | 公開；表頭 ☑ = 全選／取消全選
 * - 考點／考題來源／公開三欄直接改（與編輯面板同一組元件）；一列改了就自動勾選並淡黃底
 * - 有勾選 → 底部浮現 QuestionBulkBar：儲存（只送改過的列）、刪除（勾選的列，先 confirm）、
 *   派發（先顯示、待派發流程接上）
 * - 有未儲存修改時換頁／搜尋前 confirm
 * 點題目文字仍開編輯面板（onSelectQuestion）。
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ComboboxItem } from "@/components/shared/CreatableCombobox";
import { CreatableCombobox } from "@/components/shared/CreatableCombobox";
import ExamPointPicker from "@/components/shared/ExamPointPicker";
import { VisibilitySelect } from "@/components/shared/VisibilitySelect";
import type {
  ExamPoint,
  Question,
  QuestionType,
  QuestionVisibility,
} from "@/types/questionBank";
import QuestionBulkBar from "./QuestionBulkBar";
import { examPointsFromQuestion } from "./questionDraft";
import {
  makeCreateSource,
  searchSources,
  sourceToItem,
} from "./sourcesCombobox";

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

/** 列表可快速編輯的三個欄位 */
interface RowEdit {
  exam_points: ExamPoint[];
  sources: ComboboxItem[];
  visibility: QuestionVisibility;
}

function editFromQuestion(q: Question): RowEdit {
  return {
    exam_points: examPointsFromQuestion(q),
    sources: q.sources.map(sourceToItem),
    visibility: q.visibility,
  };
}

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
  /** 派發流程接上後傳入；未傳 = 派發鍵顯示但 disabled */
  onDispatch?: (questions: Question[]) => void;
}

export default function QuestionBankTab({
  scope,
  organizationId,
  canCreate = true,
  onCreateQuestion,
  onSelectQuestion,
  refreshKey = 0,
  onDispatch,
}: QuestionBankTabProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  // 快速編輯：只存改過的列；勾選集合
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const dirtyCount = Object.keys(edits).length;
  const confirmDiscard = useCallback(
    () =>
      dirtyCount === 0 || window.confirm(t("questionBank.list.unsavedConfirm")),
    [dirtyCount, t],
  );

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
      // 換頁／重載後清掉編輯狀態（換頁前已 confirm 過）
      setEdits({});
      setChecked(new Set());
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

  const createSource = useMemo(
    () => makeCreateSource(organizationId),
    [organizationId],
  );

  // ---- 勾選 ----
  const allChecked = items.length > 0 && items.every((q) => checked.has(q.id));
  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(items.map((q) => q.id)));
  };
  const toggleOne = (id: number, on: boolean) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // ---- 快速編輯：改了就勾選 ----
  const canEdit = (q: Question) => q.is_owner || !!q.organization_id;
  const currentEdit = (q: Question): RowEdit =>
    edits[q.id] ?? editFromQuestion(q);
  const patchRow = (q: Question, patch: Partial<RowEdit>) => {
    setEdits((prev) => ({
      ...prev,
      [q.id]: { ...(prev[q.id] ?? editFromQuestion(q)), ...patch },
    }));
    setChecked((prev) => new Set(prev).add(q.id));
  };

  const changePage = (next: number) => {
    if (!confirmDiscard()) return;
    setPage(next);
  };
  const changeSearch = (value: string) => {
    if (value.trim() !== search.trim() && !confirmDiscard()) return;
    setSearch(value);
  };

  // ---- 底部動作列 ----
  const handleSave = async () => {
    const ids = Object.keys(edits).map(Number);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => {
          const e = edits[id];
          return apiClient.updateQuestion(id, {
            exam_point_ids: e.exam_points.map((ep) => ep.id),
            source_ids: e.sources.map((s) => s.id),
            visibility: e.visibility,
          });
        }),
      );
      const failed = ids.filter((_, i) => results[i].status === "rejected");
      const okCount = ids.length - failed.length;
      if (okCount > 0)
        toast.success(t("questionBank.list.saved", { count: okCount }));
      if (failed.length > 0) {
        toast.error(
          t("questionBank.list.saveFailed", { count: failed.length }),
        );
        // 失敗的保留編輯狀態，成功的清掉
        setEdits((prev) =>
          Object.fromEntries(
            Object.entries(prev).filter(([id]) => failed.includes(Number(id))),
          ),
        );
        setChecked(new Set(failed));
        // 重新抓成功那些的最新值
        const res = await apiClient.listQuestions({
          scope,
          organization_id:
            scope === "organization" ? organizationId : undefined,
          q: debouncedSearch || undefined,
          page,
          page_size: PAGE_SIZE,
        });
        setItems(res.items);
        setTotal(res.total);
      } else {
        await load();
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const handleDelete = async () => {
    const ids = Array.from(checked);
    if (ids.length === 0) return;
    if (
      !window.confirm(
        t("questionBank.list.confirmDelete", { count: ids.length }),
      )
    )
      return;
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => apiClient.deleteQuestion(id)),
      );
      const failedCount = results.filter((r) => r.status === "rejected").length;
      if (failedCount > 0) {
        toast.error(
          t("questionBank.list.deleteFailed", { count: failedCount }),
        );
      } else {
        toast.success(t("questionBank.list.deleted", { count: ids.length }));
      }
      // 刪掉的列不需要保留編輯狀態
      setEdits({});
      setChecked(new Set());
      await load();
    } finally {
      setBulkBusy(false);
    }
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="space-y-4 pb-20" data-testid="question-bank-tab">
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
              onChange={(e) => changeSearch(e.target.value)}
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
        <div className="border border-gray-200 rounded-lg bg-white">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 w-10">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={toggleAll}
                    aria-label={t("questionBank.list.selectAll")}
                    data-testid="qb-check-all"
                  />
                </th>
                <th className="px-4 py-2 font-medium w-1/2 max-w-[600px]">
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
                <th className="px-4 py-2 font-medium w-44 hidden lg:table-cell">
                  {t("questionBank.columns.sources")}
                </th>
                <th className="px-4 py-2 font-medium w-32">
                  {t("questionBank.columns.visibility")}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((q) => {
                const e = currentEdit(q);
                const dirty = q.id in edits;
                const editable = canEdit(q);
                return (
                  <tr
                    key={q.id}
                    className={`border-t border-gray-100 align-top ${
                      dirty ? "bg-yellow-50" : ""
                    }`}
                    data-testid={`question-row-${q.id}`}
                    data-dirty={dirty || undefined}
                  >
                    <td className="px-3 py-2.5">
                      <Checkbox
                        checked={checked.has(q.id)}
                        onCheckedChange={(c) => toggleOne(q.id, c === true)}
                        aria-label={t("questionBank.list.selectRow")}
                        data-testid={`qb-check-${q.id}`}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-gray-900">
                      <button
                        type="button"
                        onClick={() => onSelectQuestion?.(q)}
                        className={`text-left w-full ${
                          onSelectQuestion
                            ? "hover:underline"
                            : "cursor-default"
                        }`}
                        data-testid={`qb-stem-${q.id}`}
                      >
                        <div className="line-clamp-2 break-words">{q.stem}</div>
                      </button>
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
                    <td
                      className="px-4 py-2 hidden lg:table-cell"
                      onClick={stop}
                    >
                      <ExamPointPicker
                        value={e.exam_points}
                        onChange={(exam_points) => patchRow(q, { exam_points })}
                        disabled={!editable || bulkBusy}
                        compact
                        data-testid={`qb-row-${q.id}-exam-points`}
                      />
                    </td>
                    <td
                      className="px-4 py-2 hidden lg:table-cell"
                      onClick={stop}
                    >
                      <CreatableCombobox
                        value={e.sources}
                        onChange={(sources) => patchRow(q, { sources })}
                        onSearch={searchSources}
                        onCreate={createSource}
                        disabled={!editable || bulkBusy}
                        triggerLabel={t("questionBank.form.batch.pickSources")}
                        searchPlaceholder={t(
                          "questionBank.form.batch.sourceSearchPlaceholder",
                        )}
                        emptyText={t("questionBank.form.batch.noSources")}
                        createLabel={(name) =>
                          t("questionBank.form.batch.createSource", { name })
                        }
                        data-testid={`qb-row-${q.id}-sources`}
                      />
                    </td>
                    <td className="px-4 py-2" onClick={stop}>
                      <VisibilitySelect
                        value={e.visibility}
                        onChange={(visibility) => patchRow(q, { visibility })}
                        scope={q.organization_id ? "organization" : "personal"}
                        disabled={!editable || bulkBusy}
                        data-testid={`qb-row-${q.id}-visibility`}
                      />
                    </td>
                  </tr>
                );
              })}
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
            onClick={() => changePage(page - 1)}
            aria-label={t("questionBank.buttons.prevPage")}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => changePage(page + 1)}
            aria-label={t("questionBank.buttons.nextPage")}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      )}

      <QuestionBulkBar
        selectedCount={checked.size}
        dirtyCount={dirtyCount}
        onSave={handleSave}
        onDelete={handleDelete}
        onDispatch={
          onDispatch
            ? () => onDispatch(items.filter((q) => checked.has(q.id)))
            : undefined
        }
        onClear={() => {
          if (!confirmDiscard()) return;
          setEdits({});
          setChecked(new Set());
        }}
        busy={bulkBusy}
      />
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

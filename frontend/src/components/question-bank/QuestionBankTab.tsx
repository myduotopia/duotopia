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
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ComboboxItem } from "@/components/shared/CreatableCombobox";
import { CreatableCombobox } from "@/components/shared/CreatableCombobox";
import ExamPointPicker from "@/components/shared/ExamPointPicker";
import {
  VisibilitySelect,
  visibilityLabelKey,
} from "@/components/shared/VisibilitySelect";
import {
  examPointLabel,
  type ExamPoint,
  type Question,
  type QuestionType,
  type QuestionVisibility,
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
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [items, setItems] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  // 只看自己的／機構的（預設關：含所有公開題）
  const [onlyOwn, setOnlyOwn] = useState(false);
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
        only_own: onlyOwn || undefined,
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
  }, [scope, organizationId, debouncedSearch, onlyOwn, page, t]);

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
          only_own: onlyOwn || undefined,
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
          <label className="flex items-center gap-2 text-xs text-gray-600 whitespace-nowrap">
            <Switch
              checked={onlyOwn}
              onCheckedChange={(v) => {
                if (!confirmDiscard()) return;
                setOnlyOwn(v);
                setPage(1);
              }}
              data-testid="question-bank-only-own"
            />
            {scope === "organization"
              ? t("questionBank.list.onlyOrg")
              : t("questionBank.list.onlyOwn")}
          </label>
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
          <table className="w-full table-fixed text-[13px]">
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
                <th className="px-4 py-2 font-medium w-1/2 max-w-[550px]">
                  {t("questionBank.columns.stem")}
                </th>
                <th className="px-2 py-2 font-medium w-[72px] hidden sm:table-cell">
                  {t("questionBank.columns.type")}
                </th>
                <th className="px-2 py-2 font-medium w-[56px] hidden lg:table-cell">
                  {t("questionBank.columns.grade")}
                </th>
                <th className="px-4 py-2 font-medium hidden xl:table-cell">
                  {t("questionBank.columns.examPoints")}
                </th>
                <th className="px-4 py-2 font-medium w-44 hidden md:table-cell">
                  {t("questionBank.columns.sources")}
                </th>
                <th className="px-4 py-2 font-medium w-32 hidden lg:table-cell">
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
                        {q.question_type === "multiple_choice" &&
                          q.options.length > 0 && (
                            <OptionGrid options={q.options} />
                          )}
                      </button>
                      {!q.is_owner && (
                        <span className="text-xs text-gray-400">
                          {q.is_platform
                            ? t("questionBank.owner.platform")
                            : t("questionBank.owner.other")}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-gray-600 hidden sm:table-cell truncate">
                      {typeLabel(q.question_type)}
                    </td>
                    <td className="px-2 py-2.5 text-gray-600 hidden lg:table-cell tabular-nums">
                      {formatGrade(q.grade_min, q.grade_max)}
                    </td>
                    <td
                      className="px-4 py-2 hidden xl:table-cell"
                      onClick={stop}
                    >
                      <ExamPointPicker
                        value={e.exam_points}
                        onChange={(exam_points) => patchRow(q, { exam_points })}
                        disabled={!editable || bulkBusy}
                        compact
                        closeOnSelect
                        renderTrigger={() => (
                          <ChipCell
                            labels={e.exam_points.map((ep) =>
                              examPointLabel(ep, lang),
                            )}
                          />
                        )}
                        data-testid={`qb-row-${q.id}-exam-points`}
                      />
                    </td>
                    <td
                      className="px-4 py-2 hidden md:table-cell"
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
                        closeOnSelect
                        renderTrigger={() => (
                          <ChipCell labels={e.sources.map((x) => x.label)} />
                        )}
                        data-testid={`qb-row-${q.id}-sources`}
                      />
                    </td>
                    <td
                      className="px-4 py-2 hidden lg:table-cell"
                      onClick={stop}
                    >
                      <InlineVisibility
                        value={e.visibility}
                        onChange={(visibility) => patchRow(q, { visibility })}
                        scope={q.organization_id ? "organization" : "personal"}
                        disabled={!editable || bulkBusy}
                        testId={`qb-row-${q.id}-visibility`}
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

/** 表格格子的純顯示：chip 列；沒有值顯示「—」。點整格才開選單（由外層 renderTrigger 包） */
function ChipCell({ labels }: { labels: string[] }) {
  if (labels.length === 0) return <span className="text-gray-300 px-1">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((l, i) => (
        <span
          key={`${l}-${i}`}
          className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 max-w-full truncate"
          title={l}
        >
          {l}
        </span>
      ))}
    </div>
  );
}

/** 公開設定：平常顯示文字，點了才出現下拉（自動展開），選完或關閉就回純顯示 */
function InlineVisibility({
  value,
  onChange,
  scope,
  disabled,
  testId,
}: {
  value: QuestionVisibility;
  onChange: (v: QuestionVisibility) => void;
  scope: "personal" | "organization";
  disabled: boolean;
  testId: string;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="text-left w-full rounded px-1 py-0.5 hover:bg-gray-100 disabled:cursor-default disabled:hover:bg-transparent"
        data-testid={`${testId}-display`}
      >
        {t(visibilityLabelKey(value, scope))}
      </button>
    );
  }
  return (
    <VisibilitySelect
      value={value}
      onChange={(v) => {
        onChange(v);
        setEditing(false);
      }}
      scope={scope}
      disabled={disabled}
      defaultOpen
      onOpenChange={(open) => {
        if (!open) setEditing(false);
      }}
      data-testid={testId}
    />
  );
}

/** 選項全都短（≤ 12 字）且不超過 4 個 → 一列四格；否則兩欄 */
const SHORT_OPTION_CHARS = 12;

function OptionGrid({ options }: { options: Question["options"] }) {
  const oneRow =
    options.length <= 4 &&
    options.every((o) => o.text.trim().length <= SHORT_OPTION_CHARS);
  return (
    <div
      className={`mt-1 grid gap-x-3 gap-y-0.5 text-xs text-gray-600 ${
        oneRow ? "grid-cols-4" : "grid-cols-2"
      }`}
      data-testid="qb-option-grid"
      data-layout={oneRow ? "1x4" : "2x2"}
    >
      {options.map((o, i) => (
        <span key={o.id} className="truncate" title={o.text}>
          {String.fromCharCode(65 + i)}.{" "}
          {o.is_correct ? (
            <span className="rounded bg-yellow-100 px-1 text-yellow-900">
              {o.text || (o.image_url ? "🖼" : "")}
            </span>
          ) : (
            o.text || (o.image_url ? "🖼" : "")
          )}
        </span>
      ))}
    </div>
  );
}

/** 年級只顯示數字（中英文相同）：7–9、7、不限 — */
function formatGrade(min: number | null, max: number | null): string {
  if (min === null && max === null) return "—";
  if (min !== null && max !== null && min !== max) return `${min}–${max}`;
  return String(min ?? max);
}

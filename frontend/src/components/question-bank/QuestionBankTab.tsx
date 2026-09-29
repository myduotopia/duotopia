/**
 * 題庫 tab（Issue #1061 / #1063 / #1082）。
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
 * 工具列：搜尋（題幹＋來源）、題型下拉、考點多選（OR，`ep=1,2`）、只看自己的、每頁筆數；
 * 全部存 URL query。考點目錄 mount 時抓一次，重整後用 id 對回名稱。
 * 點題目文字仍開編輯面板（onSelectQuestion）；題組列點標題開題組面板（onSelectGroup）。
 * 題組列（#1082）：可勾選（與單題分開存 id）、公開可快速改（updateQuestionGroup）、
 * 批次刪除含題組（deleteQuestionGroup）、列尾「刪除題組」Dialog 確認；批次編輯／派發只對單題。
 * 題型篩選與題組列的題型顯示「閱讀題組」（groupTypeLabel），新增清單仍顯示「閱讀測驗」。
 *
 * 拆檔（#1082）：QuestionBankToolbar（工具列）、QuestionRow（單題列）、GroupRow（題組列）、
 * QuestionBankPagination（分頁列）、listCells（共用格子）。此檔只持有狀態與資料流。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSearchParams } from "react-router-dom";

import { apiClient } from "@/lib/api";
import { Checkbox } from "@/components/ui/checkbox";
import {
  type ExamPoint,
  isGroupRow,
  type Question,
  type QuestionGroupListRow,
  type QuestionListItem,
  type QuestionType,
  type QuestionVisibility,
} from "@/types/questionBank";
import QuestionBulkBar from "./QuestionBulkBar";
import QuestionBankToolbar, { TYPE_FILTERS } from "./QuestionBankToolbar";
import QuestionBankPagination, {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
} from "./QuestionBankPagination";
import QuestionRow, { type RowEdit } from "./QuestionRow";
import GroupRow from "./GroupRow";
import { examPointsFromQuestion } from "./questionDraft";
import { makeCreateSource, sourceToItem } from "./sourcesCombobox";

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
  /** 點題組列 → 開題組編輯面板（#1082） */
  onSelectGroup?: (group: QuestionGroupListRow) => void;
  /** 由外部觸發重新載入（例如新增完成後）；每次數值改變就 refetch */
  refreshKey?: number;
  /** 派發流程接上後傳入；未傳 = 派發鍵顯示但 disabled */
  onDispatch?: (questions: Question[]) => void;
  /** 勾選的題型全相同時的批次編輯（開編輯面板多張卡） */
  onBulkEdit?: (questions: Question[]) => void;
}

export default function QuestionBankTab({
  scope,
  organizationId,
  canCreate = true,
  onCreateQuestion,
  onSelectQuestion,
  onSelectGroup,
  refreshKey = 0,
  onDispatch,
  onBulkEdit,
}: QuestionBankTabProps) {
  const { t } = useTranslation();
  // 列表列：單題 + 題組列（#1082）。題組列可勾選、快速改公開、批次刪除；
  // 批次編輯／派發仍只對單題（題組整組操作在面板內）
  const [items, setItems] = useState<QuestionListItem[]>([]);
  const questionItems = useMemo(
    () => items.filter((it): it is Question => !isGroupRow(it)),
    [items],
  );
  const groupItems = useMemo(
    () => items.filter((it): it is QuestionGroupListRow => isGroupRow(it)),
    [items],
  );
  const [total, setTotal] = useState(0);
  // 頁碼／每頁筆數／題型／只看自己的 都存 URL query，重整與分享連結保留
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(
    Number(searchParams.get("size")),
  )
    ? Number(searchParams.get("size"))
    : DEFAULT_PAGE_SIZE;
  const typeFilter = (
    TYPE_FILTERS.includes(searchParams.get("type") as QuestionType)
      ? searchParams.get("type")
      : ""
  ) as QuestionType | "";
  const onlyOwn = searchParams.get("own") === "1";
  // 考點 filter：`ep=3,7`（OR）；非正整數丟掉、去重
  const epParam = searchParams.get("ep") ?? "";
  const examPointIds = useMemo(
    () =>
      Array.from(
        new Set(
          epParam
            .split(",")
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0),
        ),
      ),
    [epParam],
  );
  // 考點目錄（整棵樹、數百筆）：mount 抓一次，讓 URL 帶進來的 id 能顯示名稱
  const [examPointCatalog, setExamPointCatalog] = useState<ExamPoint[]>([]);
  useEffect(() => {
    apiClient
      .listExamPoints()
      .then((res) => setExamPointCatalog(res.items))
      .catch((err) => console.error("Failed to load exam points", err));
  }, []);
  const selectedExamPoints = useMemo(
    () =>
      examPointIds
        .map((id) => examPointCatalog.find((ep) => ep.id === id))
        .filter((ep): ep is ExamPoint => !!ep),
    [examPointIds, examPointCatalog],
  );
  const setQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    });
    setSearchParams(next, { replace: true });
  };
  const setPage = (n: number) => setQuery({ page: n <= 1 ? null : String(n) });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  // 快速編輯：只存改過的列；勾選集合（單題與題組分開存，id 空間不同）
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [groupEdits, setGroupEdits] = useState<
    Record<number, QuestionVisibility>
  >({});
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [checkedGroups, setCheckedGroups] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const dirtyCount =
    Object.keys(edits).length + Object.keys(groupEdits).length;
  const clearSelection = () => {
    setEdits({});
    setGroupEdits({});
    setChecked(new Set());
    setCheckedGroups(new Set());
  };
  const confirmDiscard = useCallback(
    () =>
      dirtyCount === 0 || window.confirm(t("questionBank.list.unsavedConfirm")),
    [dirtyCount, t],
  );

  // 題幹搜尋 debounce，避免每個字都打 API
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch((prev) => {
        const nextValue = search.trim();
        if (prev !== nextValue) setPage(1);
        return nextValue;
      });
    }, 300);
    return () => window.clearTimeout(handle);
    // setPage 來自 searchParams，不列入依賴（只在搜尋字改變時觸發）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // 列表查詢參數（load 與批次儲存後重查共用）
  const listParams = useMemo(
    () => ({
      scope,
      organization_id: scope === "organization" ? organizationId : undefined,
      q: debouncedSearch || undefined,
      only_own: onlyOwn || undefined,
      question_type: typeFilter || undefined,
      exam_point_ids: examPointIds.length > 0 ? examPointIds : undefined,
      page,
      page_size: pageSize,
    }),
    [
      scope,
      organizationId,
      debouncedSearch,
      onlyOwn,
      typeFilter,
      examPointIds,
      page,
      pageSize,
    ],
  );

  const load = useCallback(async () => {
    if (scope === "organization" && !organizationId) {
      setItems([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.listQuestions(listParams);
      setItems(res.items);
      setTotal(res.total);
      // 換頁／重載後清掉編輯狀態（換頁前已 confirm 過）
      setEdits({});
      setGroupEdits({});
      setChecked(new Set());
      setCheckedGroups(new Set());
    } catch (err) {
      console.error("Failed to load question bank", err);
      toast.error(t("questionBank.messages.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [scope, organizationId, listParams, t]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

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
  // 題組類題型在列表與篩選裡顯示「閱讀題組」，新增清單仍顯示「閱讀測驗」
  const groupTypeLabel = useMemo(
    () => (type: QuestionType) =>
      type === "reading" ? t("questionBank.groupTypes.reading") : typeLabel(type),
    [t, typeLabel],
  );

  const createSource = useMemo(
    () => makeCreateSource(organizationId),
    [organizationId],
  );

  // ---- 勾選 ----
  const allChecked =
    items.length > 0 &&
    questionItems.every((q) => checked.has(q.id)) &&
    groupItems.every((g) => checkedGroups.has(g.id));
  const toggleAll = () => {
    if (allChecked) {
      setChecked(new Set());
      setCheckedGroups(new Set());
    } else {
      setChecked(new Set(questionItems.map((q) => q.id)));
      setCheckedGroups(new Set(groupItems.map((g) => g.id)));
    }
  };
  const toggleIn =
    (setter: typeof setChecked) => (id: number, on: boolean) =>
      setter((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
  const toggleOne = toggleIn(setChecked);
  const toggleGroup = toggleIn(setCheckedGroups);

  // ---- 快速編輯：改了就勾選 ----
  // 後端算好的 can_edit（建立者本人，或機構擁有人／教材管理者）
  const canEdit = (q: Question) => q.can_edit;
  const currentEdit = (q: Question): RowEdit =>
    edits[q.id] ?? editFromQuestion(q);
  const patchRow = (q: Question, patch: Partial<RowEdit>) => {
    setEdits((prev) => ({
      ...prev,
      [q.id]: { ...(prev[q.id] ?? editFromQuestion(q)), ...patch },
    }));
    setChecked((prev) => new Set(prev).add(q.id));
  };
  const patchGroupVisibility = (
    g: QuestionGroupListRow,
    visibility: QuestionVisibility,
  ) => {
    setGroupEdits((prev) => ({ ...prev, [g.id]: visibility }));
    setCheckedGroups((prev) => new Set(prev).add(g.id));
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
  const checkedItems = questionItems.filter((q) => checked.has(q.id));
  const editableChecked = checkedItems.filter(canEdit);
  const checkedSameType =
    checkedItems.length > 0 &&
    checkedItems.every(
      (q) => q.question_type === checkedItems[0].question_type,
    );

  const handleSave = async () => {
    const ids = Object.keys(edits).map(Number);
    const groupIds = Object.keys(groupEdits).map(Number);
    if (ids.length === 0 && groupIds.length === 0) return;
    setBulkBusy(true);
    try {
      const [results, groupResults] = await Promise.all([
        Promise.allSettled(
          ids.map((id) => {
            const e = edits[id];
            return apiClient.updateQuestion(id, {
              exam_point_ids: e.exam_points.map((ep) => ep.id),
              source_ids: e.sources.map((s) => s.id),
              visibility: e.visibility,
            });
          }),
        ),
        Promise.allSettled(
          groupIds.map((id) =>
            apiClient.updateQuestionGroup(id, { visibility: groupEdits[id] }),
          ),
        ),
      ]);
      const failed = ids.filter((_, i) => results[i].status === "rejected");
      const failedGroups = groupIds.filter(
        (_, i) => groupResults[i].status === "rejected",
      );
      const okCount =
        ids.length + groupIds.length - failed.length - failedGroups.length;
      if (okCount > 0)
        toast.success(t("questionBank.list.saved", { count: okCount }));
      if (failed.length > 0 || failedGroups.length > 0) {
        toast.error(
          t("questionBank.list.saveFailed", {
            count: failed.length + failedGroups.length,
          }),
        );
        // 失敗的保留編輯狀態，成功的清掉
        setEdits((prev) =>
          Object.fromEntries(
            Object.entries(prev).filter(([id]) => failed.includes(Number(id))),
          ),
        );
        setGroupEdits((prev) =>
          Object.fromEntries(
            Object.entries(prev).filter(([id]) =>
              failedGroups.includes(Number(id)),
            ),
          ),
        );
        setChecked(new Set(failed));
        setCheckedGroups(new Set(failedGroups));
        // 重新抓成功那些的最新值
        const res = await apiClient.listQuestions(listParams);
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
    const groupIds = Array.from(checkedGroups);
    if (ids.length === 0 && groupIds.length === 0) return;
    const message =
      groupIds.length > 0
        ? t("questionBank.list.confirmDeleteWithGroups", {
            count: ids.length,
            groups: groupIds.length,
          })
        : t("questionBank.list.confirmDelete", { count: ids.length });
    if (!window.confirm(message)) return;
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled([
        ...ids.map((id) => apiClient.deleteQuestion(id)),
        ...groupIds.map((id) => apiClient.deleteQuestionGroup(id)),
      ]);
      const failedCount = results.filter((r) => r.status === "rejected").length;
      if (failedCount > 0) {
        toast.error(
          t("questionBank.list.deleteFailed", { count: failedCount }),
        );
      } else {
        toast.success(
          t("questionBank.list.deleted", {
            count: ids.length + groupIds.length,
          }),
        );
      }
      // 刪掉的列不需要保留編輯狀態
      clearSelection();
      await load();
    } finally {
      setBulkBusy(false);
    }
  };

  /** 列表端刪除單一題組（GroupRow 的 Dialog 已確認過） */
  const handleDeleteGroup = async (g: QuestionGroupListRow) => {
    setBulkBusy(true);
    try {
      await apiClient.deleteQuestionGroup(g.id);
      toast.success(t("questionBank.list.groupDeleted"));
      setGroupEdits((prev) => {
        const next = { ...prev };
        delete next[g.id];
        return next;
      });
      setCheckedGroups((prev) => {
        const next = new Set(prev);
        next.delete(g.id);
        return next;
      });
      await load();
    } catch (err) {
      console.error("Failed to delete question group", err);
      toast.error(t("questionBank.list.groupDeleteFailed"));
      throw err;
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-20" data-testid="question-bank-tab">
      <QuestionBankToolbar
        scope={scope}
        canCreate={canCreate}
        onCreate={handleCreate}
        typeLabel={typeLabel}
        filterTypeLabel={groupTypeLabel}
        search={search}
        onChangeSearch={changeSearch}
        typeFilter={typeFilter}
        onChangeTypeFilter={(type) => {
          if (!confirmDiscard()) return;
          setQuery({ type: type || null, page: null });
        }}
        examPointIds={examPointIds}
        selectedExamPoints={selectedExamPoints}
        onChangeExamPoints={(next) => {
          if (!confirmDiscard()) return;
          setQuery({
            ep: next.length ? next.map((ep) => ep.id).join(",") : null,
            page: null,
          });
        }}
        onClearExamPoints={() => {
          if (!confirmDiscard()) return;
          setQuery({ ep: null, page: null });
        }}
        onlyOwn={onlyOwn}
        onChangeOnlyOwn={(v) => {
          if (!confirmDiscard()) return;
          setQuery({ own: v ? "1" : null, page: null });
        }}
      />

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
          {debouncedSearch || examPointIds.length > 0
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
              {items.map((item) =>
                isGroupRow(item) ? (
                  <GroupRow
                    key={`g-${item.id}`}
                    row={item}
                    typeLabel={groupTypeLabel}
                    checked={checkedGroups.has(item.id)}
                    editedVisibility={groupEdits[item.id]}
                    busy={bulkBusy}
                    onToggle={(on) => toggleGroup(item.id, on)}
                    onChangeVisibility={(v) => patchGroupVisibility(item, v)}
                    onSelect={onSelectGroup}
                    onDelete={handleDeleteGroup}
                  />
                ) : (
                  <QuestionRow
                    key={item.id}
                    q={item}
                    edit={currentEdit(item)}
                    dirty={item.id in edits}
                    editable={canEdit(item)}
                    checked={checked.has(item.id)}
                    busy={bulkBusy}
                    typeLabel={typeLabel}
                    createSource={createSource}
                    onToggle={(on) => toggleOne(item.id, on)}
                    onPatch={(patch) => patchRow(item, patch)}
                    onSelect={onSelectQuestion}
                  />
                ),
              )}
            </tbody>
          </table>
        </div>
      )}

      <QuestionBankPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onChangePage={changePage}
        onChangePageSize={(size) => {
          if (!confirmDiscard()) return;
          setQuery({
            size: size === DEFAULT_PAGE_SIZE ? null : String(size),
            page: null,
          });
        }}
      />

      <QuestionBulkBar
        selectedCount={checked.size + checkedGroups.size}
        dirtyCount={dirtyCount}
        onSave={handleSave}
        onDelete={handleDelete}
        onDispatch={
          onDispatch
            ? () => onDispatch(questionItems.filter((q) => checked.has(q.id)))
            : undefined
        }
        onEdit={
          onBulkEdit &&
          checkedSameType &&
          checkedGroups.size === 0 &&
          editableChecked.length > 0
            ? () => {
                if (!confirmDiscard()) return;
                onBulkEdit(editableChecked);
              }
            : undefined
        }
        editDisabledReason={
          !checkedSameType || checkedGroups.size > 0
            ? t("questionBank.list.bulkEditTypeMismatch")
            : editableChecked.length === 0
              ? t("questionBank.list.bulkEditNoPermission")
              : undefined
        }
        onClear={() => {
          if (!confirmDiscard()) return;
          clearSelection();
        }}
        busy={bulkBusy}
      />
    </div>
  );
}

/**
 * 上傳題本核對畫面（#1112 C4b）的狀態與動作。整份匯入的資料與逐頁送出仍在 `useExamImport`
 * （關掉面板不停）；這裡只管核對畫面自己的事，面板關掉就丟掉：
 *
 * - **編輯一題**（設計文件第五節「編輯一題」）：一次只展開一張卡。`startEditing` 把卡片轉成草稿
 *   （cardDraft.ts）；`finishEditing`＝收合，只送有改的欄位（PATCH，卡片格式），成功後重抓整份；
 *   換編輯另一張卡時先收合目前這張。`cancelEditing` 放棄修改。
 * - **刪除這一題**（ConfirmDialog 確認後）、**重試**（既有 retry API，次數用完只留「手動補這一題」）、
 *   **手動補一題**（先選題型，原卷題號選填，A6；新增後直接展開編輯）。
 * - **整份設定**：改了就 PATCH 設定（套用到全部還沒存的卡）。
 * - **全部儲存**：POST save（不帶 card_ids＝全部）。存好的卡從畫面消失（重抓後被過濾）；被退回的卡
 *   記下原因（`failures`，卡上與導覽格都標出）；有題庫已有而略過的題顯示「N 題因題庫已有而略過」；
 *   `completed` → 整份存完，提示後關面板（A2）。
 * - **略過核對，直接存入**：POST skip-review，結果處理同上；沒存完的頁處理完會自動存入。
 * - **看原題**：題庫已有這題時，Dialog 以 id 抓那一題／那一組顯示預覽。
 * - **目前這題**：題號導覽點了或「跳到下一題」都會設 `currentKey`，畫面捲到那一題。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { apiClient } from "@/lib/api";
import type { UnitDraft } from "../questionDraft";
import { examImportApi } from "./examImportApi";
import { errorInfo, errorKey } from "./examImportErrors";
import {
  EMPTY_CATALOG,
  makeCatalog,
  startEdit,
  unitToCardPatch,
  type CardEditState,
  type ExamPointCatalog,
} from "./cardDraft";
import {
  entryDomId,
  needsAttention,
  reviewEntries,
  reviewPages,
} from "./reviewModel";
import type {
  ExamImportCard,
  ExamImportSaveFailure,
  ExamImportSaveResult,
  ExamImportSettingsPatch,
} from "./types";
import type { ExamImportController } from "./useExamImport";

export interface DuplicateTarget {
  kind: "single" | "group";
  id: number;
}

export interface AddCardInput {
  /** 先選題型（A6）：選擇題／閱讀題組／克漏字題組 */
  type: "single" | "reading" | "cloze";
  pageNo: number;
  sourceQuestionNo: string;
}

export function useExamImportReview(controller: ExamImportController) {
  const { t } = useTranslation();
  const { detail } = controller;
  const importId = detail?.id ?? null;
  const [catalog, setCatalog] = useState<ExamPointCatalog>(EMPTY_CATALOG);
  const [editing, setEditing] = useState<CardEditState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [busyCard, setBusyCard] = useState<string | null>(null);
  const [failures, setFailures] = useState<
    Record<string, ExamImportSaveFailure>
  >({});
  const [skippedDuplicates, setSkippedDuplicates] = useState(0);
  const [saving, setSaving] = useState<"save" | "skip" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExamImportCard | null>(null);
  const [duplicateTarget, setDuplicateTarget] =
    useState<DuplicateTarget | null>(null);
  const [addPage, setAddPage] = useState<number | null>(null);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;

  // 考點目錄：數百筆、整棵抓一次（卡片只有 code／id）
  useEffect(() => {
    let cancelled = false;
    apiClient
      .listExamPoints()
      .then((res) => {
        if (!cancelled) setCatalog(makeCatalog(res.items));
      })
      .catch((err) => console.error("Failed to load exam points", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // 換一份匯入：清掉這份的核對狀態
  useEffect(() => {
    setEditing(null);
    setEditError(null);
    setFailures({});
    setSkippedDuplicates(0);
    setCurrentKey(null);
  }, [importId]);

  const pages = useMemo(() => reviewPages(detail), [detail]);
  const entries = useMemo(
    () => reviewEntries(pages, failures),
    [pages, failures],
  );
  const attention = useMemo(
    () => entries.filter((e) => needsAttention(e.issue)),
    [entries],
  );

  const toastError = useCallback(
    (err: unknown) => {
      const info = errorInfo(err);
      toast.error(t(errorKey(info.key), info.params));
    },
    [t],
  );

  const scrollTo = useCallback((key: string) => {
    setCurrentKey(key);
    // 等畫面更新（例如剛展開）再捲
    window.requestAnimationFrame(() => {
      document
        .getElementById(entryDomId(key))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  /** 跳到下一個需注意的題（目前這題之後；到底了從頭） */
  const jumpToNextAttention = useCallback(() => {
    if (attention.length === 0) return;
    const at = entries.findIndex((e) => e.key === currentKey);
    const next = attention.find((e) => entries.indexOf(e) > at) ?? attention[0];
    scrollTo(next.key);
  }, [attention, entries, currentKey, scrollTo]);

  /** 收合目前編輯的卡：有改就 PATCH；失敗留在編輯狀態並顯示原因 */
  const finishEditing = useCallback(async (): Promise<boolean> => {
    const current = editingRef.current;
    if (!current || importId === null) return true;
    const patch = unitToCardPatch(current);
    if (!patch) {
      setEditing(null);
      setEditError(null);
      return true;
    }
    setBusyCard(current.cardId);
    try {
      await examImportApi.patchCard(importId, current.cardId, patch);
      setEditing(null);
      setEditError(null);
      setFailures((prev) => {
        const next = { ...prev };
        delete next[current.cardId];
        return next;
      });
      await controller.reload();
      return true;
    } catch (err) {
      const info = errorInfo(err);
      setEditError(t(errorKey(info.key), info.params));
      return false;
    } finally {
      setBusyCard(null);
    }
  }, [controller, importId, t]);

  const startEditing = useCallback(
    async (card: ExamImportCard) => {
      if (editingRef.current?.cardId === card.card_id) return;
      if (editingRef.current && !(await finishEditing())) return;
      setEditError(null);
      setEditing(startEdit(card, catalog));
    },
    [catalog, finishEditing],
  );

  const cancelEditing = useCallback(() => {
    setEditing(null);
    setEditError(null);
  }, []);

  const updateDraft = useCallback((unit: UnitDraft) => {
    setEditing((prev) => (prev ? { ...prev, unit } : prev));
  }, []);

  const confirmDelete = useCallback(async () => {
    const card = deleteTarget;
    setDeleteTarget(null);
    if (!card || importId === null) return;
    setBusyCard(card.card_id);
    try {
      await examImportApi.deleteCard(importId, card.card_id);
      if (editingRef.current?.cardId === card.card_id) setEditing(null);
      toast.success(t("questionBank.examImport.review.deleted"));
      await controller.reload();
    } catch (err) {
      toastError(err);
    } finally {
      setBusyCard(null);
    }
  }, [controller, deleteTarget, importId, t, toastError]);

  const retryCard = useCallback(
    async (card: ExamImportCard) => {
      const pageNo = card.page_no;
      if (pageNo === undefined) return;
      setBusyCard(card.card_id);
      try {
        await controller.retryQuestion(pageNo, card.card_id);
      } catch (err) {
        toastError(err);
      } finally {
        setBusyCard(null);
      }
    },
    [controller, toastError],
  );

  const addCard = useCallback(
    async ({ type, pageNo, sourceQuestionNo }: AddCardInput) => {
      if (importId === null) return;
      if (editingRef.current && !(await finishEditing())) return;
      try {
        const res = await examImportApi.addCard(importId, {
          kind: type === "single" ? "single" : "group",
          ...(type === "single" ? {} : { group: { group_type: type } }),
          page_no: pageNo,
          source_question_no: sourceQuestionNo.trim() || null,
        });
        setAddPage(null);
        await controller.reload();
        setEditing(startEdit(res.card, catalog));
      } catch (err) {
        toastError(err);
      }
    },
    [catalog, controller, finishEditing, importId, toastError],
  );

  const patchSettings = useCallback(
    async (patch: ExamImportSettingsPatch) => {
      if (importId === null) return;
      try {
        await examImportApi.patchSettings(importId, patch);
        await controller.reload();
      } catch (err) {
        toastError(err);
        await controller.reload();
      }
    },
    [controller, importId, toastError],
  );

  const handleResult = useCallback(
    async (res: ExamImportSaveResult) => {
      setFailures(Object.fromEntries(res.failed.map((f) => [f.card_id, f])));
      const skipped = res.skipped_duplicate_questions ?? 0;
      setSkippedDuplicates(skipped);
      if (res.saved.length > 0)
        toast.success(
          t("questionBank.examImport.review.savedCount", {
            count: res.saved.length,
          }),
        );
      if (res.completed || res.status === "saved") {
        if (skipped > 0)
          toast.info(
            t("questionBank.examImport.review.skippedDuplicates", {
              count: skipped,
            }),
          );
        toast.success(t("questionBank.examImport.review.completed"));
        controller.markSaved();
        return;
      }
      await controller.reload();
      if (res.failed.length > 0) {
        const first = res.failed[0].card_id;
        const entry = entries.find((e) => e.cardId === first);
        if (entry) scrollTo(entry.key);
      }
    },
    [controller, entries, scrollTo, t],
  );

  const saveAll = useCallback(async () => {
    if (importId === null || saving) return;
    if (editingRef.current && !(await finishEditing())) return;
    setSaving("save");
    try {
      await handleResult(await examImportApi.save(importId));
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(null);
    }
  }, [finishEditing, handleResult, importId, saving, toastError]);

  const skipReview = useCallback(async () => {
    if (importId === null || saving) return;
    if (editingRef.current && !(await finishEditing())) return;
    setSaving("skip");
    try {
      const res = await examImportApi.skipReview(importId);
      if (!res.completed && res.status !== "saved")
        toast.info(t("questionBank.examImport.review.skipStarted"));
      await handleResult(res);
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(null);
    }
  }, [finishEditing, handleResult, importId, saving, t, toastError]);

  return {
    catalog,
    pages,
    entries,
    attention,
    currentKey,
    setCurrentKey,
    scrollTo,
    jumpToNextAttention,
    editing,
    editError,
    busyCard,
    startEditing,
    finishEditing,
    cancelEditing,
    updateDraft,
    failures,
    skippedDuplicates,
    saving,
    saveAll,
    skipReview,
    deleteTarget,
    requestDelete: setDeleteTarget,
    confirmDelete,
    duplicateTarget,
    showDuplicate: setDuplicateTarget,
    addPage,
    requestAdd: setAddPage,
    addCard,
    retryCard,
    patchSettings,
  };
}

export type ExamImportReviewState = ReturnType<typeof useExamImportReview>;

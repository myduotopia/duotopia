/**
 * 上傳題本核對畫面（#1112 C4b）的狀態與動作。整份匯入的資料與逐頁送出仍在 `useExamImport`
 * （關掉面板不停）；這裡只管核對畫面自己的事，面板關掉就丟掉：
 *
 * - **編輯一題**（設計文件第五節「編輯一題」）：一次只展開一張卡。`startEditing` 把卡片轉成草稿
 *   （cardDraft.ts，記下打開時的卡片版本 `rev`）；`finishEditing`＝收合，只送有改的欄位（PATCH，卡片格式
 *   ＋`rev`），成功後重抓整份；換編輯另一張卡時先收合目前這張。`cancelEditing` 放棄修改。
 *   - **還不能編輯的題組**（C4b 審查 1）：頁上最後一張題組、下一頁還沒處理完（`locked`，規則同後端）——
 *     下一頁可能還會併進小題或文章，`startEditing` 不打開，卡上說明「下一頁處理完才能編輯」。
 *   - 409 `EXAM_IMPORT_CARD_CHANGED`（編輯期間卡片被後端更新）：換成回應附的最新卡、編輯收起、提示
 *     「這題剛有更新，請重新打開」；回傳 false（接著要做的存入／關面板先停下，讓老師重看）。
 *   - 409 `EXAM_IMPORT_CARD_SAVED`／404 找不到卡（被自動存走、被刪）：放掉編輯狀態、提示、重抓，
 *     回傳 true（不擋其他動作；C4b 審查 2）。重抓後編輯中的卡不見了（自動存入、整頁重送）也一樣放掉並提示。
 * - **刪除這一題**（ConfirmDialog 確認後）、**重試**（retry API 不附頁圖；次數用完只留「手動補這一題」；這張卡編輯中不重試，免得重試結果被編輯蓋掉；
 *   後端找不到頁圖 409 PAGE_IMAGE_MISSING → 輕提示改用手動補）、**手動補一題**（先選題型，原卷題號選填，A6；
 *   新增後直接展開編輯）。
 * - **整份設定**：改了就 PATCH 設定（套用到全部還沒存的卡）。年段拖曳由這裡管（`grade`／`changeGrade`）：
 *   停 0.5 秒才送；存入、略過核對、關面板前先把還沒送的年段送出（`flushSettings`）；送失敗把滑桿改回
 *   後端的值（C4b 審查 10）。
 * - **全部儲存**：POST save（不帶 card_ids＝全部）。存好的卡從畫面消失（重抓後被過濾）；被退回的卡
 *   記下原因（`failures`，卡上與導覽格都標出）；有題庫已有而略過的題顯示「N 題因題庫已有而略過」；
 *   `completed` → 整份存完，提示後關面板（A2）。連按防護：`savingRef` 在第一次按下就設好（C4b 審查 5）。
 * - **略過核對，直接存入**：POST skip-review，結果處理同上；沒存完的頁處理完會自動存入。
 * - **關面板前收尾**（C4b 審查 3）：向 controller 登記 `beforeClose`：送出年段、收合編輯中的題；失敗回傳
 *   false（面板不關），原因顯示在那一題並跳提示。
 * - **看原題**：題庫已有這題時，Dialog 以 id 抓那一題／那一組顯示預覽。
 * - **目前這題**（C4c）：`currentKey`＝題號下拉顯示的題，捲動時由 `useReviewScrollSpy` 更新；從下拉選題、
 *   「需注意 ‹ ›」（`jumpToAttention`，前後循環，E11）跳過去時同時設 `highlightKey`（那題淡藍底）並記下
 *   `jumpedAtRef`，捲動偵測在平滑捲動期間不改目前這題。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { apiClient } from "@/lib/api";
import type { GradeRange } from "@/components/shared/GradeRangeSlider";
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
  unsettledCardIds,
} from "./reviewModel";
import {
  cardIsSaved,
  type ExamImportCard,
  type ExamImportDetail,
  type ExamImportSaveFailure,
  type ExamImportSaveResult,
  type ExamImportSettingsPatch,
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

const GRADE_DEBOUNCE_MS = 500;

const gradeOf = (d: ExamImportDetail | null | undefined): GradeRange => [
  d?.settings?.grade_min ?? null,
  d?.settings?.grade_max ?? null,
];

/** 409 帶回的最新卡片（EXAM_IMPORT_CARD_CHANGED 的 `detail.card`） */
function changedCard(err: unknown): ExamImportCard | null {
  const detail = (err as { detail?: unknown })?.detail;
  if (!detail || typeof detail !== "object") return null;
  const card = (detail as { card?: unknown }).card;
  return card && typeof card === "object" && "card_id" in card
    ? (card as ExamImportCard)
    : null;
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
  /** 目前看到的題（題號下拉顯示它；捲動時跟著變） */
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  /** 剛跳過去的題（淡藍底，讓老師找到它；捲動不會改） */
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const savingRef = useRef(false);
  const detailRef = useRef(detail);
  detailRef.current = detail;

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
    setHighlightKey(null);
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
  /** 還不能編輯的題組卡（下一頁還沒處理完） */
  const locked = useMemo(() => unsettledCardIds(detail), [detail]);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  const toastError = useCallback(
    (err: unknown) => {
      const info = errorInfo(err);
      toast.error(t(errorKey(info.key), info.params));
    },
    [t],
  );

  // 編輯中的卡從畫面上消失（自動存入、整頁重送、別處刪掉）：放掉編輯狀態並提示（C4b 審查 2）
  useEffect(() => {
    const current = editingRef.current;
    if (!current || !detail) return;
    if (pages.some((p) => p.cards.some((c) => c.card_id === current.cardId)))
      return;
    const saved = detail.pages.some((p) =>
      p.cards.some((c) => c.card_id === current.cardId && cardIsSaved(c)),
    );
    setEditing(null);
    setEditError(null);
    toast.info(
      t(
        saved
          ? "questionBank.examImport.review.editClosedSaved"
          : "questionBank.examImport.review.editClosedGone",
      ),
    );
  }, [pages, detail, t]);

  /** 程式捲動（選題、跳需注意）的時間：捲動偵測在這之後一小段時間不改目前這題 */
  const jumpedAtRef = useRef(0);
  const scrollTo = useCallback((key: string) => {
    setCurrentKey(key);
    setHighlightKey(key);
    jumpedAtRef.current = Date.now();
    // 等畫面更新（例如剛展開、剛切回逐題核對）再捲
    window.requestAnimationFrame(() => {
      document
        .getElementById(entryDomId(key))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  /** 跳到上一個／下一個需注意的題（以目前這題為準；到頭尾就循環，E11） */
  const jumpToAttention = useCallback(
    (dir: 1 | -1) => {
      if (attention.length === 0) return;
      const at = entries.findIndex((e) => e.key === currentKey);
      const pos = (e: (typeof entries)[number]) => entries.indexOf(e);
      const target =
        dir === 1
          ? (attention.find((e) => pos(e) > at) ?? attention[0])
          : ([...attention].reverse().find((e) => at >= 0 && pos(e) < at) ??
            attention[attention.length - 1]);
      scrollTo(target.key);
    },
    [attention, entries, currentKey, scrollTo],
  );

  /**
   * 收合目前編輯的卡：有改就 PATCH（帶 rev）。回傳 ok＝可以接著做別的事；message＝沒存成的原因。
   * - 一般錯誤：留在編輯狀態並顯示原因
   * - 卡片已被更新（409 CARD_CHANGED）：換成最新卡、收起編輯、提示重新打開；ok=false
   * - 已存進題庫／找不到：放掉編輯狀態、提示、重抓；ok=true
   */
  const closeEditor = useCallback(async (): Promise<{
    ok: boolean;
    message?: string;
  }> => {
    const current = editingRef.current;
    if (!current || importId === null) return { ok: true };
    const patch = unitToCardPatch(current);
    if (!patch) {
      setEditing(null);
      setEditError(null);
      return { ok: true };
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
      return { ok: true };
    } catch (err) {
      const info = errorInfo(err);
      if (info.code === "EXAM_IMPORT_CARD_CHANGED") {
        const card = changedCard(err);
        setEditing(null);
        setEditError(null);
        if (card) controller.replaceCard(card);
        else void controller.reload();
        const message = t("questionBank.examImport.review.cardChanged");
        toast.info(message);
        return { ok: false, message };
      }
      if (
        info.code === "EXAM_IMPORT_CARD_SAVED" ||
        info.code === "EXAM_IMPORT_CARD_NOT_FOUND" ||
        info.status === 404
      ) {
        setEditing(null);
        setEditError(null);
        toast.info(t(errorKey(info.key), info.params));
        await controller.reload().catch(() => null);
        return { ok: true };
      }
      const message = t(errorKey(info.key), info.params);
      setEditError(message);
      return { ok: false, message };
    } finally {
      setBusyCard(null);
    }
  }, [controller, importId, t]);

  const finishEditing = useCallback(
    async (): Promise<boolean> => (await closeEditor()).ok,
    [closeEditor],
  );

  const startEditing = useCallback(
    async (card: ExamImportCard) => {
      if (editingRef.current?.cardId === card.card_id) return;
      if (lockedRef.current.has(card.card_id)) return;
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
      // 編輯中（手動補）的卡不重試：重試換卡會跟編輯中的草稿互蓋
      if (editingRef.current?.cardId === card.card_id) return;
      setBusyCard(card.card_id);
      try {
        await controller.retryQuestion(pageNo, card.card_id);
      } catch (err) {
        if (errorInfo(err).code === "EXAM_IMPORT_PAGE_IMAGE_MISSING")
          toast.info(t("questionBank.examImport.review.retryImageMissing"));
        else toastError(err);
      } finally {
        setBusyCard(null);
      }
    },
    [controller, t, toastError],
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

  // ---- 整份設定 ----

  const [grade, setGrade] = useState<GradeRange>(() => gradeOf(detail));
  const pendingGradeRef = useRef<GradeRange | null>(null);
  const gradeTimerRef = useRef<number | null>(null);
  const gradeMin = detail?.settings?.grade_min ?? null;
  const gradeMax = detail?.settings?.grade_max ?? null;
  // 後端的值變了（重抓、別處改）：沒有還沒送的年段時跟著更新
  useEffect(() => {
    if (pendingGradeRef.current === null) setGrade([gradeMin, gradeMax]);
  }, [gradeMin, gradeMax]);

  /** PATCH 設定；失敗提示、重抓，年段改回後端的值（沒有還沒送的年段時） */
  const patchSettings = useCallback(
    async (patch: ExamImportSettingsPatch): Promise<boolean> => {
      if (importId === null) return false;
      try {
        await examImportApi.patchSettings(importId, patch);
        await controller.reload();
        return true;
      } catch (err) {
        toastError(err);
        const fresh = await controller.reload().catch(() => null);
        if (pendingGradeRef.current === null)
          setGrade(gradeOf(fresh ?? detailRef.current));
        return false;
      }
    },
    [controller, importId, toastError],
  );

  /** 送出還沒送的年段（存入、略過核對、關面板前）；失敗回傳 false */
  const flushSettings = useCallback(async (): Promise<boolean> => {
    if (gradeTimerRef.current) {
      window.clearTimeout(gradeTimerRef.current);
      gradeTimerRef.current = null;
    }
    const next = pendingGradeRef.current;
    if (next === null) return true;
    pendingGradeRef.current = null;
    return patchSettings({ grade_min: next[0], grade_max: next[1] });
  }, [patchSettings]);

  /** 年段：本機先動，停 0.5 秒才送 */
  const changeGrade = useCallback(
    (next: GradeRange) => {
      setGrade(next);
      pendingGradeRef.current = next;
      if (gradeTimerRef.current) window.clearTimeout(gradeTimerRef.current);
      gradeTimerRef.current = window.setTimeout(() => {
        gradeTimerRef.current = null;
        void flushSettings();
      }, GRADE_DEBOUNCE_MS);
    },
    [flushSettings],
  );

  // 卸載（換題庫、面板被收起）時還有沒送的年段：照樣送出，不等結果
  useEffect(
    () => () => {
      if (gradeTimerRef.current) window.clearTimeout(gradeTimerRef.current);
      const next = pendingGradeRef.current;
      const id = detailRef.current?.id;
      if (next !== null && id !== undefined)
        examImportApi
          .patchSettings(id, { grade_min: next[0], grade_max: next[1] })
          .catch((err) => console.error("Failed to save grade range", err));
    },
    [],
  );

  // ---- 存入 ----

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

  /** 存入前的共同步驟（連按防護、送出年段、收合編輯）；回傳要不要繼續 */
  const runSave = useCallback(
    async (
      kind: "save" | "skip",
      action: () => Promise<void>,
    ): Promise<void> => {
      if (importId === null || savingRef.current) return;
      savingRef.current = true;
      setSaving(kind);
      try {
        if (!(await flushSettings())) return;
        if (editingRef.current && !(await finishEditing())) return;
        await action();
      } catch (err) {
        toastError(err);
      } finally {
        savingRef.current = false;
        setSaving(null);
      }
    },
    [finishEditing, flushSettings, importId, toastError],
  );

  const saveAll = useCallback(
    () =>
      runSave("save", async () => {
        if (importId === null) return;
        await handleResult(await examImportApi.save(importId));
      }),
    [handleResult, importId, runSave],
  );

  const skipReview = useCallback(
    () =>
      runSave("skip", async () => {
        if (importId === null) return;
        const res = await examImportApi.skipReview(importId);
        if (!res.completed && res.status !== "saved")
          toast.info(t("questionBank.examImport.review.skipStarted"));
        await handleResult(res);
      }),
    [handleResult, importId, runSave, t],
  );

  // ---- 關面板前收尾（C4b 審查 3） ----

  const beforeCloseRef = useRef<() => Promise<boolean>>(async () => true);
  beforeCloseRef.current = async () => {
    if (!(await flushSettings())) return false;
    if (!editingRef.current) return true;
    const res = await closeEditor();
    if (!res.ok && res.message)
      toast.error(
        t("questionBank.examImport.review.closeBlocked", {
          reason: res.message,
        }),
      );
    return res.ok;
  };
  const { setBeforeClose } = controller;
  useEffect(() => {
    setBeforeClose?.(() => beforeCloseRef.current());
    return () => setBeforeClose?.(null);
  }, [setBeforeClose]);

  return {
    catalog,
    pages,
    entries,
    attention,
    locked,
    currentKey,
    setCurrentKey,
    highlightKey,
    jumpedAtRef,
    scrollTo,
    jumpToAttention,
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
    grade,
    changeGrade,
    flushSettings,
  };
}

export type ExamImportReviewState = ReturnType<typeof useExamImportReview>;

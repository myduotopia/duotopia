/**
 * 上傳題本（#1112 C3）的狀態與流程：由 QuestionBankTab（「我的題庫」）呼叫一次，
 * 提示列（ExamImportBanner）與上傳／進度 Sheet（ExamImportSheet）共用這份狀態。
 *
 * - **Sheet 開關與處理分開**：關掉 Sheet 不會停止處理（網頁開著就繼續送）；提示列顯示進度。
 *   網頁關掉才會停，下次從提示列「繼續」。
 * - **開始擷取**：建立匯入（409 重複 → 提示＋「打開那次匯入」；429 每天 1 本）→ 換成進度畫面 →
 *   依 `sendOrder.nextPageToSend` 一次送一頁：空白頁呼叫「標為空白頁」（不送 AI），其他頁送擷取；
 *   每送完一頁重抓整份（答案頁會回填別頁）。
 * - **錯誤**：409 PAGE_BUSY → 維持處理中，之後每 5 秒重抓，處理中超過 3 分鐘才給「重送這一頁」；
 *   PAGE_DONE → 重抓；RETRY_LIMIT → 標「這一頁讀不出來，請手動補題」；504／502 → 後端已把頁標失敗，
 *   重抓後有重送次數就給「重送這一頁」；400（圖片過大／格式）→ 這一頁留在待處理並標原因，這一輪
 *   不再自動送；CLOSED／404／網路中斷 → 停止並提示。
 * - **繼續**（提示列）：還有待處理或失敗的頁才請老師重選檔案（雜湊、頁數相符才繼續，否則
 *   「不是同一份題本」）；全部處理完的直接看進度。空白頁「仍要送出這一頁」用後端存好的頁圖，不必重選。
 * - **放棄**：`requestAbandon` 先記下要放棄哪一份，ExamImportSheet 顯示 ConfirmDialog，確認後
  `confirmAbandon` 才呼叫 DELETE（停止處理、刪草稿）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

import { examImportApi } from "./examImportApi";
import { ClientError, errorInfo, errorKey } from "./examImportErrors";
import { preparePageSource, type PageSource } from "./pageSource";
import { nextPageToSend } from "./sendOrder";
import type {
  ExamImportDetail,
  ExamImportSettingsPayload,
  ExamImportSummary,
} from "./types";

/** 處理中超過這段時間（前端從看到「處理中」開始算）才給「重送這一頁」，同後端 STALE_PROCESSING */
export const STALE_PROCESSING_MS = 3 * 60 * 1000;
const POLL_MS = 5000;

export interface PageNote {
  key: string;
  params?: Record<string, string | number>;
}

interface LocalPage {
  blob: Blob;
  blank: boolean;
  thumbUrl: string;
}

export type ExamImportView = "upload" | "progress";

export interface StartInput {
  source: PageSource;
  accents: string[];
  settings: ExamImportSettingsPayload;
}

export function useExamImport(enabled: boolean) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ExamImportView>("upload");
  const [unfinished, setUnfinished] = useState<ExamImportSummary[]>([]);
  const [detail, setDetail] = useState<ExamImportDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [running, setRunning] = useState(false);
  const [activePage, setActivePage] = useState<number | null>(null);
  const [pageNotes, setPageNotes] = useState<Record<number, PageNote>>({});
  const [runError, setRunError] = useState<PageNote | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [hasSource, setHasSource] = useState(false);
  const [busySince, setBusySince] = useState<Record<number, number>>({});
  const [now, setNow] = useState(() => Date.now());
  /** 等待 ConfirmDialog 確認放棄的匯入 */
  const [abandonTarget, setAbandonTarget] = useState<ExamImportSummary | null>(
    null,
  );

  const sourceRef = useRef<PageSource | null>(null);
  const localRef = useRef<Map<number, LocalPage>>(new Map());
  const importIdRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  // 放棄或換一份匯入時加一，進行中的迴圈看到不同就停
  const generationRef = useRef(0);
  const mountedRef = useRef(true);

  const clearLocal = useCallback(() => {
    localRef.current.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
    localRef.current = new Map();
    sourceRef.current?.dispose();
    sourceRef.current = null;
    setHasSource(false);
    setThumbs({});
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      localRef.current.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
      sourceRef.current?.dispose();
    };
  }, []);

  const refreshList = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await examImportApi.list();
      if (mountedRef.current) setUnfinished(res.items);
    } catch (err) {
      console.error("Failed to load unfinished exam imports", err);
    }
  }, [enabled]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  /** 進度畫面的整份資料也同步到提示列（處理中關掉 Sheet，提示列一樣看得到進度） */
  useEffect(() => {
    if (!detail) return;
    setUnfinished((prev) =>
      prev.some((i) => i.id === detail.id)
        ? prev.map((i) => (i.id === detail.id ? { ...i, ...detail } : i))
        : prev,
    );
  }, [detail]);

  const fetchDetail = useCallback(async (id: number) => {
    const d = await examImportApi.get(id);
    if (mountedRef.current && importIdRef.current === id) {
      setDetail(d);
      // 已經不是處理中的頁不再計時
      setBusySince((prev) => {
        const next: Record<number, number> = {};
        d.pages.forEach((p) => {
          if (p.status === "processing")
            next[p.page_no] = prev[p.page_no] ?? Date.now();
        });
        return next;
      });
    }
    return d;
  }, []);

  const notePage = useCallback((pageNo: number, note: PageNote | null) => {
    setPageNotes((prev) => {
      const next = { ...prev };
      if (note) next[pageNo] = note;
      else delete next[pageNo];
      return next;
    });
  }, []);

  /** 畫出（或取快取）第 n 頁 */
  const renderLocal = useCallback(async (pageNo: number) => {
    const cached = localRef.current.get(pageNo);
    if (cached) return cached;
    const source = sourceRef.current;
    if (!source) throw new ClientError("needFile");
    const rendered = await source.render(pageNo);
    const local = { ...rendered, thumbUrl: URL.createObjectURL(rendered.blob) };
    localRef.current.set(pageNo, local);
    if (mountedRef.current)
      setThumbs((prev) => ({ ...prev, [pageNo]: local.thumbUrl }));
    return local;
  }, []);

  /**
   * 送一頁（擷取或標空白）。回傳 "stop" 代表整份不能再處理（已結束、找不到、網路中斷）。
   * `skip` 收進這一輪不再自動送的頁（送不出去、仍是待處理）。
   */
  const sendOne = useCallback(
    async (
      id: number,
      pageNo: number,
      action: "auto" | "resend" | "sendBlank",
      skip?: Set<number>,
    ): Promise<"ok" | "stop"> => {
      setActivePage(pageNo);
      notePage(pageNo, null);
      try {
        if (action === "sendBlank") {
          await examImportApi.sendBlank(id, pageNo);
        } else {
          const local = await renderLocal(pageNo);
          if (action === "auto" && local.blank)
            await examImportApi.markBlank(id, pageNo, local.blob);
          else await examImportApi.sendPage(id, pageNo, local.blob);
        }
      } catch (err) {
        const info = errorInfo(err);
        if (
          info.code === "EXAM_IMPORT_CLOSED" ||
          info.code === "EXAM_IMPORT_NOT_FOUND" ||
          info.status === 404 ||
          info.status === 0
        ) {
          setRunError({ key: info.key });
          return "stop";
        }
        if (info.code === "EXAM_IMPORT_PAGE_BUSY") {
          setBusySince((prev) => ({
            ...prev,
            [pageNo]: prev[pageNo] ?? Date.now(),
          }));
        } else if (info.code !== "EXAM_IMPORT_PAGE_DONE") {
          // 504／502 後端已標失敗（重抓後顯示）；其餘（400、畫不出來…）頁仍待處理，標原因
          notePage(pageNo, { key: info.key, params: info.params });
          skip?.add(pageNo);
        }
      } finally {
        if (mountedRef.current) setActivePage(null);
      }
      try {
        await fetchDetail(id);
      } catch (err) {
        setRunError({ key: errorInfo(err).key });
        return "stop";
      }
      return "ok";
    },
    [fetchDetail, notePage, renderLocal],
  );

  /** 依送出順序一次送一頁，直到沒有可以自動送的頁 */
  const runQueue = useCallback(
    async (id: number) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      setRunError(null);
      const generation = generationRef.current;
      const skip = new Set<number>();
      try {
        let d = await fetchDetail(id);
        for (;;) {
          if (generation !== generationRef.current || !mountedRef.current)
            return;
          if (!sourceRef.current) return;
          const next = nextPageToSend(d.pages, skip);
          if (next === null) break;
          const result = await sendOne(id, next, "auto", skip);
          if (result === "stop") return;
          if (generation !== generationRef.current) return;
          d = await fetchDetail(id);
        }
      } catch (err) {
        if (generation === generationRef.current)
          setRunError({ key: errorInfo(err).key });
      } finally {
        runningRef.current = false;
        if (mountedRef.current) setRunning(false);
        void refreshList();
      }
    },
    [fetchDetail, refreshList, sendOne],
  );

  // 有頁在處理中（別的分頁、上一次送出）：每 5 秒重抓一次，直到不再處理中
  const hasProcessing = !!detail?.pages.some((p) => p.status === "processing");
  useEffect(() => {
    if (!hasProcessing || running || !detail) return;
    const id = detail.id;
    const handle = window.setTimeout(() => {
      setNow(Date.now());
      fetchDetail(id).catch(() => undefined);
    }, POLL_MS);
    return () => window.clearTimeout(handle);
  }, [hasProcessing, running, detail, fetchDetail]);

  // ---- 對外動作 ----

  const openUpload = useCallback(() => {
    setView("upload");
    setOpen(true);
  }, []);

  /** 打開一份匯入的進度（提示列「繼續」、重複匯入的「打開那次匯入」） */
  const openImport = useCallback(
    async (id: number) => {
      if (runningRef.current && importIdRef.current !== id) {
        toast.info(t("questionBank.examImport.progress.anotherRunning"));
        return;
      }
      if (importIdRef.current !== id) {
        generationRef.current += 1;
        clearLocal();
        setDetail(null);
        setPageNotes({});
        setRunError(null);
        setBusySince({});
        importIdRef.current = id;
      }
      setView("progress");
      setOpen(true);
      setLoadingDetail(true);
      try {
        await fetchDetail(id);
      } catch (err) {
        setRunError({ key: errorInfo(err).key });
      } finally {
        setLoadingDetail(false);
      }
    },
    [clearLocal, fetchDetail, t],
  );

  /** 開始擷取：建立匯入後換成進度畫面並開始送。失敗丟出錯誤（上傳畫面顯示）。 */
  const start = useCallback(
    async ({ source, accents, settings }: StartInput) => {
      const created = await examImportApi.create({
        file_name: source.fileName,
        file_hash: source.hash,
        page_count: source.pageCount,
        tts_accents: accents,
        settings,
      });
      generationRef.current += 1;
      clearLocal();
      sourceRef.current = source;
      setHasSource(true);
      importIdRef.current = created.id;
      setDetail(created);
      setPageNotes({});
      setRunError(null);
      setBusySince({});
      setView("progress");
      void refreshList();
      void runQueue(created.id);
    },
    [clearLocal, refreshList, runQueue],
  );

  /** 「繼續」時重選檔案：雜湊與頁數相符才接上並接著送 */
  const attachFiles = useCallback(
    async (files: File[]) => {
      if (!detail) return;
      const source = await preparePageSource(files);
      if (
        source.hash !== detail.file_hash.toLowerCase() ||
        source.pageCount !== detail.page_count
      ) {
        source.dispose();
        throw new ClientError("hashMismatch");
      }
      clearLocal();
      sourceRef.current = source;
      setHasSource(true);
      setPageNotes({});
      void runQueue(detail.id);
    },
    [clearLocal, detail, runQueue],
  );

  /** 失敗頁（或處理中超過 3 分鐘的頁）重送；需要頁圖（沒有就先請老師重選檔案） */
  const resendPage = useCallback(
    async (pageNo: number) => {
      if (!detail || runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      try {
        const result = await sendOne(detail.id, pageNo, "resend");
        // 之前因故停下的頁（例如網路中斷時還沒送）接著送
        if (result === "ok") {
          runningRef.current = false;
          await runQueue(detail.id);
        }
      } finally {
        runningRef.current = false;
        if (mountedRef.current) setRunning(false);
      }
    },
    [detail, runQueue, sendOne],
  );

  /** 空白頁「仍要送出這一頁」：用存好的頁圖，不必重選檔案、不算重送次數 */
  const sendBlankPage = useCallback(
    async (pageNo: number) => {
      if (!detail || runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      try {
        await sendOne(detail.id, pageNo, "sendBlank");
      } finally {
        runningRef.current = false;
        if (mountedRef.current) setRunning(false);
        void refreshList();
      }
    },
    [detail, refreshList, sendOne],
  );

  /** 放棄（已確認過）：停止處理、刪草稿 */
  const abandon = useCallback(
    async (id: number) => {
      try {
        await examImportApi.abandon(id);
        toast.success(t("questionBank.examImport.abandon.done"));
        if (importIdRef.current === id) {
          generationRef.current += 1;
          clearLocal();
          importIdRef.current = null;
          setDetail(null);
          setOpen(false);
        }
      } catch (err) {
        toast.error(t(errorKey(errorInfo(err).key)));
      } finally {
        void refreshList();
      }
    },
    [clearLocal, refreshList, t],
  );

  /** 先跳 ConfirmDialog（由 ExamImportSheet 顯示），確認後才 abandon */
  const requestAbandon = useCallback(
    (id: number) => {
      const target =
        (detail?.id === id ? detail : null) ??
        unfinished.find((i) => i.id === id) ??
        null;
      if (target) setAbandonTarget(target);
    },
    [detail, unfinished],
  );
  const confirmAbandon = useCallback(() => {
    if (abandonTarget) void abandon(abandonTarget.id);
    setAbandonTarget(null);
  }, [abandon, abandonTarget]);
  const cancelAbandon = useCallback(() => setAbandonTarget(null), []);

  const close = useCallback(() => {
    setOpen(false);
    void refreshList();
  }, [refreshList]);

  // 處理中超過 3 分鐘的頁可以重送（busySince 從前端第一次看到「處理中」算起）
  const staleProcessing = (pageNo: number) =>
    busySince[pageNo] !== undefined &&
    now - busySince[pageNo] > STALE_PROCESSING_MS;

  const needsFile =
    !!detail &&
    !hasSource &&
    detail.pages.some((p) => p.status === "pending" || p.status === "failed");

  return {
    open,
    view,
    unfinished,
    detail,
    loadingDetail,
    running,
    activePage,
    pageNotes,
    runError,
    thumbs,
    hasSource,
    needsFile,
    staleProcessing,
    openUpload,
    openImport,
    start,
    attachFiles,
    resendPage,
    sendBlankPage,
    abandon,
    abandonTarget,
    requestAbandon,
    confirmAbandon,
    cancelAbandon,
    close,
    refreshList,
  };
}

export type ExamImportController = ReturnType<typeof useExamImport>;

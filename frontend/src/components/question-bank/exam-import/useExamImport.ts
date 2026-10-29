/**
 * 上傳題本（#1112 C3／C4）的狀態與流程：由「我的教材」頁（TeacherTemplatePrograms）與「機構教材」頁
 * （OrgMaterialsPage，C4 開放機構題庫）各呼叫一次，不放在題庫分頁裡——切到「教材」分頁時題庫分頁會
 * 卸載，處理要繼續（C3 review 3）。提示列（ExamImportBanner，在題庫分頁）與上傳／核對 Sheet
 * （ExamImportSheet，在頁面層）共用這份狀態。
 *
 * - **題庫範圍**（C4）：`organizationId` 有值＝機構題庫：未完成列表只列該機構的匯入、建立時
 *   `settings.organization_id` 帶機構 id；換機構時停下目前這份、清空狀態。
 * - **畫面**：`view` 是 "upload"（上傳畫面）或 "review"（核對畫面，C4 定案 A1：開始擷取後直接進，
 *   題目邊處理邊出現；原進度畫面退場，每頁狀態與按鈕移到核對畫面「原卷第 N 頁」那一行）。
 * - **同一份題本已匯入過**：`openExisting` 依 409 帶的題庫判斷——同一個題庫直接打開；在別的題庫就交給
 *   宿主頁面的 `onOpenOtherBank`（切到那個題庫再打開）。
 * - **核對畫面用的**：`reload`（重抓整份）、`retryQuestion`（重讀單一題：不附頁圖，後端用存好的頁圖，
 *   C4a 修正）、`replaceCard`（409 卡片已更新時換成後端附的最新卡）、`markSaved`（全部存完：關面板、
 *   刷新列表）。
 * - **關面板前先收尾**（C4b 審查 3）：核對畫面用 `setBeforeClose` 登記收尾函式（存回編輯中的題、送出還沒送
 *   的年段）；關閉鈕與 Esc 走 `requestClose`，收尾失敗就不關（原因由核對畫面顯示）。`close` 直接關。
 *
 * - **Sheet 開關與處理分開**：關掉 Sheet、切到教材分頁都不會停止處理；提示列顯示進度。
 *   關掉網頁或離開「我的教材」頁才會停，下次從提示列「繼續」。
 * - **一次只處理一份**：處理中 `start` 直接丟 `anotherRunning`（不建立新匯入）；工具列的
 *   「上傳題本」也依 `running` 停用並說明原因。
 * - **開始擷取**：建立匯入（409 重複 → 提示＋「打開那次匯入」；429 每天 1 本）→ 換成核對畫面 →
 *   依 `sendOrder.nextPageToSend` 一次送一頁：空白頁呼叫「標為空白頁」（不送 AI），其他頁送擷取；
 *   每送完一頁重抓整份（答案頁會回填別頁）。
 * - **錯誤**：409 PAGE_BUSY → 維持處理中，之後每 5 秒重抓，處理中超過 3 分鐘才給「重送這一頁」；
 *   PAGE_DONE → 重抓；RETRY_LIMIT → 標「這一頁讀不出來，請手動補題」；504／502 → 後端已把頁標失敗，
 *   重抓後有重送次數就給「重送這一頁」；400（圖片過大／格式）、畫不出來 → 這一頁留在待處理並標原因，
 *   這一輪不再自動送，核對畫面該頁那一行給「重送這一頁」（重畫一次再送）；CLOSED／404／網路中斷 → 停止並提示。
 * - **停下後接著送**：沒在處理、有檔案、還有待處理的頁（`canResume`）時，核對畫面頂部有「繼續處理」
 *   （`resume`：清掉這一輪略過的頁、重新跑送出迴圈）。
 * - **繼續**（提示列）：還有待處理或失敗的頁才請老師重選檔案（雜湊、頁數相符才繼續，否則
 *   「不是同一份題本」）；打開的是同一份、檔案還在，就直接接著送。全部處理完的直接進核對畫面。
 *   空白頁「仍要送出這一頁」用後端存好的頁圖，不必重選。
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
  ExamImportCard,
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

export type ExamImportView = "upload" | "review";

export interface StartInput {
  source: PageSource;
  accents: string[];
  settings: ExamImportSettingsPayload;
}

/** 已匯入過的那一份在哪個題庫（409 EXAM_IMPORT_DUPLICATE） */
export interface ExistingImportTarget {
  id: number;
  organizationId: string | null;
  schoolId: string | null;
}

export interface UseExamImportOptions {
  /** 機構題庫的機構 id；不給＝我的題庫 */
  organizationId?: string | null;
  /** 「打開那次匯入」但那次在別的題庫：由宿主頁面切過去 */
  onOpenOtherBank?: (target: ExistingImportTarget) => void;
}

export function useExamImport(
  enabled: boolean,
  options: UseExamImportOptions = {},
) {
  const { t } = useTranslation();
  const organizationId = options.organizationId ?? null;
  const onOpenOtherBankRef = useRef(options.onOpenOtherBank);
  onOpenOtherBankRef.current = options.onOpenOtherBank;
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
      const res = await examImportApi.list(organizationId);
      if (mountedRef.current) setUnfinished(res.items);
    } catch (err) {
      console.error("Failed to load unfinished exam imports", err);
    }
  }, [enabled, organizationId]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // 換機構（同一頁切換工作區）：停下目前這份、清空狀態（提示列之後可續做）
  const scopeRef = useRef(organizationId);
  useEffect(() => {
    if (scopeRef.current === organizationId) return;
    scopeRef.current = organizationId;
    generationRef.current += 1;
    clearLocal();
    importIdRef.current = null;
    setDetail(null);
    setOpen(false);
    setPageNotes({});
    setRunError(null);
  }, [organizationId, clearLocal]);

  /** 核對畫面的整份資料也同步到提示列（處理中關掉 Sheet，提示列一樣看得到進度） */
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
   * 送一頁（擷取或標空白），之後重抓整份並回傳；"stop" 代表整份不能再處理（已結束、找不到、
   * 網路中斷）。
   * `skip` 收進這一輪不再自動送的頁（送不出去、仍是待處理）。
   */
  const sendOne = useCallback(
    async (
      id: number,
      pageNo: number,
      action: "auto" | "resend" | "sendBlank",
      skip?: Set<number>,
    ): Promise<ExamImportDetail | "stop"> => {
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
        return await fetchDetail(id);
      } catch (err) {
        setRunError({ key: errorInfo(err).key });
        return "stop";
      }
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
          d = result;
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

  /** 打開一份匯入的核對畫面（提示列「繼續」、重複匯入的「打開那次匯入」）；同一份、檔案還在就接著送 */
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
      setView("review");
      setOpen(true);
      setLoadingDetail(true);
      let loaded = false;
      try {
        await fetchDetail(id);
        loaded = true;
      } catch (err) {
        setRunError({ key: errorInfo(err).key });
      } finally {
        if (mountedRef.current) setLoadingDetail(false);
      }
      // 同一份、這次的檔案還在（例如網路中斷停下）：接著送沒處理的頁
      if (loaded && sourceRef.current && !runningRef.current) void runQueue(id);
    },
    [clearLocal, fetchDetail, runQueue, t],
  );

  /**
   * 開始擷取：建立匯入後換成核對畫面並開始送。失敗丟出錯誤（上傳畫面顯示）。
   * 已經有一份在處理：不建立新匯入，丟 `anotherRunning`。
   */
  const start = useCallback(
    async ({ source, accents, settings }: StartInput) => {
      // 上傳畫面會把錯誤顯示在送出鈕旁
      if (runningRef.current) throw new ClientError("anotherRunning");
      const created = await examImportApi.create({
        file_name: source.fileName,
        file_hash: source.hash,
        page_count: source.pageCount,
        tts_accents: accents,
        settings: organizationId
          ? { ...settings, organization_id: organizationId }
          : settings,
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
      setView("review");
      void refreshList();
      void runQueue(created.id);
    },
    [clearLocal, organizationId, refreshList, runQueue],
  );

  /** 「繼續處理」：停下（網路中斷、圖片被擋）後，清掉這一輪略過的頁，接著送 */
  const resume = useCallback(() => {
    if (!detail || !sourceRef.current || runningRef.current) return;
    void runQueue(detail.id);
  }, [detail, runQueue]);

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

  /**
   * 失敗頁（或處理中超過 3 分鐘的頁、被 400 擋下仍待處理的頁）重送；需要頁圖（沒有就先請老師
   * 重選檔案）。本機畫好的頁圖丟掉重畫一次（畫壞、壓縮過大時有機會不同）。
   */
  const resendPage = useCallback(
    async (pageNo: number) => {
      if (!detail || runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      const cached = localRef.current.get(pageNo);
      if (cached) {
        URL.revokeObjectURL(cached.thumbUrl);
        localRef.current.delete(pageNo);
        // 縮圖網址已釋放：一併拿掉，改顯示後端存的頁圖（避免破圖）；重畫後 sendOne 會再補上
        setThumbs((prev) => {
          const next = { ...prev };
          delete next[pageNo];
          return next;
        });
      }
      try {
        const result = await sendOne(detail.id, pageNo, "resend");
        // 之前因故停下的頁（例如網路中斷時還沒送）接著送
        if (result !== "stop") {
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

  /** 關面板前的收尾（核對畫面登記）；回傳 false＝不要關 */
  const beforeCloseRef = useRef<(() => Promise<boolean>) | null>(null);
  const setBeforeClose = useCallback((fn: (() => Promise<boolean>) | null) => {
    beforeCloseRef.current = fn;
  }, []);
  /** 關閉鈕／Esc：先收尾（存回編輯中的題），失敗就留著面板 */
  const requestClose = useCallback(async () => {
    const guard = beforeCloseRef.current;
    if (guard && !(await guard())) return;
    close();
  }, [close]);

  /** 「打開那次匯入」：同一個題庫直接打開；在別的題庫交給宿主頁面切過去 */
  const openExisting = useCallback(
    (target: ExistingImportTarget) => {
      const sameBank =
        !target.schoolId && (target.organizationId ?? null) === organizationId;
      if (sameBank) void openImport(target.id);
      else onOpenOtherBankRef.current?.(target);
    },
    [openImport, organizationId],
  );

  /** 重抓目前這份（核對畫面編輯、存入後） */
  const reload = useCallback(async () => {
    const id = importIdRef.current;
    if (id === null) return null;
    return fetchDetail(id);
  }, [fetchDetail]);

  /**
   * 重讀單一題：不附頁圖，後端用擷取時存好的頁圖（C4a 修正；瀏覽器不必抓 GCS 頁圖）。
   * 錯誤丟給呼叫端顯示（409 RETRY_LIMIT → 只留「手動補這一題」；409 PAGE_IMAGE_MISSING → 輕提示）。
   */
  const retryQuestion = useCallback(
    async (pageNo: number, cardId: string) => {
      const id = importIdRef.current;
      if (id === null) return;
      try {
        await examImportApi.retry(id, pageNo, cardId);
      } finally {
        await fetchDetail(id).catch(() => undefined);
      }
    },
    [fetchDetail],
  );

  /** 換掉畫面上的一張卡（409 EXAM_IMPORT_CARD_CHANGED 附的最新卡片） */
  const replaceCard = useCallback((card: ExamImportCard) => {
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            pages: prev.pages.map((p) =>
              p.cards.some((c) => c.card_id === card.card_id)
                ? {
                    ...p,
                    cards: p.cards.map((c) =>
                      c.card_id === card.card_id ? card : c,
                    ),
                  }
                : p,
            ),
          }
        : prev,
    );
  }, []);

  /** 全部存完（或只剩題庫已有的題）：關面板、這份從提示列消失 */
  const markSaved = useCallback(() => {
    generationRef.current += 1;
    clearLocal();
    importIdRef.current = null;
    setDetail(null);
    setOpen(false);
    void refreshList();
  }, [clearLocal, refreshList]);

  // 處理中超過 3 分鐘的頁可以重送（busySince 從前端第一次看到「處理中」算起）
  const staleProcessing = (pageNo: number) =>
    busySince[pageNo] !== undefined &&
    now - busySince[pageNo] > STALE_PROCESSING_MS;

  const needsFile =
    !!detail &&
    !hasSource &&
    detail.pages.some((p) => p.status === "pending" || p.status === "failed");

  // 停下了但還有待處理的頁、檔案也還在：給「繼續處理」
  const canResume =
    !!detail &&
    hasSource &&
    !running &&
    detail.pages.some((p) => p.status === "pending");

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
    canResume,
    staleProcessing,
    openUpload,
    openImport,
    start,
    resume,
    attachFiles,
    resendPage,
    sendBlankPage,
    abandon,
    abandonTarget,
    requestAbandon,
    confirmAbandon,
    cancelAbandon,
    close,
    setBeforeClose,
    requestClose,
    refreshList,
    organizationId,
    openExisting,
    reload,
    retryQuestion,
    replaceCard,
    markSaved,
  };
}

export type ExamImportController = ReturnType<typeof useExamImport>;

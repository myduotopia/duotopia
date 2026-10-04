/**
 * useAssignmentAutoSave — 作業設定 sheet「改完即存」的儲存佇列（Issue #1092）
 *
 * AssignmentDetailSheet 拿掉「編輯」模式後，每個欄位改完就 PATCH
 * `/api/teachers/assignments/{id}`（後端以 model_fields_set 做部分更新）。這支 hook 只管
 * 「送什麼、照什麼順序送、送完記在哪」，欄位接線與錯誤提示留在 sheet：
 *
 * - **基準值（baseline）**：`reset(saved)` 以「畫面格式正規化後」的欄位值當最後一次儲存成功
 *   的值；`baseline()` ＝ 已儲存值再疊上「送出中＋排隊中」的 patch，也就是「全部送完後
 *   伺服器會是什麼」。diff 一律對它算，連點同一個開關（開 → 關）才不會因為比到舊值而漏送。
 * - **只送有變的欄位**：`saveFields(section, next)` 只把 `next` 中與 baseline 不同的 key 排進佇列；
 *   沒有差異回 `null`、不發請求。
 * - **序列化＋合併**（沿用 classroom/GroupSettingsTab 的 pending ＋ drain 寫法）：一次只送一個
 *   請求、先進先出；尚未送出的最後一筆若同一區（section），新的變動直接併進去，併完若跟
 *   已儲存值相同的 key 會被拿掉（整筆都沒差就不送）。不同區不合併 —— 一區失敗不會連帶把
 *   另一區的欄位退回。
 * - **回傳**：成功時 resolve `{ body, response }`（呼叫端可讀 `recomputed_count`）；失敗時 reject
 *   原始錯誤，呼叫端據 422/400 code 提示並用 `baseline()` 把欄位退回。失敗不會中斷佇列。
 * - **狀態**：每區一個 SaveState（idle／saving／saved／failed），給區塊標題的儲存狀態用。
 * - **flush()**：等佇列全部送完（關閉 sheet 前呼叫）；`hasSaved()` 回報本次開啟後是否成功存過，
 *   sheet 關閉時據此決定要不要呼叫 onAssignmentUpdated。
 */
import { useCallback, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "failed";
export type AutoSaveSection = "basic" | "advanced" | "scoring";
export type PatchBody = Record<string, unknown>;

export interface AutoSaveResult<R> {
  /** 實際送出的欄位（可能是多次變動合併後的結果） */
  body: PatchBody;
  response: R;
}

interface Waiter<R> {
  resolve: (value: AutoSaveResult<R> | null) => void;
  reject: (reason: unknown) => void;
}

interface Entry<R> {
  section: AutoSaveSection;
  body: PatchBody;
  waiters: Waiter<R>[];
}

const IDLE_STATES: Record<AutoSaveSection, SaveState> = {
  basic: "idle",
  advanced: "idle",
  scoring: "idle",
};

/** `next` 中與 `base` 不同的欄位（值都是 primitive：布林／數字／字串／null）。 */
export function diffFields(base: PatchBody, next: PatchBody): PatchBody {
  const out: PatchBody = {};
  for (const key of Object.keys(next)) {
    if (!Object.is(base[key], next[key])) out[key] = next[key];
  }
  return out;
}

interface Options<R> {
  /** 送出 PATCH；回傳後端回應 */
  patch: (body: PatchBody) => Promise<R>;
  /** 每次成功後通知（sheet 用來把欄位併進 detailData） */
  onSaved?: (body: PatchBody, response: R) => void;
}

export function useAssignmentAutoSave<R = unknown>({
  patch,
  onSaved,
}: Options<R>) {
  const [saveStates, setSaveStates] =
    useState<Record<AutoSaveSection, SaveState>>(IDLE_STATES);

  // 存檔迴圈內讀最新的 callback，不閉包住過期 render
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const savedRef = useRef<PatchBody>({});
  const inFlightRef = useRef<Entry<R> | null>(null);
  const queueRef = useRef<Entry<R>[]>([]);
  const drainingRef = useRef(false);
  const idleWaitersRef = useRef<Array<() => void>>([]);
  const savedAnyRef = useRef(false);

  const setState = useCallback((section: AutoSaveSection, s: SaveState) => {
    setSaveStates((prev) =>
      prev[section] === s ? prev : { ...prev, [section]: s },
    );
  }, []);

  const baseline = useCallback((): PatchBody => {
    const merged: PatchBody = { ...savedRef.current };
    if (inFlightRef.current) Object.assign(merged, inFlightRef.current.body);
    for (const e of queueRef.current) Object.assign(merged, e.body);
    return merged;
  }, []);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const entry = queueRef.current.shift() as Entry<R>;
        inFlightRef.current = entry;
        setState(entry.section, "saving");
        try {
          const response = await patchRef.current(entry.body);
          savedRef.current = { ...savedRef.current, ...entry.body };
          savedAnyRef.current = true;
          inFlightRef.current = null;
          onSavedRef.current?.(entry.body, response);
          // 同一區後面還有排隊的就維持「儲存中」
          if (!queueRef.current.some((e) => e.section === entry.section)) {
            setState(entry.section, "saved");
          }
          entry.waiters.forEach((w) =>
            w.resolve({ body: entry.body, response }),
          );
        } catch (error) {
          inFlightRef.current = null;
          setState(entry.section, "failed");
          entry.waiters.forEach((w) => w.reject(error));
        }
      }
    } finally {
      drainingRef.current = false;
      inFlightRef.current = null;
      const waiters = idleWaitersRef.current;
      idleWaitersRef.current = [];
      waiters.forEach((resolve) => resolve());
    }
  }, [setState]);

  /**
   * 排進一筆變動。只送與 baseline 不同的 key；沒差異 → resolve null、不發請求。
   */
  const saveFields = useCallback(
    (
      section: AutoSaveSection,
      next: PatchBody,
    ): Promise<AutoSaveResult<R> | null> => {
      const diff = diffFields(baseline(), next);
      if (Object.keys(diff).length === 0) return Promise.resolve(null);

      return new Promise<AutoSaveResult<R> | null>((resolve, reject) => {
        const waiter: Waiter<R> = { resolve, reject };
        const queue = queueRef.current;
        const last = queue[queue.length - 1];
        if (last && last.section === section) {
          // 併進尚未送出的同區最後一筆；併完跟已儲存值相同的 key 拿掉
          const mergedBody = diffFields(
            { ...savedRef.current, ...(inFlightRef.current?.body ?? {}) },
            { ...last.body, ...diff },
          );
          last.waiters.push(waiter);
          if (Object.keys(mergedBody).length === 0) {
            queue.pop();
            last.waiters.forEach((w) => w.resolve(null));
            return;
          }
          last.body = mergedBody;
        } else {
          queue.push({ section, body: diff, waiters: [waiter] });
        }
        void drain();
      });
    },
    [baseline, drain],
  );

  /** 等佇列全部送完（含送出中的那一筆）。 */
  const flush = useCallback((): Promise<void> => {
    if (!drainingRef.current && queueRef.current.length === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      idleWaitersRef.current.push(resolve);
    });
  }, []);

  /** 重新開啟／載入詳情時：設定已儲存值、清掉狀態與「存過」旗標。 */
  const reset = useCallback((saved: PatchBody) => {
    savedRef.current = { ...saved };
    savedAnyRef.current = false;
    setSaveStates(IDLE_STATES);
  }, []);

  const hasSaved = useCallback(() => savedAnyRef.current, []);

  return { saveStates, saveFields, baseline, flush, reset, hasSaved };
}

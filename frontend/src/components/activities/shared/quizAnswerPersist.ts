/**
 * quizAnswerPersist — 小考逐題答案寫入的去重／in-flight 追蹤器（#1045）
 *
 * 背景：autosave（停手 1 秒）與換題／送出會對同一題同時打 answer API，
 * 後端並發時曾產生重複列（監考 31/30）。前端用本追蹤器：
 *   - 只有「已確認成功寫入」的值才略過（confirmed）；sender 回 skipped 不算確認
 *   - 同題同值已有 in-flight 請求 → await 它；失敗則重送
 *   - 同題不同值已有 in-flight → 先等它結束再送（同題請求序列化）
 *   - flush()：等所有 in-flight 完成，失敗者重送一次；供送出整卷前呼叫
 */

export interface PersistResult {
  ok: boolean;
  /** true＝sender 沒有真的送出（預覽/demo/session 未建立/空值）；不記 confirmed */
  skipped?: boolean;
}

export type PersistSender<R extends PersistResult> = (
  itemId: number,
  value: string,
) => Promise<R>;

interface InflightEntry<R extends PersistResult> {
  value: string;
  promise: Promise<R>;
}

export interface AnswerPersistTracker<R extends PersistResult> {
  /** 寫入某題答案（去重＋in-flight 合併）。回傳最終結果。 */
  save(itemId: number, value: string): Promise<R | PersistResult>;
  /** autosave 用：此值已確認寫入或正在寫入 → 不需排程。 */
  isSavedOrPending(itemId: number, value: string): boolean;
  /** 等所有 in-flight 完成，失敗者重送；全部成功回 true。 */
  flush(): Promise<boolean>;
}

export function createAnswerPersistTracker<R extends PersistResult>(
  getSender: () => PersistSender<R>,
): AnswerPersistTracker<R> {
  const confirmed = new Map<number, string>();
  const inflight = new Map<number, InflightEntry<R>>();

  const start = (itemId: number, value: string): Promise<R> => {
    // entry 先建立，cleanup 以物件身分比對（避免 TS 認為 promise 未賦值）
    const entry = { value } as InflightEntry<R>;
    entry.promise = (async (): Promise<R> => {
      let result: R;
      try {
        result = await getSender()(itemId, value);
      } catch {
        result = { ok: false } as R;
      }
      // skipped（未真的送出，如 session 尚未建立）不可記成已確認，否則之後永遠不送
      if (result.ok && !result.skipped) confirmed.set(itemId, value);
      else if (confirmed.get(itemId) === value) confirmed.delete(itemId);
      if (inflight.get(itemId) === entry) inflight.delete(itemId);
      return result;
    })();
    inflight.set(itemId, entry);
    return entry.promise;
  };

  const save = async (
    itemId: number,
    value: string,
  ): Promise<R | PersistResult> => {
    // 迴圈：遇到 in-flight 就等；等完若同值成功即返回，否則重新判斷（可能已有別人重送）
    for (;;) {
      if (confirmed.get(itemId) === value) return { ok: true };
      const current = inflight.get(itemId);
      if (!current) return start(itemId, value);
      const result = await current.promise;
      if (current.value === value && result.ok) return result;
    }
  };

  const isSavedOrPending = (itemId: number, value: string): boolean =>
    confirmed.get(itemId) === value || inflight.get(itemId)?.value === value;

  const flush = async (): Promise<boolean> => {
    const entries = Array.from(inflight.entries());
    const results = await Promise.all(
      entries.map(async ([itemId, entry]) => {
        const first = await entry.promise;
        if (first.ok) return true;
        return (await save(itemId, entry.value)).ok;
      }),
    );
    return results.every(Boolean);
  };

  return { save, isSavedOrPending, flush };
}

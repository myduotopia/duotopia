/**
 * 情境對話送出前的「答完了嗎」判定（Issue #1140 A 項）。
 *
 * ## 為什麼需要自己一套
 *
 * 作業頁的送出檢查（`handleSubmit`）讀的是 `activities` state 裡的
 * `item.recording_url`。情境對話的錄音是在 `studentAdapters` 裡上傳的，**不會回寫那份
 * state** —— 所以那個檢查對情境對話一律看成「沒錄音」，而
 * `activityNeedsRecording()` 也刻意沒把 `SCENARIO_DIALOGUE` 列進去（列進去會讓每一題
 * 都被誤判，見 `StudentActivityPageContent` 裡 `RECORDING_REQUIRED_TYPES` 旁的警告）。
 *
 * 答題進度只有 `ScenarioChatActivity` 知道，所以它透過 `onProgressChange` 回報，
 * 這裡做判定。
 *
 * ## 為什麼是提醒而不是擋掉
 *
 * 每一題都可以略過，所以全部略過也走得到「送出」。但學生可能真的想先交（下課了、
 * 下次再補），所以沿用其他模式那個「未完成」dialog：列出哪幾題沒答，可以取消，
 * 也可以堅持送出。
 */

/**
 * 回傳沒答過的題號（1 起算）。
 *
 * `answered` 可能比 `itemCount` 短（元件還沒回報、或回報到一半），**缺的一律算沒答**
 * —— 寧可多提醒一次，也不要讓學生以為自己答完了。
 */
export function unansweredQuestionNumbers(
  itemCount: number,
  answered: boolean[],
): number[] {
  const numbers: number[] = [];
  for (let i = 0; i < itemCount; i += 1) {
    if (!answered[i]) numbers.push(i + 1);
  }
  return numbers;
}

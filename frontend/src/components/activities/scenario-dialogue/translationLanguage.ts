/**
 * 情境對話翻譯鈕的語言判定（#1133）。
 *
 * 翻譯鈕只在「題目的翻譯語言＝學生介面語言」時出現：
 * - 學生介面＝英文 → 永遠沒有翻譯鈕（題目本身就是英文）。
 * - 介面語言用前綴判定：`zh`＝中文、`ja`＝日文、`ko`＝韓文（日韓為預留，sample 不示範）。
 * - 翻譯語言是 `scenario_settings.translate_language` 存的值（"chinese"／"japanese"／
 *   "korean"／老師自訂名稱）；自訂名稱對不上任何介面語言，就不顯示。
 * DB 每題目前只存一份翻譯；要支援其他介面語言需下一階段後端（即時翻譯或派發時預先翻）。
 */

const UI_PREFIX_TO_TRANSLATE_LANGUAGE: Record<string, string> = {
  zh: "chinese",
  ja: "japanese",
  ko: "korean",
};

/** 介面語言（例如 "zh-TW"、"en"）對應的翻譯語言值；英文或不支援的語言回傳 null */
export function translateLanguageForUi(uiLanguage: string): string | null {
  const prefix = uiLanguage.toLowerCase().split(/[-_]/)[0];
  return UI_PREFIX_TO_TRANSLATE_LANGUAGE[prefix] ?? null;
}

/** 這份翻譯能不能給這個介面語言的學生看 */
export function translationMatchesUi(
  translationLanguage: string | undefined,
  uiLanguage: string,
): boolean {
  if (!translationLanguage) return false;
  const wanted = translateLanguageForUi(uiLanguage);
  return wanted !== null && translationLanguage.trim().toLowerCase() === wanted;
}

/**
 * 圖片題組的對話文稿 ↔ 文字版（Issue #1083，2026-10-06）。
 *
 * 決策：以圖為準的題組（漫畫、對話圖）由 AI 擷取為逐句「說話者: 台詞」，存
 * `question_group_segments`；它是之後題組對話音檔的唯一來源，所以老師不可修改，
 * 文字版（`passage_text`，搜尋／AI 用）只是它的純文字副本。
 *
 * 文字版格式（後端 `routers/question_bank_schemas.dialogue_passage_text` 同規則）：
 *   非對話文字（標題、旁白、標示；可無）
 *   （空行）
 *   Speaker: line
 *   Speaker: line
 *
 * 非對話文字沒有獨立欄位，存在文字版開頭；讀回時用「結尾正好是這份對話」切出來。
 */

import type { GroupSegmentInput } from "@/types/questionBank";

/** 逐句對話的純文字：一句一行 `Speaker: line` */
export function dialogueLines(segments: GroupSegmentInput[]): string {
  return segments
    .map((s) =>
      s.speaker_label ? `${s.speaker_label}: ${s.transcript}` : s.transcript,
    )
    .join("\n");
}

/** 從文字版取出對話之前的非對話文字；結尾不是這份對話（對不上）時回 "" */
export function dialogueNarration(
  passageText: string,
  segments: GroupSegmentInput[],
): string {
  const text = passageText.trim();
  const lines = dialogueLines(segments);
  if (!text || !lines || !text.endsWith(lines)) return "";
  return text.slice(0, text.length - lines.length).trim();
}

/** 組文字版：非對話文字＋空行＋逐句對話 */
export function dialoguePassageText(
  narration: string,
  segments: GroupSegmentInput[],
): string {
  return [narration.trim(), dialogueLines(segments)]
    .filter((p) => p !== "")
    .join("\n\n");
}

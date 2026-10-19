/**
 * 作業的「類型」徽章（清單、詳情 sheet、詳情頁共用）。
 *
 * ## 為什麼要抽出來
 *
 * 這段判定原本**被複製三份**：
 *
 * * `ClassroomDetail.tsx` 的作業清單徽章
 * * `AssignmentDetailSheet.tsx` 的詳情徽章
 * * `ClassroomDetail.tsx` 詳情頁內文的另一份 inline 對照表
 *
 * 三份都只列舉 `VOCABULARY_SET` / `EXAMPLE_SENTENCES` 與四個 legacy 型別，
 * 所以情境對話的作業一律顯示「未知類型」—— 三個地方同時錯。
 *
 * 這與 #1030／#1033／#1034 是同一個病：**手寫列舉，新增題型時漏掉**。
 * 修法也一樣：**以 `practice_mode` 查 registry**，未來新增任何模式都自動有標籤。
 *
 * ## 判定順序（刻意保留既有行為）
 *
 * 1. 單字集／例句集照舊先走各自的分支 —— 它們有「沒有 practice_mode 時的預設標籤」
 *    與專屬配色，直接改成查 registry 會改變現有畫面。
 * 2. legacy 型別（SPEAKING_PRACTICE 等）照舊。
 * 3. **新增**：以 `practice_mode` 查 registry —— 情境對話與未來的新模式走這裡。
 * 4. 都認不得才是「未知類型」。
 *
 * 第 3 步放在倒數第二，就是為了既不動既有顯示、又讓新模式不會再掉進「未知類型」。
 */

import {
  getModeConfig,
  practiceModeBadgeClass,
  practiceModeLabelKey,
} from "./practiceMode";

export interface AssignmentTypeBadge {
  label: string;
  /** Tailwind class（徽章底色與文字色）。 */
  className: string;
}

const UNKNOWN_CLASS =
  "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";

/** 早於 practice_mode 制度的內容型別，各有固定標籤。 */
const LEGACY_TYPE_LABELS: Record<string, AssignmentTypeBadge> = {
  SPEAKING_PRACTICE: {
    label: "classroomDetail.contentTypes.speakingPractice",
    className:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  },
  SPEAKING_SCENARIO: {
    label: "classroomDetail.contentTypes.speakingScenario",
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  LISTENING_CLOZE: {
    label: "classroomDetail.contentTypes.listeningCloze",
    className:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  },
  SPEAKING_QUIZ: {
    label: "classroomDetail.contentTypes.speakingQuiz",
    className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  },
};

/**
 * 回傳要顯示的標籤與配色。
 *
 * `t` 由呼叫端傳入（這個模組不依賴 i18n 實例，才驗得到）。
 */
export function assignmentTypeBadge(
  contentType: string | null | undefined,
  practiceMode: string | null | undefined,
  t: (key: string) => string,
): AssignmentTypeBadge {
  // 1) 單字集：依 practice_mode，沒有就退回單字朗讀（既有行為）
  if (contentType === "VOCABULARY_SET" || contentType === "SENTENCE_MAKING") {
    const key = practiceModeLabelKey(practiceMode);
    if (key) {
      return { label: t(key), className: practiceModeBadgeClass(practiceMode) };
    }
    return {
      label: t("practiceMode.word_reading.label"),
      className:
        "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
    };
  }

  // 2) 例句集：重組與朗讀分開，其餘退回朗讀（既有行為）
  if (
    contentType === "EXAMPLE_SENTENCES" ||
    contentType === "READING_ASSESSMENT"
  ) {
    if (practiceMode === "rearrangement") {
      return {
        label: t("practiceMode.rearrangement.label"),
        className:
          "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
      };
    }
    return {
      label: t("practiceMode.reading.label"),
      className:
        "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    };
  }

  // 3) legacy 型別
  const legacy = LEGACY_TYPE_LABELS[contentType || ""];
  if (legacy) return { label: t(legacy.label), className: legacy.className };

  // 4) 其餘一律查 registry —— 情境對話走這裡，未來新增的模式也是。
  //    少了這一步，新題型的作業就會顯示「未知類型」（這次回報的 bug）。
  if (getModeConfig(practiceMode)) {
    return {
      label: t(practiceModeLabelKey(practiceMode)),
      className: practiceModeBadgeClass(practiceMode),
    };
  }

  return {
    label: t("classroomDetail.labels.unknownType"),
    className: UNKNOWN_CLASS,
  };
}

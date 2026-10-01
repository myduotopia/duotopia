/**
 * quizScoring — 打字類小考評分方式（Issue #1092）前端鏡像
 *
 * 後端 `backend/utils/quiz_scoring.py` 才是唯一判定來源；這裡**只供派發／編輯時的
 * 即時試算**（批改頁一律用後端回的 `default_deduction`）。兩邊規則必須一致，
 * 測試案例（quizScoring.test.ts）與後端 tests/unit/test_quiz_scoring.py 用同一組數字。
 * 新增評分方式時兩個檔都要改，見 docs/design/quiz-scoring-methods.md。
 *
 * 規則：
 *   - per_q = 100 / 題數（不先捨入）；正解以空白切成 N 個單字，學生答案逐格對應
 *     （空格 = 該單字錯）；比對前 trim，不分大小寫時轉小寫。
 *   - d = 編輯距離（多打／少打／打錯各算 1；空格的 d = 該單字字母數）。
 *   - 學生字數多於格數：多出的非空字以空白併入最後一格 → 最後一格必錯。
 *   - whole_question（A，null 亦同）：有錯 → per_q
 *     per_word（B）：per_q × 錯字數 / N
 *     per_word_lenient（C）：每字 d=0 扣 0；d=1 且有填且單字長度 > 1 扣 per_q/N 的一半；其餘扣 per_q/N
 *     fixed_per_word（D）：points × 錯字數；fixed_per_letter（E）：points × Σd
 *   - 上限 per_q；未作答（含每格都空白）扣 per_q；全對扣 0；部分扣分逐題加總後
 *     half-up 到小數一位（捨入後 ≥ per_q 視為全扣），全扣維持 per_q 原值。
 *   - 總分 = round1(max(0, 100 − Σ扣分))。
 *
 * 另含小考輸入格的切格 / 合併（QuizAnswerInput 與兩個小考 Activity 共用）。
 */

export type QuizScoringMethod =
  | "whole_question"
  | "per_word"
  | "per_word_lenient"
  | "fixed_per_word"
  | "fixed_per_letter";

export const QUIZ_SCORING_METHODS: QuizScoringMethod[] = [
  "whole_question",
  "per_word",
  "per_word_lenient",
  "fixed_per_word",
  "fixed_per_letter",
];

/** D、E 需要老師填「每錯一個單字／字母扣幾分」。 */
export const METHODS_REQUIRING_POINTS: ReadonlySet<QuizScoringMethod> = new Set(
  ["fixed_per_word", "fixed_per_letter"],
);

/** 有評分方式可選的打字類小考。 */
export const TYPED_QUIZ_MODES: ReadonlySet<string> = new Set([
  "word_spelling_quiz",
  "word_cloze_quiz",
]);

export function isTypedQuizMode(mode: string | null | undefined): boolean {
  return !!mode && TYPED_QUIZ_MODES.has(mode);
}

/** null（舊作業）＝整題計分。 */
export function effectiveMethod(
  method: QuizScoringMethod | string | null | undefined,
): QuizScoringMethod {
  return (method as QuizScoringMethod) || "whole_question";
}

// ---------------------------------------------------------------------------
// 輸入格切格 / 合併（#1092 格子定位）
// ---------------------------------------------------------------------------

/** 正解有幾格（以空白切；空正解視為 1 格）。 */
export function answerSlotCount(expected: string): number {
  const trimmed = (expected || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 1;
}

/** value 拆回逐格（單一空白為分隔，空格留在原位），補齊／截到格數。 */
export function splitAnswerSlots(value: string, slotCount: number): string[] {
  const parts = (value || "").split(" ");
  while (parts.length < slotCount) parts.push("");
  return parts.slice(0, slotCount);
}

/** 只去尾端空白（開頭空白＝第 1 格沒填，要保留格子位置）。 */
export function trimSlotsEnd(value: string): string {
  return (value || "").replace(/\s+$/, "");
}

/** 逐格 join 回 value，只去尾端空白。 */
export function joinAnswerSlots(slots: string[]): string {
  return trimSlotsEnd(slots.join(" "));
}

/** 小考送出用的逐格答案（typed_words）：長度＝正解單字數，空格為 ""。 */
export function toTypedWords(value: string, expected: string): string[] {
  return splitAnswerSlots(value, answerSlotCount(expected));
}

// ---------------------------------------------------------------------------
// 比對
// ---------------------------------------------------------------------------

export interface AnswerEvaluation {
  isCorrect: boolean;
  /** 每格都空白 ＝ 視同未作答 */
  isBlank: boolean;
  wordTotal: number;
  wrongWords: number;
  wrongLetters: number;
  perWordDistance: number[];
  /** C 方式該字可否只扣一半（d=1 且有填且正解單字長度 > 1） */
  perWordHalf: boolean[];
}

const norm = (word: string, caseSensitive: boolean) => {
  const w = (word || "").trim();
  return caseSensitive ? w : w.toLowerCase();
};

/** Python str.split()：去頭尾空白後以任意空白切，空字串回 []。 */
const pySplit = (s: string) => {
  const t = (s || "").trim();
  return t ? t.split(/\s+/) : [];
};

/** Levenshtein 距離（插入／刪除／替換各算 1）。 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(
        Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        ),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function align(words: string[], correctWords: string[]): string[] {
  const n = correctWords.length;
  if (n === 0) return [];
  const slots = words.slice(0, n);
  while (slots.length < n) slots.push("");
  const extras = words.slice(n).filter((w) => w);
  if (extras.length) {
    slots[n - 1] = [slots[n - 1], ...extras].filter((w) => w).join(" ");
  }
  return slots;
}

/**
 * 逐格比對一題答案。`answer` 為逐格陣列（typed_words）或整串（舊作答）。
 * isCorrect：整串時 = trim（＋不分大小寫時 lower）相等；陣列時 = 每格相符且沒有多出的字。
 */
export function evaluateAnswer(
  answer: string[] | string | null | undefined,
  correct: string,
  caseSensitive = false,
): AnswerEvaluation {
  const words =
    answer == null
      ? []
      : typeof answer === "string"
        ? pySplit(answer)
        : answer.map((w) => (w || "").trim());
  const correctWords = pySplit(correct || "");
  const slots = align(words, correctWords);

  const perWordDistance: number[] = [];
  const perWordHalf: boolean[] = [];
  slots.forEach((typed, i) => {
    const expected = correctWords[i];
    const d = editDistance(
      norm(typed, caseSensitive),
      norm(expected, caseSensitive),
    );
    perWordDistance.push(d);
    perWordHalf.push(d === 1 && !!typed && expected.length > 1);
  });
  const wrongWords = perWordDistance.filter((d) => d > 0).length;

  let isCorrect: boolean;
  if (answer == null || typeof answer === "string") {
    isCorrect =
      norm(answer || "", caseSensitive) === norm(correct || "", caseSensitive);
  } else {
    const hasExtra = words.slice(correctWords.length).some((w) => w);
    isCorrect = correctWords.length
      ? wrongWords === 0 && !hasExtra
      : !words.some((w) => w);
  }

  return {
    isCorrect,
    isBlank: !words.some((w) => w),
    wordTotal: correctWords.length,
    wrongWords,
    wrongLetters: perWordDistance.reduce((a, d) => a + d, 0),
    perWordDistance,
    perWordHalf,
  };
}

// ---------------------------------------------------------------------------
// 扣分 / 總分
// ---------------------------------------------------------------------------

/** 去掉浮點雜訊（對齊後端 Decimal(str(x)) 的十進位運算）。 */
const clean = (x: number) => Number(x.toPrecision(12));

const EPS = 1e-9;

/** 四捨五入到小數一位（half-up）。 */
export function roundHalfUp1(value: number): number {
  const scaled = clean(clean(value) * 10);
  const rounded = Math.round(scaled) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** 單題扣分。evaluation 為 null 或整題空白 ＝ 未作答（扣 perQ）。 */
export function questionDeduction(
  method: QuizScoringMethod | string | null | undefined,
  points: number | null | undefined,
  perQ: number,
  evaluation: AnswerEvaluation | null,
): number {
  if (evaluation == null) return perQ;
  if (evaluation.isCorrect) return 0;
  const m = effectiveMethod(method);
  const n = evaluation.wordTotal;
  if (m === "whole_question" || n === 0 || evaluation.isBlank) return perQ;

  let raw: number;
  if (m === "per_word") {
    raw = (perQ * evaluation.wrongWords) / n;
  } else if (m === "per_word_lenient") {
    const perWord = perQ / n;
    raw = 0;
    evaluation.perWordDistance.forEach((d, i) => {
      if (d === 0) return;
      raw += evaluation.perWordHalf[i] ? perWord / 2 : perWord;
    });
  } else if (m === "fixed_per_word") {
    raw = (points || 0) * evaluation.wrongWords;
  } else if (m === "fixed_per_letter") {
    raw = (points || 0) * evaluation.wrongLetters;
  } else {
    return perQ;
  }

  if (clean(raw) >= perQ - EPS) return perQ;
  const rounded = roundHalfUp1(raw);
  if (rounded >= perQ - EPS) return perQ;
  return rounded;
}

/** 每題配分 100 / 題數；題數未知或 0 → null（畫面不顯示數字）。 */
export function perQuestionPoints(
  questionCount: number | null | undefined,
): number | null {
  return questionCount && questionCount > 0 ? 100 / questionCount : null;
}

/** 總分 = round1(clamp(100 − Σ扣分, 0, 100))；全扣以「題數 × perQ」計（與後端一致）。 */
export function totalScore(perQ: number, deductions: number[]): number {
  const full = deductions.filter((d) => d === perQ).length;
  const partialTenths = deductions
    .filter((d) => d && d !== perQ)
    .reduce((acc, d) => acc + Math.round(d * 10), 0);
  const deducted = full * perQ + partialTenths / 10;
  const value = Math.max(0, Math.min(100, 100 - deducted));
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

// ---------------------------------------------------------------------------
// 派發／編輯的設定值（QuizScoringMethodField 用）
// ---------------------------------------------------------------------------

export interface QuizScoringSettings {
  /** 新派發不預選（null）；編輯舊作業時 null 顯示為整題計分 */
  method: QuizScoringMethod | null;
  /** D、E 每錯一單位扣幾分（> 0、≤ 100）；輸入不合法時為 null */
  points: number | null;
  caseSensitive: boolean;
}

export const EMPTY_QUIZ_SCORING: QuizScoringSettings = {
  method: null,
  points: null,
  caseSensitive: false,
};

export function isValidScoringPoints(points: number | null | undefined) {
  return (
    points != null && Number.isFinite(points) && points > 0 && points <= 100
  );
}

/** 可以送出：已選方式，且 D/E 已填合法的扣分。 */
export function isQuizScoringComplete(s: QuizScoringSettings): boolean {
  if (!s.method) return false;
  return (
    !METHODS_REQUIRING_POINTS.has(s.method) || isValidScoringPoints(s.points)
  );
}

/** 由作業詳情 API 讀回設定；舊作業 method=null 顯示為整題計分。 */
export function quizScoringFromDetail(detail: {
  quiz_scoring_method?: unknown;
  quiz_scoring_points?: unknown;
  quiz_case_sensitive?: unknown;
}): QuizScoringSettings {
  const method = QUIZ_SCORING_METHODS.includes(
    detail.quiz_scoring_method as QuizScoringMethod,
  )
    ? (detail.quiz_scoring_method as QuizScoringMethod)
    : "whole_question";
  const points =
    typeof detail.quiz_scoring_points === "number"
      ? detail.quiz_scoring_points
      : null;
  return { method, points, caseSensitive: detail.quiz_case_sensitive === true };
}

/**
 * 有效設定是否不同（與後端 PATCH 的判斷一致）：method null ＝ 整題計分、
 * 大小寫 null ＝ 不分，points 只在 D/E 才比較（到小數兩位）。
 */
export function quizScoringChanged(
  before: QuizScoringSettings,
  after: QuizScoringSettings,
): boolean {
  const eff = (s: QuizScoringSettings) => {
    const method = effectiveMethod(s.method);
    const points =
      METHODS_REQUIRING_POINTS.has(method) && s.points != null
        ? Math.round(s.points * 100)
        : null;
    return [method, points, !!s.caseSensitive] as const;
  };
  const [m1, p1, c1] = eff(before);
  const [m2, p2, c2] = eff(after);
  return m1 !== m2 || p1 !== p2 || c1 !== c2;
}

/** 送給 create / PATCH API 的三個欄位。 */
export function quizScoringPayload(s: QuizScoringSettings) {
  return {
    quiz_scoring_method: s.method,
    quiz_scoring_points:
      s.method && METHODS_REQUIRING_POINTS.has(s.method) ? s.points : null,
    quiz_case_sensitive: s.caseSensitive,
  };
}

export type QuizScoringErrorCode =
  | "QUIZ_SCORING_METHOD_REQUIRED"
  | "QUIZ_SCORING_POINTS_REQUIRED";

/** 後端 422 評分設定錯誤碼（不依賴 ApiError class，避免把 api 模組拉進試算測試）。 */
export function quizScoringErrorCode(
  error: unknown,
): QuizScoringErrorCode | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { status?: unknown; detail?: unknown };
  if (e.status !== 422 || !e.detail || typeof e.detail !== "object")
    return null;
  const code = (e.detail as { code?: unknown }).code;
  return code === "QUIZ_SCORING_METHOD_REQUIRED" ||
    code === "QUIZ_SCORING_POINTS_REQUIRED"
    ? code
    : null;
}

// ---------------------------------------------------------------------------
// 試算表
// ---------------------------------------------------------------------------

/** 沒有實際題目可用時的內建例句。 */
export const BUILTIN_SAMPLE_ANSWER = "look forward to";

/** 從本次題目答案挑「單字最多」的一題當試算例（同字數取較長者）；沒有就用內建例句。 */
export function pickSampleAnswer(answers: string[]): string {
  let best = "";
  let bestWords = 0;
  for (const raw of answers) {
    const answer = (raw || "").trim().split(/\s+/).join(" ");
    if (!answer) continue;
    const words = answer.split(" ").length;
    if (
      words > bestWords ||
      (words === bestWords && answer.length > best.length)
    ) {
      best = answer;
      bestWords = words;
    }
  }
  return best || BUILTIN_SAMPLE_ANSWER;
}

/** 本次題目是否全部都是一個單字（且至少有一題）。 */
export function allSingleWordAnswers(answers: string[]): boolean {
  const nonEmpty = answers.map((a) => (a || "").trim()).filter(Boolean);
  return nonEmpty.length > 0 && nonEmpty.every((a) => !/\s/.test(a));
}

export type PreviewCaseKey =
  | "allCorrect"
  | "oneLetter"
  | "oneWord"
  | "blankSlot"
  | "unanswered";

export interface PreviewCase {
  key: PreviewCaseKey;
  /** 逐格答案；null ＝ 沒作答 */
  answer: string[] | null;
}

function typoOf(word: string): string {
  // 少打一個字母（取倒數第二個字母拿掉）；一個字母的單字改成別的字母
  if (word.length >= 3) return word.slice(0, -2) + word.slice(-1);
  if (word.length === 2) return word.slice(0, 1);
  return word.toLowerCase() === "x" ? "y" : "x";
}

/** 試算固定列：全對／差 1 字母／錯 1 單字／漏填 1 格／沒作答。 */
export function buildPreviewCases(sample: string): PreviewCase[] {
  const words = pySplit(sample);
  if (!words.length) return [];
  let longest = 0;
  words.forEach((w, i) => {
    if (w.length > words[longest].length) longest = i;
  });
  const withLetter = words.slice();
  withLetter[longest] = typoOf(words[longest]);
  const withWord = words.slice();
  const wrong = words[longest].toLowerCase() === "apple" ? "lemon" : "apple";
  withWord[longest] = wrong;
  const withBlank = words.slice();
  withBlank[0] = "";
  return [
    { key: "allCorrect", answer: words },
    { key: "oneLetter", answer: withLetter },
    { key: "oneWord", answer: withWord },
    { key: "blankSlot", answer: withBlank },
    { key: "unanswered", answer: null },
  ];
}

/** 逐格答案顯示用：空格以「＿」標出。 */
export function formatSlots(answer: string[]): string {
  return answer.map((w) => w || "＿").join(" ");
}

export interface DeductionReason {
  key: string;
  values?: Record<string, number>;
}

/**
 * 扣分原因（i18n key 在 quizScoring.reason.*）。
 * detail 為 null ＝ 沒作答；deduction 為 0 ＝ 全對；≥ perQ ＝ 扣整題。
 */
export function deductionReason(
  method: QuizScoringMethod | string | null | undefined,
  detail: {
    wordTotal: number;
    wrongWords: number;
    wrongLetters: number;
    isBlank?: boolean;
  } | null,
  deduction: number,
  perQ: number | null,
): DeductionReason {
  if (!detail || detail.isBlank)
    return { key: "quizScoring.reason.unanswered" };
  if (deduction <= 0) return { key: "quizScoring.reason.allCorrect" };
  const m = effectiveMethod(method);
  if (m === "whole_question")
    return { key: "quizScoring.reason.wholeQuestion" };
  if (perQ != null && deduction >= perQ - EPS) {
    return { key: "quizScoring.reason.full" };
  }
  if (m === "fixed_per_letter")
    return {
      key: "quizScoring.reason.letters",
      values: { count: detail.wrongLetters },
    };
  if (m === "per_word_lenient")
    return {
      key: "quizScoring.reason.wordsLenient",
      values: { total: detail.wordTotal, wrong: detail.wrongWords },
    };
  return {
    key: "quizScoring.reason.words",
    values: { total: detail.wordTotal, wrong: detail.wrongWords },
  };
}

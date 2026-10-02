"""打字類小考評分方式（Issue #1092）— 唯一判定來源（純函式，不碰 DB）。

適用 ``word_spelling_quiz`` / ``word_cloze_quiz``；``word_selection_quiz`` 固定整題計分。
規則表見 docs/design/quiz-scoring-methods.md，前端試算鏡像在
``frontend/src/lib/quizScoring.ts``（新增評分方式時兩邊都要改）。

共用定義：
    - ``per_q = 100 / 題數``（不先捨入）。
    - 正解以空白切成 N 個單字；學生答案**逐格**對應（第 i 格對第 i 個單字，
      空格 = 該單字錯）。作答有 ``typed_words`` 時用它（保留空格位置）；舊作答
      沒有時退回 ``typed_answer.split()``（位置可能已被前擠，盡力而為）。
    - 比對前 strip；``case_sensitive`` 為假時轉小寫。
    - 字母差 d = 編輯距離（多打／少打／打錯各算 1；空格的 d = 該單字字母數）。
    - 學生字數多於格數（API 誤用／舊資料）：多出的非空字併入最後一格
      （以空白相接）→ 最後一格必錯，``is_correct`` 為 False。

單題扣分（``question_deduction``）：
    - ``whole_question``（A，NULL 亦同）：有任一格不符 → ``per_q``
    - ``per_word``（B）：``per_q × 錯誤單字數 / N``
    - ``per_word_lenient``（C）：每字 d=0 扣 0；d=1 且該格有填且單字長度 > 1 扣
      ``per_q / N`` 的一半；其餘扣 ``per_q / N``
    - ``fixed_per_word``（D）：``points × 錯誤單字數``
    - ``fixed_per_letter``（E）：``points × Σd``
    全部：上限 ``per_q``；未作答（含每格都空白）扣 ``per_q``；全對扣 0；部分扣分以 half-up
    （``Decimal``）四捨五入到小數一位；全扣維持 ``per_q`` 原值不先捨入。

總分（``total_score``）= round1(max(0, 100 − Σ扣分))。全扣題以「題數 × per_q」
相乘、部分扣分另外加總，確保舊作業（全為全扣）與 #1045 公式逐位元相同。
"""
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

# 兩種打字類小考（有評分方式可選）
TYPED_QUIZ_MODES = frozenset({"word_spelling_quiz", "word_cloze_quiz"})

WHOLE_QUESTION = "whole_question"
PER_WORD = "per_word"
PER_WORD_LENIENT = "per_word_lenient"
FIXED_PER_WORD = "fixed_per_word"
FIXED_PER_LETTER = "fixed_per_letter"

SCORING_METHODS = (
    WHOLE_QUESTION,
    PER_WORD,
    PER_WORD_LENIENT,
    FIXED_PER_WORD,
    FIXED_PER_LETTER,
)
# D、E 需要老師填每錯一個單字／字母扣幾分
METHODS_REQUIRING_POINTS = frozenset({FIXED_PER_WORD, FIXED_PER_LETTER})

_ONE_DECIMAL = Decimal("0.1")


def effective_method(method: Optional[str]) -> str:
    """NULL（舊作業）＝整題計分。"""
    return method or WHOLE_QUESTION


def _norm(word: str, case_sensitive: bool) -> str:
    word = (word or "").strip()
    return word if case_sensitive else word.lower()


def edit_distance(a: str, b: str) -> int:
    """Levenshtein 距離（插入／刪除／替換各算 1）。"""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        cur = [i]
        for j, cb in enumerate(b, start=1):
            cur.append(
                min(
                    prev[j] + 1,  # 刪除
                    cur[j - 1] + 1,  # 插入
                    prev[j - 1] + (0 if ca == cb else 1),  # 替換
                )
            )
        prev = cur
    return prev[-1]


def _student_words(answer: Union[Sequence[str], str, None]) -> List[str]:
    if answer is None:
        return []
    if isinstance(answer, str):
        return answer.split()
    return [(w or "").strip() for w in answer]


def split_slots(
    answer_data: Optional[Dict[str, Any]], correct: str
) -> Tuple[List[str], List[str]]:
    """回 (學生逐格答案, 正解單字)；學生格數補齊／收斂到與正解相同。

    有 ``typed_words`` 用它（保留空格位置），否則退回 ``typed_answer.split()``。
    多出的非空字併入最後一格（見模組說明）。
    """
    data = answer_data or {}
    typed_words = data.get("typed_words")
    if isinstance(typed_words, list):
        words = _student_words(typed_words)
    else:
        words = _student_words(data.get("typed_answer") or "")
    return _align(words, (correct or "").split())


def _align(words: List[str], correct_words: List[str]) -> Tuple[List[str], List[str]]:
    n = len(correct_words)
    if n == 0:
        return [], []
    slots = list(words[:n]) + [""] * max(0, n - len(words))
    extras = [w for w in words[n:] if w]
    if extras:
        slots[-1] = " ".join([w for w in [slots[-1]] + extras if w])
    return slots, correct_words


def evaluate_answer(
    answer: Union[Sequence[str], str, None],
    correct: str,
    case_sensitive: bool = False,
) -> Dict[str, Any]:
    """逐格比對一題答案。

    ``answer`` 為 ``typed_words``（list，逐格）或 ``typed_answer``（str，舊作答）。
    回 ``{is_correct, word_total, wrong_words, wrong_letters, per_word_distance,
    per_word_half}``；``per_word_half[i]`` 為 C 方式該字可否只扣一半
    （d == 1 且該格有填且正解單字長度 > 1）。

    ``is_correct``（整題全對）：
        - 傳 str（舊作答）→ 與 #828 完全相同：整串 strip（＋不分大小寫時 lower）相等。
        - 傳 list（``typed_words``）→ 每格都相符且沒有多出的字。
    """
    correct = correct or ""
    words = _student_words(answer)
    slots, correct_words = _align(words, correct.split())

    distances: List[int] = []
    halves: List[bool] = []
    for typed, expected in zip(slots, correct_words):
        d = edit_distance(_norm(typed, case_sensitive), _norm(expected, case_sensitive))
        distances.append(d)
        halves.append(d == 1 and bool(typed) and len(expected) > 1)
    wrong_words = sum(1 for d in distances if d > 0)

    if isinstance(answer, str) or answer is None:
        is_correct = _norm(answer or "", case_sensitive) == _norm(
            correct, case_sensitive
        )
    else:
        has_extra = any(w for w in words[len(correct_words) :])
        if correct_words:
            is_correct = wrong_words == 0 and not has_extra
        else:
            # 正解為空（髒資料）：沿用整串比對
            is_correct = not any(words)

    return {
        "is_correct": is_correct,
        # 每格都空（含只送空白）＝ 視同未作答，扣分時整題扣
        "is_blank": not any(words),
        "word_total": len(correct_words),
        "wrong_words": wrong_words,
        "wrong_letters": sum(distances),
        "per_word_distance": distances,
        "per_word_half": halves,
    }


def evaluate_answer_data(
    answer_data: Optional[Dict[str, Any]],
    correct: str,
    case_sensitive: bool = False,
) -> Dict[str, Any]:
    """從 ``practice_answers.answer_data`` 評一題：有 ``typed_words`` 優先用。"""
    data = answer_data or {}
    typed_words = data.get("typed_words")
    if isinstance(typed_words, list):
        return evaluate_answer(typed_words, correct, case_sensitive)
    return evaluate_answer(data.get("typed_answer") or "", correct, case_sensitive)


def _to_decimal(value: Union[float, int, Decimal, str]) -> Decimal:
    if isinstance(value, Decimal):
        return value
    # 經 str()（最短十進位表示）避免二進位誤差讓 x.x5 捨入方向偏掉
    return Decimal(str(value))


def round_half_up_1(value: Union[float, Decimal]) -> float:
    """四捨五入到小數一位（half-up）。"""
    return float(_to_decimal(value).quantize(_ONE_DECIMAL, rounding=ROUND_HALF_UP))


def question_deduction(
    method: Optional[str],
    points: Optional[Union[float, Decimal]],
    per_q: float,
    evaluation: Optional[Dict[str, Any]],
) -> float:
    """單題扣分。``evaluation`` 為 None 或整題空白（``is_blank``）＝ 未作答，扣 ``per_q``。

    全扣一律回 ``per_q`` 原值（不捨入）；部分扣分 half-up 到小數一位，捨入後
    若 ≥ ``per_q`` 也視為全扣（上限 ``per_q``）。
    """
    if evaluation is None:
        return per_q
    if evaluation.get("is_correct"):
        return 0.0
    method = effective_method(method)
    n = int(evaluation.get("word_total") or 0)
    if method == WHOLE_QUESTION or n == 0 or evaluation.get("is_blank"):
        return per_q

    per_q_dec = _to_decimal(per_q)
    # B / C 一律「先乘後除、只除一次」：先除再逐字加總會在 Decimal 精度下少一點點，
    # 全錯時算出來 < per_q 而被當成部分扣分（例：22 題、3 字全錯 → 4.5 而非全扣）。
    if method == PER_WORD:
        raw = per_q_dec * int(evaluation.get("wrong_words") or 0) / n
    elif method == PER_WORD_LENIENT:
        # 以「半格」為單位計數：整字錯 2、只差 1 字母 1 → 扣 per_q × units / (2N)
        units = 0
        for d, half in zip(
            evaluation.get("per_word_distance") or [],
            evaluation.get("per_word_half") or [],
        ):
            if d == 0:
                continue
            units += 1 if half else 2
        raw = per_q_dec * units / (2 * n)
    elif method == FIXED_PER_WORD:
        raw = _to_decimal(points or 0) * int(evaluation.get("wrong_words") or 0)
    elif method == FIXED_PER_LETTER:
        raw = _to_decimal(points or 0) * int(evaluation.get("wrong_letters") or 0)
    else:
        # 未知方式（不應發生，validator 已擋）→ 保守整題計分
        return per_q

    if raw >= per_q_dec:
        return per_q
    rounded = _to_decimal(raw).quantize(_ONE_DECIMAL, rounding=ROUND_HALF_UP)
    if rounded >= per_q_dec:
        return per_q
    return float(rounded)


def total_score(per_q: float, deductions: Sequence[float]) -> float:
    """總分 = round1(clamp(100 − Σ扣分, 0, 100))。

    全扣題（== per_q）以「題數 × per_q」計，部分扣分另以 Decimal 加總，
    舊作業（只有 0 與 per_q）結果與 #1045 的 ``100 − wrong × per_q`` 逐位元相同。
    """
    full = sum(1 for d in deductions if d == per_q)
    partial = sum((_to_decimal(d) for d in deductions if d and d != per_q), Decimal(0))
    deducted = full * per_q + float(partial)
    return round(max(0.0, min(100.0, 100.0 - deducted)), 1)

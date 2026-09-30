"""Shared cloze (克漏字) extraction logic.

Used by:
- Vocabulary set CRUD (auto-populate ``ContentItem.cloze_answer`` on save).
- AI sentence generation (return cloze answer alongside generated sentence).
- Word cloze practice endpoint (fallback when persisted answer missing).
"""

import re
from typing import Optional, Tuple

_CLOZE_STOPWORDS = frozenset(
    {
        "the",
        "a",
        "an",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "have",
        "has",
        "had",
        "do",
        "does",
        "did",
        "will",
        "would",
        "can",
        "could",
        "should",
        "may",
        "might",
        "must",
        "and",
        "or",
        "but",
        "if",
        "of",
        "in",
        "on",
        "at",
        "to",
        "for",
        "with",
        "by",
        "from",
        "as",
        "it",
        "its",
        "this",
        "that",
        "these",
        "those",
        "he",
        "she",
        "we",
        "they",
        "you",
        "my",
        "your",
        "his",
        "their",
        "our",
        "her",
        "him",
        "me",
        "us",
        "them",
    }
)


def build_blank(matched_text: str) -> str:
    """Render the blank placeholder for the text being blanked out (#880).

    One underscore per WORD (not per letter): a single-word answer renders as a
    single blank box, and a phrase answer renders as one box per word — so
    "two pieces of cake" becomes "_ _ _ _" (four boxes). The blank does not
    reveal the letter count.

    The frontend (``ClozeBlankText``) renders one box per underscore run, so
    each space-separated underscore becomes its own box.
    """
    words = matched_text.split()
    if not words:
        return "_"
    return " ".join("_" for _ in words)


def collapse_to_single_blank(blanked_sentence: str) -> str:
    """把「一字一格」的挖空收合成單一格（Issue #860 單字選擇例句題專用）。

    ``build_blank`` 依 #880 對片語答案產生 "_ _"（一字一格），那是為 word_cloze
    的「打字作答」設計的——知道字數是合理提示。但單字選擇是四選一，顯示格數等於
    直接洩漏答案是幾個字（如看到兩格就能排除所有單字選項），因此這裡收合成一格。

    "I love to _ _ of landscapes." → "I love to _ of landscapes."
    """
    if not blanked_sentence:
        return blanked_sentence
    return re.sub(r"_(?:\s+_)+", "_", blanked_sentence)


def find_cloze_match(
    answer: str, example_sentence: str
) -> Optional[Tuple[int, int, str]]:
    """Locate ``answer`` (or its variant) inside ``example_sentence``.

    Returns ``(start, end, matched_text)`` or ``None``.

    Strategy:
    1. Exact word(s) match — supports multi-word answers like "two pieces of cake".
    2. Prefix match on the first token — e.g. base "swim" finds "swam"? No;
       prefix only catches "swim" → "swimming". Irregular forms are handled
       by teacher input or AI-supplied answer rather than prefix matching.
    """
    if not answer or not example_sentence:
        return None

    needle = answer.strip()
    if not needle:
        return None

    escaped = re.escape(needle)
    exact = re.search(rf"\b{escaped}\b", example_sentence, re.IGNORECASE)
    if exact:
        return exact.start(), exact.end(), exact.group(0)

    # Prefix match only meaningful for single-token answers (e.g. apple→apples,
    # watch→watching). Skip for multi-word phrases.
    if " " not in needle:
        prefix = re.search(rf"\b{escaped}\w*\b", example_sentence, re.IGNORECASE)
        if prefix:
            return prefix.start(), prefix.end(), prefix.group(0)

    return None


def extract_cloze(base_word: str, example_sentence: str) -> Optional[Tuple[str, str]]:
    """Return ``(blanked_sentence, correct_answer)`` for a vocabulary item.

    ``correct_answer`` is the actual word/phrase form that appears in the
    sentence (e.g. "cups" from base "cup", "swam" from base "swim").
    Returns ``None`` if no match found.
    """
    match = find_cloze_match(base_word, example_sentence)
    if not match:
        return None
    start, end, actual = match
    blanked = example_sentence[:start] + build_blank(actual) + example_sentence[end:]
    return blanked, actual


def pick_cloze_target_from_sentence(sentence: str) -> Optional[Tuple[str, str]]:
    """Pick a target word from a sentence to blank out.

    Used for the EXAMPLE_SENTENCES content shape where the sentence itself
    is the source text. Deterministically chooses the longest content word
    (length >= 4, not a stopword).
    """
    if not sentence:
        return None

    matches = [
        (m.start(), m.end(), m.group(0))
        for m in re.finditer(r"\b[a-zA-Z][a-zA-Z']*\b", sentence)
    ]
    candidates = [
        (s, e, w)
        for (s, e, w) in matches
        if len(w) >= 4 and w.lower() not in _CLOZE_STOPWORDS
    ]
    if not candidates:
        return None

    best = max(candidates, key=lambda x: (len(x[2]), -x[0]))
    start, end, word = best
    blanked = sentence[:start] + build_blank(word) + sentence[end:]
    return blanked, word


def is_sentence_start(sentence: str, start: int) -> bool:
    """``start`` 是否位於句首（開頭，或前面只有 [.!?] ＋ 空白）。"""
    if start <= 0:
        return True
    before = sentence[:start].rstrip()
    return not before or before[-1] in ".!?"


def normalize_cloze_case(
    matched: str,
    base_word: str,
    sentence: str = "",
    start: int = 0,
    persisted_answer: Optional[str] = None,
) -> str:
    """句首大寫還原（Issue #1088）。

    例句 "Told me her name." 比對到 "Told me"，但作為選項應顯示 "told me"。
    只在下列全部成立時把首字母小寫：
      - 比對結果大寫開頭、單字原形 ``base_word`` 小寫開頭
      - 老師存的 ``persisted_answer`` 不是大寫開頭（大寫＝專有名詞，照存）
      - 比對位置在句首（index 0，或前面是 [.!?] ＋ 空白）
    句中的大寫（"I love Paris."）一律保留。
    """
    if not matched or not base_word:
        return matched
    if not (base_word[0].islower() and matched[0].isupper()):
        return matched
    if persisted_answer and persisted_answer.strip()[:1].isupper():
        return matched
    if not is_sentence_start(sentence, start):
        return matched
    return matched[0].lower() + matched[1:]


def extract_cloze_for_item(content_item) -> Optional[Tuple[str, str]]:
    """Extract ``(blanked_sentence, correct_answer)`` from a ContentItem.

    Prefers the persisted ``cloze_answer`` field if present and locatable in
    the example sentence; otherwise auto-extracts from the base word, or
    falls back to picking a target from the text itself for EXAMPLE_SENTENCES.
    """
    base = (getattr(content_item, "text", None) or "").strip()
    example = getattr(content_item, "example_sentence", None) or ""
    persisted = (getattr(content_item, "cloze_answer", None) or "").strip()

    # Strategy 0: persisted answer wins, as long as it still appears in the
    # current example sentence. (Teacher may have edited the sentence after
    # saving the answer; if the answer no longer appears, re-extract.)
    if persisted and example:
        match = find_cloze_match(persisted, example)
        if match:
            start, end, actual = match
            blanked = example[:start] + build_blank(actual) + example[end:]
            return blanked, actual

    # Strategy 1: VOCABULARY_SET — base word + example sentence
    if example and base:
        result = extract_cloze(base, example)
        if result:
            return result

    # Strategy 2: EXAMPLE_SENTENCES — text itself is a sentence
    if base and " " in base:
        return pick_cloze_target_from_sentence(base)

    return None


def compute_cloze_answer(base_word: str, example_sentence: str) -> Optional[str]:
    """Return only the cloze answer (no blanked sentence). Convenience helper
    for ``ContentItem`` save paths."""
    result = extract_cloze(base_word, example_sentence)
    return result[1] if result else None


def resolve_cloze_answer_on_save(
    base_word: str,
    example_sentence: Optional[str],
    incoming_answer: Optional[str],
    existing_answer: Optional[str],
) -> Optional[str]:
    """Determine the ``cloze_answer`` value to persist on a save.

    Rules (per Issue #632 Q2):
    1. If client explicitly sends a non-empty ``incoming_answer``, honor it.
       (Teacher override.)
    2. If ``existing_answer`` is still present in the current sentence, keep
       it. (Teacher's manual override survives unrelated edits.)
    3. Otherwise, auto-extract from ``base_word`` + ``example_sentence``.
    4. Returns ``None`` when neither path yields a usable answer.
    """
    example = (example_sentence or "").strip()

    if incoming_answer is not None and incoming_answer.strip():
        return incoming_answer.strip()

    if existing_answer and existing_answer.strip() and example:
        if find_cloze_match(existing_answer.strip(), example):
            return existing_answer.strip()

    if base_word and example:
        return compute_cloze_answer(base_word, example)

    return None

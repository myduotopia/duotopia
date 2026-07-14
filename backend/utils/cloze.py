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

    One underscore per character, so the number of blanks equals the number of
    letters in the answer. Word boundaries are preserved for phrase answers, so
    "two pieces of cake" renders as "___ ______ __ ____" rather than one
    unbroken run — the student can still see it is four words.

    The frontend (``ClozeBlankText``) turns each underscore run into that many
    per-letter boxes, so the space between runs becomes the gap between words.
    """
    words = matched_text.split()
    if not words:
        return "_____"
    return " ".join("_" * len(word) for word in words)


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

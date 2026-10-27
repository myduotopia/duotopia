"""
上傳題本題目卡的純函式（Issue #1112 C2）：題號／答案正規化、答案回填、克漏字空格對位、跨頁題組合併。

**不碰 DB、不呼叫 AI**。``services/exam_paper_service.py``（擷取）、``services/exam_import_service.py``
（匯入流程）與驗證報告腳本 ``scripts/exam_import_report.py`` 共用這裡的函式，確保跨頁合併等規則
只有一份。題目卡 JSON 形狀見 ``exam_paper_service`` 模組說明。
"""

from __future__ import annotations

import copy
import re
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Set

from services.magic_paste_service import MC_MAX_OPTIONS

# 答案來源
ANSWER_SOURCE_ANSWER_PAGE = "answer_page"
ANSWER_SOURCE_AI = "ai"
ANSWER_SOURCE_TEACHER = "teacher"

CARD_KIND_SINGLE = "single"
CARD_KIND_GROUP = "group"
GROUP_TYPE_READING = "reading"
GROUP_TYPE_CLOZE = "cloze"

STATUS_OK = "ok"
STATUS_FAILED = "failed"

SOURCE_QUESTION_NO_MAX_CHARS = 20  # 對齊 question_source_links.source_question_no

BLANK_TOKEN_RE = re.compile(r"\{\{(\d+)\}\}")
# 選項標籤 → 0-based index（答案頁印的是標籤）
_LABEL_TO_INDEX = {
    **{c: i for i, c in enumerate("ABCDEF")},
    **{str(i + 1): i for i in range(6)},
    **{c: i for i, c in enumerate("甲乙丙丁戊己")},
    **{c: i for i, c in enumerate("①②③④⑤⑥")},
}


# --------------------------------------------------------------------------- #
# 題號與答案
# --------------------------------------------------------------------------- #
def normalize_question_no(raw: Any) -> Optional[str]:
    """原卷題號：去頭尾空白、句點、括號；空字串回 None；截到 20 字。"""
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, float) and raw.is_integer():
        raw = int(raw)
    text = str(raw).strip()
    text = text.strip("．.、:：()（）[]【】 ")
    if not text:
        return None
    return text[:SOURCE_QUESTION_NO_MAX_CHARS]


def label_to_indexes(raw: Any) -> List[int]:
    """答案頁的答案（"B"、"(C)"、"AC"、"2"、"乙"、[1]）→ 0-based index 清單；認不出回 []。"""
    if isinstance(raw, list):
        out: List[int] = []
        for item in raw:
            if isinstance(item, int) and not isinstance(item, bool):
                if 0 <= item < MC_MAX_OPTIONS and item not in out:
                    out.append(item)
            else:
                for i in label_to_indexes(item):
                    if i not in out:
                        out.append(i)
        return sorted(out)
    if raw is None or isinstance(raw, bool):
        return []
    text = re.sub(r"[\s()（）.,，、/;；]+", "", str(raw)).upper()
    if not text:
        return []
    indexes: List[int] = []
    for ch in text:
        idx = _LABEL_TO_INDEX.get(ch)
        if idx is None:
            return []  # 有認不出的字（例如整句文字）就整個放棄，不猜
        if idx not in indexes:
            indexes.append(idx)
    return sorted(indexes)


def normalize_answer_key(raw: Any) -> Dict[str, List[int]]:
    """AI 回的 ``[{"no": "12", "answer": "B"}]``（或 dict）→ ``{"12": [1]}``。"""
    if isinstance(raw, dict):
        pairs = list(raw.items())
    elif isinstance(raw, list):
        pairs = [(e.get("no"), e.get("answer")) for e in raw if isinstance(e, dict)]
    else:
        return {}
    key: Dict[str, List[int]] = {}
    for no_raw, ans_raw in pairs:
        no = normalize_question_no(no_raw)
        indexes = label_to_indexes(ans_raw)
        if no and indexes:
            key[no] = indexes
    return key


def iter_card_questions(card: Mapping[str, Any]) -> Iterable[Dict[str, Any]]:
    """一張卡裡的所有題目（單題 1 題、題組 n 題）。"""
    if card.get("kind") == CARD_KIND_SINGLE:
        q = card.get("question")
        if isinstance(q, dict):
            yield q
    else:
        for q in (card.get("group") or {}).get("questions") or []:
            if isinstance(q, dict):
                yield q


def card_has_question(card: Mapping[str, Any], question_no: Optional[str]) -> bool:
    return bool(question_no) and any(
        q.get("source_question_no") == question_no for q in iter_card_questions(card)
    )


def answer_is_locked(question: Mapping[str, Any]) -> bool:
    """老師改過答案就鎖住：答案頁晚到也不覆蓋。"""
    return question.get("answer_source") == ANSWER_SOURCE_TEACHER or (
        "correct_indexes" in (question.get("teacher_edited") or [])
    )


def apply_answer_key(
    cards: Iterable[Dict[str, Any]], answer_key: Mapping[str, List[int]]
) -> int:
    """把答案頁的答案套到題目卡：只改「答案來源是 AI 或沒答案」且老師沒改過的題。回傳改了幾題。

    已是答案頁答案的題也會更新（同一題號以最後處理的答案頁為準）；索引超出選項數就略過。
    """
    if not answer_key:
        return 0
    changed = 0
    for card in cards:
        for q in iter_card_questions(card):
            no = q.get("source_question_no")
            if not no or no not in answer_key or answer_is_locked(q):
                continue
            indexes = [
                i for i in answer_key[no] if 0 <= i < len(q.get("options") or [])
            ]
            if not indexes:
                continue
            if (
                q.get("answer_source") == ANSWER_SOURCE_ANSWER_PAGE
                and q.get("correct_indexes") == indexes
            ):
                continue
            q["correct_indexes"] = indexes
            q["answer_source"] = ANSWER_SOURCE_ANSWER_PAGE
            changed += 1
    return changed


# --------------------------------------------------------------------------- #
# 克漏字空格
# --------------------------------------------------------------------------- #
def blank_numbers(paragraphs: Iterable[str]) -> List[int]:
    """文章裡的 ``{{n}}`` 編號，依閱讀順序、不重複。"""
    out: List[int] = []
    for p in paragraphs:
        for m in BLANK_TOKEN_RE.finditer(p or ""):
            n = int(m.group(1))
            if n not in out:
                out.append(n)
    return out


def match_cloze_blanks(paragraphs: List[str], questions: List[Dict[str, Any]]) -> None:
    """克漏字空格對位（沿用 #1086 規則）：小題 blank 合法、不重複、集合 = 文章空格集合才採用；
    否則依閱讀順序補配（文章第 i 個空格 ↔ 第 i 題），多出來的小題 blank 為 None。"""
    blanks = blank_numbers(paragraphs)
    given = [q.get("blank") for q in questions]
    if (
        blanks
        and all(isinstance(b, int) for b in given)
        and len(set(given)) == len(given)
        and set(given) == set(blanks)
    ):
        return
    for i, q in enumerate(questions):
        q["blank"] = blanks[i] if i < len(blanks) else None


# --------------------------------------------------------------------------- #
# 跨頁題組
# --------------------------------------------------------------------------- #
def merge_group_cards(target: Dict[str, Any], cont: Dict[str, Any]) -> None:
    """把「延續上一頁」的題組卡併進上一頁的題組卡（就地修改 target）。

    克漏字空格編號：下一頁文章自己從 {{1}} 重編時（最小編號不大於上一頁已用到的編號），
    下一頁的空格與小題 blank 一起加上位移；下一頁文章沒有空格（只有小題）或 AI 已經接續編號時
    不加位移。合併後對整個題組重跑 ``match_cloze_blanks``，對不上就依閱讀順序補配。
    """
    tg, cg = target["group"], cont["group"]
    ts, cs = tg["stimulus"], cg["stimulus"]
    is_cloze = GROUP_TYPE_CLOZE in (tg.get("group_type"), cg.get("group_type"))
    if is_cloze:
        tg["group_type"] = GROUP_TYPE_CLOZE
        used = max(
            blank_numbers(ts.get("paragraphs") or [])
            + [q.get("blank") or 0 for q in tg["questions"]],
            default=0,
        )
        cont_blanks = blank_numbers(cs.get("paragraphs") or [])
        if used and cont_blanks and min(cont_blanks) <= used:
            cs["paragraphs"] = [
                BLANK_TOKEN_RE.sub(lambda m: "{{%d}}" % (int(m.group(1)) + used), p)
                for p in cs.get("paragraphs") or []
            ]
            for q in cg["questions"]:
                if q.get("blank"):
                    q["blank"] += used
    ts["paragraphs"] = (ts.get("paragraphs") or []) + (cs.get("paragraphs") or [])
    ts["dialogue"] = (ts.get("dialogue") or []) + (cs.get("dialogue") or [])
    if cs.get("text"):
        ts["text"] = "\n".join(t for t in (ts.get("text"), cs["text"]) if t)
    seen_words = {g["word"] for g in tg.get("glossary") or []}
    tg["glossary"] = (tg.get("glossary") or []) + [
        g for g in cg.get("glossary") or [] if g["word"] not in seen_words
    ]
    names = {s["speaker"].lower() for s in tg.get("speakers") or []}
    tg["speakers"] = (tg.get("speakers") or []) + [
        s for s in cg.get("speakers") or [] if s["speaker"].lower() not in names
    ]
    existing_nos = {
        q.get("source_question_no")
        for q in tg["questions"]
        if q.get("source_question_no")
    }
    tg["questions"].extend(
        q
        for q in cg["questions"]
        if not q.get("source_question_no")
        or q["source_question_no"] not in existing_nos
    )
    if is_cloze and ts["paragraphs"]:
        match_cloze_blanks(ts["paragraphs"], tg["questions"])
    target["pages"] = sorted(
        set(target.get("pages") or []) | set(cont.get("pages") or [])
    )
    if not tg.get("title") and cg.get("title"):
        tg["title"] = cg["title"]


def merge_continuations(
    pages: MutableMapping[int, Optional[List[Dict[str, Any]]]],
) -> Set[int]:
    """依頁碼掃一遍，把「延續上一頁題組」的第一張卡併進前面的題組（就地修改 ``pages``）。

    ``pages``：頁碼 → 該頁題目卡（``None`` = 還沒處理完）。往前找**最近一個有卡片**的已處理頁
    （中間整頁都是延續、合併後變空的頁直接跳過，所以跨三頁以上的題組也能接上）；途中遇到還沒
    處理完的頁就先不併，等那一頁處理完再併。回傳有改動的頁碼。
    """
    changed: Set[int] = set()
    for n in sorted(pages):
        cards = pages[n]
        if not cards:
            continue
        first = cards[0]
        if first.get("kind") != CARD_KIND_GROUP or not first.get("continues_previous"):
            continue
        prev_no = n - 1
        target_no = None
        while prev_no in pages:
            prev_cards = pages[prev_no]
            if prev_cards is None:
                break  # 前面有頁還沒處理完：先留著
            if prev_cards:
                target_no = prev_no
                break
            prev_no -= 1
        if target_no is None:
            continue
        target_cards = pages[target_no]
        if target_cards[-1].get("kind") != CARD_KIND_GROUP:
            continue
        merge_group_cards(target_cards[-1], copy.deepcopy(first))
        pages[n] = cards[1:]
        changed.update({n, target_no})
    return changed


__all__ = [
    "ANSWER_SOURCE_AI",
    "ANSWER_SOURCE_ANSWER_PAGE",
    "ANSWER_SOURCE_TEACHER",
    "BLANK_TOKEN_RE",
    "CARD_KIND_GROUP",
    "CARD_KIND_SINGLE",
    "GROUP_TYPE_CLOZE",
    "GROUP_TYPE_READING",
    "SOURCE_QUESTION_NO_MAX_CHARS",
    "STATUS_FAILED",
    "STATUS_OK",
    "answer_is_locked",
    "apply_answer_key",
    "blank_numbers",
    "card_has_question",
    "iter_card_questions",
    "label_to_indexes",
    "match_cloze_blanks",
    "merge_continuations",
    "merge_group_cards",
    "normalize_answer_key",
    "normalize_question_no",
]

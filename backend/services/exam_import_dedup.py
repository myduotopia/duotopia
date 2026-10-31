"""
上傳題本：題目卡與「自己的題庫」重複比對（Issue #1112 C2，定案 14／16）。

- **只比對老師自己建立、未刪除的題目**（不含別人的公開題）。
- 比對前忽略空白、大小寫、標點（全形半形視為相同；克漏字空格 ``{{n}}``／``____`` 一律忽略）。
- 單題：**題目＋選項**都相同才算相同（選項順序不同也算相同：選項排序後再比）。
- 題組：**題組文字相同＋小題題目集合相同**就算相同，**選項不同也算相同**；只有部分小題相同不算。
  題組文字：對話題組用逐句「說話者: 台詞」串起來；其他用文章段落（題庫端用 ``passage_text``）。
- 同一份匯入裡也比：題目卡依原卷順序，後出現的標成重複前面那張。

重複的卡寫入 ``card["duplicate_of"]``，預設不存（C4 存入時略過）：
``{"type": "bank", "kind": "single" | "group", "id": 123}`` 或 ``{"type": "import", "card_id": "..."}``。
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from models import Question, QuestionGroup
from services.exam_paper_service import CARD_KIND_GROUP, CARD_KIND_SINGLE
from services.question_bank_service import normalize_stem

_BLANK_RE = re.compile(r"\{\{\d+\}\}")

Signature = Tuple[Any, ...]


def norm_key(text: Optional[str]) -> str:
    """正規化成比對鍵：normalize_stem（小寫、去標點、NFKC）後再拿掉所有空白與底線。"""
    text = _BLANK_RE.sub(" ", text or "")
    return normalize_stem(text).replace(" ", "").replace("_", "")


def _dialogue_text(lines: Iterable[Tuple[Any, Any]]) -> str:
    return "\n".join(f"{s or ''}: {t or ''}" for s, t in lines)


def card_group_text(group: Mapping[str, Any]) -> str:
    stim = group.get("stimulus") or {}
    dialogue = stim.get("dialogue") or []
    if dialogue:
        return _dialogue_text((d.get("speaker"), d.get("text")) for d in dialogue)
    paragraphs = stim.get("paragraphs") or []
    return "\n".join(paragraphs) if paragraphs else str(stim.get("text") or "")


def card_signature(card: Mapping[str, Any]) -> Optional[Signature]:
    """比對鍵；內容不足以判斷（空題幹的單題、沒文字也沒題目的題組）回 None，不參與比對。"""
    if card.get("kind") == CARD_KIND_SINGLE:
        q = card.get("question") or {}
        stem = norm_key(q.get("stem"))
        if not stem:
            return None
        return (
            CARD_KIND_SINGLE,
            stem,
            tuple(sorted(norm_key(o) for o in q.get("options") or [])),
        )
    if card.get("kind") == CARD_KIND_GROUP:
        group = card.get("group") or {}
        text = norm_key(card_group_text(group))
        stems = tuple(
            sorted(norm_key(q.get("stem")) for q in group.get("questions") or [])
        )
        if not text and not any(stems):
            return None
        return (CARD_KIND_GROUP, text, stems)
    return None


def _bank_group_text(group: QuestionGroup) -> str:
    if group.segments:
        return _dialogue_text((s.speaker_label, s.transcript) for s in group.segments)
    return group.passage_text or ""


def _live(model):
    return [model.is_active.is_(True), model.deleted_at.is_(None)]


def _stem_key_sql():
    """SQL 端的題目比對鍵：``normalized_stem`` 再拿掉空白與底線（對應 ``norm_key``）。"""
    return func.replace(func.replace(Question.normalized_stem, " ", ""), "_", "")


def _has_blank_token_sql():
    # 題庫題目含 ``{{n}}`` 時，normalized_stem 會留下編號數字（"i 1 a cat"），和卡片的比對鍵
    # （空格整個忽略）對不上；這類題目另外撈出來在 Python 端用 norm_key 比
    return Question.stem.like("%{{%")


def find_bank_duplicates(
    db: Session, teacher_id: int, cards: List[Dict[str, Any]]
) -> Dict[str, Dict[str, Any]]:
    """回 ``{card_id: duplicate_of}``，只含和自己題庫重複的卡。

    先用 SQL 篩候選（題目比對鍵相同、或題目含 ``{{n}}``），再在 Python 端用完整簽章比，
    不載入老師全部的題目／題組。
    """
    sigs = {c["card_id"]: card_signature(c) for c in cards}
    result: Dict[str, Dict[str, Any]] = {}
    stem_key = _stem_key_sql()

    single_stems = {s[1] for s in sigs.values() if s and s[0] == CARD_KIND_SINGLE}
    if single_stems:
        rows = (
            db.query(Question)
            .options(selectinload(Question.options))
            .filter(
                Question.teacher_id == teacher_id,
                Question.group_id.is_(None),
                or_(stem_key.in_(single_stems), _has_blank_token_sql()),
                *_live(Question),
            )
            .order_by(Question.id)
            .all()
        )
        bank_singles: Dict[Signature, int] = {}
        for q in rows:
            sig = (
                CARD_KIND_SINGLE,
                norm_key(q.stem),
                tuple(sorted(norm_key(o.text) for o in q.options)),
            )
            bank_singles.setdefault(sig, q.id)
        for card_id, sig in sigs.items():
            if sig and sig in bank_singles:
                result[card_id] = {
                    "type": "bank",
                    "kind": CARD_KIND_SINGLE,
                    "id": bank_singles[sig],
                }

    group_sigs = [s for s in sigs.values() if s and s[0] == CARD_KIND_GROUP]
    if group_sigs:
        # 候選題組：至少有一個小題的題目比對鍵出現在卡片小題裡（克漏字小題常是空題幹，鍵為 ""）
        group_stems = {stem for s in group_sigs for stem in s[2]}
        candidate_ids = (
            db.query(Question.group_id)
            .filter(
                Question.teacher_id == teacher_id,
                Question.group_id.isnot(None),
                or_(stem_key.in_(group_stems), _has_blank_token_sql()),
                *_live(Question),
            )
            .distinct()
        )
        groups = (
            db.query(QuestionGroup)
            .options(
                selectinload(QuestionGroup.segments),
                selectinload(QuestionGroup.questions),
            )
            .filter(
                QuestionGroup.teacher_id == teacher_id,
                QuestionGroup.id.in_(candidate_ids),
                *_live(QuestionGroup),
            )
            .order_by(QuestionGroup.id)
            .all()
        )
        bank_groups: Dict[Signature, int] = {}
        for g in groups:
            stems = tuple(
                sorted(
                    norm_key(q.stem)
                    for q in g.questions
                    if q.is_active and q.deleted_at is None
                )
            )
            bank_groups.setdefault(
                (CARD_KIND_GROUP, norm_key(_bank_group_text(g)), stems), g.id
            )
        for card_id, sig in sigs.items():
            if sig and sig[0] == CARD_KIND_GROUP and sig in bank_groups:
                result[card_id] = {
                    "type": "bank",
                    "kind": CARD_KIND_GROUP,
                    "id": bank_groups[sig],
                }
    return result


def mark_duplicates(
    db: Session,
    teacher_id: int,
    cards_in_order: List[Dict[str, Any]],
    check_bank_ids: Optional[set] = None,
) -> None:
    """依原卷順序重新標記重複（就地修改卡片）。

    - ``check_bank_ids``：這次要重新查題庫的卡（新擷取的）；None = 全部重查。其他卡沿用
      原本的題庫比對結果。
    - 同一份匯入：第一次出現的卡保留，後面相同的標 ``{"type": "import"}``；題庫重複優先。
    """
    to_check = [
        c
        for c in cards_in_order
        if check_bank_ids is None or c.get("card_id") in check_bank_ids
    ]
    bank = find_bank_duplicates(db, teacher_id, to_check) if to_check else {}
    first_seen: Dict[Signature, str] = {}
    for card in cards_in_order:
        card_id = card.get("card_id")
        previous = card.get("duplicate_of") or {}
        if check_bank_ids is None or card_id in check_bank_ids:
            dup = bank.get(card_id)
        else:
            dup = previous if previous.get("type") == "bank" else None
        sig = card_signature(card)
        if dup is None and sig is not None:
            if sig in first_seen:
                dup = {"type": "import", "card_id": first_seen[sig]}
            else:
                first_seen[sig] = card_id
        card["duplicate_of"] = dup

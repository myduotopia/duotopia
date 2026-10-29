"""
上傳題本：題目卡 → 題庫建立 payload（Issue #1112 C4，cold-read B2「轉換唯一來源」）。

存入（全部儲存、略過核對、自動存入）**一律**走 ``card_to_payload``，得到的 dict 再交給
``QuestionCreate``／``QuestionGroupCreate.model_validate``，所以驗證規則和老師自己出題完全一樣。
前端編輯時把草稿轉回卡片格式再 PATCH（``exam_import_edit``），不另送題庫格式。

純函式、不碰 DB（考點 code → id 對照由呼叫端查好傳進來）。

卡片欄位 → 題庫欄位
- 單題：``stem``、``options``（＋``option_image_urls``）、``correct_indexes``（多於一個＝允許複選）、
  ``explanation``、``image_url``（題幹圖）、``exam_point_codes``／``exam_point_ids``。
- 題組：``group_type`` → ``question_type``（reading／cloze）；主圖文：
  - 老師編輯過排版 → 卡片帶 ``layout``（＋``passage_text``／``segments``），原樣採用；
  - ``stimulus.kind = text`` → ``paragraphs_to_layout``（前端 ``extractedGroup.ts`` 同規則：
    一個區塊一列，插圖依 ``after_paragraph``／``placement``／``side``／``width`` 擺），
    ``framed`` → 根層 ``frame: true``；沒切段落只有 ``text`` → 當文字版、排版留空；
  - ``stimulus.kind = image`` → 一張圖的排版（``stimulus.image_url``，裁不出來就沒有排版），
    文字版＝圖內文字；有逐句對話 → ``segments``，文字版＝非對話文字＋逐句對話。
  - 閱讀題組不得含 ``{{n}}``：段落與文字版一律轉回底線；克漏字保留，小題 ``blank_index``＝``blank``。
- 整份設定（年段、公開、教材、來源、機構／學校）由呼叫端套用（``apply_settings``）。
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from services.exam_paper_cards import CARD_KIND_GROUP, GROUP_TYPE_CLOZE

PLAIN_BLANK = "____"
_BLANK_TOKEN = re.compile(r"\{\{\d+\}\}")

# 並排時圖佔的寬度 → 欄的 span 配對（對齊前端 FIGURE_SPANS）
_FIGURE_SPANS = (
    (1 / 3, 1, 2),
    (1 / 2, 1, 1),
    (2 / 3, 2, 1),
)


def strip_blank_tokens(text: str) -> str:
    return _BLANK_TOKEN.sub(PLAIN_BLANK, text or "")


def _figure_spans(width: Optional[float]) -> Tuple[int, int]:
    target = width if isinstance(width, (int, float)) else 1 / 3
    _, figure, text = min(_FIGURE_SPANS, key=lambda s: abs(s[0] - target))
    return figure, text


def _image_block(fig: Mapping[str, Any]) -> Dict[str, Any]:
    block = {"type": "image", "url": fig["url"], "align": "center"}
    if fig.get("caption"):
        block["caption"] = fig["caption"]
    return block


def _row(*blocks: Dict[str, Any]) -> Dict[str, Any]:
    return {"columns": [{"span": 1, "blocks": [b]} for b in blocks]}


def paragraphs_to_layout(
    paragraphs: Iterable[str], figures: Iterable[Mapping[str, Any]] = ()
) -> Optional[Dict[str, Any]]:
    """散文段落（＋插圖）→ layout；沒內容回 None。與前端 ``paragraphsToLayout`` 同規則。"""
    texts = [p.strip() for p in paragraphs if p and p.strip()]
    placed = [f for f in figures if f.get("url")]
    last = len(texts) - 1

    def after(f: Mapping[str, Any]) -> int:
        try:
            return int(f.get("after_paragraph", -1))
        except (TypeError, ValueError):
            return -1

    head = [f for f in placed if after(f) < 0]
    tail = [f for f in placed if after(f) > last]
    inside = [f for f in placed if 0 <= after(f) <= last]
    besides: Dict[int, Mapping[str, Any]] = {}
    for f in inside:
        if f.get("placement") == "beside" and after(f) not in besides:
            besides[after(f)] = f

    rows: List[Dict[str, Any]] = [_row(_image_block(f)) for f in head]
    for i, text in enumerate(texts):
        paragraph = {"type": "paragraph", "text": text}
        beside = besides.get(i)
        if beside is None:
            rows.append(_row(paragraph))
        else:
            fig_span, text_span = _figure_spans(beside.get("width"))
            image = _image_block(beside)
            cols = [
                {"span": text_span, "blocks": [paragraph]},
                {"span": fig_span, "blocks": [image]},
            ]
            if beside.get("side") == "left":
                cols.reverse()
            rows.append({"columns": cols})
        rows.extend(
            _row(_image_block(f))
            for f in inside
            if after(f) == i and besides.get(i) is not f
        )
    rows.extend(_row(_image_block(f)) for f in tail)
    if not rows:
        return None
    return {"version": 1, "rows": rows}


def single_image_layout(url: str, alt: str) -> Dict[str, Any]:
    return {
        "version": 1,
        "rows": [
            {
                "columns": [
                    {
                        "span": 1,
                        "blocks": [
                            {"type": "image", "url": url, "alt": alt, "align": "center"}
                        ],
                    }
                ]
            }
        ],
    }


def derive_stimulus_type(layout: Optional[Mapping[str, Any]]) -> str:
    """與前端 ``deriveStimulusType`` 同規則（題組的 image_url 一律不用，只看排版）。"""
    if not layout or not layout.get("rows"):
        return "passage"
    images = texts = 0
    for node in layout["rows"]:
        rows = node.get("rows") if node.get("type") == "section" else [node]
        for row in rows or []:
            for col in row.get("columns") or []:
                for b in col.get("blocks") or []:
                    if b.get("type") == "image":
                        images += 1
                    else:
                        texts += 1
    if images and not texts:
        return "image"
    return "passage" if not images else "mixed"


def dialogue_segments(dialogue: Iterable[Mapping[str, Any]]) -> List[Dict[str, str]]:
    out = []
    for d in dialogue or []:
        speaker = str(d.get("speaker") or "").strip()
        text = str(d.get("text") or "").strip()
        if speaker and text:
            out.append({"speaker_label": speaker, "transcript": text})
    return out


def _dialogue_passage(narration: str, segments: List[Mapping[str, str]]) -> str:
    lines = "\n".join(f"{s['speaker_label']}: {s['transcript']}" for s in segments)
    return "\n\n".join(p for p in (narration.strip(), lines) if p)


def exam_point_ids_for(
    question: Mapping[str, Any], code_to_id: Mapping[str, int]
) -> List[int]:
    """考點：``exam_point_codes`` 對回 id（cold-read B2），再補上卡片已有、對不到 code 的 id。"""
    ids: List[int] = []
    for code in question.get("exam_point_codes") or []:
        i = code_to_id.get(code)
        if i is not None and i not in ids:
            ids.append(i)
    for i in question.get("exam_point_ids") or []:
        if isinstance(i, int) and not isinstance(i, bool) and i not in ids:
            ids.append(i)
    return ids


def _question_fields(
    q: Mapping[str, Any], code_to_id: Mapping[str, int]
) -> Dict[str, Any]:
    options = list(q.get("options") or [])
    correct = {i for i in q.get("correct_indexes") or [] if 0 <= i < len(options)}
    images = list(q.get("option_image_urls") or [])
    return {
        "stem": q.get("stem") or "",
        "explanation": (q.get("explanation") or "").strip() or None,
        "image_url": q.get("image_url") or None,
        "allow_multiple_answers": len(correct) > 1,
        "exam_point_ids": exam_point_ids_for(q, code_to_id),
        "options": [
            {
                "text": text or "",
                "is_correct": i in correct,
                "image_url": images[i] if i < len(images) else None,
            }
            for i, text in enumerate(options)
        ],
    }


def _group_stimulus(group: Mapping[str, Any]) -> Dict[str, Any]:
    """題組主圖文 → layout／passage_text／segments。"""
    is_cloze = group.get("group_type") == GROUP_TYPE_CLOZE
    norm = (
        (lambda t: (t or "").strip())
        if is_cloze
        else (lambda t: strip_blank_tokens((t or "").strip()))
    )
    if "layout" in group:  # 老師編輯過排版：原樣採用
        segments = group.get("segments") or []
        return {
            "layout": group.get("layout"),
            "passage_text": group.get("passage_text"),
            "segments": segments or None,
        }
    stim = group.get("stimulus") or {}
    title = (group.get("title") or "").strip()
    if stim.get("kind") == "image":
        text = norm(stim.get("text"))
        segments = group.get("segments")
        if segments is None:
            segments = dialogue_segments(stim.get("dialogue") or [])
        url = stim.get("image_url")
        return {
            "layout": single_image_layout(url, title or "stimulus") if url else None,
            "passage_text": _dialogue_passage(text, segments) if segments else text,
            "segments": segments or None,
        }
    paragraphs = [norm(p) for p in stim.get("paragraphs") or []]
    layout = paragraphs_to_layout(paragraphs, stim.get("figures") or [])
    if layout and stim.get("framed"):
        layout["frame"] = True
    return {
        "layout": layout,
        "passage_text": None if layout else norm(stim.get("text")),
        "segments": None,
    }


def card_to_payload(
    card: Mapping[str, Any], code_to_id: Mapping[str, int]
) -> Tuple[str, Dict[str, Any]]:
    """題目卡 → (``"single"`` | ``"group"``, payload)。payload 不含整份設定（``apply_settings``）。"""
    if card.get("kind") != CARD_KIND_GROUP:
        q = card.get("question") or {}
        payload = {
            "question_type": "multiple_choice",
            **_question_fields(q, code_to_id),
        }
        return "single", payload
    group = card.get("group") or {}
    is_cloze = group.get("group_type") == GROUP_TYPE_CLOZE
    stimulus = _group_stimulus(group)
    glossary = [
        {"word": str(g.get("word") or "").strip(), "zh": str(g.get("zh") or "").strip()}
        for g in group.get("glossary") or []
    ]
    glossary = [g for g in glossary if g["word"] and g["zh"]]
    questions = []
    for i, q in enumerate(group.get("questions") or []):
        fields = _question_fields(q, code_to_id)
        if not is_cloze:
            fields["stem"] = strip_blank_tokens(fields["stem"])
        fields["group_order"] = i
        fields["blank_index"] = q.get("blank") if is_cloze else None
        questions.append(fields)
    payload = {
        "question_type": "cloze" if is_cloze else "reading",
        "stimulus_type": derive_stimulus_type(stimulus["layout"]),
        "title": (group.get("title") or "").strip()[:200] or None,
        "passage_text": stimulus["passage_text"] or None,
        "layout": stimulus["layout"],
        "glossary": glossary or None,
        "segments": stimulus["segments"],
        "questions": questions,
    }
    return "group", payload


def apply_settings(
    kind: str, payload: Dict[str, Any], settings: Mapping[str, Any]
) -> Dict[str, Any]:
    """整份設定套到 payload：年段、公開、機構／學校；單題（與題組小題）帶教材、來源。"""
    common = {
        "grade_min": settings.get("grade_min"),
        "grade_max": settings.get("grade_max"),
        "visibility": settings.get("visibility") or "private",
        "organization_id": settings.get("organization_id") or None,
        "school_id": settings.get("school_id") or None,
    }
    links = [
        {"program_id": pl["program_id"], "lesson_id": pl.get("lesson_id")}
        for pl in settings.get("program_links") or []
    ]
    sources = [settings["source_id"]] if settings.get("source_id") else []
    if kind == "single":
        return {**payload, **common, "program_links": links, "source_ids": sources}
    questions = [
        {**q, "program_links": links, "source_ids": sources}
        for q in payload["questions"]
    ]
    return {**payload, **common, "questions": questions}

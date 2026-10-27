"""
上傳題本擷取服務（Issue #1112 C2）：一頁圖片 → 題目卡陣列。

**每頁一次 AI 呼叫**（定案 17）：同一次呼叫完成
  1. 擷取題目卡（單題／題組、原卷題號、題目、選項、bbox、「延續上一頁題組」）
  2. 判斷是不是答案頁，答案頁（或隨題目印出的答案表）回「題號 → 答案」
  3. 頁上沒印答案、也沒有已知答案的題目，由 AI 作答（答案來源記 ``ai``）
  4. 考點：只能從平台考點清單（code）挑
  5. 對話角色的性別與年輕／成人
呼叫時把這份匯入「已知的答案」（之前處理過的答案頁）帶進 prompt，有已知答案的題不再 AI 作答。

模型沿用 magic paste 的 ``settings.VERTEX_AI_FLASH_MODEL``。thinking token 與 output token
**分開回報**（用量表分欄存，加總時相加）。

本模組**不碰 DB**：DB 寫入、答案頁回填已處理頁、重複比對在 ``services/exam_import_service.py``；
驗證報告腳本 ``scripts/exam_import_report.py`` 直接呼叫本模組。題目卡純函式（答案回填、克漏字
空格對位、跨頁合併）在 ``services/exam_paper_cards.py``，本模組一併匯出。

``cloze_group`` 模式是**匯入內部使用**：目前沒有端點用它（上傳題本的克漏字由 ``exam_paper`` 的題組
``group_type: "cloze"`` 產出），保留給之後「只重讀一個克漏字題組」用。

題目卡（card）JSON 形狀::

    {
      "card_id": "p3-0-1a2b3c",
      "kind": "single" | "group",
      "page_no": 3, "pages": [3],            # 跨頁題組合併後會變 [3, 4]
      "bbox": [ymin, xmin, ymax, xmax] | null,  # 0–1000，相對該頁
      "continues_previous": false,           # 題組延續上一頁（合併後清掉）
      "status": "ok" | "failed",
      "duplicate_of": null,                  # 重複比對結果（exam_import_service 填）
      "tts_accent": null,                    # 口音分配（exam_import_service 填）
      "teacher_edited": [],                  # 老師改過的卡片層欄位（C4 寫入）
      "question": {...},                     # kind = single
      "group": {                             # kind = group
        "group_type": "reading" | "cloze", "title": "...",
        "stimulus": {...與 magic paste reading_group 相同...},
        "glossary": [...], "speakers": [{"speaker", "gender", "age", "inferred"}],
        "questions": [{...}, ...]
      }
    }

題目（question）::

    {
      "source_question_no": "12" | null, "bbox": [...] | null, "page_no": 3,
      "stem": "...", "blank": 1 | null, "stem_box_2d": [...] | null,
      "options": [...], "option_boxes": [...],
      "correct_indexes": [1], "answer_source": "answer_page" | "ai" | "teacher" | null,
      "explanation": "...", "exam_point_codes": [...], "exam_point_ids": [...],
      "status": "ok" | "failed", "teacher_edited": []
    }
"""

from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from core.config import settings

# 題目卡純函式在 exam_paper_cards（報告腳本與 exam_import_service 共用）；這裡一併匯出，
# 舊的 ``from services.exam_paper_service import ...`` 寫法照樣能用
from services.exam_paper_cards import (  # noqa: F401
    ANSWER_SOURCE_AI,
    ANSWER_SOURCE_ANSWER_PAGE,
    ANSWER_SOURCE_TEACHER,
    BLANK_TOKEN_RE,
    CARD_KIND_GROUP,
    CARD_KIND_SINGLE,
    GROUP_TYPE_CLOZE,
    GROUP_TYPE_READING,
    SOURCE_QUESTION_NO_MAX_CHARS,
    STATUS_FAILED,
    STATUS_OK,
    answer_is_locked,
    apply_answer_key,
    card_has_question,
    iter_card_questions,
    label_to_indexes,
    match_cloze_blanks,
    merge_continuations,
    merge_group_cards,
    normalize_answer_key,
    normalize_question_no,
)
from services.magic_paste_service import (
    EXTRACT_MODE_CLOZE_GROUP,
    EXTRACT_MODE_EXAM_PAPER,
    MC_MAX_OPTIONS,
    MC_MIN_OPTIONS,
    MagicPasteError,
    MagicPasteService,
)
from utils.ai_cost import estimate_cost_usd

logger = logging.getLogger(__name__)

FLASH_MODEL = settings.VERTEX_AI_FLASH_MODEL

# 一頁可能有十幾題＋文章＋每題解析；拉高上限避免截斷
MAX_OUTPUT_TOKENS = 16384
# 這次呼叫要「作答」，給一點 thinking 預算（比 magic paste 純擷取的 0 多）；
# 用量表另存 thinking token，之後可依實測調整
THINKING_BUDGET = 2048

ALLOWED_PAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}

MAX_EXPLANATION_CHARS = 400
MAX_EXAM_POINTS_PER_QUESTION = 3
MAX_UNITS_PER_PAGE = 60

GENDERS = ("female", "male")
AGES = ("young", "adult")


@dataclass
class CallUsage:
    model: str
    input_tokens: int = 0
    output_tokens: int = 0  # 不含 thinking
    thinking_tokens: int = 0

    @property
    def estimated_cost_usd(self) -> float:
        # thinking 以輸出價計費（Issue #1119）：估價時併入 output
        return estimate_cost_usd(
            self.model,
            {
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens + self.thinking_tokens,
            },
        )


@dataclass
class PageExtraction:
    page_no: int
    is_answer_page: bool
    answer_key: Dict[str, List[int]]
    cards: List[Dict[str, Any]]
    usage: CallUsage
    raw: Any = field(default=None, repr=False)


class ExamPaperError(MagicPasteError):
    """頁圖不合法等可預期錯誤（endpoint 轉 4xx）。"""


def _new_card_id(page_no: int, index: int) -> str:
    return f"p{page_no}-{index}-{uuid.uuid4().hex[:6]}"


# --------------------------------------------------------------------------- #
# Prompt
# --------------------------------------------------------------------------- #
SYSTEM_INSTRUCTION = (
    "You are an assistant that digitises English test papers for a K-12 "
    "language-learning app in Taiwan. You read one scanned page at a time. "
    "Always respond with a valid JSON object only, no markdown, no prose. "
    "When writing Chinese you MUST use Traditional Chinese (繁體中文)."
)

_QUESTION_SHAPE = (
    '{"no": "12", "box_2d": [ymin, xmin, ymax, xmax], "stem": "...", '
    '"blank": null, "stem_box_2d": null, "options": ["...", "..."], '
    '"option_boxes": [], "printed_answer_indexes": [], "ai_answer_indexes": [1], '
    '"explanation": "...", "exam_point_codes": ["..."], "unreadable": false}'
)


def build_prompt(
    *,
    extract_mode: str = EXTRACT_MODE_EXAM_PAPER,
    known_answers: Optional[Mapping[str, List[int]]] = None,
    exam_point_catalog: Optional[List[Mapping[str, Any]]] = None,
    focus_question_no: Optional[str] = None,
    focus_box: Optional[List[int]] = None,
) -> str:
    known = {k: v for k, v in (known_answers or {}).items() if v}
    catalog_lines = "\n".join(
        f"{e.get('code')}: {e.get('name') or ''}" for e in (exam_point_catalog or [])
    )
    scope = (
        "The image is ONE page of an English test paper. Extract EVERY "
        "multiple-choice question on this page, in printed order, grouped into "
        "units: a stand-alone question is a `single` unit; questions that share "
        "a passage, dialogue, poster, comic or cloze text are one `group` unit."
    )
    if extract_mode == EXTRACT_MODE_CLOZE_GROUP:
        scope = (
            "The image contains ONE cloze (fill-in-the-blank) question group. "
            'Return exactly one unit with kind "group" and group_type "cloze".'
        )
    if focus_question_no or focus_box:
        where = []
        if focus_question_no:
            where.append(f'printed as question number "{focus_question_no}"')
        if focus_box:
            where.append(f"located around box_2d {list(focus_box)}")
        scope += (
            " RE-READ ONLY ONE QUESTION: the question "
            + " and ".join(where)
            + ". Return exactly one unit containing it; if it belongs to a "
            "question group, return that whole group (stimulus and all of its "
            'questions). Set "is_answer_page" to false and "answer_key" to [].'
        )

    return (
        f"{scope}\n"
        "Return JSON of the exact shape: "
        '{"is_answer_page": false, "answer_key": [{"no": "12", "answer": "B"}], '
        '"units": ['
        '{"kind": "single", "box_2d": [ymin, xmin, ymax, xmax], '
        f'"question": {_QUESTION_SHAPE}}}, '
        '{"kind": "group", "group_type": "reading" | "cloze", '
        '"continues_previous": false, "box_2d": [ymin, xmin, ymax, xmax], '
        '"title": "...", "stimulus": {"kind": "text" | "image", '
        '"paragraphs": ["..."], "text": "...", "box_2d": [ymin, xmin, ymax, xmax], '
        '"framed": false, "blanks_renumbered": true, '
        '"dialogue": [{"speaker": "...", "text": "..."}], '
        '"figures": [{"box_2d": [ymin, xmin, ymax, xmax], "placement": "beside" | '
        '"full", "after_paragraph": 0, "side": "left" | "right", "width": 0.33, '
        '"caption": "..."}]}, "glossary": [{"word": "...", "zh": "..."}], '
        '"speakers": [{"speaker": "...", "gender": "female" | "male" | "unknown", '
        '"age": "young" | "adult" | "unknown"}], '
        f'"questions": [{_QUESTION_SHAPE}]}}]}}\n'
        "Rules:\n"
        "- All boxes are [ymin, xmin, ymax, xmax] on a 0-1000 scale relative to "
        "the page. A unit's `box_2d` covers the whole unit (for a group: its "
        "stimulus and all its questions on this page); a question's `box_2d` "
        "covers that question's number, text and choices.\n"
        '- `no`: the question number printed on the paper ("12"), without '
        "dots or brackets; null if none is printed.\n"
        "- `stem`: the question text exactly as printed, without the leading "
        'number. Keep blanks such as "____". `options`: the choices in printed '
        f"order ({MC_MIN_OPTIONS}-{MC_MAX_OPTIONS}), without labels such as (A) "
        "B. 甲. Never invent options. `stem_box_2d`: box of a picture printed as "
        "part of that question, else null. `option_boxes`: same length as "
        "`options`, the box of a picture choice or null for a text choice; [] "
        'when no choice is a picture (a picture choice keeps "" in `options`).\n'
        "- `unreadable`: true when you can see a question but cannot read its "
        "text or choices reliably (blurred, cut off); still give its `no` and "
        "`box_2d`. Otherwise false.\n"
        "- `printed_answer_indexes`: 0-based indexes of the correct choice ONLY "
        "when the answer is shown on this page for that question (circled, "
        "ticked, bold, written next to it, or in an answer table on this page); "
        "otherwise [].\n"
        "- `ai_answer_indexes`: when there is NO printed answer and the question "
        "number is NOT in the known answers below, solve the question yourself "
        "and give the 0-based index(es) of the correct choice (usually one). "
        "Otherwise []. `explanation`: Traditional Chinese, at most "
        f"{MAX_EXPLANATION_CHARS} characters, why the answer is correct; copy a "
        'printed explanation when there is one; "" for a known answer.\n'
        f"- `exam_point_codes`: 1 to {MAX_EXAM_POINTS_PER_QUESTION} codes chosen "
        "ONLY from the exam point catalog below (prefer the most specific code). "
        "Never invent a code; [] if none fits.\n"
        '- Group `group_type`: "cloze" when the questions fill blanks in the '
        'passage, else "reading". Group `title`: the printed title, or a short '
        "English title of your own (at most 8 words) naming what the material is "
        'about, not starting with "Reading" / "Passage" / "Question".\n'
        '- `stimulus`: "text" for prose (paragraphs, a letter, an article, a '
        "dialogue printed as text) with `paragraphs` = the printed paragraphs in "
        'order (you may mark **bold** and __underline__), `text` "" and no '
        '`box_2d`; "image" when the layout itself carries the meaning (poster, '
        "comic, map, menu, timetable, chart, advertisement) with `box_2d` = that "
        "area only, `text` = its readable words that are not spoken lines, and "
        "`paragraphs` []. `framed`: true when the passage is printed inside one "
        "box. `figures`: pictures printed inside a prose passage (box, "
        "placement, after_paragraph 0-based or -1, side, width 0.2-0.8, "
        "caption); [] when none.\n"
        "- CLOZE BLANKS: rewrite every printed blank in the passage "
        '("__40__", "___(40)___", "(40)", "40.____") as "{{n}}" numbering the '
        "blanks 1, 2, 3 ... in reading order (the first blank is always {{1}}), "
        "set `blanks_renumbered` true, and give each question the NEW number in "
        '`blank`. Keep the PRINTED number in `no` (e.g. no "40", blank 1). Cloze '
        'questions often print only choices: `stem` may be "". For other '
        "questions `blank` is null.\n"
        '- `stimulus.dialogue` (only when stimulus kind is "image" and people '
        "speak, e.g. speech bubbles): every spoken line in reading order as "
        '{"speaker", "text"}. Name speakers WITHOUT "the": a printed name that '
        "clearly belongs to the speaker; else a job or role (Teacher, Doctor, "
        "Clerk); else Girl / Boy / Woman / Man (Girls, Boys, Boy and girl for "
        "groups); add A / B for two of the same kind (Girl A, Girl B).\n"
        "- `speakers`: for a group with a dialogue (in `stimulus.dialogue` or a "
        "printed conversation), one entry per distinct speaker in order of first "
        "appearance: `gender` and `age` (young = child or teenager, adult) judged "
        'from names, pictures and content; "unknown" when you cannot tell. [] '
        "when nobody speaks.\n"
        "- `continues_previous`: true for a group whose stimulus or questions "
        "started on the PREVIOUS page (e.g. the page begins with questions about "
        "a passage that is not on this page). Then put only what is on THIS page.\n"
        "- `is_answer_page`: true when this page is an answer key (a list or "
        "table of question numbers with their answers) and has no questions to "
        "extract. `answer_key`: every question number -> answer printed in such "
        'a list or table on this page, `answer` exactly as printed (e.g. "B"); '
        "[] when there is none. An answer table can also appear on a page that "
        "has questions.\n"
        '- If the page has no questions and no answer key, return {"is_answer_page": '
        'false, "answer_key": [], "units": []}.\n'
        "Known answers for this paper (question number -> 0-based correct index; do "
        f"NOT solve these):\n{json.dumps(known, ensure_ascii=False)}\n"
        f"Exam point catalog (code: name):\n{catalog_lines}\n"
    )


# --------------------------------------------------------------------------- #
# 正規化：AI 回傳 → 題目卡
# --------------------------------------------------------------------------- #
def _int_indexes(raw: Any) -> List[int]:
    if not isinstance(raw, list):
        return []
    out = []
    for v in raw:
        n = MagicPasteService._as_finite_number(v)
        if n is not None and int(n) not in out:
            out.append(int(n))
    return out


def _normalize_question(
    entry: Mapping[str, Any],
    *,
    page_no: int,
    known_answers: Mapping[str, List[int]],
    valid_codes: Optional[set],
    code_to_id: Optional[Mapping[str, int]],
) -> Optional[Dict[str, Any]]:
    """一題：沿用 magic paste ``_normalize_mc_items`` 的選項／座標規則，再補原卷題號、答案來源、考點。"""
    no = normalize_question_no(entry.get("no"))
    bbox = MagicPasteService._normalize_box_2d(entry.get("box_2d"))
    unreadable = entry.get("unreadable") is True
    blank = MagicPasteService._normalize_blank_index(entry.get("blank"))
    # magic paste 規則：題幹、題幹圖、blank 至少要有一個才留。克漏字小題常常只印選項、AI 又
    # 可能漏給 blank —— 有原卷題號或位置就先放行，blank 之後由 match_cloze_blanks 補配
    patched_blank = blank if blank is not None else (1 if (no or bbox) else None)

    def mc_with(indexes_key: str) -> List[Dict[str, Any]]:
        item = {
            **entry,
            "blank": patched_blank,
            "correct_indexes": entry.get(indexes_key) or [],
        }
        result = MagicPasteService._normalize_mc_items({"items": [item]})
        for r in result:
            r["blank"] = blank
        return result

    printed = mc_with("printed_answer_indexes")
    if not printed:
        # 讀不到（或選項不足）：只要知道題號或位置就留一張「處理失敗」的題，前端可重試／手動補
        if not (no or bbox):
            return None
        return {
            "source_question_no": no,
            "bbox": bbox,
            "page_no": page_no,
            "stem": str(entry.get("stem") or "").strip(),
            "blank": blank,
            "stem_box_2d": None,
            "options": [],
            "option_boxes": [],
            "correct_indexes": [],
            "answer_source": None,
            "explanation": "",
            "exam_point_codes": [],
            "exam_point_ids": [],
            "status": STATUS_FAILED,
            "teacher_edited": [],
        }
    base = printed[0]
    ai = mc_with("ai_answer_indexes")
    ai_indexes = ai[0]["correct_indexes"] if ai else []
    n_options = len(base["options"])

    known = [i for i in known_answers.get(no, []) if 0 <= i < n_options] if no else []
    if known:
        correct, source = known, ANSWER_SOURCE_ANSWER_PAGE
    elif base["correct_indexes"]:
        correct, source = base["correct_indexes"], ANSWER_SOURCE_ANSWER_PAGE
    elif ai_indexes:
        correct, source = ai_indexes, ANSWER_SOURCE_AI
    else:
        correct, source = [], None

    codes_raw = entry.get("exam_point_codes")
    codes: List[str] = []
    for c in codes_raw if isinstance(codes_raw, list) else []:
        if not isinstance(c, str):
            continue
        c = c.strip()
        if valid_codes is not None and c not in valid_codes:
            continue
        if c and c not in codes:
            codes.append(c)
    codes = codes[:MAX_EXAM_POINTS_PER_QUESTION]
    ids = [code_to_id[c] for c in codes if code_to_id and c in code_to_id]

    return {
        "source_question_no": no,
        "bbox": bbox,
        "page_no": page_no,
        "stem": base["stem"],
        "blank": base["blank"],
        "stem_box_2d": base["stem_box_2d"],
        "options": base["options"],
        "option_boxes": base["option_boxes"],
        "correct_indexes": correct,
        "answer_source": source,
        "explanation": base["explanation"][:MAX_EXPLANATION_CHARS],
        "exam_point_codes": codes,
        "exam_point_ids": ids,
        "status": STATUS_FAILED if unreadable else STATUS_OK,
        "teacher_edited": [],
    }


def normalize_speakers(
    raw: Any, dialogue: List[Dict[str, str]]
) -> List[Dict[str, Any]]:
    """對話角色：AI 判斷的性別／年輕或成人；判斷不出來時依出場順序女、男輪替（定案 7）。

    對話裡出現、但 AI 沒列的角色也補上（同樣走輪替）。``inferred`` = True 表示是預設輪替。
    """
    speakers: List[Dict[str, Any]] = []
    seen: set = set()
    undetermined = 0
    entries = [e for e in raw if isinstance(e, dict)] if isinstance(raw, list) else []
    for line in dialogue:
        entries.append({"speaker": line.get("speaker")})
    for e in entries:
        name = " ".join(str(e.get("speaker") or "").split())[:50]
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        gender = str(e.get("gender") or "").strip().lower()
        age = str(e.get("age") or "").strip().lower()
        inferred = gender not in GENDERS
        if inferred:
            # 判斷不出來的角色之間輪替：第一位女聲、第二位男聲…
            gender = GENDERS[undetermined % 2]
            undetermined += 1
        speakers.append(
            {
                "speaker": name,
                "gender": gender,
                "age": age if age in AGES else "young",
                "inferred": inferred,
            }
        )
    return speakers


def _normalize_group(
    unit: Mapping[str, Any], questions: List[Dict[str, Any]]
) -> Dict[str, Any]:
    stim_part = MagicPasteService._normalize_reading_group(
        {
            "title": unit.get("title"),
            "stimulus": unit.get("stimulus"),
            "glossary": unit.get("glossary"),
            "questions": [],
        }
    )
    if stim_part:
        g = stim_part[0]
        title, stimulus, glossary = g["title"], g["stimulus"], g["glossary"]
    else:  # 延續上一頁、這一頁沒有素材
        title, glossary = str(unit.get("title") or "").strip()[:200], []
        stimulus = {
            "kind": "text",
            "paragraphs": [],
            "text": "",
            "box_2d": None,
            "page": None,
            "figures": [],
            "blanks_renumbered": False,
            "framed": False,
            "dialogue": [],
        }
    paragraphs = stimulus.get("paragraphs") or []
    has_blanks = any(BLANK_TOKEN_RE.search(p) for p in paragraphs)
    group_type = str(unit.get("group_type") or "").strip().lower()
    if group_type not in (GROUP_TYPE_READING, GROUP_TYPE_CLOZE):
        group_type = GROUP_TYPE_CLOZE if has_blanks else GROUP_TYPE_READING
    if has_blanks:
        group_type = GROUP_TYPE_CLOZE
    if group_type == GROUP_TYPE_CLOZE and paragraphs:
        match_cloze_blanks(paragraphs, questions)
    if group_type == GROUP_TYPE_READING:
        for q in questions:
            q["blank"] = None
    return {
        "group_type": group_type,
        "title": title,
        "stimulus": stimulus,
        "glossary": glossary,
        "speakers": normalize_speakers(
            unit.get("speakers"), stimulus.get("dialogue") or []
        ),
        "questions": questions,
    }


def normalize_page(
    raw: Any,
    *,
    page_no: int,
    known_answers: Optional[Mapping[str, List[int]]] = None,
    exam_point_codes: Optional[Iterable[str]] = None,
    code_to_id: Optional[Mapping[str, int]] = None,
) -> Tuple[bool, Dict[str, List[int]], List[Dict[str, Any]]]:
    """AI 回傳 → (是否答案頁, 這一頁的答案對照, 題目卡陣列)。

    這一頁自己的答案表（隨題目印出）也會套到這一頁的卡上；已知答案優先於 AI 作答。
    """
    known = dict(known_answers or {})
    if not isinstance(raw, dict):
        return False, {}, []
    answer_key = normalize_answer_key(raw.get("answer_key"))
    merged_known = {**known, **answer_key}
    valid_codes = set(exam_point_codes) if exam_point_codes is not None else None

    def norm_q(entry: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(entry, dict):
            return None
        return _normalize_question(
            entry,
            page_no=page_no,
            known_answers=merged_known,
            valid_codes=valid_codes,
            code_to_id=code_to_id,
        )

    cards: List[Dict[str, Any]] = []
    units = raw.get("units")
    for unit in (units if isinstance(units, list) else [])[:MAX_UNITS_PER_PAGE]:
        if not isinstance(unit, dict):
            continue
        kind = str(unit.get("kind") or "").strip().lower()
        card: Dict[str, Any] = {
            "card_id": _new_card_id(page_no, len(cards)),
            "page_no": page_no,
            "pages": [page_no],
            "bbox": MagicPasteService._normalize_box_2d(unit.get("box_2d")),
            "continues_previous": False,
            "status": STATUS_OK,
            "duplicate_of": None,
            "tts_accent": None,
            "teacher_edited": [],
        }
        if kind == CARD_KIND_GROUP or isinstance(unit.get("questions"), list):
            questions = [
                q for q in (norm_q(e) for e in unit.get("questions") or []) if q
            ]
            group = _normalize_group(unit, questions)
            stim = group["stimulus"]
            has_stim = bool(
                stim["paragraphs"] or stim["text"] or stim["box_2d"] or stim["dialogue"]
            )
            if not questions and not has_stim:
                continue
            card.update(
                kind=CARD_KIND_GROUP,
                continues_previous=unit.get("continues_previous") is True,
                group=group,
            )
            if not card["bbox"] and questions:
                card["bbox"] = questions[0]["bbox"]
        else:
            q = norm_q(unit.get("question") if "question" in unit else unit)
            if q is None:
                continue
            if not card["bbox"]:
                card["bbox"] = q["bbox"]
            card.update(kind=CARD_KIND_SINGLE, question=q, status=q["status"])
        cards.append(card)

    is_answer_page = raw.get("is_answer_page") is True and not cards
    return is_answer_page, answer_key, cards


# --------------------------------------------------------------------------- #
# Service
# --------------------------------------------------------------------------- #
class ExamPaperService:
    """一頁一次 AI 呼叫。測試 monkeypatch ``_call_model`` 即可，不打 Vertex。"""

    @staticmethod
    def validate_page_image(image_bytes: bytes, mime_type: str) -> str:
        """頁圖只收 PNG／JPEG／WebP（PDF 在前端拆頁）；回傳正規化後的 mime。"""
        mime = (mime_type or "").split(";")[0].strip().lower()
        if mime == "image/jpg":
            mime = "image/jpeg"
        if mime not in ALLOWED_PAGE_MIME_TYPES:
            raise ExamPaperError(f"頁面圖片只支援 PNG／JPEG／WebP（收到 {mime_type or '未知'}）")
        MagicPasteService.validate_file(image_bytes, mime)
        sniffed = MagicPasteService._sniff_mime(image_bytes)
        if sniffed not in ALLOWED_PAGE_MIME_TYPES:
            raise ExamPaperError("頁面內容不是 PNG／JPEG／WebP 圖片")
        return sniffed

    async def extract_page(
        self,
        image_bytes: bytes,
        mime_type: str,
        *,
        page_no: int,
        known_answers: Optional[Mapping[str, List[int]]] = None,
        exam_point_catalog: Optional[List[Mapping[str, Any]]] = None,
        code_to_id: Optional[Mapping[str, int]] = None,
        extract_mode: str = EXTRACT_MODE_EXAM_PAPER,
        focus_question_no: Optional[str] = None,
        focus_box: Optional[List[int]] = None,
    ) -> PageExtraction:
        """擷取一頁。``exam_point_catalog`` = ``[{"code", "name"}]``（平台 active 考點）。

        AI 回應被擋、沒有文字或無法解析時丟 ``ExamPaperOutputError``（帶著已產生的 ``usage``），
        呼叫端（exam_import_service）負責把失敗的呼叫也記進用量表。
        """
        mime = self.validate_page_image(image_bytes, mime_type)
        if extract_mode not in (EXTRACT_MODE_EXAM_PAPER, EXTRACT_MODE_CLOZE_GROUP):
            extract_mode = EXTRACT_MODE_EXAM_PAPER
        prompt = build_prompt(
            extract_mode=extract_mode,
            known_answers=known_answers,
            exam_point_catalog=exam_point_catalog,
            focus_question_no=focus_question_no,
            focus_box=focus_box,
        )
        text, usage = await self._call_model(image_bytes, mime, prompt)
        try:
            raw = MagicPasteService._parse_json(text)
        except Exception as e:
            raise ExamPaperOutputError(str(e), usage) from e
        codes = [str(e.get("code")) for e in exam_point_catalog or [] if e.get("code")]
        is_answer_page, answer_key, cards = normalize_page(
            raw,
            page_no=page_no,
            known_answers=known_answers,
            exam_point_codes=codes if exam_point_catalog is not None else None,
            code_to_id=code_to_id,
        )
        logger.info(
            "[exam-paper] page=%s mode=%s cards=%d answer_page=%s key=%d "
            "tokens(in/out/think)=%s/%s/%s cost≈$%.5f",
            page_no,
            extract_mode,
            len(cards),
            is_answer_page,
            len(answer_key),
            usage.input_tokens,
            usage.output_tokens,
            usage.thinking_tokens,
            usage.estimated_cost_usd,
        )
        return PageExtraction(
            page_no=page_no,
            is_answer_page=is_answer_page,
            answer_key=answer_key,
            cards=cards,
            usage=usage,
            raw=raw,
        )

    async def _call_model(
        self, image_bytes: bytes, mime_type: str, prompt: str
    ) -> Tuple[str, CallUsage]:
        from vertexai.generative_models import (
            GenerationConfig,
            GenerativeModel,
            Part,
        )
        from services.vertex_ai import VertexAIService, get_vertex_ai_service

        get_vertex_ai_service()._ensure_initialized()
        model = GenerativeModel(FLASH_MODEL, system_instruction=SYSTEM_INSTRUCTION)
        config = GenerationConfig(
            max_output_tokens=MAX_OUTPUT_TOKENS,
            temperature=0.2,
            response_mime_type="application/json",
        )
        VertexAIService._set_thinking_budget(config, THINKING_BUDGET)
        response = await model.generate_content_async(
            [Part.from_data(data=image_bytes, mime_type=mime_type), prompt],
            generation_config=config,
        )
        return response_text_and_usage(response, FLASH_MODEL)


class ExamPaperOutputError(Exception):
    """AI 有回應但內容無法解析；帶著 usage，讓呼叫端照樣記用量。"""

    def __init__(self, message: str, usage: CallUsage):
        super().__init__(message)
        self.usage = usage


def response_text_and_usage(response: Any, model: str) -> Tuple[str, CallUsage]:
    """先算 usage 再讀 ``.text``：回應被安全過濾擋下或沒有文字時，``.text`` 會丟例外，
    這時改丟 ``ExamPaperOutputError``（帶著 usage），呼叫端照樣記用量（token 已經花掉）。"""
    usage = usage_from_response(response, model)
    try:
        text = response.text
    except Exception as e:  # ValueError（被擋／沒有 candidate）等
        raise ExamPaperOutputError(f"AI 沒有回傳內容：{e}", usage) from e
    if not isinstance(text, str) or not text.strip():
        raise ExamPaperOutputError("AI 沒有回傳內容", usage)
    return text, usage


def usage_from_response(response: Any, model: str) -> CallUsage:
    meta = getattr(response, "usage_metadata", None)
    if meta is None:
        return CallUsage(model=model)
    return CallUsage(
        model=model,
        input_tokens=int(getattr(meta, "prompt_token_count", 0) or 0),
        output_tokens=int(getattr(meta, "candidates_token_count", 0) or 0),
        thinking_tokens=int(getattr(meta, "thoughts_token_count", 0) or 0),
    )


_exam_paper_service: Optional[ExamPaperService] = None


def get_exam_paper_service() -> ExamPaperService:
    global _exam_paper_service
    if _exam_paper_service is None:
        _exam_paper_service = ExamPaperService()
    return _exam_paper_service

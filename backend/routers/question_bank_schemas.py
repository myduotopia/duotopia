"""
題庫 API 的 Pydantic schemas 與可建立題型常數（自 routers/question_bank.py 拆出，#1082）。

驗證規則（選項至少一個正確、題組主圖文至少一項、layout／glossary 深度驗證）都在這裡；
router 只負責權限與流程。

#1083（2026-10-06）：圖片題組的對話文稿存 ``question_group_segments``（``SegmentIn``，
一句一段「說話者：台詞」）；有 segments 時 ``passage_text`` 由 segments 推導
（``dialogue_passage_text``），不採用前端送來的對話內容。
"""

from __future__ import annotations

from typing import ClassVar, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from models.question_bank import (
    GRADE_MAX,
    GRADE_MIN,
    QUESTION_TYPE_MULTIPLE_CHOICE,
)
from services.question_bank_ai import (
    MAX_PASSAGE_CHARS,
    MAX_QUESTIONS_PER_CALL,
    MAX_TITLE_STEM_CHARS,
    MAX_TITLE_STEMS,
)
from services.question_bank_layout import (
    LayoutError,
    assert_no_cloze_blanks,
    layout_to_plain_text,
    validate_cloze_blanks,
    validate_glossary,
    validate_layout,
)

# 可建立的題型：單題端點只收 multiple_choice；reading（#1082）、cloze（#1085）只能經題組端點建
SINGLE_CREATABLE_TYPES = (QUESTION_TYPE_MULTIPLE_CHOICE,)
GROUP_CREATABLE_TYPES = ("reading", "cloze")
CREATABLE_TYPES = SINGLE_CREATABLE_TYPES + GROUP_CREATABLE_TYPES
MAX_GROUP_QUESTIONS = 20
# 克漏字空格編號範圍（{{n}} 的 n；會考題本原始題號可能到三位數）
BLANK_INDEX_MIN = 1
BLANK_INDEX_MAX = 999
MIN_OPTIONS = 2
MAX_OPTIONS = 6
# 對話文稿（#1083）：一題組最多幾句、說話者／台詞長度上限
# 說話者上限對齊 DB `question_group_segments.speaker_label` VARCHAR(50)；
# 台詞與句數上限與擷取端 services.magic_paste_service 的 DIALOGUE_* 常數一致
MAX_SEGMENTS = 100
SEGMENT_SPEAKER_MAX_CHARS = 50
SEGMENT_TRANSCRIPT_MAX_CHARS = 2000


# ============ Schemas ============


class OptionIn(BaseModel):
    """選項：文字可空（純圖選項），但文字／圖片／語音至少一個。"""

    text: str = Field("", max_length=1000)
    is_correct: bool = False
    audio_url: Optional[str] = None
    image_url: Optional[str] = None

    @field_validator("text")
    @classmethod
    def _strip(cls, v: str) -> str:
        return (v or "").strip()

    @model_validator(mode="after")
    def _has_content(self):
        if not (self.text or self.image_url or self.audio_url):
            raise ValueError("選項需要文字或圖片")
        return self


class ProgramLinkIn(BaseModel):
    program_id: int
    lesson_id: Optional[int] = None


class QuestionBase(BaseModel):
    # 題幹可空（純圖題），但 stem / image_url / stem_audio_url 至少一個
    # 題組小題例外：克漏字小題本來就沒有自身題幹／插圖（只有選項），
    # DB 的 ck_questions_has_content 也已排除 group_id 非空的小題，
    # 所以子類別可以關掉這個內容檢查（#1085）
    REQUIRES_CONTENT: ClassVar[bool] = True
    stem: str = Field("", max_length=5000)
    explanation: Optional[str] = Field(None, max_length=5000)
    image_url: Optional[str] = None
    stem_audio_url: Optional[str] = None
    grade_min: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    grade_max: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    allow_multiple_answers: bool = False
    show_stem_text: bool = True
    visibility: Literal[
        "private", "public", "organization_only", "individual_only"
    ] = "private"
    exam_point_ids: List[int] = Field(default_factory=list)
    program_links: List[ProgramLinkIn] = Field(default_factory=list)
    source_ids: List[int] = Field(default_factory=list)

    @field_validator("stem")
    @classmethod
    def _strip_stem(cls, v: str) -> str:
        return (v or "").strip()

    @model_validator(mode="after")
    def _grade_range(self):
        if (
            self.grade_min is not None
            and self.grade_max is not None
            and self.grade_min > self.grade_max
        ):
            raise ValueError("grade_min 不可大於 grade_max")
        if self.REQUIRES_CONTENT and not (
            self.stem or self.image_url or self.stem_audio_url
        ):
            raise ValueError("題目需要文字或圖片")
        return self


class QuestionCreate(QuestionBase):
    question_type: Literal["multiple_choice"] = QUESTION_TYPE_MULTIPLE_CHOICE
    options: List[OptionIn] = Field(..., min_length=MIN_OPTIONS, max_length=MAX_OPTIONS)
    # 歸屬：都不給 = 自己的題庫；給 organization_id = 機構題庫；給 school_id = 學校題庫
    organization_id: Optional[str] = None
    school_id: Optional[str] = None

    @model_validator(mode="after")
    def _answers(self):
        _validate_options(self.options, self.allow_multiple_answers)
        if self.organization_id and self.school_id:
            raise ValueError("organization_id 與 school_id 只能擇一")
        return self


class GroupQuestionIn(QuestionBase):
    """題組小題：與單題相同，但 question_type／歸屬／visibility 由題組決定。

    題幹／插圖／語音可以全空：克漏字小題只有選項（題幹由文章裡的空格代表）。
    題組本身的圖文在 ``QuestionGroupCreate`` 驗證，所以小題不再要求自身素材。
    """

    REQUIRES_CONTENT: ClassVar[bool] = False

    options: List[OptionIn] = Field(..., min_length=MIN_OPTIONS, max_length=MAX_OPTIONS)
    # 不給就照陣列順序
    group_order: Optional[int] = Field(None, ge=0)
    # 克漏字小題對應的空格編號（layout 內 {{n}} 的 n）；非克漏字題組留 None（#1085）
    blank_index: Optional[int] = Field(None, ge=BLANK_INDEX_MIN, le=BLANK_INDEX_MAX)

    @model_validator(mode="after")
    def _answers(self):
        _validate_options(self.options, self.allow_multiple_answers)
        return self


class SegmentIn(BaseModel):
    """對話文稿的一句（#1083）：說話者＋台詞，兩者都不可空。順序 = 陣列順序（order_index）。"""

    speaker_label: str = Field(..., max_length=SEGMENT_SPEAKER_MAX_CHARS)
    transcript: str = Field(..., max_length=SEGMENT_TRANSCRIPT_MAX_CHARS)

    @field_validator("speaker_label", "transcript")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("對話的說話者與台詞都不可空白")
        return v


class QuestionGroupCreate(BaseModel):
    """題組：主圖文 + 小題，一次建立。layout 深度驗證在閱讀題組編輯器那段再做。"""

    question_type: Literal["reading", "cloze"] = "reading"
    stimulus_type: Literal["passage", "audio", "dialogue", "image", "mixed"] = "passage"
    title: Optional[str] = Field(None, max_length=200)
    passage_text: Optional[str] = Field(None, max_length=20000)
    image_url: Optional[str] = None
    layout: Optional[dict] = None
    glossary: Optional[List[dict]] = None
    grade_min: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    grade_max: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    visibility: Literal[
        "private", "public", "organization_only", "individual_only"
    ] = "private"
    questions: List[GroupQuestionIn] = Field(
        ..., min_length=1, max_length=MAX_GROUP_QUESTIONS
    )
    # 圖片題組的對話文稿（#1083）；給了就寫進 question_group_segments，passage_text 由它推導
    segments: Optional[List[SegmentIn]] = Field(None, max_length=MAX_SEGMENTS)
    organization_id: Optional[str] = None
    school_id: Optional[str] = None

    @field_validator("title", "passage_text")
    @classmethod
    def _strip_opt(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @model_validator(mode="after")
    def _check(self):
        if (
            self.grade_min is not None
            and self.grade_max is not None
            and self.grade_min > self.grade_max
        ):
            raise ValueError("grade_min 不可大於 grade_max")
        if self.organization_id and self.school_id:
            raise ValueError("organization_id 與 school_id 只能擇一")
        _validate_layout_fields(self.layout, self.glossary)
        if not (self.passage_text or self.image_url or self.layout or self.segments):
            raise ValueError("題組需要文章、圖片或排版內容")
        check_group_blanks(
            self.question_type, self.layout, [q.blank_index for q in self.questions]
        )
        return self


def _validate_layout_fields(layout, glossary) -> None:
    """layout / glossary 深度驗證；LayoutError 轉成 ValueError（Pydantic → 422）並帶路徑。"""
    try:
        validate_layout(layout)
        validate_glossary(glossary)
    except LayoutError as e:
        raise ValueError(f"{e.path}: {e.message}") from e


def check_group_blanks(question_type: str, layout, blank_indexes: list) -> None:
    """題組的空格對應檢查（#1085）。不合格拋 ``ValueError("path: message")``。

    - ``cloze``：layout 的 ``{{n}}`` 與小題 ``blank_index`` 必須一一對應
    - 其他題型（reading）：文章不得含 ``{{n}}``，請改用克漏字題組

    建立時由 schema 呼叫（Pydantic → 422），PATCH 時由 router 用合併後的狀態呼叫。
    """
    try:
        if question_type == "cloze":
            validate_cloze_blanks(layout, blank_indexes)
        else:
            assert_no_cloze_blanks(layout)
    except LayoutError as e:
        raise ValueError(f"{e.path}: {e.message}") from e


def _effective_passage_text(passage_text: Optional[str], layout) -> Optional[str]:
    """老師沒填 passage_text 時，由 layout 的文字區塊拼出純文字副本（搜尋／AI 用）。"""
    if passage_text:
        return passage_text
    derived = layout_to_plain_text(layout) if layout else ""
    return derived or None


def dialogue_lines(segments) -> str:
    """對話文稿 → 純文字：一句一行 ``Speaker: line``（前端 dialogueTranscript.ts 同規則）。

    ``segments`` 可以是 ``SegmentIn`` 或 ORM ``QuestionGroupSegment``（都有 speaker_label／transcript）。
    """
    return "\n".join(
        f"{s.speaker_label}: {s.transcript}" if s.speaker_label else s.transcript
        for s in segments
    )


def dialogue_narration(passage_text: Optional[str], lines: str) -> str:
    """從文字版取出對話之前的非對話文字（標題、旁白、標示）。

    文字版的格式是「非對話文字 + 空行 + 對話逐句」；結尾不是這份對話（舊資料、對話已換）
    時無法分辨哪段是旁白，回空字串 —— 寧可丟掉旁白，也不讓舊的對話文字混在新文稿前面。
    """
    text = (passage_text or "").strip()
    if not text or not lines or not text.endswith(lines):
        return ""
    return text[: -len(lines)].strip()


def dialogue_passage_text(passage_text: Optional[str], segments) -> Optional[str]:
    """有對話文稿時的文字版：沿用 ``passage_text`` 開頭的非對話文字，對話部分一律由 segments 重組。

    決策（#1083，2026-10-06）：對話文稿的唯一來源是 segments（之後題組對話音檔也由它產生），
    文字版只是它的純文字副本（搜尋／AI 考點分析用）。前端送來的對話文字不採用，
    避免「文字版」與「segments／音檔」各說各話。
    """
    lines = dialogue_lines(segments)
    narration = dialogue_narration(passage_text, lines)
    return "\n\n".join(p for p in (narration, lines) if p) or None


class GroupQuestionUpdateIn(GroupQuestionIn):
    """PATCH 題組時的小題：帶 id = 更新既有小題；沒 id = 新增；沒出現在清單的既有小題 = 軟刪除。"""

    id: Optional[int] = None


class QuestionGroupUpdate(BaseModel):
    """整組替換：group 欄位只更新有給的；questions 若給就整份對齊（upsert + 軟刪除）。"""

    stimulus_type: Optional[
        Literal["passage", "audio", "dialogue", "image", "mixed"]
    ] = None
    title: Optional[str] = Field(None, max_length=200)
    passage_text: Optional[str] = Field(None, max_length=20000)
    image_url: Optional[str] = None
    layout: Optional[dict] = None
    glossary: Optional[List[dict]] = None
    grade_min: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    grade_max: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    visibility: Optional[
        Literal["private", "public", "organization_only", "individual_only"]
    ] = None
    questions: Optional[List[GroupQuestionUpdateIn]] = Field(
        None, min_length=1, max_length=MAX_GROUP_QUESTIONS
    )
    # 給了就整組替換對話文稿（[] = 清掉，例如換成沒有對話的圖）；不給 = 不動（#1083）
    segments: Optional[List[SegmentIn]] = Field(None, max_length=MAX_SEGMENTS)

    @field_validator("title", "passage_text")
    @classmethod
    def _strip_opt(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @model_validator(mode="after")
    def _check(self):
        if (
            self.grade_min is not None
            and self.grade_max is not None
            and self.grade_min > self.grade_max
        ):
            raise ValueError("grade_min 不可大於 grade_max")
        _validate_layout_fields(self.layout, self.glossary)
        if self.questions is not None:
            ids = [q.id for q in self.questions if q.id is not None]
            if len(ids) != len(set(ids)):
                raise ValueError("小題 id 重複")
        return self


class QuestionUpdate(BaseModel):
    """PATCH：全部選填；有給 options 就整批覆寫。"""

    stem: Optional[str] = Field(None, max_length=5000)
    explanation: Optional[str] = Field(None, max_length=5000)
    image_url: Optional[str] = None
    stem_audio_url: Optional[str] = None
    grade_min: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    grade_max: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    allow_multiple_answers: Optional[bool] = None
    show_stem_text: Optional[bool] = None
    visibility: Optional[
        Literal["private", "public", "organization_only", "individual_only"]
    ] = None
    options: Optional[List[OptionIn]] = Field(
        None, min_length=MIN_OPTIONS, max_length=MAX_OPTIONS
    )
    exam_point_ids: Optional[List[int]] = None
    program_links: Optional[List[ProgramLinkIn]] = None
    source_ids: Optional[List[int]] = None

    @field_validator("stem")
    @classmethod
    def _strip_stem(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else v.strip()


class ProgramLinksReplace(BaseModel):
    program_links: List[ProgramLinkIn]


class AiQuestionIn(BaseModel):
    """AI 作答／考點分析的單題輸入；key 由前端給，回傳時帶回對應。"""

    key: str = Field(..., min_length=1, max_length=64)
    stem: str = Field(..., min_length=1, max_length=2000)
    options: List[str] = Field(..., min_length=2, max_length=6)
    # 題組小題：主圖文純文字，附在題目前給模型（#1082）。
    # 不用 max_length 硬擋：題組文字版可到 20000 字，超長改為截斷（與 AiGroupTitleIn 一致）
    passage: Optional[str] = None

    @field_validator("passage")
    @classmethod
    def _clip_passage(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else v[:MAX_PASSAGE_CHARS]


class AiQuestionsIn(BaseModel):
    questions: List[AiQuestionIn] = Field(
        ..., min_length=1, max_length=MAX_QUESTIONS_PER_CALL
    )


class AiGroupTitleIn(BaseModel):
    """AI 題組標題（#1084）：主圖文純文字與／或小題題幹，至少要有一邊。"""

    # 不用 max_length 硬擋：前端可能送整篇主圖文，超長改為截斷（與 stems 處理一致）
    passage: Optional[str] = None
    stems: List[str] = Field(default_factory=list, max_length=MAX_TITLE_STEMS)

    @field_validator("passage")
    @classmethod
    def _clip_passage(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else v[:MAX_PASSAGE_CHARS]

    @field_validator("stems")
    @classmethod
    def _clean_stems(cls, v: List[str]) -> List[str]:
        return [s.strip()[:MAX_TITLE_STEM_CHARS] for s in v if s and s.strip()]

    @model_validator(mode="after")
    def _needs_content(self):
        if not (self.passage or "").strip() and not self.stems:
            raise ValueError("請先輸入文章或小題")
        return self


class SourceCreate(BaseModel):
    """老師在可打字下拉直接新增來源。"""

    source_type: Literal["exam", "publisher"]
    name: str = Field(..., min_length=1, max_length=200)
    year: Optional[int] = Field(None, ge=1900, le=2200)
    # 給 organization_id = 建成機構來源（需為該機構 active 成員）；不給 = 個人來源
    organization_id: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("來源名稱不可為空")
        return v


def _validate_options(options: List[OptionIn], allow_multiple: bool) -> None:
    correct = sum(1 for o in options if o.is_correct)
    if correct == 0:
        raise ValueError("至少要勾選一個正確答案")
    if not allow_multiple and correct > 1:
        raise ValueError("單選題只能有一個正確答案（或開啟允許複選）")

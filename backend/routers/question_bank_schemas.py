"""
題庫 API 的 Pydantic schemas 與可建立題型常數（自 routers/question_bank.py 拆出，#1082）。

驗證規則（選項至少一個正確、題組主圖文至少一項、layout／glossary 深度驗證）都在這裡；
router 只負責權限與流程。
"""

from __future__ import annotations

from typing import List, Literal, Optional

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

# 可建立的題型：單題端點只收 multiple_choice；reading 只能經題組端點建（#1082）
SINGLE_CREATABLE_TYPES = (QUESTION_TYPE_MULTIPLE_CHOICE,)
GROUP_CREATABLE_TYPES = ("reading", "cloze")
CREATABLE_TYPES = SINGLE_CREATABLE_TYPES + GROUP_CREATABLE_TYPES
MAX_GROUP_QUESTIONS = 20
# 克漏字空格編號範圍（{{n}} 的 n；會考題本原始題號可能到三位數）
BLANK_INDEX_MIN = 1
BLANK_INDEX_MAX = 999
MIN_OPTIONS = 2
MAX_OPTIONS = 6


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
        if not (self.stem or self.image_url or self.stem_audio_url):
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
    """題組小題：與單題相同，但 question_type／歸屬／visibility 由題組決定。"""

    options: List[OptionIn] = Field(..., min_length=MIN_OPTIONS, max_length=MAX_OPTIONS)
    # 不給就照陣列順序
    group_order: Optional[int] = Field(None, ge=0)
    # 克漏字小題對應的空格編號（layout 內 {{n}} 的 n）；非克漏字題組留 None（#1085）
    blank_index: Optional[int] = Field(None, ge=BLANK_INDEX_MIN, le=BLANK_INDEX_MAX)

    @model_validator(mode="after")
    def _answers(self):
        _validate_options(self.options, self.allow_multiple_answers)
        return self


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
        if not (self.passage_text or self.image_url or self.layout):
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
    # 題組小題：主圖文純文字，附在題目前給模型（#1082）
    passage: Optional[str] = Field(None, max_length=6000)


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

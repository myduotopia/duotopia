"""
上傳題本匯入 API 的 Pydantic schemas（Issue #1112；C4a 自 ``question_bank_exam_imports.py`` 拆出並新增
核對畫面用的 schema）。

卡片編輯（``CardPatch``／``CardCreate``）只收**卡片格式**的內容欄位（cold-read B2），送了其他欄位
一律忽略；業務規則在 ``services/exam_import_edit.py``。
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from models.exam_import import EXAM_IMPORT_MAX_PAGES
from models.question_bank import GRADE_MAX, GRADE_MIN
from routers.question_bank_schemas import MAX_GROUP_QUESTIONS, ProgramLinkIn
from utils.ttsVoiceResolver import ACCENT_CHOICES

Visibility = Literal["private", "public", "organization_only", "individual_only"]


class ExamImportSettings(BaseModel):
    """整份設定（每份只填一次，存入時套用到全部題目）。都可先不填，存入前必填年段、來源、公開。"""

    grade_min: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    grade_max: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    source_id: Optional[int] = None
    # 教材／單元：建立與 PATCH 設定時驗擁有權（services/exam_import_settings.py）
    program_links: List[ProgramLinkIn] = Field(default_factory=list)
    visibility: Optional[Visibility] = None
    organization_id: Optional[str] = None
    school_id: Optional[str] = None

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
        return self


class ExamImportCreate(BaseModel):
    file_name: str = Field(..., min_length=1, max_length=255)
    # 檔案內容 SHA-256（前端計算；PDF 在前端拆頁，後端拿不到整份檔）
    file_hash: str = Field(..., pattern=r"^[0-9a-fA-F]{64}$")
    page_count: int = Field(..., ge=1, le=EXAM_IMPORT_MAX_PAGES)
    # 朗讀口音：多選、至少一種（值同平台 TTS 設定：American English…）
    tts_accents: List[str] = Field(..., min_length=1)
    settings: ExamImportSettings = Field(default_factory=ExamImportSettings)

    @field_validator("file_name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("檔名不可空白")
        return v

    @field_validator("tts_accents")
    @classmethod
    def _accents(cls, v: List[str]) -> List[str]:
        bad = [a for a in v if a not in ACCENT_CHOICES]
        if bad:
            raise ValueError(f"不支援的口音：{bad}（可選 {ACCENT_CHOICES}）")
        return list(dict.fromkeys(v))


class ExamImportSettingsPatch(BaseModel):
    """PATCH 整份設定：只改有給的欄位；存進哪個題庫（機構／學校）不能改。"""

    model_config = ConfigDict(extra="ignore")

    grade_min: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    grade_max: Optional[int] = Field(None, ge=GRADE_MIN, le=GRADE_MAX)
    source_id: Optional[int] = None
    program_links: Optional[List[ProgramLinkIn]] = None
    visibility: Optional[Visibility] = None


class CardQuestionIn(BaseModel):
    """題目（卡片格式）。沒給的欄位不動；``image_url``／``option_image_urls`` 給 null ＝沒有圖。"""

    model_config = ConfigDict(extra="ignore")

    stem: Optional[str] = Field(None, max_length=5000)
    options: Optional[List[str]] = Field(None, max_length=6)
    correct_indexes: Optional[List[int]] = Field(None, max_length=6)
    explanation: Optional[str] = Field(None, max_length=5000)
    exam_point_codes: Optional[List[str]] = Field(None, max_length=10)
    exam_point_ids: Optional[List[int]] = Field(None, max_length=10)
    image_url: Optional[str] = Field(None, max_length=2000)
    option_image_urls: Optional[List[Optional[str]]] = Field(None, max_length=6)
    source_question_no: Optional[str] = Field(None, max_length=50)
    blank: Optional[int] = Field(None, ge=1, le=999)

    @field_validator("options")
    @classmethod
    def _options(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return v
        if any(len(o or "") > 1000 for o in v):
            raise ValueError("選項最多 1000 字")
        return [(o or "").strip() for o in v]


class CardSegmentIn(BaseModel):
    speaker_label: str = Field(..., min_length=1, max_length=50)
    transcript: str = Field(..., min_length=1, max_length=2000)


class CardGroupIn(BaseModel):
    """題組（卡片格式）。``layout``／``passage_text``／``segments``＝老師編輯過的排版（存入時原樣採用）。"""

    model_config = ConfigDict(extra="ignore")

    group_type: Optional[Literal["reading", "cloze"]] = None
    title: Optional[str] = Field(None, max_length=200)
    stimulus: Optional[Dict[str, Any]] = None
    glossary: Optional[List[Dict[str, Any]]] = None
    speakers: Optional[List[Dict[str, Any]]] = None
    layout: Optional[Dict[str, Any]] = None
    passage_text: Optional[str] = Field(None, max_length=20000)
    segments: Optional[List[CardSegmentIn]] = Field(None, max_length=100)
    questions: Optional[List[CardQuestionIn]] = Field(
        None, min_length=1, max_length=MAX_GROUP_QUESTIONS
    )


class CardPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    tts_accent: Optional[str] = None
    question: Optional[CardQuestionIn] = None
    group: Optional[CardGroupIn] = None

    @field_validator("tts_accent")
    @classmethod
    def _accent(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ACCENT_CHOICES:
            raise ValueError(f"不支援的口音：{v}")
        return v


class CardCreate(CardPatch):
    """「手動補這一題」：先選題型（A6），原卷題號選填；內容可一起給，也可之後再 PATCH。"""

    kind: Literal["single", "group"]
    page_no: int = Field(..., ge=1, le=EXAM_IMPORT_MAX_PAGES)
    after_card_id: Optional[str] = Field(None, max_length=64)
    source_question_no: Optional[str] = Field(None, max_length=50)


class SaveRequest(BaseModel):
    """全部儲存：要存的卡（畫面一律送全部未存的卡）；不給 ＝ 全部。"""

    card_ids: Optional[List[str]] = Field(None, max_length=500)

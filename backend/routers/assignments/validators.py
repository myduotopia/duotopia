"""
Pydantic models and validators for assignments
"""

from typing import List, Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, Field, model_validator, field_validator

from utils.practice_mode import validate_practice_mode

# Issue #884 item 1: the only practice modes that have student-side live-gate
# endpoints (_guard_live_gate on start/answer). is_live_quiz is restricted to
# these on create/patch so e.g. speaking_quiz can't be marked live without a
# gate protecting students.
LIVE_QUIZ_MODES = frozenset(
    {"word_selection_quiz", "word_spelling_quiz", "word_cloze_quiz"}
)

# Issue #828: 整卷限時上限守衛（10 小時），擋掉負數/超大值；
# 不用精確 allow-list 以免日後 UI 新增選項就壞掉
_MAX_QUIZ_TIME_LIMIT_SECONDS = 36000


def _validate_quiz_time_limit(value: Optional[int]) -> Optional[int]:
    if value is None:
        return value
    # null = 不限時（前端把 0 也視為不限時並送 null）；其餘需在合理範圍內
    if value < 0 or value > _MAX_QUIZ_TIME_LIMIT_SECONDS:
        raise ValueError(
            "quiz_time_limit_seconds must be null (no limit) or between "
            f"0 and {_MAX_QUIZ_TIME_LIMIT_SECONDS}"
        )
    return value


class CreateAssignmentRequest(BaseModel):
    """建立作業請求（新架構）"""

    title: str
    description: Optional[str] = None
    classroom_id: int
    content_ids: List[int]  # 支援多個內容
    student_ids: List[int] = []  # 空陣列 = 全班
    due_date: Optional[datetime] = None
    start_date: Optional[datetime] = None
    # 機構模式：傳遞機構/學校 ID 以供後端授權驗證
    organization_id: Optional[str] = None
    school_id: Optional[str] = None
    # 作答模式設定 — 合法值見 utils.practice_mode.ALLOWED_PRACTICE_MODES（含 tug_of_war）；
    # 由下方 _check_practice_mode 驗證。
    practice_mode: Optional[str] = None
    answer_mode: Optional[
        str
    ] = None  # DEPRECATED: only 'listening'/'writing' allowed by DB
    time_limit_per_question: Optional[int] = None
    # Issue #828: 小考整卷限時（秒）；null 不限時
    quiz_time_limit_seconds: Optional[int] = None
    # Issue #835: 老師主控 live 考試模式（同步開始/收卷，無倒數）
    is_live_quiz: Optional[bool] = False
    shuffle_questions: Optional[bool] = False
    show_answer: Optional[bool] = False
    play_audio: Optional[bool] = False
    # 單字選擇模式設定
    target_proficiency: Optional[int] = None
    show_word: Optional[bool] = None
    show_image: Optional[bool] = None
    show_translation: Optional[bool] = None
    show_option_images: Optional[bool] = None  # Issue #631
    score_category: Optional[str] = None

    @field_validator("quiz_time_limit_seconds")
    @classmethod
    def _check_quiz_time_limit(cls, v: Optional[int]) -> Optional[int]:
        return _validate_quiz_time_limit(v)

    @field_validator("practice_mode")
    @classmethod
    def _check_practice_mode(cls, v: Optional[str]) -> Optional[str]:
        # #854: 單一真相源驗證（先前完全不檢查，任意字串都會寫進 DB）
        return validate_practice_mode(v)

    @model_validator(mode="after")
    def _option_images_xor_image(self) -> "CreateAssignmentRequest":
        # Issue #631: show_image 與 show_option_images 互斥，避免題目圖片直接洩漏答案
        if self.show_image and self.show_option_images:
            raise ValueError("show_image and show_option_images are mutually exclusive")
        return self


class UpdateAssignmentRequest(BaseModel):
    """更新作業請求（部分更新）"""

    title: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None  # Alias for description
    due_date: Optional[datetime] = None
    start_date: Optional[datetime] = None
    student_ids: Optional[List[int]] = None
    # 進階設定
    time_limit_per_question: Optional[int] = None
    quiz_time_limit_seconds: Optional[int] = None
    is_live_quiz: Optional[bool] = None  # Issue #835
    shuffle_questions: Optional[bool] = None
    show_answer: Optional[bool] = None
    play_audio: Optional[bool] = None
    target_proficiency: Optional[int] = None
    show_word: Optional[bool] = None
    show_image: Optional[bool] = None
    show_translation: Optional[bool] = None
    show_option_images: Optional[bool] = None  # Issue #631

    @field_validator("quiz_time_limit_seconds")
    @classmethod
    def _check_quiz_time_limit(cls, v: Optional[int]) -> Optional[int]:
        return _validate_quiz_time_limit(v)

    @model_validator(mode="after")
    def _option_images_xor_image(self) -> "UpdateAssignmentRequest":
        # 只在兩者都明確 True 時才阻擋；其中一邊為 None 表示「不更新」，由後端保留現值，
        # 不在 validator 階段判斷，留給 CRUD 層讀現值再檢查。
        if self.show_image is True and self.show_option_images is True:
            raise ValueError("show_image and show_option_images are mutually exclusive")
        return self


class AssignmentResponse(BaseModel):
    """作業回應"""

    id: int
    student_id: int
    content_id: int
    classroom_id: int
    title: str
    instructions: Optional[str]
    status: str
    assigned_at: datetime
    due_date: Optional[datetime]

    class Config:
        from_attributes = True


class StudentResponse(BaseModel):
    """學生回應"""

    id: int
    name: str
    email: Optional[str] = None
    student_number: Optional[str] = None

    class Config:
        from_attributes = True


class ContentResponse(BaseModel):
    """Content 回應"""

    id: int
    # Issue #587: lesson_id may be None for program-direct content
    lesson_id: Optional[int] = None
    program_id: Optional[int] = None
    title: str
    type: str
    level: Optional[str]
    items_count: int

    class Config:
        from_attributes = True


class AIGradingRequest(BaseModel):
    """AI 批改請求"""

    grading_mode: str = "full"  # "full" 或 "quick"
    audio_urls: List[str] = []
    mock_mode: bool = False
    mock_data: Optional[Dict[str, Any]] = None


class WordAnalysis(BaseModel):
    """單字分析"""

    word: str
    start_time: float
    end_time: float
    confidence: float
    is_correct: bool


class ItemGradingResult(BaseModel):
    """單項批改結果"""

    item_id: int
    expected_text: str
    transcribed_text: str
    accuracy_score: float
    pronunciation_score: float
    word_analysis: List[WordAnalysis]


class AIScores(BaseModel):
    """AI 評分"""

    pronunciation: float  # 發音評分 (0-100)
    fluency: float  # 流暢度評分 (0-100)
    accuracy: float  # 準確率評分 (0-100)
    wpm: float  # 每分鐘字數


class AIGradingResponse(BaseModel):
    """AI 批改回應"""

    assignment_id: int
    ai_scores: AIScores
    overall_score: float
    feedback: str
    detailed_feedback: List[Dict[str, Any]]
    graded_at: datetime
    processing_time_seconds: float


# ============ Batch Grading Models ============


class BatchGradingRequest(BaseModel):
    """批次批改請求（第一階段：AI 計算分數）"""

    classroom_id: int
    student_ids: Optional[List[int]] = None  # Optional: Filter specific students


class StudentBatchGradingResult(BaseModel):
    """單個學生的批改結果"""

    student_id: int
    student_name: str
    total_score: float
    missing_items: int
    total_items: int  # Total items in assignment
    completed_items: int  # Items with recordings
    avg_pronunciation: float
    avg_accuracy: float
    avg_fluency: float
    avg_completeness: float
    feedback: Optional[str] = None  # Assignment feedback
    status: str


class BatchGradingResponse(BaseModel):
    """批次批改回應"""

    total_students: int
    processed: int
    results: List[StudentBatchGradingResult]


class BatchGradeFinalizeRequest(BaseModel):
    """批次批改完成請求（第二階段：決定狀態）"""

    classroom_id: int
    teacher_decisions: Dict[
        str, Optional[str]
    ]  # student_id -> "RETURNED" | "GRADED" | None


class BatchGradeFinalizeResponse(BaseModel):
    """批次批改完成回應"""

    returned_count: int
    graded_count: int
    unchanged_count: int
    total_count: int


# Issue #335 item 5: typed request bodies for the manual/teacher grading
# endpoints that previously accepted raw ``dict`` (no validation, no score
# bounds). Endpoints bridge these back to a dict via
# ``model_dump(exclude_none=True)`` so existing body logic is unchanged while
# input is now validated at the boundary.
class TeacherItemGradeResult(BaseModel):
    """Per-item teacher grade inside GradeStudentAssignmentRequest."""

    item_index: int
    feedback: Optional[str] = None
    passed: Optional[bool] = None
    score: Optional[float] = Field(default=None, ge=0, le=100)


class GradeStudentAssignmentRequest(BaseModel):
    """Body for POST /{assignment_id}/grade."""

    student_id: int
    score: Optional[float] = Field(default=None, ge=0, le=100)
    feedback: Optional[str] = None
    update_status: bool = True
    item_results: Optional[List[TeacherItemGradeResult]] = None


class SetAssignmentInProgressRequest(BaseModel):
    """Body for POST /{assignment_id}/set-in-progress."""

    student_id: int


class ReturnForRevisionRequest(BaseModel):
    """Body for POST /{assignment_id}/return-for-revision."""

    student_id: int
    message: Optional[str] = None


class ManualGradeAssignmentRequest(BaseModel):
    """Body for POST /{assignment_id}/manual-grade."""

    score: Optional[float] = Field(default=None, ge=0, le=100)
    feedback: Optional[str] = None
    detailed_scores: Optional[Dict[str, Any]] = None

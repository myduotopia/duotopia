"""
Pydantic models and validators for assignments
"""

from typing import List, Optional, Dict, Any
from datetime import datetime
from pydantic import BaseModel, model_validator


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
    # 作答模式設定
    practice_mode: Optional[
        str
    ] = None  # reading, rearrangement, word_reading, word_selection
    answer_mode: Optional[
        str
    ] = None  # DEPRECATED: only 'listening'/'writing' allowed by DB
    time_limit_per_question: Optional[int] = None
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

    @model_validator(mode="after")
    def _option_images_xor_image(self) -> "CreateAssignmentRequest":
        # Issue #631: show_image 與 show_option_images 互斥，避免題目圖片直接洩漏答案
        if self.show_image and self.show_option_images:
            raise ValueError(
                "show_image and show_option_images are mutually exclusive"
            )
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
    shuffle_questions: Optional[bool] = None
    show_answer: Optional[bool] = None
    play_audio: Optional[bool] = None
    target_proficiency: Optional[int] = None
    show_word: Optional[bool] = None
    show_image: Optional[bool] = None
    show_translation: Optional[bool] = None
    show_option_images: Optional[bool] = None  # Issue #631

    @model_validator(mode="after")
    def _option_images_xor_image(self) -> "UpdateAssignmentRequest":
        # 只在兩者都明確 True 時才阻擋；其中一邊為 None 表示「不更新」，由後端保留現值，
        # 不在 validator 階段判斷，留給 CRUD 層讀現值再檢查。
        if self.show_image is True and self.show_option_images is True:
            raise ValueError(
                "show_image and show_option_images are mutually exclusive"
            )
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
    lesson_id: int
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

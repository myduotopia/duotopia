"""Pydantic schemas and validators for student endpoints."""

from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


class StudentValidateRequest(BaseModel):
    email: str
    password: str  # Can be birthdate (YYYYMMDD) or new password if changed


class StudentLoginResponse(BaseModel):
    access_token: str
    token_type: str
    student: dict


class UpdateStudentProfileRequest(BaseModel):
    name: Optional[str] = None


class UpdatePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class EmailUpdateRequest(BaseModel):
    email: str


class SwitchAccountRequest(BaseModel):
    target_student_id: int
    password: Optional[str] = None  # Identity 關聯帳號不需密碼，fallback 才需要


# Practice Words schemas
class PracticeWord(BaseModel):
    """練習單字資料"""

    content_item_id: int
    text: str
    translation: str
    example_sentence: str
    example_sentence_translation: str
    audio_url: Optional[str] = None
    memory_strength: float
    priority_score: float


class PracticeWordsResponse(BaseModel):
    """練習單字回應"""

    session_id: int
    answer_mode: str
    words: List[PracticeWord]


class SubmitAnswerRequest(BaseModel):
    """提交答案請求"""

    content_item_id: int
    is_correct: bool
    time_spent_seconds: int
    answer_data: Dict[str, Any]  # {"selected_words": [...], "attempts": 3}


class SubmitAnswerResponse(BaseModel):
    """提交答案回應"""

    success: bool
    new_memory_strength: float
    next_review_at: Optional[datetime]


class MasteryStatusResponse(BaseModel):
    """達標狀態回應"""

    current_mastery: float
    target_mastery: float
    achieved: bool


# Rearrangement (例句重組) schemas
class RearrangementQuestionResponse(BaseModel):
    """例句重組題目回應"""

    content_item_id: int
    shuffled_words: List[str]  # 打亂後的單字列表
    word_count: int
    max_errors: int
    time_limit: int  # 時間限制（秒）
    play_audio: bool  # 是否播放音檔
    audio_url: Optional[str] = None
    translation: Optional[str] = None
    original_text: Optional[str] = None  # 正確答案（用於顯示答案功能）


class RearrangementAnswerRequest(BaseModel):
    """例句重組答題請求"""

    content_item_id: int
    selected_word: str  # 學生選擇的單字
    current_position: int  # 目前已正確選擇的位置（0-based）


class RearrangementAnswerResponse(BaseModel):
    """例句重組答題回應"""

    is_correct: bool
    correct_word: Optional[str] = None  # 如果錯誤，顯示正確答案
    error_count: int
    max_errors: int
    expected_score: float
    correct_word_count: int
    total_word_count: int
    challenge_failed: bool  # 達到錯誤上限
    completed: bool  # 是否完成此題


class RearrangementRetryRequest(BaseModel):
    """重新挑戰請求"""

    content_item_id: int


class RearrangementCompleteRequest(BaseModel):
    """完成題目請求"""

    content_item_id: int
    timeout: bool = False  # 是否因超時完成
    expected_score: Optional[float] = None  # 最終分數
    error_count: Optional[int] = None  # 錯誤次數

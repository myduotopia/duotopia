"""
Student progress tracking models
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    Boolean,
    Text,
    JSON,
    Enum,
    Float,
    DECIMAL,
    UniqueConstraint,
    Index,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
from .base import AssignmentStatus


class StudentContentProgress(Base):
    """
    ⚠️ DEPRECATED - 此模型計劃在未來版本中移除

    學生-內容進度表 - 追蹤學生對每個內容的完成狀況

    ⚠️ WARNING: This model is redundant and scheduled for removal.

    Why deprecated:
    - All actual student data is stored in StudentItemProgress
    - All fields can be aggregated from StudentItemProgress
    - The `is_locked` field is never checked in business logic
    - Keeping this only for backward compatibility

    Migration plan:
    - Phase 1: Mark as deprecated (current)
    - Phase 2: Create aggregation functions from StudentItemProgress
    - Phase 3: Refactor all 76+ references to use aggregation
    - Phase 4: Remove this model and database table

    New code should NOT use this model. Use StudentItemProgress instead.
    """

    __tablename__ = "student_content_progress"

    id = Column(Integer, primary_key=True, index=True)
    student_assignment_id = Column(
        Integer, ForeignKey("student_assignments.id"), nullable=False
    )
    content_id = Column(Integer, ForeignKey("contents.id"), nullable=False)

    status = Column(Enum(AssignmentStatus), default=AssignmentStatus.NOT_STARTED)
    score = Column(Float, nullable=True)  # 該內容的分數（選填，保留但不強制）

    # 順序與鎖定（支援順序學習）
    order_index = Column(Integer, default=0)
    is_locked = Column(Boolean, default=False)  # 是否需要解鎖（Phase 2）

    # 批改相關
    checked = Column(Boolean, nullable=True)  # True=通過, False=未通過, None=未批改
    feedback = Column(Text)  # 該內容的個別回饋

    # 學生回答/提交內容
    response_data = Column(JSON)  # 儲存錄音URL、答案等

    # AI 評分結果
    ai_scores = Column(JSON)  # {"wpm": 85, "accuracy": 0.92, ...}
    ai_feedback = Column(Text)

    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))

    # Relationships
    student_assignment = relationship(
        "StudentAssignment", back_populates="content_progress"
    )
    content = relationship("Content")

    def __repr__(self):
        return (
            f"<Progress student_assignment={self.student_assignment_id} "
            f"content={self.content_id}>"
        )


class StudentItemProgress(Base):
    """Track individual item progress for each student"""

    __tablename__ = "student_item_progress"

    id = Column(Integer, primary_key=True, index=True)
    student_assignment_id = Column(
        Integer,
        ForeignKey("student_assignments.id", ondelete="CASCADE"),
        nullable=False,
    )
    content_item_id = Column(
        Integer, ForeignKey("content_items.id", ondelete="CASCADE"), nullable=False
    )

    # Recording data
    recording_url = Column(Text)
    answer_text = Column(Text)
    transcription = Column(Text)  # AI 轉錄文字（與 DB 一致）
    submitted_at = Column(DateTime(timezone=True))

    # AI Assessment (flattened structure for better querying)
    accuracy_score = Column(DECIMAL(5, 2))
    fluency_score = Column(DECIMAL(5, 2))
    pronunciation_score = Column(DECIMAL(5, 2))
    completeness_score = Column(DECIMAL(5, 2))
    ai_feedback = Column(Text)
    ai_assessed_at = Column(DateTime(timezone=True))

    # Teacher Review Fields (新增老師批改功能)
    teacher_review_score = Column(DECIMAL(5, 2))  # 老師評分 (0-100)
    teacher_feedback = Column(Text)  # 老師文字回饋
    teacher_passed = Column(Boolean)  # 老師判定是否通過 (True/False/None)
    teacher_reviewed_at = Column(DateTime(timezone=True))  # 批改時間
    teacher_id = Column(Integer, ForeignKey("teachers.id", ondelete="SET NULL"))  # 批改老師
    review_status = Column(String(20), default="PENDING")  # PENDING, REVIEWED

    # Status tracking
    status = Column(
        String(20), default="NOT_STARTED"
    )  # NOT_STARTED, IN_PROGRESS, COMPLETED, SUBMITTED
    attempts = Column(Integer, default=0)

    # Rearrangement activity fields (例句重組專用)
    error_count = Column(Integer, default=0)  # 錯誤選擇次數
    correct_word_count = Column(Integer, default=0)  # 正確選擇的單字數
    retry_count = Column(Integer, default=0)  # 重試次數
    expected_score = Column(DECIMAL(5, 2), default=0)  # 預期分數
    timeout_ended = Column(Boolean, default=False)  # 是否因超時結束
    rearrangement_data = Column(JSONB)  # 例句重組選擇歷史記錄

    # Word selection activity fields (單字選擇專用)
    word_selection_data = Column(JSONB)  # 單字選擇累計統計與答題歷史

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    student_assignment = relationship(
        "StudentAssignment", back_populates="item_progress"
    )
    content_item = relationship("ContentItem", back_populates="student_progress")
    teacher = relationship("Teacher", foreign_keys=[teacher_id])

    # Constraints
    __table_args__ = (
        UniqueConstraint(
            "student_assignment_id", "content_item_id", name="_student_item_progress_uc"
        ),
    )

    @property
    def overall_score(self):
        """Calculate overall score from all components"""
        scores = [
            s
            for s in [self.accuracy_score, self.fluency_score, self.pronunciation_score]
            if s is not None
        ]
        return sum(scores) / len(scores) if scores else None

    @property
    def is_completed(self):
        """Check if this item is completed"""
        return self.status == "COMPLETED"

    @property
    def has_teacher_review(self):
        """Check if teacher has reviewed this item"""
        return (
            self.review_status == "REVIEWED" and self.teacher_review_score is not None
        )

    @property
    def final_score(self):
        """Get final score (teacher review if available, otherwise AI score)"""
        if self.has_teacher_review:
            return float(self.teacher_review_score)
        return self.overall_score

    @property
    def has_recording(self):
        """Check if recording exists"""
        return self.recording_url is not None and self.recording_url != ""

    @property
    def has_ai_assessment(self):
        """Check if AI assessment exists"""
        # 使用 ai_assessed_at 判斷是否有 AI 評估，因為分數可能為 0
        return self.ai_assessed_at is not None

    def __repr__(self):
        return (
            f"<StudentItemProgress(id={self.id}, "
            f"assignment={self.student_assignment_id}, "
            f"item={self.content_item_id}, status={self.status})>"
        )


class PracticeSession(Base):
    """練習記錄 - 每次練習 session"""

    __tablename__ = "practice_sessions"

    id = Column(Integer, primary_key=True)
    student_id = Column(
        Integer, ForeignKey("students.id", ondelete="CASCADE"), nullable=False
    )
    student_assignment_id = Column(
        Integer,
        ForeignKey("student_assignments.id", ondelete="CASCADE"),
        nullable=False,
    )

    # 練習模式
    practice_mode = Column(
        String(20), nullable=False
    )  # 'listening', 'writing', 'word_selection'

    # 本次練習統計
    words_practiced = Column(
        Integer, default=0, server_default="0", nullable=False
    )  # 本次練習單字數
    correct_count = Column(
        Integer, default=0, server_default="0", nullable=False
    )  # 本次答對題數
    total_time_seconds = Column(
        Integer, default=0, server_default="0", nullable=False
    )  # 總花費時間（秒）

    # 時間戳記
    started_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at = Column(DateTime(timezone=True))
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    student = relationship("Student")
    student_assignment = relationship("StudentAssignment")
    answers = relationship(
        "PracticeAnswer", back_populates="session", cascade="all, delete-orphan"
    )

    # Constraints - 匹配現有資料庫索引
    __table_args__ = (
        Index("idx_practice_sessions_student", "student_id", "student_assignment_id"),
        Index("idx_practice_sessions_started", "started_at"),
    )

    def __repr__(self):
        return (
            f"<PracticeSession id={self.id} student={self.student_id} "
            f"mode={self.practice_mode}>"
        )


class PracticeAnswer(Base):
    """答題詳細記錄"""

    __tablename__ = "practice_answers"

    id = Column(Integer, primary_key=True)
    practice_session_id = Column(
        Integer, ForeignKey("practice_sessions.id", ondelete="CASCADE"), nullable=False
    )
    content_item_id = Column(Integer, ForeignKey("content_items.id"), nullable=False)

    # 答題結果
    is_correct = Column(Boolean, nullable=False)
    time_spent_seconds = Column(Integer, default=0, server_default="0", nullable=False)

    # 學生答案（JSONB 格式儲存，兼容現有數據庫 schema）
    answer_data = Column(JSONB)  # {"selected_words": [...], "attempts": 3}

    # 時間戳記
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    session = relationship("PracticeSession", back_populates="answers")
    content_item = relationship("ContentItem")

    # Constraints - 匹配現有資料庫索引
    __table_args__ = (
        Index("idx_practice_answers_session", "practice_session_id"),
        Index("idx_practice_answers_item", "content_item_id"),
    )

    def __repr__(self):
        return (
            f"<PracticeAnswer session={self.practice_session_id} "
            f"item={self.content_item_id} correct={self.is_correct}>"
        )

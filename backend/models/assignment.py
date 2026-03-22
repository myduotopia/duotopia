"""
Assignment models
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    Boolean,
    Text,
    Enum,
    Float,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
from .base import AssignmentStatus


# ============ 作業系統 ============
class Assignment(Base):
    """作業主表 - 教師建立的作業任務"""

    __tablename__ = "assignments"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text)
    classroom_id = Column(Integer, ForeignKey("classrooms.id"), nullable=True)
    teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=False)

    due_date = Column(DateTime(timezone=True))
    start_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Legacy: 造句練習答題模式（只對舊 SENTENCE_MAKING 類型有效）
    # @deprecated: 請使用 practice_mode 和 play_audio 替代
    # Note: 保持 nullable=True 以兼容現有數據庫 schema
    answer_mode = Column(
        String(20),
        default="writing",
        server_default="writing",
        nullable=True,
    )

    # ===== 例句集作答模式設定 =====
    # 作答模式：'reading' (例句朗讀) / 'rearrangement' (例句重組)
    practice_mode = Column(String(20), default="reading")

    # 每題時間限制（秒）：0（不限時）/10/20/30/40
    time_limit_per_question = Column(Integer, default=30)

    # 是否打亂題目順序
    shuffle_questions = Column(Boolean, default=False)

    # 是否播放音檔（例句重組專用）
    play_audio = Column(Boolean, default=False)

    # 答題結束後是否顯示正確答案（例句重組專用）
    show_answer = Column(Boolean, default=False)

    # 分數記錄分類：'speaking' / 'listening' / 'writing' / 'vocabulary'
    score_category = Column(String(20), default=None)

    # ===== Phase 2: 單字集作答模式設定 =====
    # 達標熟悉度（百分比，預設 80%）- 單字選擇模式專用
    target_proficiency = Column(Integer, default=80)

    # 是否顯示翻譯（預設 true）- 單字朗讀模式可選擇隱藏
    show_translation = Column(Boolean, default=True)

    # 是否顯示單字（預設 true）- 單字選擇模式可選擇隱藏（只播音檔）
    show_word = Column(Boolean, default=True)

    # 是否顯示圖片（預設 true）- 單字集專用
    show_image = Column(Boolean, default=True)

    # 軟刪除標記
    is_active = Column(Boolean, default=True)

    # 封存標記
    is_archived = Column(Boolean, default=False)
    archived_at = Column(DateTime(timezone=True), nullable=True)

    # 即刻練習標記（暫時資料，懶清理：建立新的時刪除舊的）
    is_instant_practice = Column(Boolean, default=False)

    # Relationships
    classroom = relationship("Classroom", back_populates="assignments")
    teacher = relationship("Teacher", back_populates="assignments")
    contents = relationship(
        "AssignmentContent", back_populates="assignment", cascade="all, delete-orphan"
    )
    student_assignments = relationship(
        "StudentAssignment", back_populates="assignment", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Assignment {self.title} in Classroom {self.classroom_id}>"


class AssignmentContent(Base):
    """作業-內容關聯表 - 一個作業可包含多個內容"""

    __tablename__ = "assignment_contents"

    id = Column(Integer, primary_key=True, index=True)
    assignment_id = Column(Integer, ForeignKey("assignments.id"), nullable=False)
    content_id = Column(Integer, ForeignKey("contents.id"), nullable=False)
    order_index = Column(Integer, default=0)  # 內容順序

    # Relationships
    assignment = relationship("Assignment", back_populates="contents")
    content = relationship("Content")

    # Constraints - 確保同一作業不會重複包含相同內容
    __table_args__ = (
        UniqueConstraint(
            "assignment_id", "content_id", name="unique_assignment_content"
        ),
    )

    def __repr__(self):
        return f"<AssignmentContent assignment={self.assignment_id} content={self.content_id}>"


class StudentAssignment(Base):
    """學生作業實例 - 每個學生對應作業的記錄"""

    __tablename__ = "student_assignments"

    id = Column(Integer, primary_key=True, index=True)
    assignment_id = Column(
        Integer, ForeignKey("assignments.id"), nullable=True
    )  # nullable 暫時為 True 以兼容舊資料
    student_id = Column(Integer, ForeignKey("students.id"), nullable=False)

    # TODO: Phase 2 - 移除以下舊欄位（等資料遷移完成）
    # 這些欄位應該從 Assignment 取得，不需要重複儲存
    classroom_id = Column(
        Integer, ForeignKey("classrooms.id"), nullable=False
    )  # 可從 assignment.classroom_id 取得
    title = Column(String(200), nullable=False)  # 可從 assignment.title 取得
    instructions = Column(Text)  # 可從 assignment.description 取得
    due_date = Column(DateTime(timezone=True))  # 可從 assignment.due_date 取得

    status = Column(Enum(AssignmentStatus), default=AssignmentStatus.NOT_STARTED)

    # 時間記錄
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True))  # 首次開始時間
    submitted_at = Column(DateTime(timezone=True))  # 全部完成時間
    graded_at = Column(DateTime(timezone=True))  # 批改完成時間
    returned_at = Column(DateTime(timezone=True))  # 退回訂正時間
    resubmitted_at = Column(DateTime(timezone=True))  # 重新提交時間

    # 成績與回饋
    score = Column(Float, nullable=True)  # 總分（選填，保留但不強制使用）
    feedback = Column(Text)  # 總評

    # 軟刪除標記
    is_active = Column(Boolean, default=True)

    # 時間戳記
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    assignment = relationship("Assignment", back_populates="student_assignments")
    student = relationship("Student", back_populates="assignments")
    content_progress = relationship(
        "StudentContentProgress",
        back_populates="student_assignment",
        cascade="all, delete-orphan",
    )
    item_progress = relationship(
        "StudentItemProgress",
        back_populates="student_assignment",
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<Assignment {self.title} for {self.student_id}>"

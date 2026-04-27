"""
Program, Lesson, Content, and ContentItem models
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
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
from .base import ProgramLevel, ContentType, ProgramVisibility, UUID


# ============ 課程系統（三層架構）============
class Program(Base):
    """課程計畫 - 公版模板或班級課程"""

    __tablename__ = "programs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    level = Column(Enum(ProgramLevel), default=ProgramLevel.A1)

    # 類型與歸屬
    is_template = Column(
        Boolean, default=False, nullable=False
    )  # True=公版模板, False=班級課程
    classroom_id = Column(
        Integer, ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=True
    )  # 公版課程為 NULL
    teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=False)
    organization_id = Column(
        UUID,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )  # Organization-owned materials (NOT classroom copies)
    school_id = Column(
        UUID, ForeignKey("schools.id", ondelete="CASCADE"), nullable=True, index=True
    )  # School-owned materials

    # 來源追蹤
    source_type = Column(
        String(20), nullable=True
    )  # 'template', 'classroom', 'custom', None
    source_metadata = Column(JSON, nullable=True)
    """
    範例 - ONLY for COPIED programs (classroom copies):
    - 從公版複製: {"template_id": 123, "template_name": "初級會話"}
    - 從其他班級: {"classroom_id": 456, "classroom_name": "五年級B班", "program_id": 789}
    - 從組織教材: {"organization_id": "uuid", "organization_name": "XX學校", "program_id": 123, "source_type": "org_template"}

    NOTE: organization_id column is for ORGANIZATION-OWNED materials
          source_metadata.organization_id is for COPIES tracking their origin
    """

    # 課程屬性
    is_public = Column(Boolean, nullable=True)  # 是否公開（與 DB 一致，但不使用）
    visibility = Column(
        String(20), default="private", nullable=False, server_default="private"
    )  # 資源教材包公開權限: private, public, organization_only, individual_only
    estimated_hours = Column(Integer)  # 預計時數
    order_index = Column(Integer, default=1)  # 排序順序
    tags = Column(JSON, nullable=True)  # 標籤

    # 軟刪除
    is_active = Column(Boolean, default=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    teacher = relationship("Teacher", back_populates="programs")
    classroom = relationship("Classroom", back_populates="programs")
    lessons = relationship(
        "Lesson",
        back_populates="program",
        cascade="all, delete-orphan",
        order_by="Lesson.order_index",
    )

    @property
    def is_public_template(self):
        """判斷是否為公版模板"""
        return self.is_template and self.classroom_id is None

    @property
    def is_classroom_program(self):
        """判斷是否為班級課程"""
        return not self.is_template and self.classroom_id is not None

    @property
    def is_school_template(self):
        """判斷是否為學校教材"""
        return self.is_template and self.school_id is not None

    def __repr__(self):
        type_str = "Template" if self.is_template else f"Class {self.classroom_id}"
        return f"<Program {self.name} ({type_str})>"


class Lesson(Base):
    """課程單元（中層）"""

    __tablename__ = "lessons"

    id = Column(Integer, primary_key=True, index=True)
    program_id = Column(Integer, ForeignKey("programs.id"), nullable=False)
    name = Column(String(200), nullable=False)
    description = Column(Text)
    order_index = Column(Integer, default=0)  # 排序
    estimated_minutes = Column(Integer)  # 預計分鐘數
    is_active = Column(Boolean, default=True)  # 軟刪除標記

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    program = relationship("Program", back_populates="lessons")
    contents = relationship(
        "Content",
        back_populates="lesson",
        cascade="all, delete-orphan",
        order_by="Content.order_index",
    )

    def __repr__(self):
        return f"<Lesson {self.name}>"


class Content(Base):
    """課程內容（底層 - Phase 1 只有朗讀錄音集）"""

    __tablename__ = "contents"

    id = Column(Integer, primary_key=True, index=True)
    # Issue #587: lesson_id 可為 null（內容直接掛在 program 下時）
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=True)
    program_id = Column(
        Integer,
        ForeignKey("programs.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    type = Column(Enum(ContentType), default=ContentType.EXAMPLE_SENTENCES)
    title = Column(String(200), nullable=False)
    order_index = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)  # 軟刪除標記

    # 注意：items 欄位已移除，改用 ContentItem 關聯表
    # items = Column(JSON) # DEPRECATED - 使用 content_items 關聯

    # 設定
    target_wpm = Column(Integer)  # 目標 WPM
    target_accuracy = Column(Float)  # 目標準確率
    time_limit_seconds = Column(Integer)  # 時間限制

    # 新增欄位
    level = Column(String(10), default="A1")  # 等級 (PreA, A1, A2, B1, B2, C1, C2)
    tags = Column(JSON, default=list)  # 標籤列表
    is_public = Column(Boolean, default=False)  # 是否公開（給其他老師使用）

    # 作業副本機制欄位
    is_assignment_copy = Column(
        Boolean, nullable=False, server_default=text("false"), default=False, index=True
    )  # 標記是否為作業副本
    source_content_id = Column(
        Integer, ForeignKey("contents.id"), nullable=True, index=True
    )  # 原始內容 ID（如果是副本）

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    lesson = relationship("Lesson", back_populates="contents")
    program = relationship("Program", foreign_keys=[program_id])
    content_items = relationship(
        "ContentItem", back_populates="content", cascade="all, delete-orphan"
    )
    source_content = relationship(
        "Content", remote_side=[id], foreign_keys=[source_content_id]
    )  # 原始內容（如果是副本）

    def __repr__(self):
        return f"<Content {self.title}>"


class ContentItem(Base):
    """Individual question/item within a Content"""

    __tablename__ = "content_items"

    id = Column(Integer, primary_key=True, index=True)
    content_id = Column(
        Integer, ForeignKey("contents.id", ondelete="CASCADE"), nullable=False
    )
    order_index = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    translation = Column(Text)
    audio_url = Column(Text)  # Example audio file

    # Example sentence fields (Phase 1)
    example_sentence = Column(Text, nullable=True)  # Example sentence in English
    example_sentence_translation = Column(
        Text, nullable=True
    )  # Chinese translation of example
    example_sentence_definition = Column(
        Text, nullable=True
    )  # English definition of example
    example_sentence_audio_url = Column(
        Text, nullable=True
    )  # TTS audio for example sentence

    # ===== 例句重組相關欄位 =====
    # 單字數量（建立時自動計算）
    word_count = Column(Integer, nullable=True)

    # 允許錯誤次數（根據 word_count 自動計算：2-10 字 → 3 次，11-25 字 → 5 次）
    max_errors = Column(Integer, nullable=True)

    # ===== Phase 2: 單字集相關欄位 =====
    # 單字圖片 URL（用於視覺輔助記憶）
    image_url = Column(Text, nullable=True)

    # 詞性（n., v., adj., adv., prep., conj., etc.）
    part_of_speech = Column(String(20), nullable=True)

    # 預生成的干擾選項（單字選擇練習用）
    # 儲存格式: ["干擾項1", "干擾項2", "干擾項3"]
    distractors = Column(JSON, nullable=True)

    item_metadata = Column(JSON, default={})
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    content = relationship("Content", back_populates="content_items")
    student_progress = relationship(
        "StudentItemProgress",
        back_populates="content_item",
        cascade="all, delete-orphan",
    )

    # Constraints
    __table_args__ = (
        UniqueConstraint("content_id", "order_index", name="_content_item_order_uc"),
    )

    def __repr__(self):
        return (
            f"<ContentItem(id={self.id}, content_id={self.content_id}, "
            f"order={self.order_index}, text='{self.text[:30]}...')>"
        )


# ============ 資源教材包複製記錄 ============

COPIED_BY_INDIVIDUAL = "individual"
COPIED_BY_ORGANIZATION = "organization"


class ProgramCopyLog(Base):
    """記錄資源教材包的複製歷史，用於每日複製次數限制"""

    __tablename__ = "program_copy_logs"

    id = Column(Integer, primary_key=True, index=True)
    source_program_id = Column(
        Integer,
        ForeignKey("programs.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    copied_by_type = Column(
        String(20), nullable=False
    )  # 'individual' or 'organization'
    copied_by_id = Column(
        String(100), nullable=False, index=True
    )  # teacher_id (as str) or organization_id (uuid str)
    copied_program_id = Column(
        Integer, ForeignKey("programs.id", ondelete="SET NULL"), nullable=True
    )  # 複製後產生的新課程 ID
    copied_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    source_program = relationship(
        "Program", foreign_keys=[source_program_id], backref="copy_logs"
    )
    copied_program = relationship("Program", foreign_keys=[copied_program_id])

    def __repr__(self):
        return (
            f"<ProgramCopyLog(source={self.source_program_id}, "
            f"by={self.copied_by_type}:{self.copied_by_id})>"
        )

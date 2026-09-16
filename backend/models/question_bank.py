"""
Question bank models (Issue #1061 / #1062)

題庫：可被多份考卷重複使用的題目池。與教材階層（Program → Lesson → Content →
ContentItem）是多對多，所以不塞進 ContentItem，另開一組表。
設計討論、欄位語意、權限規則見 docs/design/question-bank-schema.md。

主表 ``questions`` 全題型共用（question_type 區分）；「一份素材配多題」的題型
（文章閱讀、克漏字、獨白／對話聽力）用 ``QuestionGroup`` 承載共用素材，對話再
拆 ``QuestionGroupSegment``。填充題不用選項表，答案存 ``accepted_answers``。

歸屬沿用 Program 的模式：teacher_id 必填（建立者）、organization_id / school_id
擇一表示機構／學校題庫、visibility 用 ProgramVisibility 同一組值。
``is_platform`` 為 True 的題目（contact@duotopia.co 建置）visibility 恆為 public，
DB 有 CHECK 擋，這裡 service 層也會強制。
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base
from models.base import UUID


# ---- 值域常數（DB 亦有 CHECK；這裡供 service / schema 驗證用） ----
QUESTION_TYPE_MULTIPLE_CHOICE = "multiple_choice"
QUESTION_TYPES = (
    QUESTION_TYPE_MULTIPLE_CHOICE,
    "reading",
    "cloze",
    "fill_in",
    "listening",
    "listening_image",
)

STIMULUS_TYPES = ("passage", "audio", "dialogue", "image", "mixed")
ANSWER_MATCH_MODES = ("exact", "case_insensitive", "ignore_punctuation")
SOURCE_TYPES = ("exam", "publisher")

EXAM_POINT_STATUS_ACTIVE = "active"
EXAM_POINT_STATUS_PENDING = "pending"
EXAM_POINT_STATUS_MERGED = "merged"

EXAM_POINT_LINK_SOURCE_MANUAL = "manual"
EXAM_POINT_LINK_SOURCE_AI = "ai"

GRADE_MIN = 1
GRADE_MAX = 12


class ExamPoint(Base):
    """考點（平台維護、有階層、多語）。

    ``code`` 是穩定識別碼（如 ``grammar.tense.present_perfect``），AI 考點分析
    回傳的是 code 而非名稱。``names`` 為 ``{"zh-TW": "...", "en": "..."}``。
    同一考點只能有一個正式名稱；異名靠 ExamPointAlias 歸一。
    """

    __tablename__ = "exam_points"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(100), nullable=False, unique=True)
    parent_id = Column(
        Integer, ForeignKey("exam_points.id", ondelete="SET NULL"), nullable=True
    )
    names = Column(JSONB, nullable=False, default=dict)
    description = Column(JSONB, nullable=True)
    status = Column(String(20), nullable=False, default=EXAM_POINT_STATUS_ACTIVE)
    # 被合併時指向正式考點；查詢時自動 redirect
    merged_into_id = Column(
        Integer, ForeignKey("exam_points.id", ondelete="SET NULL"), nullable=True
    )
    order_index = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    parent = relationship(
        "ExamPoint", remote_side=[id], foreign_keys=[parent_id], backref="children"
    )
    merged_into = relationship(
        "ExamPoint", remote_side=[id], foreign_keys=[merged_into_id]
    )
    aliases = relationship(
        "ExamPointAlias", back_populates="exam_point", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<ExamPoint {self.code} ({self.status})>"


class ExamPointAlias(Base):
    """考點異名：「現完式」「現在完成時態」都對回「現在完成式」。"""

    __tablename__ = "exam_point_aliases"

    id = Column(Integer, primary_key=True, index=True)
    exam_point_id = Column(
        Integer,
        ForeignKey("exam_points.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    alias = Column(Text, nullable=False)
    lang = Column(String(10), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    exam_point = relationship("ExamPoint", back_populates="aliases")

    def __repr__(self):
        return f"<ExamPointAlias {self.alias!r} -> {self.exam_point_id}>"


class QuestionSource(Base):
    """來源標註：歷屆考題（exam）／出版社版本（publisher）。

    organization_id 為 NULL = 平台公用；有值 = 機構自建。
    跟考點分開：考點是「教什麼」，來源是「哪裡來」。
    """

    __tablename__ = "question_sources"

    id = Column(Integer, primary_key=True, index=True)
    source_type = Column(String(20), nullable=False)
    name = Column(String(200), nullable=False)
    year = Column(SmallInteger, nullable=True)
    organization_id = Column(
        UUID,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    def __repr__(self):
        return f"<QuestionSource {self.source_type}:{self.name}>"


class QuestionGroup(Base):
    """題組：一份素材配多題（文章閱讀、克漏字、獨白／對話聽力、圖片題組）。

    整組公開／派發／刪除，不可單獨派其中一題。題組內題目的 visibility 跟隨
    題組（service 層同步）。考點掛在小題層，題組層不掛。
    """

    __tablename__ = "question_groups"

    id = Column(Integer, primary_key=True, index=True)
    stimulus_type = Column(String(20), nullable=False)
    title = Column(String(200), nullable=True)
    # 文章；克漏字用 {{1}} {{2}} 標記空格
    passage_text = Column(Text, nullable=True)
    # 整段合併音檔（播放快取；segments 變動時重生成）
    audio_url = Column(Text, nullable=True)
    image_url = Column(Text, nullable=True)
    grade_min = Column(SmallInteger, nullable=True)
    grade_max = Column(SmallInteger, nullable=True)

    teacher_id = Column(
        Integer,
        ForeignKey("teachers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(
        UUID,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    school_id = Column(
        UUID, ForeignKey("schools.id", ondelete="CASCADE"), nullable=True
    )
    visibility = Column(String(20), nullable=False, default="private")
    is_platform = Column(Boolean, nullable=False, default=False)

    is_active = Column(Boolean, nullable=False, default=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    segments = relationship(
        "QuestionGroupSegment",
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="QuestionGroupSegment.order_index",
    )
    questions = relationship(
        "Question",
        back_populates="group",
        order_by="Question.group_order",
    )

    def __repr__(self):
        return f"<QuestionGroup {self.id} {self.stimulus_type}>"


class QuestionGroupSegment(Base):
    """題組素材分段。對話聽力每一句是一段、各自有音檔與語音角色；獨白 = 只有一段。"""

    __tablename__ = "question_group_segments"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(
        Integer,
        ForeignKey("question_groups.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_index = Column(SmallInteger, nullable=False)
    speaker_label = Column(String(50), nullable=True)
    transcript = Column(Text, nullable=False)
    audio_url = Column(Text, nullable=True)
    tts_voice = Column(String(100), nullable=True)
    pause_after_ms = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    group = relationship("QuestionGroup", back_populates="segments")

    __table_args__ = (
        UniqueConstraint(
            "group_id", "order_index", name="uq_question_group_segments_order"
        ),
    )


class Question(Base):
    """題目主表（全題型共用）。

    ``normalized_stem`` 是正規化題幹（小寫、去標點、壓空白），供重複偵測；
    同一老師的單題不可完全重複（partial unique index，在 migration 中定義）。
    """

    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    question_type = Column(String(30), nullable=False)
    stem = Column(Text, nullable=False)
    normalized_stem = Column(Text, nullable=False, index=True)
    stem_audio_url = Column(Text, nullable=True)
    image_url = Column(Text, nullable=True)
    explanation = Column(Text, nullable=True)
    grade_min = Column(SmallInteger, nullable=True)
    grade_max = Column(SmallInteger, nullable=True)
    allow_multiple_answers = Column(Boolean, nullable=False, default=False)
    # 聽力題設 False → 學生只聽不看題幹
    show_stem_text = Column(Boolean, nullable=False, default=True)
    # 填充題：可接受答案清單 + 比對規則；選擇題為 NULL
    accepted_answers = Column(JSONB, nullable=True)
    answer_match_mode = Column(String(20), nullable=True)

    # 題組
    group_id = Column(
        Integer,
        ForeignKey("question_groups.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    group_order = Column(SmallInteger, nullable=True)
    # 克漏字：對應 passage_text 內 {{n}} 的 n
    blank_index = Column(SmallInteger, nullable=True)
    # 預留：小題只針對對話中某一段（本期不做 UI）
    segment_id = Column(
        Integer,
        ForeignKey("question_group_segments.id", ondelete="SET NULL"),
        nullable=True,
    )

    # 歸屬（與 Program 相同模式）
    teacher_id = Column(
        Integer,
        ForeignKey("teachers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    organization_id = Column(
        UUID,
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    school_id = Column(
        UUID,
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    visibility = Column(String(20), nullable=False, default="private")
    is_platform = Column(Boolean, nullable=False, default=False)
    # 從公開題庫複製到自己題庫時的來源
    source_question_id = Column(
        Integer, ForeignKey("questions.id", ondelete="SET NULL"), nullable=True
    )

    is_active = Column(Boolean, nullable=False, default=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    teacher = relationship("Teacher")
    group = relationship("QuestionGroup", back_populates="questions")
    options = relationship(
        "QuestionOption",
        back_populates="question",
        cascade="all, delete-orphan",
        order_by="QuestionOption.order_index",
    )
    exam_point_links = relationship(
        "QuestionExamPoint",
        back_populates="question",
        cascade="all, delete-orphan",
    )
    source_links = relationship(
        "QuestionSourceLink",
        back_populates="question",
        cascade="all, delete-orphan",
    )
    program_links = relationship(
        "QuestionProgramLink",
        back_populates="question",
        cascade="all, delete-orphan",
    )
    source_question = relationship(
        "Question", remote_side=[id], foreign_keys=[source_question_id]
    )

    def __repr__(self):
        return f"<Question {self.id} {self.question_type} '{self.stem[:30]}'>"


class QuestionOption(Base):
    """選項。獨立成表，讓學生作答紀錄能以 option_id 做誘答統計，改順序不影響。"""

    __tablename__ = "question_options"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(
        Integer,
        ForeignKey("questions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    order_index = Column(SmallInteger, nullable=False)
    text = Column(Text, nullable=False)
    is_correct = Column(Boolean, nullable=False, default=False)
    audio_url = Column(Text, nullable=True)
    image_url = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    question = relationship("Question", back_populates="options")

    __table_args__ = (
        UniqueConstraint(
            "question_id", "order_index", name="uq_question_options_order"
        ),
    )


class QuestionExamPoint(Base):
    """題目 ↔ 考點。``source`` 記錄是老師手標還是 AI 標的，日後評估 AI 準確度。"""

    __tablename__ = "question_exam_points"

    question_id = Column(
        Integer,
        ForeignKey("questions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    exam_point_id = Column(
        Integer,
        ForeignKey("exam_points.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    source = Column(String(10), nullable=False, default=EXAM_POINT_LINK_SOURCE_MANUAL)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    question = relationship("Question", back_populates="exam_point_links")
    exam_point = relationship("ExamPoint")


class QuestionSourceLink(Base):
    """題目 ↔ 來源（歷屆考題／出版社版本）。"""

    __tablename__ = "question_source_links"

    question_id = Column(
        Integer,
        ForeignKey("questions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    source_id = Column(
        Integer,
        ForeignKey("question_sources.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    question = relationship("Question", back_populates="source_links")
    source = relationship("QuestionSource")


class QuestionProgramLink(Base):
    """題目 ↔ 教材包／單元。lesson_id 為 NULL 表示只掛教材包。

    唯一性 (question_id, program_id, COALESCE(lesson_id, 0)) 在 migration 以
    唯一索引實作（UNIQUE 對 NULL 不生效）。
    """

    __tablename__ = "question_program_links"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(
        Integer,
        ForeignKey("questions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    program_id = Column(
        Integer,
        ForeignKey("programs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    lesson_id = Column(
        Integer, ForeignKey("lessons.id", ondelete="CASCADE"), nullable=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    question = relationship("Question", back_populates="program_links")
    program = relationship("Program")
    lesson = relationship("Lesson")

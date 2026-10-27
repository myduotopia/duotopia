"""
上傳題本（Issue #1112）匯入草稿 models。

- ``ExamImport``       一份上傳的題本（老師、檔名、檔案雜湊、頁數、整份設定、口音選擇、狀態、
                       已知答案對照、用量加總）
- ``ExamImportPage``   題本的一頁（狀態、頁圖 URL、是否答案頁、題目卡 JSONB）
- ``ExamImportUsage``  每次 AI 呼叫一列（類型、模型、input／output／thinking token、估算美元）

流程與規則見 docs/design/question-bank-exam-import.md；資料表見
docs/design/question-bank-schema.md「上傳題本（#1112）」段。migration：
``alembic/versions/20261027_1000_add_exam_imports.py``。

題目卡（``ExamImportPage.cards``）的 JSON 形狀由 ``services/exam_paper_service.py``
產生、``services/exam_import_service.py`` 維護（答案回填、跨頁合併、重複標記）。
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Index,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base

# ---- 匯入狀態 ----
# processing：還有頁沒處理完；ready：每頁都處理過（待老師核對／存入，C4）；
# saved：全部存入題庫；abandoned：老師放棄（不算進每天 1 本）
EXAM_IMPORT_STATUS_PROCESSING = "processing"
EXAM_IMPORT_STATUS_READY = "ready"
EXAM_IMPORT_STATUS_SAVED = "saved"
EXAM_IMPORT_STATUS_ABANDONED = "abandoned"
EXAM_IMPORT_STATUSES = (
    EXAM_IMPORT_STATUS_PROCESSING,
    EXAM_IMPORT_STATUS_READY,
    EXAM_IMPORT_STATUS_SAVED,
    EXAM_IMPORT_STATUS_ABANDONED,
)

# ---- 頁狀態 ----
PAGE_STATUS_PENDING = "pending"
PAGE_STATUS_PROCESSING = "processing"
PAGE_STATUS_DONE = "done"
PAGE_STATUS_FAILED = "failed"
PAGE_STATUSES = (
    PAGE_STATUS_PENDING,
    PAGE_STATUS_PROCESSING,
    PAGE_STATUS_DONE,
    PAGE_STATUS_FAILED,
)

# 一份題本最多 20 頁（DB CHECK 同值）
EXAM_IMPORT_MAX_PAGES = 20

# ---- 用量類型 ----
USAGE_CALL_EXTRACT_PAGE = "extract_page"  # 一頁一次：擷取＋缺答案的 AI 作答＋考點
USAGE_CALL_RETRY_QUESTION = "retry_question"  # 重讀單一題
USAGE_CALL_TTS = "tts"  # 語音段才寫


class ExamImport(Base):
    """一份上傳的題本（匯入草稿）。"""

    __tablename__ = "exam_imports"
    __table_args__ = (
        Index("ix_exam_imports_teacher_created", "teacher_id", "created_at"),
        Index("ix_exam_imports_teacher_hash", "teacher_id", "file_hash"),
    )

    id = Column(Integer, primary_key=True)
    teacher_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )
    file_name = Column(String(255), nullable=False)
    # 檔案內容 SHA-256（hex）：同一位老師重複匯入同一份題本時擋下
    file_hash = Column(String(64), nullable=False)
    page_count = Column(SmallInteger, nullable=False)
    status = Column(String(20), nullable=False, default=EXAM_IMPORT_STATUS_PROCESSING)
    # 整份設定：{"grade_min", "grade_max", "source_id", "program_links",
    #           "visibility", "organization_id", "school_id"}（C4 存入時逐題寫入）
    settings = Column(JSONB, nullable=False, default=dict)
    # 朗讀口音選擇（多選，至少一種）：["American English", ...]
    tts_accents = Column(JSONB, nullable=False, default=list)
    # 已知答案（答案頁擷取到的）：{"12": [1], "13": [0]}；題號 → 0-based 正確選項 index
    known_answers = Column(JSONB, nullable=False, default=dict)
    question_count = Column(Integer, nullable=False, default=0)

    # 用量加總（每列明細在 exam_import_usage）
    ai_call_count = Column(Integer, nullable=False, default=0)
    input_tokens = Column(Integer, nullable=False, default=0)
    output_tokens = Column(Integer, nullable=False, default=0)
    thinking_tokens = Column(Integer, nullable=False, default=0)
    estimated_cost_usd = Column(Numeric(12, 6), nullable=False, default=0)

    abandoned_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    teacher = relationship("Teacher")
    pages = relationship(
        "ExamImportPage",
        back_populates="exam_import",
        cascade="all, delete-orphan",
        order_by="ExamImportPage.page_no",
    )

    def __repr__(self):
        return f"<ExamImport {self.id} {self.file_name!r} {self.status}>"


class ExamImportPage(Base):
    """題本的一頁：頁圖、狀態、這一頁擷取出的題目卡。"""

    __tablename__ = "exam_import_pages"
    __table_args__ = (
        UniqueConstraint(
            "import_id", "page_no", name="uq_exam_import_pages_import_page"
        ),
    )

    id = Column(Integer, primary_key=True)
    import_id = Column(
        Integer, ForeignKey("exam_imports.id", ondelete="CASCADE"), nullable=False
    )
    page_no = Column(SmallInteger, nullable=False)
    status = Column(String(20), nullable=False, default=PAGE_STATUS_PENDING)
    image_url = Column(Text, nullable=True)
    is_answer_page = Column(Boolean, nullable=False, default=False)
    # 這一頁擷取到的答案對照：{"12": [1]}（答案頁或隨題目印出的答案表）
    answer_key = Column(JSONB, nullable=True)
    # 題目卡陣列（形狀見 services/exam_paper_service.py 模組說明）
    cards = Column(JSONB, nullable=False, default=list)
    error = Column(Text, nullable=True)
    # 正在處理這一頁的那次請求的識別值（搶到 processing 時寫入）：AI 回來後確認仍是自己搶到的
    # 才寫結果，避免卡太久被重搶後舊請求把結果寫進去或把頁標失敗
    claim_id = Column(String(32), nullable=True)
    # 整頁重送次數：第一次處理不算；失敗後、或處理中超過 3 分鐘後再送才算。上限見
    # services/exam_import_service.py ``MAX_PAGE_RESENDS``
    resend_count = Column(SmallInteger, nullable=False, default=0, server_default="0")
    processed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    exam_import = relationship("ExamImport", back_populates="pages")

    def __repr__(self):
        return f"<ExamImportPage {self.import_id}#{self.page_no} {self.status}>"


class ExamImportUsage(Base):
    """每次 AI 呼叫一列。只記錄、不扣老師額度，只在後台查（之後平均到每頁當收費依據）。"""

    __tablename__ = "exam_import_usage"
    __table_args__ = (
        Index("ix_exam_import_usage_import", "import_id"),
        Index("ix_exam_import_usage_created", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    # 放棄匯入時草稿保留、只刪頁面；用量列不跟著消失（SET NULL 只在整列被刪時保底）
    import_id = Column(
        Integer, ForeignKey("exam_imports.id", ondelete="SET NULL"), nullable=True
    )
    teacher_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="SET NULL"), nullable=True
    )
    page_no = Column(SmallInteger, nullable=True)
    call_type = Column(String(30), nullable=False)
    model = Column(String(100), nullable=False)
    input_tokens = Column(Integer, nullable=False, default=0)
    # output 不含 thinking；thinking 另存一欄，加總時相加（同為輸出價計費）
    output_tokens = Column(Integer, nullable=False, default=0)
    thinking_tokens = Column(Integer, nullable=False, default=0)
    audio_seconds = Column(Numeric(10, 2), nullable=True)
    estimated_cost_usd = Column(Numeric(12, 6), nullable=False, default=0)
    succeeded = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return (
            f"<ExamImportUsage import={self.import_id} {self.call_type} "
            f"in={self.input_tokens} out={self.output_tokens} "
            f"think={self.thinking_tokens}>"
        )

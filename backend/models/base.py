"""
Base models and common types for Duotopia
"""

from sqlalchemy import (
    String,
    JSON,
    TypeDecorator,
)
from sqlalchemy.dialects.postgresql import UUID as PostgreSQL_UUID, JSONB
from database import Base  # noqa: F401  # 經 models/__init__ 再匯出供各處 import
import enum
import uuid


# ============ SQLite Compatible UUID Type ============
class UUID(TypeDecorator):
    """
    Cross-database UUID type
    - PostgreSQL: Uses native UUID
    - SQLite: Uses CHAR(36) to store string format
    """

    impl = String
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PostgreSQL_UUID(as_uuid=True))
        else:
            return dialect.type_descriptor(String(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        if dialect.name == "postgresql":
            return value
        else:
            if isinstance(value, uuid.UUID):
                return str(value)
            return value

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        if dialect.name == "postgresql":
            return value
        else:
            if isinstance(value, str):
                return uuid.UUID(value)
            return value


# ============ SQLite Compatible JSONB Type ============
class JSONType(TypeDecorator):
    """
    Cross-database JSON type
    - PostgreSQL: Uses JSONB
    - SQLite: Uses JSON
    """

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        else:
            return dialect.type_descriptor(JSON())


# ============ Enums ============
class UserRole(str, enum.Enum):
    TEACHER = "teacher"
    STUDENT = "student"
    ADMIN = "admin"


class ProgramLevel(str, enum.Enum):
    PRE_A = "preA"
    A1 = "A1"
    A2 = "A2"
    B1 = "B1"
    B2 = "B2"
    C1 = "C1"
    C2 = "C2"


class AssignmentStatus(str, enum.Enum):
    NOT_STARTED = "NOT_STARTED"  # 未開始
    IN_PROGRESS = "IN_PROGRESS"  # 進行中
    SUBMITTED = "SUBMITTED"  # 已提交（待批改）
    GRADED = "GRADED"  # 已批改（完成）
    RETURNED = "RETURNED"  # 退回訂正
    RESUBMITTED = "RESUBMITTED"  # 重新提交（訂正後待批改）


class AnswerMode(str, enum.Enum):
    LISTENING = "listening"  # 聽力模式作答
    WRITING = "writing"  # 寫作模式作答


class TransactionType(str, enum.Enum):
    TRIAL = "TRIAL"  # 試用期啟動
    RECHARGE = "RECHARGE"  # 充值
    EXPIRED = "EXPIRED"  # 到期
    REFUND = "REFUND"  # 退款


class TransactionStatus(str, enum.Enum):
    PENDING = "PENDING"  # 處理中
    SUCCESS = "SUCCESS"  # 成功
    FAILED = "FAILED"  # 失敗


class ContentType(str, enum.Enum):
    # Phase 1 - 啟用
    EXAMPLE_SENTENCES = "EXAMPLE_SENTENCES"  # 例句集（原 READING_ASSESSMENT）

    # Phase 2 - 暫時禁用（UI 中不顯示）
    VOCABULARY_SET = "VOCABULARY_SET"  # 單字集（原 SENTENCE_MAKING）
    MULTIPLE_CHOICE = "MULTIPLE_CHOICE"  # 單選題庫
    SCENARIO_DIALOGUE = "SCENARIO_DIALOGUE"  # 情境對話

    # Legacy values - 保留向後相容性（deprecated，新資料不應使用）
    READING_ASSESSMENT = "READING_ASSESSMENT"  # @deprecated: use EXAMPLE_SENTENCES
    SENTENCE_MAKING = "SENTENCE_MAKING"  # @deprecated: use VOCABULARY_SET


class PracticeMode(str, enum.Enum):
    """作答模式"""

    # 例句集 (EXAMPLE_SENTENCES)
    READING = "reading"  # 例句朗讀 -> 口說分類
    REARRANGEMENT = "rearrangement"  # 例句重組 -> 聽力/寫作分類

    # 單字集 (VOCABULARY_SET) - Phase 2
    WORD_READING = "word_reading"  # 單字朗讀 -> 口說分類
    WORD_SELECTION = "word_selection"  # 單字選擇 -> 艾賓浩斯記憶曲線
    WORD_SELECTION_QUIZ = "word_selection_quiz"  # 單字選擇 -> 小考
    WORD_SPELLING = "word_spelling"  # 單字拼寫 -> 艾賓浩斯
    WORD_CLOZE = "word_cloze"  # 單字克漏字 -> 艾賓浩斯
    WORD_SPELLING_QUIZ = "word_spelling_quiz"  # 單字拼寫 -> 小考
    WORD_CLOZE_QUIZ = "word_cloze_quiz"  # 單字克漏字 -> 小考
    TUG_OF_WAR = "tug_of_war"  # 拔河對戰（雙人搶答；不經派發 dialog，由即刻練習提供）


class ScoreCategory(str, enum.Enum):
    """分數記錄分類 — 由 practice_mode + play_audio 自動推導。

    對照表見 docs/design/score-category-mapping.md。
    """

    SPEAKING = "speaking"  # 口說
    LISTENING = "listening"  # 聽力
    WRITING = "writing"  # 寫作
    READING = "reading"  # 閱讀


class ProgramVisibility(str, enum.Enum):
    """課程公開權限"""

    PRIVATE = "private"  # 不公開（預設）
    PUBLIC = "public"  # 全公開
    ORGANIZATION_ONLY = "organization_only"  # 只對組織公開
    INDIVIDUAL_ONLY = "individual_only"  # 只對個人使用者公開

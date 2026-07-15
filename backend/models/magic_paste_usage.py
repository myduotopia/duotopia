"""
Magic Paste 每月配額計數 model（issue #891）。

「教材內容魔術貼上」每位老師每月有免費額度（預設 5 張），超額改扣點數。
本表只負責記錄「某老師在某個年月用了幾次」，每個自然月一列，跨月自然重置。

year_month 以 'YYYY-MM' 字串表示（例：'2026-07'），
唯一約束 (teacher_id, year_month) 確保同月只有一列，供 UPSERT 累加。
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class MagicPasteUsage(Base):
    """魔術貼上每月使用計數（每位老師每個自然月一列）。"""

    __tablename__ = "magic_paste_usage"
    __table_args__ = (
        UniqueConstraint(
            "teacher_id", "year_month", name="uq_magic_paste_usage_teacher_month"
        ),
        Index("ix_magic_paste_usage_teacher_month", "teacher_id", "year_month"),
    )

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )
    # 'YYYY-MM'，代表計數所屬的自然月
    year_month = Column(String(7), nullable=False)
    count = Column(Integer, nullable=False, default=0, server_default="0")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    teacher = relationship("Teacher")

    def __repr__(self):
        return (
            f"<MagicPasteUsage teacher={self.teacher_id} "
            f"month={self.year_month} count={self.count}>"
        )

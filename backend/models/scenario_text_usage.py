"""情境對話文字 AI 的每月使用計數（issue #1025）。

與 ``ScenarioImageUsage``（#1024）同一個形狀，但**刻意分成兩張表**：生圖的成本比
文字生成貴一個量級，兩者的合理上限差很多（目前 30 vs 50）。共用一張表就得共用一個
數字，調其中一邊會連動另一邊。

計數涵蓋三個端點：產生情境文章、產生題目、從檔案擷取情境文章。
"""

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from database import Base


class ScenarioTextUsage(Base):
    """情境對話文字 AI 的每月使用計數（每位老師每個自然月一列）。"""

    __tablename__ = "scenario_text_usage"
    __table_args__ = (
        UniqueConstraint(
            "teacher_id", "year_month", name="uq_scenario_text_usage_teacher_month"
        ),
        Index("ix_scenario_text_usage_teacher_month", "teacher_id", "year_month"),
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

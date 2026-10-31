"""情境對話 AI 生圖的使用計數 model（issue #1024，#1158 起同一張表存月與日兩種計數）。

每位老師每個「計數期間」一列，唯一約束 (teacher_id, year_month) 供 UPSERT 累加。

``year_month`` 欄位名稱沿用，但 #1158 起它是「計數期間的鍵」，有兩種格式：

* ``'YYYY-MM'``（7 字元）：**訂閱老師**每月 60 張的月計數，月份以 **UTC** 計
  （沿用 #1024 的寫法，與 ``scenario_text_usage`` 一致）。
* ``'YYYY-MM-DD'``（10 字元）：**未付費、非機構老師**每天 3 張的日計數，日期以
  **台灣時區**計（老師感受到的「今天」）。

兩種鍵長度不同，不會撞到同一列；欄位由 String(7) 放寬為 String(10)
（migration 20261029_1000）。計費規則見 ``services/scenario_image_billing``。

本表為 JWT-auth 業務表，不使用 Supabase RLS（已加入 deploy-backend.yml 排除清單）。
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
from sqlalchemy.sql import func
from database import Base


class ScenarioImageUsage(Base):
    """情境對話生圖的使用計數（每位老師每個計數期間一列：月或日）。"""

    __tablename__ = "scenario_image_usage"
    __table_args__ = (
        UniqueConstraint(
            "teacher_id", "year_month", name="uq_scenario_image_usage_teacher_month"
        ),
        Index("ix_scenario_image_usage_teacher_month", "teacher_id", "year_month"),
    )

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )
    # 計數期間的鍵：'YYYY-MM'（訂閱月計數，UTC）或 'YYYY-MM-DD'（未付費日計數，台灣時區）
    year_month = Column(String(10), nullable=False)
    count = Column(Integer, nullable=False, default=0, server_default="0")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

"""Group-buy standalone models (issue #862, 方案 B 後端重構).

團購脫離機構表（organizations / schools / teacher_organizations / teacher_schools），
改由本檔的 `group_buy_teams` / `group_buy_members` 自成一格：
  - 發起人記於 team.owner_teacher_id（取代 TeacherOrganization(org_owner) + TeacherSchool(school_admin)）
  - 團員記於 group_buy_members（取代 TeacherSchool(roles=["teacher"])）
  - 帳務把關改用 team.owner_teacher_id，不再共用機構 org-owner 端點

§4.8「既有個人訂閱者入團 → 暫停+延展（殘值保留）」所需的暫停狀態欄位掛在
group_buy_members 上。設計見 docs/design/issue-862-plan-b-backend-restructure.md。

PR1 只建立資料模型與遷移＋回填，不改動任何讀寫路徑（見該 doc §7 分階段）。
"""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func, text

from database import Base
from .base import UUID


class GroupBuyTeam(Base):
    """團購團體（取代借用的 Organization(group_buy) + School）。"""

    __tablename__ = "group_buy_teams"

    id = Column(Integer, primary_key=True, index=True)

    # 發起人（付款人）。取代 TeacherOrganization(org_owner)。
    owner_teacher_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )
    # 團購方案（teacher_seats / annual_fee / topup_discount）
    plan_id = Column(Integer, ForeignKey("plans.id"), nullable=False)

    # 席次上限（取代 School.teacher_seat_limit / Organization.teacher_limit 的聚合值）
    seat_limit = Column(Integer, nullable=False)

    # 年度訂閱窗口（取代 Organization.subscription_start/end_date）
    subscription_start = Column(DateTime(timezone=True), nullable=True)
    subscription_end = Column(DateTime(timezone=True), nullable=True)

    # 發起人聯絡資訊
    contact_email = Column(String(200), nullable=True)
    contact_phone = Column(String(50), nullable=True)

    is_active = Column(Boolean, nullable=False, default=True, index=True)

    # 回填來源：對應原本借用的機構（供 PR2 雙讀過渡與回填冪等）。新開團為 NULL。
    source_organization_id = Column(
        UUID, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )

    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    members = relationship(
        "GroupBuyMember",
        back_populates="team",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_group_buy_teams_owner", "owner_teacher_id"),
        # 部分唯一索引：同一來源機構最多回填一個 team，讓冪等不變式由 DB 保證
        # （防並發重跑重複），而非只靠回填 SQL 的 WHERE NOT EXISTS。NULL（新開團）
        # 不受限。postgresql_where 在 SQLite 測試被忽略，退化為一般唯一索引。
        Index(
            "uq_group_buy_teams_source_org",
            "source_organization_id",
            unique=True,
            postgresql_where=text("source_organization_id IS NOT NULL"),
        ),
    )

    def __repr__(self):
        return (
            f"<GroupBuyTeam(id={self.id}, owner={self.owner_teacher_id}, "
            f"seats={self.seat_limit})>"
        )


class GroupBuyMember(Base):
    """團購成員（取代團員的 TeacherSchool）。發起人本身也是一列（is_owner=True）。"""

    __tablename__ = "group_buy_members"

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(
        Integer, ForeignKey("group_buy_teams.id", ondelete="CASCADE"), nullable=False
    )
    teacher_id = Column(
        Integer, ForeignKey("teachers.id", ondelete="CASCADE"), nullable=False
    )
    # 發起人在名冊中也有一列，用此旗標區分（帳務把關看 team.owner_teacher_id）
    is_owner = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    # ---- §4.8 暫停+延展（殘值保留）狀態 ----
    # 入團時被暫停的個人 SubscriptionPeriod；NULL = 入團時無有效個人訂閱。
    paused_period_id = Column(
        Integer,
        ForeignKey("subscription_periods.id", ondelete="SET NULL"),
        nullable=True,
    )
    # 凍結的個人訂閱剩餘時間（秒），退團/團購結束時原封接回。
    paused_remaining_seconds = Column(Integer, nullable=True)
    # 入團時是否為此成員關掉 auto_renew（決定退團要不要恢復月扣）。
    individual_auto_renew_suspended = Column(Boolean, nullable=False, default=False)
    paused_at = Column(DateTime(timezone=True), nullable=True)

    # 回填來源：對應原本綁定的 School（供雙讀過渡）。
    source_school_id = Column(
        UUID, ForeignKey("schools.id", ondelete="SET NULL"), nullable=True
    )

    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    team = relationship("GroupBuyTeam", back_populates="members")

    __table_args__ = (
        UniqueConstraint(
            "team_id", "teacher_id", name="uq_group_buy_members_team_teacher"
        ),
        Index("ix_group_buy_members_teacher", "teacher_id"),
        Index("ix_group_buy_members_team", "team_id"),
    )

    def __repr__(self):
        return (
            f"<GroupBuyMember(team={self.team_id}, teacher={self.teacher_id}, "
            f"owner={self.is_owner})>"
        )

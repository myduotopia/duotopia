"""Add group_buy_teams / group_buy_members tables + backfill (issue #862, 方案 B PR1)

團購脫離機構表：新增團購專屬 `group_buy_teams` / `group_buy_members`，並把既有
借用機構結構（Organization(group_buy) + School + TeacherOrganization(org_owner)
+ TeacherSchool）回填進新表。**本 migration 只建表 + 回填，不改動任何讀寫路徑**
（雙讀切換在 PR2）。

回填策略（冪等）：
  - teams：每個 org_type='group_buy' 的 organization → 一列 group_buy_teams，
    owner = 其 org_owner、plan/seat 取最早 active school、訂閱窗口/聯絡資訊取自 org。
    以 source_organization_id 去重（WHERE NOT EXISTS），可安全重跑。
  - members：team 來源 org 底下所有 active teacher_schools → group_buy_members，
    is_owner = (teacher = team.owner_teacher_id)。以 (team_id, teacher_id) 去重。

Idempotent：CREATE TABLE / CONSTRAINT / INDEX 皆 IF NOT EXISTS 或先檢查後建立；
回填 INSERT ... WHERE NOT EXISTS。遵守 CLAUDE.md Migration 鐵則。

本表為 JWT-auth 業務表，不使用 Supabase RLS（已加入 deploy-backend.yml 排除清單）。

Revision ID: 20260721_1000
Revises: 20260716_1000
Create Date: 2026-07-21
"""
from typing import Union

from alembic import op


revision: str = "20260721_1000"
down_revision: Union[str, None] = "20260716_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1) group_buy_teams（冪等建表）
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS group_buy_teams (
            id SERIAL PRIMARY KEY,
            owner_teacher_id INTEGER NOT NULL
                REFERENCES teachers (id) ON DELETE CASCADE,
            plan_id INTEGER NOT NULL REFERENCES plans (id),
            seat_limit INTEGER NOT NULL,
            subscription_start TIMESTAMPTZ,
            subscription_end TIMESTAMPTZ,
            contact_email VARCHAR(200),
            contact_phone VARCHAR(50),
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            source_organization_id UUID
                REFERENCES organizations (id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_group_buy_teams_owner "
        "ON group_buy_teams (owner_teacher_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_group_buy_teams_source_org "
        "ON group_buy_teams (source_organization_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_group_buy_teams_is_active "
        "ON group_buy_teams (is_active)"
    )

    # ------------------------------------------------------------------
    # 2) group_buy_members（冪等建表 + 唯一約束 + 索引）
    # ------------------------------------------------------------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS group_buy_members (
            id SERIAL PRIMARY KEY,
            team_id INTEGER NOT NULL
                REFERENCES group_buy_teams (id) ON DELETE CASCADE,
            teacher_id INTEGER NOT NULL
                REFERENCES teachers (id) ON DELETE CASCADE,
            is_owner BOOLEAN NOT NULL DEFAULT FALSE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            paused_period_id INTEGER
                REFERENCES subscription_periods (id) ON DELETE SET NULL,
            paused_remaining_seconds INTEGER,
            individual_auto_renew_suspended BOOLEAN NOT NULL DEFAULT FALSE,
            paused_at TIMESTAMPTZ,
            source_school_id UUID REFERENCES schools (id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ
        )
        """
    )
    # 唯一約束（pg_constraint 依 table OID 鎖定，避免同名 constraint 誤判）
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint c
                JOIN pg_class cls ON c.conrelid = cls.oid
                WHERE c.conname = 'uq_group_buy_members_team_teacher'
                  AND cls.relname = 'group_buy_members'
            ) THEN
                ALTER TABLE group_buy_members
                ADD CONSTRAINT uq_group_buy_members_team_teacher
                UNIQUE (team_id, teacher_id);
            END IF;
        END $$;
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_group_buy_members_teacher "
        "ON group_buy_members (teacher_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_group_buy_members_team "
        "ON group_buy_members (team_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_group_buy_members_is_active "
        "ON group_buy_members (is_active)"
    )

    # ------------------------------------------------------------------
    # 3) 回填 teams（每個 group_buy org → 一列，以 source_organization_id 去重）
    #    plan/seat 取最早 active school；owner 取最早 org_owner。
    #    seat_limit = org.teacher_limit（聚合值）優先，退回 school.teacher_seat_limit。
    # ------------------------------------------------------------------
    op.execute(
        """
        INSERT INTO group_buy_teams (
            owner_teacher_id, plan_id, seat_limit,
            subscription_start, subscription_end,
            contact_email, contact_phone, is_active,
            source_organization_id, created_at
        )
        SELECT
            towner.teacher_id,
            sch.plan_id,
            COALESCE(o.teacher_limit, sch.teacher_seat_limit),
            o.subscription_start_date,
            o.subscription_end_date,
            o.contact_email,
            o.contact_phone,
            o.is_active,
            o.id,
            now()
        FROM organizations o
        JOIN LATERAL (
            SELECT s.plan_id, s.teacher_seat_limit
            FROM schools s
            WHERE s.organization_id = o.id
              AND s.is_active = TRUE
              AND s.plan_id IS NOT NULL
            ORDER BY s.created_at ASC
            LIMIT 1
        ) sch ON TRUE
        JOIN LATERAL (
            SELECT t_o.teacher_id
            FROM teacher_organizations t_o
            WHERE t_o.organization_id = o.id
              AND t_o.role = 'org_owner'
              AND t_o.is_active = TRUE
            ORDER BY t_o.created_at ASC
            LIMIT 1
        ) towner ON TRUE
        WHERE o.org_type = 'group_buy'
          AND NOT EXISTS (
              SELECT 1 FROM group_buy_teams t
              WHERE t.source_organization_id = o.id
          );
        """
    )

    # ------------------------------------------------------------------
    # 4) 回填 members（team 來源 org 底下所有 active teacher_schools）
    #    DISTINCT ON 避免同一老師綁多校時違反 (team_id, teacher_id) 唯一約束。
    #    is_owner = (teacher = team.owner_teacher_id)。
    # ------------------------------------------------------------------
    op.execute(
        """
        INSERT INTO group_buy_members (
            team_id, teacher_id, is_owner, is_active, source_school_id, created_at
        )
        SELECT DISTINCT ON (t.id, ts.teacher_id)
            t.id,
            ts.teacher_id,
            (ts.teacher_id = t.owner_teacher_id),
            ts.is_active,
            ts.school_id,
            now()
        FROM group_buy_teams t
        JOIN organizations o ON o.id = t.source_organization_id
        JOIN schools s ON s.organization_id = o.id
        JOIN teacher_schools ts ON ts.school_id = s.id
        WHERE NOT EXISTS (
            SELECT 1 FROM group_buy_members m
            WHERE m.team_id = t.id AND m.teacher_id = ts.teacher_id
        )
        ORDER BY t.id, ts.teacher_id, ts.school_id;
        """
    )


def downgrade() -> None:
    # 破壞性操作對其他環境不安全，依專案慣例不在 downgrade 刪表。
    pass

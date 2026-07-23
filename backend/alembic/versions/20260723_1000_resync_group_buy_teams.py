"""Full re-sync of group_buy_teams / group_buy_members (issue #862 PR3)

expand/contract 的 read-switch 前置：PR1 回填是「PR1 部署當下」的快照，PR2 起才
對舊表寫入時同步鏡射新表。PR1 部署後、PR2 鏡射上線前那段時間內對舊表的變動
（新開團、加團員、續約延長、退團）**只寫了舊表**，新表對這些會漏更新或漏建。

本 migration 以「舊表當前狀態」對新表做一次全量 UPSERT，補平該間隙，讓 read-switch
（cron / subscription-status / validate-team-emails 改讀新表）拿到最新資料。欄位推導
與 PR1 回填、與 services.group_buy.sync_group_buy_team_from_org 一致。

Idempotent：INSERT ... ON CONFLICT DO UPDATE，可安全重跑（重跑只把值刷新為當前舊表
狀態）。遵守 CLAUDE.md Migration 鐵則（無 DROP/RENAME）。

Revision ID: 20260723_1000
Revises: 20260721_1000
Create Date: 2026-07-23
"""
from typing import Union

from alembic import op


revision: str = "20260723_1000"
down_revision: Union[str, None] = "20260721_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 0) 自癒：補建 teams 的部分唯一索引。
    #    PR1（20260721_1000）在 iterate 中把 ix_group_buy_teams_source_org（普通）
    #    改成 uq_group_buy_teams_source_org（部分唯一）——但那是「改一支已被套用過
    #    的 migration」。先前已套用該 revision 的環境不會重跑，於是缺 uq_ 索引，
    #    下方 ON CONFLICT 會報 "no unique or exclusion constraint matching"。
    #    這裡 IF NOT EXISTS 補上，讓所有環境一致（新環境 no-op）。
    # ------------------------------------------------------------------
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_group_buy_teams_source_org "
        "ON group_buy_teams (source_organization_id) "
        "WHERE source_organization_id IS NOT NULL"
    )

    # ------------------------------------------------------------------
    # 1) UPSERT teams：每個 group_buy org → 一列，衝突（同 source_organization_id）
    #    時把欄位刷新為舊表當前值。seat_limit 以 plan.teacher_seats 保底，皆 NULL
    #    才跳過（graceful，與 PR1 一致）。ON CONFLICT 目標為部分唯一索引，需帶述詞。
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
            COALESCE(o.teacher_limit, sch.teacher_seat_limit, sch.teacher_seats),
            o.subscription_start_date,
            o.subscription_end_date,
            o.contact_email,
            o.contact_phone,
            o.is_active,
            o.id,
            now()
        FROM organizations o
        JOIN LATERAL (
            SELECT s.plan_id, s.teacher_seat_limit, p.teacher_seats
            FROM schools s
            JOIN plans p ON p.id = s.plan_id
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
          AND COALESCE(o.teacher_limit, sch.teacher_seat_limit, sch.teacher_seats)
              IS NOT NULL
        ON CONFLICT (source_organization_id) WHERE source_organization_id IS NOT NULL
        DO UPDATE SET
            owner_teacher_id = EXCLUDED.owner_teacher_id,
            plan_id = EXCLUDED.plan_id,
            seat_limit = EXCLUDED.seat_limit,
            subscription_start = EXCLUDED.subscription_start,
            subscription_end = EXCLUDED.subscription_end,
            contact_email = EXCLUDED.contact_email,
            contact_phone = EXCLUDED.contact_phone,
            is_active = EXCLUDED.is_active,
            updated_at = now();
        """
    )

    # ------------------------------------------------------------------
    # 2) UPSERT members：team 來源 org 底下 active school 的 teacher_schools。
    #    DISTINCT ON 保證每 (team, teacher) 一列（避免 ON CONFLICT 同列改兩次）。
    #    衝突時刷新 is_owner/is_active/source_school_id 為當前舊表值。
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
        JOIN schools s ON s.organization_id = o.id AND s.is_active = TRUE
        JOIN teacher_schools ts ON ts.school_id = s.id
        ORDER BY t.id, ts.teacher_id, ts.is_active DESC, ts.school_id
        ON CONFLICT (team_id, teacher_id)
        DO UPDATE SET
            is_owner = EXCLUDED.is_owner,
            is_active = EXCLUDED.is_active,
            source_school_id = EXCLUDED.source_school_id,
            updated_at = now();
        """
    )


def downgrade() -> None:
    # 純資料 re-sync，無結構變更；不提供破壞性 downgrade（依專案慣例）。
    pass

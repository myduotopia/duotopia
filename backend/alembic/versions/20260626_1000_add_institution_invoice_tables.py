"""Add institution billing invoice tables (issue #838 data layer)

Revision ID: 20260626_1000
Revises: 20260624_1000
Create Date: 2026-06-26 10:00:00

Creates the two tables backing the manual 請款 / 收款 workflow that follows
the read-only monthly billing query from issue #768:

  - institution_invoices        — accounts-receivable ledger, one row per
    (organization, year, month). UNIQUE(organization_id, year, month) is the
    idempotency anchor for the Phase D upsert endpoint.
  - institution_invoice_emails  — append-only 請款 email audit trail (no
    unique key: repeat sends must append, never overwrite).

Idempotent (per專案 migration 鐵則):
  - CREATE TABLE IF NOT EXISTS — constraints + PK declared inline so they are
    created atomically with the (brand-new) table; re-running is a no-op.
  - CREATE INDEX IF NOT EXISTS for every index.
  - updated_at trigger uses CREATE OR REPLACE FUNCTION + DROP TRIGGER IF
    EXISTS before CREATE TRIGGER (mirrors 20260518_1000), so re-running is
    safe and raw-SQL UPDATEs (e.g. the Phase D overdue cron) refresh
    updated_at without relying on the ORM onupdate hook.
  - No DROP / RENAME / ALTER TYPE on existing tables; FKs reference existing
    organizations(id) (UUID) and teachers(id) (INTEGER).
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260626_1000"
down_revision: Union[str, None] = "20260624_1000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- institution_invoices (accounts-receivable ledger) --------------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS institution_invoices (
            id SERIAL PRIMARY KEY,
            organization_id UUID NOT NULL
                REFERENCES organizations(id) ON DELETE CASCADE,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            due_date DATE,
            paid_at TIMESTAMP WITH TIME ZONE,
            paid_by_admin_id INTEGER
                REFERENCES teachers(id) ON DELETE SET NULL,
            payment_note TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_institution_invoices_org_year_month
                UNIQUE (organization_id, year, month),
            CONSTRAINT ck_institution_invoices_status_valid
                CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
            CONSTRAINT ck_institution_invoices_month_valid
                CHECK (month BETWEEN 1 AND 12),
            CONSTRAINT ck_institution_invoices_year_valid
                CHECK (year BETWEEN 2000 AND 2099),
            CONSTRAINT ck_institution_invoices_amount_nonneg
                CHECK (amount >= 0)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_institution_invoices_status "
        "ON institution_invoices (status);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_institution_invoices_org "
        "ON institution_invoices (organization_id);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_institution_invoices_due_date "
        "ON institution_invoices (due_date);"
    )

    # DB-level trigger to refresh updated_at on every UPDATE, including
    # raw-SQL writes that bypass SQLAlchemy's ORM-only onupdate=func.now()
    # — notably the Phase D overdue cron that bulk-UPDATEs status. Function
    # uses CREATE OR REPLACE; trigger is dropped + re-created so the
    # migration stays idempotent (mirrors 20260518_1000).
    op.execute(
        """
        CREATE OR REPLACE FUNCTION set_institution_invoices_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = now();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_institution_invoices_updated_at "
        "ON institution_invoices"
    )
    op.execute(
        """
        CREATE TRIGGER trg_institution_invoices_updated_at
        BEFORE UPDATE ON institution_invoices
        FOR EACH ROW
        EXECUTE FUNCTION set_institution_invoices_updated_at();
        """
    )

    # ---- institution_invoice_emails (append-only audit trail) -----------
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS institution_invoice_emails (
            id SERIAL PRIMARY KEY,
            organization_id UUID NOT NULL
                REFERENCES organizations(id) ON DELETE CASCADE,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            recipient VARCHAR(200) NOT NULL,
            cc JSONB,
            sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            sent_by_admin_id INTEGER
                REFERENCES teachers(id) ON DELETE SET NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT ck_institution_invoice_emails_month_valid
                CHECK (month BETWEEN 1 AND 12),
            CONSTRAINT ck_institution_invoice_emails_year_valid
                CHECK (year BETWEEN 2000 AND 2099)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_institution_invoice_emails_lookup "
        "ON institution_invoice_emails (organization_id, year, month);"
    )


def downgrade() -> None:
    # Both tables are brand-new in this revision and hold no pre-existing
    # business data, so dropping them (and the trigger/function) on
    # downgrade is safe.
    op.execute(
        "DROP TRIGGER IF EXISTS trg_institution_invoices_updated_at "
        "ON institution_invoices"
    )
    op.execute("DROP FUNCTION IF EXISTS set_institution_invoices_updated_at();")
    op.execute("DROP TABLE IF EXISTS institution_invoice_emails;")
    op.execute("DROP TABLE IF EXISTS institution_invoices;")

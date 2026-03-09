"""Add oauth_identities table and teachers.has_password column

Revision ID: 20260306_1200
Revises: 20260303_1000
Create Date: 2026-03-06 12:00:00.000000

SSO foundation: oauth_identities table for linking external OAuth providers
(Google, LINE, 1campus, iSchool) to teacher accounts, and has_password flag
for OAuth-only accounts.

Related: #241
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "20260306_1200"
down_revision = "20260303_1000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create oauth_identities table
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS oauth_identities (
            id SERIAL PRIMARY KEY,
            teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
            provider VARCHAR(50) NOT NULL,
            provider_user_id VARCHAR(255) NOT NULL,
            provider_email VARCHAR(255),
            display_name VARCHAR(255),
            avatar_url TEXT,
            access_token TEXT,
            refresh_token TEXT,
            token_expires_at TIMESTAMP WITH TIME ZONE,
            raw_profile JSONB DEFAULT '{}',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
        """
    )

    # 2. Add unique constraints (idempotent)
    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_oauth_provider_user') THEN
                ALTER TABLE oauth_identities
                    ADD CONSTRAINT uq_oauth_provider_user UNIQUE (provider, provider_user_id);
            END IF;
        END $$;
        """
    )

    op.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_oauth_teacher_provider') THEN
                ALTER TABLE oauth_identities
                    ADD CONSTRAINT uq_oauth_teacher_provider UNIQUE (teacher_id, provider);
            END IF;
        END $$;
        """
    )

    # 3. Add indexes (idempotent)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_oauth_identity_teacher ON oauth_identities(teacher_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_oauth_identity_lookup ON oauth_identities(provider, provider_user_id)"
    )

    # 4. Add has_password column to teachers (idempotent)
    op.execute(
        "ALTER TABLE teachers ADD COLUMN IF NOT EXISTS has_password BOOLEAN DEFAULT TRUE"
    )

    # 5. Backfill existing accounts
    op.execute("UPDATE teachers SET has_password = TRUE WHERE has_password IS NULL")


def downgrade() -> None:
    pass

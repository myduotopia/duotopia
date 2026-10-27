"""
#1112 C2 migration 靜態檢查：冪等寫法（CLAUDE.md Migration 鐵則）與 downgrade 可還原。

CI 的測試 DB 是 SQLite（Postgres 的 DO $$ 區塊跑不了），所以用讀檔檢查寫法。
"""

import pathlib
import re

import pytest

pytestmark = [pytest.mark.unit, pytest.mark.no_db]

VERSIONS = pathlib.Path(__file__).resolve().parents[2] / "alembic" / "versions"
MIGRATION = VERSIONS / "20261027_1000_add_exam_imports.py"
NEW_TABLES = ("exam_imports", "exam_import_pages", "exam_import_usage")


@pytest.fixture(scope="module")
def source() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _split(source: str):
    up = source.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    down = source.split("def downgrade()", 1)[1]
    return up, down


def test_revision_chain(source):
    assert 'revision: str = "20261027_1000"' in source
    assert 'down_revision: Union[str, None] = "20261016_1100"' in source
    # 沒有別的 migration 也接在 20261016_1100 後面（避免多個 head）
    others = [
        p.name
        for p in VERSIONS.glob("*.py")
        if p != MIGRATION
        and re.search(
            r'down_revision[^=]*=\s*"20261016_1100"', p.read_text(encoding="utf-8")
        )
    ]
    assert others == []


def test_upgrade_is_idempotent(source):
    up, _ = _split(source)
    for table in NEW_TABLES:
        assert f"CREATE TABLE IF NOT EXISTS {table}" in up
    assert "CREATE INDEX IF NOT EXISTS" in up
    assert "CREATE INDEX " not in up.replace("CREATE INDEX IF NOT EXISTS", "")
    # 新欄位：information_schema 守衛且限定 public schema
    assert "table_schema = 'public'" in up
    assert "column_name = 'source_question_no'" in up
    # constraint：一律經 _add_constraint（pg_constraint 以 table 鎖定）
    assert "JOIN pg_class cls ON c.conrelid = cls.oid" in source
    assert "cls.relname = '{table}'" in source
    assert "ADD CONSTRAINT" not in up
    assert up.count("_add_constraint(") >= 4


def test_upgrade_has_no_destructive_or_raw_alembic_ops(source):
    up, _ = _split(source)
    for forbidden in (
        "DROP ",
        "RENAME",
        "ALTER TYPE",
        "op.create_table",
        "op.add_column",
        "op.create_index",
        "op.drop_",
    ):
        assert forbidden not in up, forbidden


def test_downgrade_really_reverts(source):
    _, down = _split(source)
    for table in NEW_TABLES:
        assert f"DROP TABLE IF EXISTS {table}" in down
    # 子表先刪
    assert down.index("exam_import_usage") < down.index(
        "DROP TABLE IF EXISTS exam_imports"
    )
    assert down.index("exam_import_pages") < down.index(
        "DROP TABLE IF EXISTS exam_imports"
    )
    assert "DROP COLUMN source_question_no" in down
    assert "IF EXISTS" in down


def test_new_tables_are_in_rls_exclusion_list():
    workflow = (
        pathlib.Path(__file__).resolve().parents[3]
        / ".github"
        / "workflows"
        / "deploy-backend.yml"
    ).read_text(encoding="utf-8")
    for table in NEW_TABLES:
        assert f"'{table}'" in workflow

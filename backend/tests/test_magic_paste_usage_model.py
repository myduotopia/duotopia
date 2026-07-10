"""
PR 1 (issue #891) — 魔術貼上「每月配額計數」資料層測試。

只證明 magic_paste_usage 這張表的 schema、預設值與唯一約束。
擷取 / 配額扣點 / API 行為留待後續 PR。
"""

import pytest
from sqlalchemy.exc import IntegrityError

from models import Teacher, MagicPasteUsage


def _make_teacher(db, email):
    teacher = Teacher(name="T", email=email, password_hash="x")
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return teacher


def test_defaults(test_db_session):
    """新建列 count 預設為 0。"""
    teacher = _make_teacher(test_db_session, "mp-defaults@test.com")
    row = MagicPasteUsage(teacher_id=teacher.id, year_month="2026-07")
    test_db_session.add(row)
    test_db_session.commit()
    test_db_session.refresh(row)

    assert row.count == 0
    assert row.id is not None
    assert row.year_month == "2026-07"


def test_unique_teacher_year_month(test_db_session):
    """同一老師同一個月只能有一列（UNIQUE 約束）。"""
    teacher = _make_teacher(test_db_session, "mp-unique@test.com")
    test_db_session.add(
        MagicPasteUsage(teacher_id=teacher.id, year_month="2026-07", count=3)
    )
    test_db_session.commit()

    test_db_session.add(
        MagicPasteUsage(teacher_id=teacher.id, year_month="2026-07", count=1)
    )
    with pytest.raises(IntegrityError):
        test_db_session.commit()
    test_db_session.rollback()


def test_same_teacher_different_months_allowed(test_db_session):
    """同一老師不同月份可各有一列。"""
    teacher = _make_teacher(test_db_session, "mp-months@test.com")
    test_db_session.add_all(
        [
            MagicPasteUsage(teacher_id=teacher.id, year_month="2026-07", count=5),
            MagicPasteUsage(teacher_id=teacher.id, year_month="2026-08", count=0),
        ]
    )
    test_db_session.commit()

    rows = (
        test_db_session.query(MagicPasteUsage)
        .filter(MagicPasteUsage.teacher_id == teacher.id)
        .all()
    )
    assert len(rows) == 2


def test_different_teachers_same_month_allowed(test_db_session):
    """不同老師同月份互不衝突。"""
    t1 = _make_teacher(test_db_session, "mp-t1@test.com")
    t2 = _make_teacher(test_db_session, "mp-t2@test.com")
    test_db_session.add_all(
        [
            MagicPasteUsage(teacher_id=t1.id, year_month="2026-07"),
            MagicPasteUsage(teacher_id=t2.id, year_month="2026-07"),
        ]
    )
    test_db_session.commit()

    rows = (
        test_db_session.query(MagicPasteUsage)
        .filter(MagicPasteUsage.year_month == "2026-07")
        .all()
    )
    assert len(rows) == 2

"""
魔術貼上每月配額服務測試（issue #891, PR 2）。

涵蓋：免費額度耗用、跨月重置、超額扣點、點數不足擋下。
"""

from datetime import datetime, timezone, timedelta

import pytest
from fastapi import HTTPException

from models import Teacher, CreditPackage
from services import magic_paste_quota as mpq


def _make_teacher(db, email="mpq@test.com"):
    t = Teacher(name="T", email=email, password_hash="x")
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _grant_points(db, teacher, points=100):
    """給老師一個有效點數包（用於超額扣點測試）。"""
    now = datetime.now(timezone.utc)
    pkg = CreditPackage(
        teacher_id=teacher.id,
        package_id="pkg-test",
        points_total=points,
        points_used=0,
        price_paid=0,
        purchased_at=now,
        expires_at=now + timedelta(days=365),
        status="active",
        source="admin_grant",
    )
    db.add(pkg)
    db.commit()
    return pkg


def test_free_quota_five_uses(test_db_session):
    """前 5 次都是免費，free_remaining 從 4 遞減到 0。"""
    db = test_db_session
    teacher = _make_teacher(db, "free5@test.com")

    for expected_used in range(1, mpq.FREE_MONTHLY_LIMIT + 1):
        result = mpq.consume(db, teacher, year_month="2026-07")
        assert result["charged"] == "free"
        assert result["points_used"] == 0
        assert result["free_used"] == expected_used
        assert result["free_remaining"] == mpq.FREE_MONTHLY_LIMIT - expected_used


def test_over_limit_without_points_blocked(test_db_session):
    """免費額度用完、又沒有點數 → 第 6 次丟 402。"""
    db = test_db_session
    teacher = _make_teacher(db, "block@test.com")

    for _ in range(mpq.FREE_MONTHLY_LIMIT):
        mpq.consume(db, teacher, year_month="2026-07")

    with pytest.raises(HTTPException) as exc:
        mpq.consume(db, teacher, year_month="2026-07")
    assert exc.value.status_code == 402


def test_over_limit_with_points_charged(test_db_session):
    """免費額度用完但有點數 → 第 6 次扣點數。"""
    db = test_db_session
    teacher = _make_teacher(db, "paid@test.com")
    _grant_points(db, teacher, points=100)

    for _ in range(mpq.FREE_MONTHLY_LIMIT):
        mpq.consume(db, teacher, year_month="2026-07")

    result = mpq.consume(db, teacher, year_month="2026-07")
    assert result["charged"] == "points"
    assert result["points_used"] == mpq.POINTS_PER_IMAGE
    assert result["free_remaining"] == 0


def test_monthly_reset(test_db_session):
    """不同月份免費額度各自獨立（跨月重置）。"""
    db = test_db_session
    teacher = _make_teacher(db, "reset@test.com")

    for _ in range(mpq.FREE_MONTHLY_LIMIT):
        mpq.consume(db, teacher, year_month="2026-07")
    # 7 月已用完
    status_jul = mpq.get_quota_status(db, teacher, year_month="2026-07")
    assert status_jul["free_remaining"] == 0

    # 8 月重新有免費額度
    status_aug = mpq.get_quota_status(db, teacher, year_month="2026-08")
    assert status_aug["free_remaining"] == mpq.FREE_MONTHLY_LIMIT
    result = mpq.consume(db, teacher, year_month="2026-08")
    assert result["charged"] == "free"
    assert result["free_remaining"] == mpq.FREE_MONTHLY_LIMIT - 1


def test_quota_status_can_use_flags(test_db_session):
    """can_use：有免費額度時 True；用完且無點數時 False。"""
    db = test_db_session
    teacher = _make_teacher(db, "canuse@test.com")

    status = mpq.get_quota_status(db, teacher, year_month="2026-07")
    assert status["free_remaining"] == mpq.FREE_MONTHLY_LIMIT
    assert status["can_use"] is True

    for _ in range(mpq.FREE_MONTHLY_LIMIT):
        mpq.consume(db, teacher, year_month="2026-07")

    status = mpq.get_quota_status(db, teacher, year_month="2026-07")
    assert status["free_remaining"] == 0
    assert status["can_use"] is False

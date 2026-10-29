"""情境對話 AI 生圖計費 — Issue #1158。

驗的是 ``services/scenario_image_billing`` 的產品規則（使用者 2026-10-28／29 定案）：

* admin 不限張數
* 機構老師扣機構點數；機構點數不足改用個人方案；個人方案也沒有就擋下
* 訂閱制每月 60 張，用完後照現有順序扣點（訂閱週期配額 → 點數包）
* 點數制每次依實際 token 扣點（130 token = 1 點，無條件進位）
* 未付費且非機構每天 3 張（台灣時區），用完就擋、不扣試用點數
"""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from models import CreditPackage, Teacher
from models.organization import Organization, TeacherOrganization
from models.subscription import SubscriptionPeriod
from services import scenario_image_billing as sib


# ---------------------------------------------------------------- 建資料


def _teacher(db, email, is_admin=False):
    t = Teacher(name="T", email=email, password_hash="x", is_admin=is_admin)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _package(db, teacher, points=1000, used=0, source="purchase"):
    now = datetime.now(timezone.utc)
    pkg = CreditPackage(
        teacher_id=teacher.id,
        package_id=f"pkg-{source}",
        points_total=points,
        points_used=used,
        price_paid=0,
        purchased_at=now,
        expires_at=now + timedelta(days=365),
        status="active",
        source=source,
    )
    db.add(pkg)
    db.commit()
    return pkg


def _subscribe(db, teacher, quota_total=2000, quota_used=0):
    now = datetime.now(timezone.utc)
    period = SubscriptionPeriod(
        teacher_id=teacher.id,
        plan_name="Tutor Teachers",
        amount_paid=299,
        quota_total=quota_total,
        quota_used=quota_used,
        start_date=now - timedelta(days=1),
        end_date=now + timedelta(days=29),
        payment_method="manual",
        payment_status="paid",
        status="active",
    )
    db.add(period)
    db.commit()
    db.refresh(teacher)
    return period


def _org(db, teacher, total=1000, used=0, active=True, member_active=True):
    org = Organization(name=f"Org-{total}-{used}", is_active=active)
    org.total_points = total
    org.used_points = used
    db.add(org)
    db.commit()
    db.refresh(org)
    db.add(
        TeacherOrganization(
            teacher_id=teacher.id,
            organization_id=org.id,
            role="teacher",
            is_active=member_active,
        )
    )
    db.commit()
    return org


# ---------------------------------------------------------------- token → 點數


class TestPointsForTokens:
    @pytest.mark.parametrize(
        "tokens,points",
        [(1, 1), (129, 1), (130, 1), (131, 2), (1120, 9), (1300, 10), (1301, 11)],
    )
    def test_rounds_up(self, tokens, points):
        assert sib.points_for_tokens(tokens) == points

    def test_missing_tokens_falls_back_to_estimate(self):
        """讀不到 token 時不能算 0 點（否則 usage_metadata 格式一變就變免費生圖）。"""
        assert sib.points_for_tokens(0) == sib.POINTS_PER_IMAGE_ESTIMATE
        assert sib.points_for_tokens(None) == sib.POINTS_PER_IMAGE_ESTIMATE

    def test_rate_is_a_single_constant(self, monkeypatch):
        monkeypatch.setattr(sib, "TOKENS_PER_POINT", 100)
        assert sib.points_for_tokens(1120) == 12


# ---------------------------------------------------------------- 身分判斷


class TestResolveBilling:
    def test_admin(self, test_db_session):
        t = _teacher(test_db_session, "admin@img.com", is_admin=True)
        assert sib.resolve_billing(test_db_session, t)["billing"] == "admin"

    def test_unpaid_is_free_daily(self, test_db_session):
        t = _teacher(test_db_session, "free@img.com")
        assert sib.resolve_billing(test_db_session, t)["billing"] == "free_daily"

    def test_trial_bonus_only_is_still_free_daily(self, test_db_session):
        """只有試用贈點的老師算「未付費」—— 每天 3 張，不扣試用點數。"""
        t = _teacher(test_db_session, "trial@img.com")
        _package(test_db_session, t, source="trial_bonus")
        assert sib.resolve_billing(test_db_session, t)["billing"] == "free_daily"

    def test_paid_package_is_points(self, test_db_session):
        t = _teacher(test_db_session, "points@img.com")
        _package(test_db_session, t, source="purchase")
        assert sib.resolve_billing(test_db_session, t)["billing"] == "points"

    def test_subscribed(self, test_db_session):
        t = _teacher(test_db_session, "sub@img.com")
        _subscribe(test_db_session, t)
        assert sib.resolve_billing(test_db_session, t)["billing"] == "subscription"

    def test_org_with_points(self, test_db_session):
        t = _teacher(test_db_session, "org@img.com")
        org = _org(test_db_session, t, total=1000)
        resolved = sib.resolve_billing(test_db_session, t)
        assert resolved["billing"] == "org"
        assert resolved["organization"].id == org.id

    def test_inactive_org_is_ignored(self, test_db_session):
        t = _teacher(test_db_session, "orgoff@img.com")
        _org(test_db_session, t, total=1000, active=False)
        assert sib.resolve_billing(test_db_session, t)["billing"] == "free_daily"

    def test_org_out_of_points_falls_back_to_subscription(self, test_db_session):
        t = _teacher(test_db_session, "orgsub@img.com")
        _org(test_db_session, t, total=100, used=95)
        _subscribe(test_db_session, t)
        assert sib.resolve_billing(test_db_session, t)["billing"] == "subscription"

    def test_org_out_of_points_without_personal_plan_is_blocked(self, test_db_session):
        """機構老師不會掉到「每天 3 張」—— 那是給非機構老師的。"""
        t = _teacher(test_db_session, "orgnone@img.com")
        _org(test_db_session, t, total=100, used=100)
        resolved = sib.resolve_billing(test_db_session, t)
        assert resolved["billing"] == "org"
        assert resolved["organization"] is None

    def test_first_org_with_points_wins(self, test_db_session):
        t = _teacher(test_db_session, "orgs@img.com")
        _org(test_db_session, t, total=100, used=100)
        second = _org(test_db_session, t, total=500)
        assert sib.resolve_billing(test_db_session, t)["organization"].id == second.id


# ---------------------------------------------------------------- 各身分的扣法


class TestAdmin:
    def test_unlimited_and_no_charge(self, test_db_session):
        t = _teacher(test_db_session, "admin2@img.com", is_admin=True)
        for _ in range(sib.FREE_DAILY_LIMIT + 5):
            charge = sib.reserve(test_db_session, t)
            assert sib.settle(test_db_session, t, charge, 1120)["points_used"] == 0
        status = sib.get_status(test_db_session, t)
        assert status["billing"] == "admin"
        assert status["remaining"] is None
        assert status["can_generate"] is True


class TestFreeDaily:
    def test_three_per_day_then_blocked(self, test_db_session, monkeypatch):
        t = _teacher(test_db_session, "daily@img.com")
        monkeypatch.setattr(sib, "current_taipei_date", lambda: "2026-10-29")

        for _ in range(sib.FREE_DAILY_LIMIT):
            charge = sib.reserve(test_db_session, t)
            assert charge.usage_key == "2026-10-29"
            assert sib.settle(test_db_session, t, charge, 1120)["points_used"] == 0

        with pytest.raises(HTTPException) as exc:
            sib.reserve(test_db_session, t)
        assert exc.value.status_code == 402
        assert exc.value.detail["error"] == sib.QUOTA_EXCEEDED_ERROR

    def test_does_not_touch_trial_points(self, test_db_session, monkeypatch):
        t = _teacher(test_db_session, "dailytrial@img.com")
        pkg = _package(test_db_session, t, points=2000, source="trial_bonus")
        monkeypatch.setattr(sib, "current_taipei_date", lambda: "2026-10-29")

        charge = sib.reserve(test_db_session, t)
        sib.settle(test_db_session, t, charge, 1120)

        test_db_session.refresh(pkg)
        assert pkg.points_used == 0

    def test_resets_next_taipei_day(self, test_db_session, monkeypatch):
        t = _teacher(test_db_session, "dailyreset@img.com")
        monkeypatch.setattr(sib, "current_taipei_date", lambda: "2026-10-29")
        for _ in range(sib.FREE_DAILY_LIMIT):
            sib.reserve(test_db_session, t)

        monkeypatch.setattr(sib, "current_taipei_date", lambda: "2026-10-30")
        assert sib.reserve(test_db_session, t).usage_key == "2026-10-30"

    def test_taipei_date_differs_from_utc_before_8am(self, monkeypatch):
        """UTC 10/28 20:00 = 台灣 10/29 04:00：日計數要算在 10/29。"""
        from services import monthly_usage_quota as muq

        class FakeDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                base = datetime(2026, 10, 28, 20, 0, tzinfo=timezone.utc)
                return base.astimezone(tz) if tz else base

        monkeypatch.setattr(muq, "datetime", FakeDatetime)
        assert muq.current_taipei_date() == "2026-10-29"
        assert muq.current_year_month() == "2026-10"

    def test_release_refunds_the_reserved_day(self, test_db_session, monkeypatch):
        """跨午夜時要退回「當初佔的那一天」。"""
        t = _teacher(test_db_session, "dailyrefund@img.com")
        monkeypatch.setattr(sib, "current_taipei_date", lambda: "2026-10-29")
        charge = sib.reserve(test_db_session, t)

        monkeypatch.setattr(sib, "current_taipei_date", lambda: "2026-10-30")
        sib.release(test_db_session, t, charge)

        assert (
            sib._daily.get_quota_status(test_db_session, t, "2026-10-29")["used"] == 0
        )
        assert (
            sib._daily.get_quota_status(test_db_session, t, "2026-10-30")["used"] == 0
        )

    def test_status(self, test_db_session, monkeypatch):
        t = _teacher(test_db_session, "dailystatus@img.com")
        monkeypatch.setattr(sib, "current_taipei_date", lambda: "2026-10-29")
        sib.reserve(test_db_session, t)
        status = sib.get_status(test_db_session, t)
        assert status == {
            "billing": "free_daily",
            "remaining": sib.FREE_DAILY_LIMIT - 1,
            "limit": sib.FREE_DAILY_LIMIT,
            "period": "day",
            "points_per_image_estimate": sib.POINTS_PER_IMAGE_ESTIMATE,
            "can_generate": True,
        }

    def test_daily_and_monthly_keys_do_not_collide(self, test_db_session, monkeypatch):
        """同一張表存 'YYYY-MM' 與 'YYYY-MM-DD'，各自計數。"""
        t = _teacher(test_db_session, "keys@img.com")
        sib._monthly.consume(test_db_session, t, "2026-10")
        sib._daily.consume(test_db_session, t, "2026-10-29")
        sib._daily.consume(test_db_session, t, "2026-10-29")
        assert sib._monthly.get_quota_status(test_db_session, t, "2026-10")["used"] == 1
        assert (
            sib._daily.get_quota_status(test_db_session, t, "2026-10-29")["used"] == 2
        )


class TestSubscription:
    def test_first_sixty_are_free(self, test_db_session, monkeypatch):
        t = _teacher(test_db_session, "sub60@img.com")
        period = _subscribe(test_db_session, t, quota_total=2000)
        monkeypatch.setattr(sib, "SUBSCRIPTION_MONTHLY_LIMIT", 2)
        monkeypatch.setattr(sib, "current_year_month", lambda: "2026-10")

        for _ in range(2):
            charge = sib.reserve(test_db_session, t)
            assert charge.usage_key == "2026-10"
            assert sib.settle(test_db_session, t, charge, 1120)["points_used"] == 0

        test_db_session.refresh(period)
        assert period.quota_used == 0

    def test_after_limit_deducts_points_in_existing_order(
        self, test_db_session, monkeypatch
    ):
        """60 張用完後照現有順序扣：先訂閱週期配額，再點數包。"""
        t = _teacher(test_db_session, "subover@img.com")
        period = _subscribe(test_db_session, t, quota_total=2000)
        pkg = _package(test_db_session, t, points=500, source="purchase")
        monkeypatch.setattr(sib, "SUBSCRIPTION_MONTHLY_LIMIT", 1)
        monkeypatch.setattr(sib, "current_year_month", lambda: "2026-10")

        sib.reserve(test_db_session, t)  # 免費那張
        charge = sib.reserve(test_db_session, t)
        assert charge.pay_points is True
        assert charge.usage_key is None
        result = sib.settle(test_db_session, t, charge, 1120)
        assert result["points_used"] == 9

        test_db_session.refresh(period)
        test_db_session.refresh(pkg)
        assert period.quota_used == 9
        assert pkg.points_used == 0

    def test_after_limit_without_points_is_blocked(self, test_db_session, monkeypatch):
        t = _teacher(test_db_session, "subnone@img.com")
        _subscribe(test_db_session, t, quota_total=2000, quota_used=2000)
        monkeypatch.setattr(sib, "SUBSCRIPTION_MONTHLY_LIMIT", 1)
        monkeypatch.setattr(sib, "current_year_month", lambda: "2026-10")

        sib.reserve(test_db_session, t)
        with pytest.raises(HTTPException) as exc:
            sib.reserve(test_db_session, t)
        assert exc.value.status_code == 402

    def test_month_boundary_resets(self, test_db_session, monkeypatch):
        t = _teacher(test_db_session, "submonth@img.com")
        _subscribe(test_db_session, t, quota_total=0)
        monkeypatch.setattr(sib, "SUBSCRIPTION_MONTHLY_LIMIT", 1)
        monkeypatch.setattr(sib, "current_year_month", lambda: "2026-10")
        sib.reserve(test_db_session, t)

        monkeypatch.setattr(sib, "current_year_month", lambda: "2026-11")
        assert sib.reserve(test_db_session, t).usage_key == "2026-11"

    def test_status(self, test_db_session, monkeypatch):
        t = _teacher(test_db_session, "substatus@img.com")
        _subscribe(test_db_session, t)
        monkeypatch.setattr(sib, "current_year_month", lambda: "2026-10")
        sib.reserve(test_db_session, t)
        status = sib.get_status(test_db_session, t)
        assert status["billing"] == "subscription"
        assert status["period"] == "month"
        assert status["limit"] == sib.SUBSCRIPTION_MONTHLY_LIMIT
        assert status["remaining"] == sib.SUBSCRIPTION_MONTHLY_LIMIT - 1


class TestPoints:
    def test_deducts_by_actual_tokens(self, test_db_session):
        t = _teacher(test_db_session, "pts@img.com")
        pkg = _package(test_db_session, t, points=1000)

        charge = sib.reserve(test_db_session, t)
        result = sib.settle(test_db_session, t, charge, 1301)
        assert result["points_used"] == 11

        test_db_session.refresh(pkg)
        assert pkg.points_used == 11

    def test_needs_estimate_before_generating(self, test_db_session):
        """餘額不到一張的預估點數 → 生圖前就擋，不浪費一次呼叫。"""
        t = _teacher(test_db_session, "ptslow@img.com")
        _package(test_db_session, t, points=100, used=95)
        with pytest.raises(HTTPException) as exc:
            sib.reserve(test_db_session, t)
        assert exc.value.status_code == 402

    def test_release_does_not_touch_points(self, test_db_session):
        """生圖失敗不扣點（點數只在 settle 才扣），所以也沒有退點這件事。"""
        t = _teacher(test_db_session, "ptsfail@img.com")
        pkg = _package(test_db_session, t, points=1000)
        charge = sib.reserve(test_db_session, t)
        sib.release(test_db_session, t, charge)
        test_db_session.refresh(pkg)
        assert pkg.points_used == 0

    def test_status(self, test_db_session):
        t = _teacher(test_db_session, "ptsstatus@img.com")
        _package(test_db_session, t, points=1000)
        status = sib.get_status(test_db_session, t)
        assert status["billing"] == "points"
        assert status["remaining"] is None
        assert status["period"] is None
        assert status["can_generate"] is True


class TestOrg:
    def test_deducts_org_points(self, test_db_session):
        t = _teacher(test_db_session, "orgpay@img.com")
        org = _org(test_db_session, t, total=1000)
        pkg = _package(test_db_session, t, points=1000)

        charge = sib.reserve(test_db_session, t)
        assert charge.organization_id == org.id
        assert sib.settle(test_db_session, t, charge, 1120)["points_used"] == 9

        test_db_session.refresh(org)
        test_db_session.refresh(pkg)
        assert org.used_points == 9
        assert pkg.points_used == 0  # 個人點數不動

    def test_org_short_falls_back_to_personal_points(self, test_db_session):
        t = _teacher(test_db_session, "orgfall@img.com")
        org = _org(test_db_session, t, total=100, used=95)
        pkg = _package(test_db_session, t, points=1000)

        charge = sib.reserve(test_db_session, t)
        assert charge.billing == "points"
        sib.settle(test_db_session, t, charge, 1120)

        test_db_session.refresh(org)
        test_db_session.refresh(pkg)
        assert org.used_points == 95
        assert pkg.points_used == 9

    def test_org_and_personal_both_short_is_blocked(self, test_db_session):
        t = _teacher(test_db_session, "orgblock@img.com")
        _org(test_db_session, t, total=100, used=100)
        with pytest.raises(HTTPException) as exc:
            sib.reserve(test_db_session, t)
        assert exc.value.status_code == 402
        assert sib.get_status(test_db_session, t)["can_generate"] is False


class TestSettleFailureDoesNotBreakDelivery:
    def test_deduct_failure_is_swallowed(self, test_db_session, monkeypatch):
        """圖已經交出去了，扣點失敗只記 log，不回錯誤（否則老師會再按一次、真的再花一次錢）。"""
        t = _teacher(test_db_session, "settlefail@img.com")
        _package(test_db_session, t, points=1000)
        charge = sib.reserve(test_db_session, t)

        def boom(**kwargs):
            raise HTTPException(status_code=402, detail="over")

        monkeypatch.setattr(sib.QuotaService, "deduct_quota", staticmethod(boom))
        result = sib.settle(test_db_session, t, charge, 1120)
        assert result["points_used"] == 0

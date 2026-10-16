"""情境對話文字 AI 的每月配額 — Issue #1025。

#1021 把產題／情境文章／PDF 擷取接成真的 AI 呼叫但刻意不擋，這張單補上限制。

這個檔案守的是**配額機制本身**（保留／退還／並發／跨月），端點整合在
`test_scenario_text_quota_endpoints.py`。Vertex 一律 mock。
"""
import pytest

from models import ScenarioTextUsage, Teacher
from services import scenario_text_quota as stq
from services.monthly_usage_quota import MonthlyUsageQuota


@pytest.fixture
def teacher(db_session):
    t = Teacher(
        email="text-quota@teacher.com",
        name="T",
        password_hash="x",
        email_verified=True,
    )
    db_session.add(t)
    db_session.commit()
    return t


class TestReserveThenRefund:
    def test_first_call_reserves_one(self, db_session, teacher):
        charge = stq.consume(db_session, teacher)
        assert charge["charged"] == "free"
        assert charge["used"] == 1
        assert charge["remaining"] == stq.FREE_MONTHLY_LIMIT - 1

    def test_consume_stops_at_limit(self, db_session, teacher, monkeypatch):
        monkeypatch.setattr(stq, "FREE_MONTHLY_LIMIT", 2)

        assert stq.consume(db_session, teacher)["charged"] == "free"
        assert stq.consume(db_session, teacher)["charged"] == "free"

        # 第三次拿不到額度，而且是回 charged=None 而不是丟例外 ——
        # 呼叫端要能自己決定回什麼狀態碼
        third = stq.consume(db_session, teacher)
        assert third["charged"] is None
        assert third["remaining"] == 0
        assert third["can_use"] is False

    def test_refund_gives_the_slot_back(self, db_session, teacher):
        charge = stq.consume(db_session, teacher)
        after = stq.refund(db_session, teacher, year_month=charge["year_month"])
        assert after["used"] == 0
        assert after["remaining"] == stq.FREE_MONTHLY_LIMIT

    def test_refund_never_goes_negative(self, db_session, teacher):
        """例外處理路徑重入時可能退兩次 —— 不能把計數扣成負的。"""
        charge = stq.consume(db_session, teacher)
        stq.refund(db_session, teacher, year_month=charge["year_month"])
        again = stq.refund(db_session, teacher, year_month=charge["year_month"])
        assert again["used"] == 0

    def test_refund_uses_the_month_it_was_charged_to(self, db_session, teacher):
        """跨月那一瞬間：扣在 A 月、退到 B 月的話 A 月永遠少一格（PR #1027 R3）。"""
        stq.consume(db_session, teacher, year_month="2026-10")

        # 模擬「AI 跑很久，回來已經是 11 月」—— 退款仍要算回 10 月
        stq.refund(db_session, teacher, year_month="2026-10")

        october = stq.get_quota_status(db_session, teacher, year_month="2026-10")
        november = stq.get_quota_status(db_session, teacher, year_month="2026-11")
        assert october["used"] == 0
        assert november["used"] == 0


class TestStatus:
    def test_status_without_any_usage(self, db_session, teacher):
        status = stq.get_quota_status(db_session, teacher)
        assert status["used"] == 0
        assert status["limit"] == stq.FREE_MONTHLY_LIMIT
        assert status["can_use"] is True

    def test_status_does_not_create_a_row(self, db_session, teacher):
        """只是查詢就寫一列進去的話，用量表會被查詢汙染。"""
        stq.get_quota_status(db_session, teacher)
        assert (
            db_session.query(ScenarioTextUsage)
            .filter(ScenarioTextUsage.teacher_id == teacher.id)
            .count()
            == 0
        )

    def test_each_month_counts_separately(self, db_session, teacher):
        stq.consume(db_session, teacher, year_month="2026-10")
        assert (
            stq.get_quota_status(db_session, teacher, year_month="2026-11")["used"] == 0
        )


class TestSeparateFromTheImagePool:
    """生圖與文字是**兩個池**，不互相消耗（成本量級差太多，上限也不同）。"""

    def test_text_usage_does_not_touch_the_image_counter(self, db_session, teacher):
        from services import scenario_image_quota as siq

        stq.consume(db_session, teacher)

        assert siq.get_quota_status(db_session, teacher)["used"] == 0

    def test_the_two_pools_have_different_limits(self):
        from services import scenario_image_quota as siq

        # 生圖貴一個量級，所以次數少 —— 共用一張表就得共用一個數字
        assert siq.FREE_MONTHLY_LIMIT != stq.FREE_MONTHLY_LIMIT


class TestLimitIsReadAtCallTime:
    """上限是呼叫端模組的常數，不能在建構時就抄進共用物件。

    抄進去的話測試 monkeypatch 那個常數會 patch 不到，額度測試整批靜靜失效 ——
    這正是 #1025 重構時被既有的 20 條生圖測試抓到的問題。
    """

    def test_monkeypatching_the_module_constant_takes_effect(
        self, db_session, teacher, monkeypatch
    ):
        monkeypatch.setattr(stq, "FREE_MONTHLY_LIMIT", 1)
        assert stq.get_quota_status(db_session, teacher)["limit"] == 1

    def test_plain_int_limit_still_works(self):
        """共用物件也接受固定值，不是只能傳 callable。"""
        quota = MonthlyUsageQuota(ScenarioTextUsage, 7)
        assert quota.limit == 7

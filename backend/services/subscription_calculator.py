"""
訂閱計算服務 - 固定每月訂閱週期

規則：
1. 首次訂閱：從訂閱日起算 +1 個月，收全額
2. 續訂：從當前到期日起算 +1 個月，收全額
3. 例：3/5 訂閱 → 到期日 4/5，續訂 → 5/5
"""

from datetime import datetime, timezone
from typing import Tuple
from calendar import monthrange

from config.plans import (
    PLAN_PRICES as _PLAN_PRICES,
    DEFAULT_PRICE as _DEFAULT_PRICE,
    get_plan_price,
)


class SubscriptionCalculator:
    """訂閱計算器"""

    # Kept for backward compat; prefer ``get_plan_price`` so admin overrides apply.
    PLAN_PRICES = _PLAN_PRICES

    DEFAULT_PRICE = _DEFAULT_PRICE

    @staticmethod
    def calculate_first_subscription(
        start_date: datetime, plan_name: str
    ) -> Tuple[datetime, int, dict]:
        """
        計算首次訂閱的到期日和金額

        Args:
            start_date: 訂閱開始日期
            plan_name: 方案名稱 ("Tutor Teachers" or "School Teachers")

        Returns:
            (到期日, 應付金額, 詳細資訊)
        """
        full_price = get_plan_price(plan_name)

        end_date = SubscriptionCalculator._add_one_month(start_date)

        details = {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "actual_days": (end_date.date() - start_date.date()).days,
            "full_price": full_price,
            "amount": full_price,
            "plan_name": plan_name,
            "pricing_method": "fixed_monthly",
        }

        return end_date, full_price, details

    @staticmethod
    def calculate_renewal(
        current_end_date: datetime, plan_name: str
    ) -> Tuple[datetime, int]:
        """
        計算續訂的到期日和金額

        Args:
            current_end_date: 當前到期日
            plan_name: 方案名稱

        Returns:
            (新到期日, 應付金額)
        """
        new_end_date = SubscriptionCalculator._add_one_month(current_end_date)
        amount = get_plan_price(plan_name)

        return new_end_date, amount

    @staticmethod
    def _add_one_month(date: datetime) -> datetime:
        """
        加一個月，處理月末邊界案例

        例：1/31 → 2/28, 3/31 → 4/30, 12/15 → 1/15

        Args:
            date: 基準日期

        Returns:
            加一個月後的 datetime
        """
        if date.month == 12:
            next_month = 1
            next_year = date.year + 1
        else:
            next_month = date.month + 1
            next_year = date.year

        # 處理月末邊界：目標月天數不夠時取當月最後一天
        max_day = monthrange(next_year, next_month)[1]
        next_day = min(date.day, max_day)

        return datetime(
            year=next_year,
            month=next_month,
            day=next_day,
            hour=date.hour,
            minute=date.minute,
            second=date.second,
            microsecond=date.microsecond,
            tzinfo=date.tzinfo or timezone.utc,
        )

    @staticmethod
    def get_days_until_renewal(subscription_end_date: datetime) -> int:
        """
        計算距離續訂還有幾天

        Args:
            subscription_end_date: 訂閱到期日

        Returns:
            剩餘天數
        """
        now = datetime.now(timezone.utc)
        if subscription_end_date <= now:
            return 0

        return (subscription_end_date - now).days

    @staticmethod
    def should_renew_today(subscription_end_date: datetime) -> bool:
        """
        檢查今天是否應該續訂

        Args:
            subscription_end_date: 訂閱到期日

        Returns:
            True if 今天是到期日
        """
        today = datetime.now(timezone.utc).date()
        end_date = subscription_end_date.date()

        return today == end_date


# ============ 使用範例 ============
if __name__ == "__main__":
    print("=" * 70)
    print("訂閱計算測試（固定 +1 個月）")
    print("=" * 70)

    test_cases = [
        ("3/5 訂閱", datetime(2026, 3, 5, 10, 0, 0, tzinfo=timezone.utc)),
        ("1/31 訂閱", datetime(2026, 1, 31, 10, 0, 0, tzinfo=timezone.utc)),
        ("2/28 訂閱", datetime(2026, 2, 28, 10, 0, 0, tzinfo=timezone.utc)),
        ("12/15 訂閱", datetime(2025, 12, 15, 10, 0, 0, tzinfo=timezone.utc)),
        ("3/31 訂閱", datetime(2026, 3, 31, 10, 0, 0, tzinfo=timezone.utc)),
    ]

    for name, start_date in test_cases:
        end_date, amount, details = SubscriptionCalculator.calculate_first_subscription(
            start_date, "Tutor Teachers"
        )

        print(f"\n{name}")
        print(f"  訂閱日期: {start_date.date()}")
        print(f"  到期日: {end_date.date()}")
        print(f"  應付金額: TWD {amount}")
        print(f"  天數: {details['actual_days']} 天")

    print("\n" + "=" * 70)

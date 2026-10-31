"""每月次數硬上限的共用實作（issue #1025）。

## 為什麼抽出來

`scenario_image_quota`（#1024）與 `scenario_text_quota`（#1025）是同一個形狀：
每位老師每個自然月 N 次、用完就擋、不接點數。兩份各寫一次等於把「保留 → 退還」
那段並發處理複製兩遍，而那段的每一個細節都是踩過坑才長成現在這樣：

* **先保留再打 AI**，不是先查再打 —— 只在打 AI 之前查一次是擋不住並發的：同一位
  老師在 29/30 時同時送兩個請求，兩個都會通過那次檢查（PR #1027 review round 1）。
* **`SELECT ... FOR UPDATE`** 鎖住當月計數列，讓同一位老師的 consume 序列化。
* **首次建列靠 UNIQUE 擋並發**，衝突就改讀對方建立的那列。
* **refund 要能指定 year_month** —— 不重算當下月份：跨月那一瞬間保留在 10 月、
  退還算到 11 月，會退到別的月份去（PR #1027 review round 3）。
* **額度用完回 `charged: None` 而不是丟例外**，讓呼叫端決定回什麼狀態碼。

複製第二份的時候這些還會對；複製到第三份、或其中一份被改動時就會開始漂移。

## 與 magic_paste_quota 的差別

`magic_paste_quota`（#891）用完免費額度會走 `QuotaService` waterfall（訂閱 → 點數包）
扣點。這裡刻意**不接點數**：情境對話 AI 的計價還沒定（#1025 的產品決策是先用硬上限
換取成本可控），等要收費時把 :meth:`consume` 換成 waterfall 即可，計數表沿用。

所以這個模組只負責「每月硬上限」這一種形狀，不是通用配額框架。
"""

from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional, Type, Union

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import Teacher


def current_year_month() -> str:
    """目前的自然月字串 'YYYY-MM'（UTC）。"""
    return datetime.now(timezone.utc).strftime("%Y-%m")


class MonthlyUsageQuota:
    """綁定一張「每位老師每個自然月一列」的計數表，提供保留／退還／查詢。

    ``usage_model`` 必須有 ``teacher_id`` / ``year_month`` / ``count`` 三個欄位，
    以及 ``UNIQUE(teacher_id, year_month)``。
    """

    def __init__(
        self,
        usage_model: Type[Any],
        free_monthly_limit: Union[int, Callable[[], int]],
    ) -> None:
        self.usage_model = usage_model
        # 可以傳 callable：上限通常是呼叫端模組的常數，測試會 monkeypatch 那個常數。
        # 在 __init__ 就把值抄下來的話，patch 不到這裡，額度測試會靜靜地失效
        # （本機 review 前就被既有的 20 條生圖測試抓到）。
        self._limit_source = free_monthly_limit

    @property
    def limit(self) -> int:
        source = self._limit_source
        return source() if callable(source) else source

    # ------------------------------------------------------------------ 內部

    def _get(self, db: Session, teacher_id: int, year_month: str) -> Optional[Any]:
        model = self.usage_model
        return (
            db.query(model)
            .filter(
                model.teacher_id == teacher_id,
                model.year_month == year_month,
            )
            .first()
        )

    def _get_or_create_locked(
        self, db: Session, teacher_id: int, year_month: str
    ) -> Any:
        """取得（或建立）當月計數列並鎖住，讓同一位老師的 consume 序列化。

        首次建立靠 ``UNIQUE(teacher_id, year_month)`` 擋並發，衝突就改讀對方建立的
        那列。（SQLite 不支援 FOR UPDATE，SQLAlchemy 會自動忽略，測試不受影響。）
        """
        model = self.usage_model
        row = (
            db.query(model)
            .filter(
                model.teacher_id == teacher_id,
                model.year_month == year_month,
            )
            .with_for_update()
            .first()
        )
        if row is not None:
            return row

        row = model(teacher_id=teacher_id, year_month=year_month, count=0)
        db.add(row)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            row = (
                db.query(model)
                .filter(
                    model.teacher_id == teacher_id,
                    model.year_month == year_month,
                )
                .with_for_update()
                .first()
            )
        return row

    def _snapshot(self, year_month: str, used: int) -> Dict[str, Any]:
        remaining = max(0, self.limit - used)
        return {
            "year_month": year_month,
            "limit": self.limit,
            "used": used,
            "remaining": remaining,
            "can_use": remaining > 0,
        }

    # ------------------------------------------------------------------ 公開

    def get_quota_status(
        self, db: Session, teacher: Teacher, year_month: Optional[str] = None
    ) -> Dict[str, Any]:
        """目前的配額狀態，供前端顯示剩餘次數。"""
        ym = year_month or current_year_month()
        row = self._get(db, teacher.id, ym)
        return self._snapshot(ym, row.count if row else 0)

    def consume(
        self, db: Session, teacher: Teacher, year_month: Optional[str] = None
    ) -> Dict[str, Any]:
        """**先保留**一次額度（在打 AI 之前呼叫）。

        額度用完會回 ``{"charged": None, ...}`` 而不是丟例外，讓呼叫端決定回什麼
        狀態碼。呼叫端**一定要看這個回傳值** —— 正確用法是「先 consume 佔位 →
        再打 AI → 失敗就 :meth:`refund`」，而不是「先查 → 打 AI → 再 consume」。
        """
        ym = year_month or current_year_month()
        row = self._get_or_create_locked(db, teacher.id, ym)

        if row.count >= self.limit:
            db.commit()
            return {"charged": None, **self._snapshot(ym, row.count)}

        row.count += 1
        db.commit()
        db.refresh(row)
        return {"charged": "free", **self._snapshot(ym, row.count)}

    def refund(
        self, db: Session, teacher: Teacher, year_month: Optional[str] = None
    ) -> Dict[str, Any]:
        """把先前保留的一次額度還回去。

        用在「保留成功但後續失敗」—— 老師沒拿到東西就不該被算一次。

        ``year_month`` 請傳 consume 回傳的那個值，不要讓它重算當下月份：跨月那一
        瞬間保留在 10 月、退還算到 11 月，會退到別的月份去（PR #1027 review R3）。

        計數不會被扣到負數 —— 就算重複退款（例外處理路徑重入）也只是回到 0。
        """
        ym = year_month or current_year_month()
        row = self._get_or_create_locked(db, teacher.id, ym)
        row.count = max(0, row.count - 1)
        db.commit()
        db.refresh(row)
        return self._snapshot(ym, row.count)

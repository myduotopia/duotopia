"""
魔術貼上（教材內容 AI 擷取）每月配額服務（issue #891）。

規則：
- 每位老師每個自然月有 FREE_MONTHLY_LIMIT 張免費額度（跨月自然重置）。
- 用完免費額度後，每張改扣點數（1 張 = 10 秒，走既有 QuotaService waterfall：
  訂閱 → 點數包）。點數也不足時 QuotaService 會丟 HTTPException(402)，
  由前端導向訂閱 / 購買點數。

計數以 magic_paste_usage 表記錄（每位老師每個 year_month 一列）。
"""

from datetime import datetime, timezone
from typing import Optional, Dict, Any

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from models import Teacher, MagicPasteUsage
from services.quota_service import QuotaService

# 每位老師每月免費張數
FREE_MONTHLY_LIMIT = 5

# 超額後的計費參數（沿用 QuotaService 單位換算：1 張 = 10 秒）
FEATURE_TYPE = "magic_paste"
UNIT_TYPE = "張"
UNIT_COUNT = 1
# 一張圖擷取所需的點數（秒），供前端判斷「點數是否足夠再扣一張」
POINTS_PER_IMAGE = QuotaService.convert_unit_to_seconds(UNIT_COUNT, UNIT_TYPE)


def current_year_month() -> str:
    """回傳目前的自然月字串 'YYYY-MM'（UTC）。"""
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _get_usage(
    db: Session, teacher_id: int, year_month: str
) -> Optional[MagicPasteUsage]:
    return (
        db.query(MagicPasteUsage)
        .filter(
            MagicPasteUsage.teacher_id == teacher_id,
            MagicPasteUsage.year_month == year_month,
        )
        .first()
    )


def _get_or_create_usage_locked(
    db: Session, teacher_id: int, year_month: str
) -> MagicPasteUsage:
    """
    取得（或建立）當月計數列，並以 SELECT ... FOR UPDATE 鎖住，讓同一老師的
    consume 序列化，避免 check-then-increment 的競態把免費額度多花（review PR #943 #1）。
    首次建立時靠 UNIQUE(teacher_id, year_month) 擋並發，衝突則改讀對方已建立的列。
    （SQLite 不支援 FOR UPDATE，SQLAlchemy 會自動忽略，測試不受影響。）
    """
    row = (
        db.query(MagicPasteUsage)
        .filter(
            MagicPasteUsage.teacher_id == teacher_id,
            MagicPasteUsage.year_month == year_month,
        )
        .with_for_update()
        .first()
    )
    if row is not None:
        return row

    row = MagicPasteUsage(teacher_id=teacher_id, year_month=year_month, count=0)
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        row = (
            db.query(MagicPasteUsage)
            .filter(
                MagicPasteUsage.teacher_id == teacher_id,
                MagicPasteUsage.year_month == year_month,
            )
            .with_for_update()
            .first()
        )
    return row


def get_quota_status(
    db: Session, teacher: Teacher, year_month: Optional[str] = None
) -> Dict[str, Any]:
    """
    回傳目前配額狀態，供前端顯示剩餘免費張數與是否可繼續使用。
    """
    ym = year_month or current_year_month()
    row = _get_usage(db, teacher.id, ym)
    free_used = row.count if row else 0
    free_remaining = max(0, FREE_MONTHLY_LIMIT - free_used)

    quota_info = QuotaService.get_quota_info(teacher, db)
    paid_remaining = quota_info["quota_remaining"]

    return {
        "year_month": ym,
        "free_limit": FREE_MONTHLY_LIMIT,
        "free_used": free_used,
        "free_remaining": free_remaining,
        "points_per_image": POINTS_PER_IMAGE,
        "paid_quota_remaining": paid_remaining,
        # 還有免費額度，或付費點數足夠再扣一張
        "can_use": free_remaining > 0 or paid_remaining >= POINTS_PER_IMAGE,
    }


def consume(
    db: Session,
    teacher: Teacher,
    year_month: Optional[str] = None,
    feature_detail: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    消耗一張額度。優先扣免費額度，用完改扣點數。

    Returns:
        dict 描述本次如何計費（charged: "free" | "points"）。

    Raises:
        HTTPException(402): 免費額度用完且點數不足（由 QuotaService.deduct_quota 丟出）。
    """
    ym = year_month or current_year_month()
    # 鎖住當月計數列，序列化同一老師的並發消耗
    row = _get_or_create_usage_locked(db, teacher.id, ym)

    if row.count < FREE_MONTHLY_LIMIT:
        row.count += 1
        db.commit()
        db.refresh(row)
        return {
            "charged": "free",
            "points_used": 0,
            "free_used": row.count,
            "free_remaining": max(0, FREE_MONTHLY_LIMIT - row.count),
            "year_month": ym,
        }

    # 免費額度用完 → 先扣點數（不足會丟 402，且尚未動到 count）
    usage_log = QuotaService.deduct_quota(
        db=db,
        teacher=teacher,
        student_id=None,
        assignment_id=None,
        feature_type=FEATURE_TYPE,
        unit_count=UNIT_COUNT,
        unit_type=UNIT_TYPE,
        feature_detail=feature_detail,
    )
    row.count += 1
    db.commit()
    db.refresh(row)
    return {
        "charged": "points",
        "points_used": usage_log.points_used,
        "free_used": FREE_MONTHLY_LIMIT,
        "free_remaining": 0,
        "year_month": ym,
    }

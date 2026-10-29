"""情境對話 AI 生圖的計費（issue #1158）。

取代 #1024 的 ``scenario_image_quota``（每位老師每月 30 張、用完就擋）—— 那個規則作廢。

依老師身分分開計算（使用者 2026-10-28／29 定案）
------------------------------------------------

==========================  =========================================================
身分（依序判斷）             規則
==========================  =========================================================
admin（``is_admin``）        不限張數，不計數、不扣點
機構老師                     扣**第一個點數還夠的有效機構**（順序同
                             ``QuotaService.check_ai_analysis_availability``）；所有機構
                             點數都不夠就改用個人方案（下面兩列）；個人方案也沒有就擋下
訂閱制（subscribed）         每月 60 張（UTC 自然月）；用完後走 ``QuotaService.deduct_quota``
                             的現有順序（先訂閱週期配額，再點數包，含試用贈點）
點數制（有非試用點數包）     每次依實際 token 扣點數
未付費且非機構               每天 3 張（台灣時區），用完就擋，**不扣試用點數**
==========================  =========================================================

扣點的換算
----------

一張圖的實際 token 只有生完才知道，所以：

1. 生圖**前**先確認餘額至少 :data:`POINTS_PER_IMAGE_ESTIMATE` 點（機構或個人），
   不夠就在打 AI 之前回 402，一次呼叫都不浪費。
2. 生完依實際輸出 token 換算一次扣掉：每 :data:`TOKENS_PER_POINT` token 算 1 點，
   無條件進位（2026-10-29 實測一張 4:3 是 1120 token → 9 點）。``unit_type="秒"``，
   因為點數在系統裡就是以「秒」計（1 秒 = 1 點）。
3. **不寫退點**：被安全過濾擋下或生圖失敗時根本還沒扣點。

張數計數（每月 60 張、每天 3 張）則照 ``MonthlyUsageQuota`` 的「先佔位、失敗就退」
—— 只在打 AI 之前查一次是擋不住並發的（PR #1027 review）。

月與日兩種計數共用 ``scenario_image_usage`` 表：月計數的鍵是 'YYYY-MM'（**UTC**，沿用
#1024 的寫法），日計數的鍵是 'YYYY-MM-DD'（**台灣時區**，老師感受到的「今天」）。
兩者時區不同是刻意的：月計數在台灣時間每月 1 日早上 8 點重置，差 8 小時對 60 張的
月額度沒有實質影響；但每天只有 3 張時，用 UTC 會讓老師早上 8 點前用掉的算到前一天，
看起來像額度沒重置。
"""

import logging
import math
from dataclasses import dataclass
from typing import Any, Dict, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import ScenarioImageUsage, Teacher
from models.organization import Organization, TeacherOrganization
from services.monthly_usage_quota import (
    MonthlyUsageQuota,
    current_taipei_date,
    current_year_month,
)
from services.organization_points_service import OrganizationPointsService
from services.quota_service import QuotaService

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------- 可調常數
# 換算率與額度都集中在這裡，之後要改只改一行（使用者定案 3）

# 每多少個輸出 token 算 1 點（無條件進位）
TOKENS_PER_POINT = 130
# 一張圖的預估點數：生圖前檢查餘額用，也回給前端顯示「約扣 N 點」
POINTS_PER_IMAGE_ESTIMATE = 10
# 訂閱老師每月免費張數
SUBSCRIPTION_MONTHLY_LIMIT = 60
# 未付費、非機構老師每天張數
FREE_DAILY_LIMIT = 3

FEATURE_TYPE = "scenario_image"
UNIT_TYPE = "秒"

# 計費方式（也是 /image-quota 回傳的 billing 值）
BILLING_ADMIN = "admin"
BILLING_ORG = "org"
BILLING_SUBSCRIPTION = "subscription"
BILLING_POINTS = "points"
BILLING_FREE_DAILY = "free_daily"

# 傳 lambda 而不是值：測試會 monkeypatch 本模組的常數
_monthly = MonthlyUsageQuota(ScenarioImageUsage, lambda: SUBSCRIPTION_MONTHLY_LIMIT)
_daily = MonthlyUsageQuota(ScenarioImageUsage, lambda: FREE_DAILY_LIMIT)

QUOTA_EXCEEDED_ERROR = "SCENARIO_IMAGE_QUOTA_EXCEEDED"


def points_for_tokens(output_tokens: int) -> int:
    """輸出 token → 點數（每 :data:`TOKENS_PER_POINT` 算 1 點，無條件進位）。

    回應裡讀不到 token（0 或缺欄位）時改用預估值 —— 圖已經交出去了，不能算 0 點，
    否則 usage_metadata 格式一變就變成免費生圖。
    """
    tokens = int(output_tokens or 0)
    if tokens <= 0:
        logger.warning(
            "scenario_image_billing | output_tokens 讀不到，改用預估 %s 點",
            POINTS_PER_IMAGE_ESTIMATE,
        )
        return POINTS_PER_IMAGE_ESTIMATE
    return math.ceil(tokens / TOKENS_PER_POINT)


# ---------------------------------------------------------------- 身分判斷


def _org_remaining(org: Organization) -> int:
    return (org.total_points or 0) - (org.used_points or 0)


def _active_orgs(db: Session, teacher: Teacher) -> list:
    """老師所屬的有效機構（TeacherOrganization 有效且機構有效）。

    順序同 ``QuotaService.check_ai_analysis_availability``（依 TeacherOrganization 的
    建立順序；那邊沒寫 order_by，這裡補上 id 排序讓結果穩定）。
    """
    rows = (
        db.query(Organization)
        .join(
            TeacherOrganization,
            TeacherOrganization.organization_id == Organization.id,
        )
        .filter(
            TeacherOrganization.teacher_id == teacher.id,
            TeacherOrganization.is_active.is_(True),
            Organization.is_active.is_(True),
        )
        .order_by(TeacherOrganization.id.asc())
        .all()
    )
    return rows


def _has_paid_credit_package(db: Session, teacher: Teacher) -> bool:
    """有 ``source != "trial_bonus"`` 的有效點數包（點數制老師）。"""
    return any(
        (pkg.source or "") != "trial_bonus"
        for pkg in QuotaService._get_active_credit_packages(teacher, db)
    )


def _personal_remaining(db: Session, teacher: Teacher) -> int:
    """個人方案剩餘點數（訂閱週期配額 + 所有有效點數包，含試用贈點）。"""
    return QuotaService._get_total_remaining(teacher, db)


def _is_subscribed(teacher: Teacher) -> bool:
    return getattr(teacher, "subscription_status", None) == "subscribed"


def resolve_billing(db: Session, teacher: Teacher) -> Dict[str, Any]:
    """判斷這位老師此刻的計費方式。

    回傳 ``{"billing": ..., "organization": Organization|None, "is_org_teacher": bool}``。
    機構老師但所有機構點數都不夠、又沒有個人方案時，billing 仍是 ``"org"``、
    organization 為 None —— 代表「擋下」，不會掉到每天 3 張（那是給非機構老師的）。
    """
    if bool(getattr(teacher, "is_admin", False)):
        return {"billing": BILLING_ADMIN, "organization": None, "is_org_teacher": False}

    orgs = _active_orgs(db, teacher)
    is_org_teacher = bool(orgs)
    if is_org_teacher:
        org = next(
            (o for o in orgs if _org_remaining(o) >= POINTS_PER_IMAGE_ESTIMATE), None
        )
        if org is not None:
            return {"billing": BILLING_ORG, "organization": org, "is_org_teacher": True}

    # 機構點數不足（或不是機構老師）→ 看個人方案
    if _is_subscribed(teacher):
        billing = BILLING_SUBSCRIPTION
    elif _has_paid_credit_package(db, teacher):
        billing = BILLING_POINTS
    elif is_org_teacher:
        billing = BILLING_ORG  # 機構點數用完、也沒有個人方案 → 擋下
    else:
        billing = BILLING_FREE_DAILY
    return {"billing": billing, "organization": None, "is_org_teacher": is_org_teacher}


# ---------------------------------------------------------------- 查詢


def get_status(db: Session, teacher: Teacher) -> Dict[str, Any]:
    """``GET /image-quota`` 的回傳（#1158 cold-read 定案格式）。

    ``{billing, remaining, limit, period, points_per_image_estimate}``，另多帶
    ``can_generate`` 讓前端不用自己推算「現在按得下去嗎」。

    * admin：remaining / limit / period 皆為 None（不限張數）
    * org / points：以點數計，remaining / limit / period 為 None
    * subscription：本月剩餘張數 / 60 / "month"（用完後改扣點數，can_generate 看個人點數）
    * free_daily：今天剩餘張數 / 3 / "day"
    """
    resolved = resolve_billing(db, teacher)
    billing = resolved["billing"]
    out: Dict[str, Any] = {
        "billing": billing,
        "remaining": None,
        "limit": None,
        "period": None,
        "points_per_image_estimate": POINTS_PER_IMAGE_ESTIMATE,
        "can_generate": True,
    }

    if billing == BILLING_ADMIN:
        return out
    if billing == BILLING_ORG:
        out["can_generate"] = resolved["organization"] is not None
        return out
    if billing == BILLING_POINTS:
        out["can_generate"] = (
            _personal_remaining(db, teacher) >= POINTS_PER_IMAGE_ESTIMATE
        )
        return out
    if billing == BILLING_SUBSCRIPTION:
        snap = _monthly.get_quota_status(db, teacher, current_year_month())
        out.update(remaining=snap["remaining"], limit=snap["limit"], period="month")
        out["can_generate"] = snap["remaining"] > 0 or (
            _personal_remaining(db, teacher) >= POINTS_PER_IMAGE_ESTIMATE
        )
        return out

    # free_daily
    snap = _daily.get_quota_status(db, teacher, current_taipei_date())
    out.update(remaining=snap["remaining"], limit=snap["limit"], period="day")
    out["can_generate"] = snap["remaining"] > 0
    return out


# ---------------------------------------------------------------- 佔位 → 結算 / 退回


@dataclass
class ImageCharge:
    """一次生圖的佔位結果，生完交給 :func:`settle`，失敗交給 :func:`release`。"""

    billing: str
    # 佔了張數名額時的期間鍵（'YYYY-MM' 或 'YYYY-MM-DD'）；沒佔就是 None
    usage_key: Optional[str] = None
    # 用哪個計數器佔的（"month" / "day"）
    counter: Optional[str] = None
    # 生完要不要扣點數；扣機構還是個人
    pay_points: bool = False
    organization_id: Any = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "billing": self.billing,
            "usage_key": self.usage_key,
            "pays_points": self.pay_points,
        }


def _exceeded(message: str, db: Session, teacher: Teacher) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={
            "error": QUOTA_EXCEEDED_ERROR,
            "message": message,
            "quota": get_status(db, teacher),
        },
    )


def reserve(db: Session, teacher: Teacher) -> ImageCharge:
    """生圖**之前**呼叫：佔張數名額、或確認點數夠扣一張。不夠就丟 402。

    正確用法是「reserve → 生圖 → 成功 :func:`settle` / 失敗 :func:`release`」。
    """
    resolved = resolve_billing(db, teacher)
    billing = resolved["billing"]

    if billing == BILLING_ADMIN:
        return ImageCharge(billing=billing)

    if billing == BILLING_ORG:
        org = resolved["organization"]
        if org is None:
            raise _exceeded(
                "機構點數已用完，個人也沒有可用的方案，暫時無法用 AI 生成圖片。可以改用手動上傳圖片。",
                db,
                teacher,
            )
        return ImageCharge(billing=billing, pay_points=True, organization_id=org.id)

    if billing == BILLING_POINTS:
        if _personal_remaining(db, teacher) < POINTS_PER_IMAGE_ESTIMATE:
            raise _exceeded("點數不足，暫時無法用 AI 生成圖片。可以改用手動上傳圖片。", db, teacher)
        return ImageCharge(billing=billing, pay_points=True)

    if billing == BILLING_SUBSCRIPTION:
        key = current_year_month()
        taken = _monthly.consume(db, teacher, key)
        if taken["charged"] is not None:
            return ImageCharge(billing=billing, usage_key=key, counter="month")
        # 本月 60 張用完 → 照現有順序扣點（訂閱週期配額 → 點數包，含試用贈點）
        if _personal_remaining(db, teacher) < POINTS_PER_IMAGE_ESTIMATE:
            raise _exceeded(
                f"本月 {SUBSCRIPTION_MONTHLY_LIMIT} 張 AI 生圖已用完，方案點數也不足，"
                "下個月 1 日會重置。可以改用手動上傳圖片。",
                db,
                teacher,
            )
        return ImageCharge(billing=billing, pay_points=True)

    # free_daily：每天 3 張，用完就擋，不扣試用點數
    key = current_taipei_date()
    taken = _daily.consume(db, teacher, key)
    if taken["charged"] is None:
        raise _exceeded(
            f"今天 {FREE_DAILY_LIMIT} 張 AI 生圖已用完，明天會重置。可以改用手動上傳圖片。",
            db,
            teacher,
        )
    return ImageCharge(billing=billing, usage_key=key, counter="day")


def release(db: Session, teacher: Teacher, charge: ImageCharge) -> None:
    """生圖失敗（被擋、出錯、存檔失敗、中途取消）時退回佔掉的張數名額。

    點數不用退：點數只在 :func:`settle` 才扣。``usage_key`` 一定用佔位時那個，
    不重算 —— 生圖跨過午夜／月底時，扣在哪一期就退回哪一期。
    """
    if charge.usage_key is None:
        return
    quota = _monthly if charge.counter == "month" else _daily
    quota.refund(db, teacher, charge.usage_key)


def settle(
    db: Session,
    teacher: Teacher,
    charge: ImageCharge,
    output_tokens: int,
    feature_detail: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """圖已經交到老師手上之後呼叫：需要扣點的依實際 token 一次扣掉。

    扣點失敗（例如剛好被別的請求用到超過緩衝上限）**不影響這次回應**：圖已經生出來、
    存好了，再回錯誤只會讓老師白等一次又再按一次（那會真的再花一次錢）。只記 error
    log 讓我們看得到。
    """
    result = {**charge.as_dict(), "points_used": 0, "output_tokens": output_tokens}
    if not charge.pay_points:
        return result

    points = points_for_tokens(output_tokens)
    detail = {"output_tokens": output_tokens, **(feature_detail or {})}
    try:
        if charge.organization_id is not None:
            OrganizationPointsService.deduct_points(
                db=db,
                organization_id=charge.organization_id,
                teacher_id=teacher.id,
                student_id=None,
                assignment_id=None,
                feature_type=FEATURE_TYPE,
                unit_count=points,
                unit_type=UNIT_TYPE,
                feature_detail=detail,
            )
        else:
            QuotaService.deduct_quota(
                db=db,
                teacher=teacher,
                student_id=None,
                assignment_id=None,
                feature_type=FEATURE_TYPE,
                unit_count=points,
                unit_type=UNIT_TYPE,
                feature_detail=detail,
            )
        result["points_used"] = points
    except Exception:
        db.rollback()
        logger.exception(
            "scenario_image_billing | 扣點失敗，這張圖沒有扣到 | teacher_id=%s | "
            "billing=%s | points=%s",
            teacher.id,
            charge.billing,
            points,
        )
    return result


__all__ = [
    "TOKENS_PER_POINT",
    "POINTS_PER_IMAGE_ESTIMATE",
    "SUBSCRIPTION_MONTHLY_LIMIT",
    "FREE_DAILY_LIMIT",
    "ImageCharge",
    "points_for_tokens",
    "resolve_billing",
    "get_status",
    "reserve",
    "release",
    "settle",
]

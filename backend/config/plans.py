"""
訂閱方案常數 - 所有方案相關的數值統一在此定義

修改此檔案即可全域更新方案名稱、價格與配額。
"""

# === 方案名稱 ===
PLAN_FREE_TRIAL = "Free Trial"
PLAN_TUTOR = "Tutor Teachers"
PLAN_SCHOOL = "School Teachers"
PLAN_DEMO_UNLIMITED = "Demo Unlimited Plan"
PLAN_VIP = "VIP"

# === 試用方案 ===
TRIAL_QUOTA = 2000
TRIAL_DAYS = 365

# === 訂閱價格 (TWD/月) ===
PLAN_PRICES = {
    PLAN_TUTOR: 299,
    PLAN_SCHOOL: 599,
}
DEFAULT_PRICE = 299

# === 每月點數配額 ===
PLAN_QUOTAS = {
    PLAN_FREE_TRIAL: 2000,
    PLAN_TUTOR: 2000,
    PLAN_SCHOOL: 6000,
    PLAN_DEMO_UNLIMITED: 999999,
    PLAN_VIP: 0,  # VIP 由 Admin 自訂
}

# === 點數包定義 ===
CREDIT_PACKAGES = {
    "pkg-1000": {"points": 1000, "bonus": 0, "price": 180},
    "pkg-2000": {"points": 2000, "bonus": 0, "price": 320},
    "pkg-5000": {"points": 5000, "bonus": 200, "price": 700},
    "pkg-10000": {"points": 10000, "bonus": 500, "price": 1200},
    "pkg-20000": {"points": 20000, "bonus": 800, "price": 2000},
}

# 機構可購買的點數包
ORG_ALLOWED_PACKAGES = ["pkg-20000"]

# 點數包效期（天）
CREDIT_PACKAGE_VALIDITY_DAYS = 365


# === DB-backed overrides ===
# `Plan` table allows admins to override price/quota without a deploy.
# These helpers prefer the DB value and fall back to the config constants
# so call sites work even before the migration runs or table is seeded.
#
# Callers that already have a DB session (e.g. router endpoints) should pass
# it as ``db`` so reads share the request transaction (and so tests can
# inject the test session). When ``db`` is None the helper opens its own
# short-lived session against the configured database; failures fall through
# to the config constants.
def _get_plan_override(plan_name: str, db=None):
    """Fetch the Plan row for ``plan_name``. Returns None on any error so
    callers can fall back to config defaults without crashing."""
    try:
        from models.plan import Plan

        if db is not None:
            return db.query(Plan).filter(Plan.name == plan_name).first()

        from database import SessionLocal

        session = SessionLocal()
        try:
            return session.query(Plan).filter(Plan.name == plan_name).first()
        finally:
            session.close()
    except Exception:
        return None


def _guard_group_buy(row, plan_name: str) -> None:
    """Reject group-buy plans for the individual-plan price/quota helpers.

    Group-buy billing is `annual_fee × teacher_seats` (see issue #768);
    silently returning DEFAULT_PRICE (=299) for these names would invoice
    NT$299/month instead. Detection is by `row.teacher_seats is not None`,
    not by name pattern, so it stays correct if seed names change.
    """
    if row is not None and row.teacher_seats is not None:
        raise ValueError(
            f"get_plan_price/quota does not apply to group-buy plan {plan_name!r}; "
            "use the checkout flow with annual_fee × teacher_seats instead."
        )


def get_plan_price(plan_name: str, db=None) -> int:
    """Return the price for ``plan_name``. Prefer DB override; fall back to
    PLAN_PRICES; finally DEFAULT_PRICE. Raises ValueError for group-buy plans."""
    row = _get_plan_override(plan_name, db=db)
    _guard_group_buy(row, plan_name)
    if row is not None and row.price is not None:
        return row.price
    return PLAN_PRICES.get(plan_name, DEFAULT_PRICE)


def get_plan_quota(plan_name: str, db=None) -> int:
    """Return the monthly quota for ``plan_name``. Prefer DB override; fall
    back to PLAN_QUOTAS; finally 0. Raises ValueError for group-buy plans."""
    row = _get_plan_override(plan_name, db=db)
    _guard_group_buy(row, plan_name)
    if row is not None and row.quota is not None:
        return row.quota
    return PLAN_QUOTAS.get(plan_name, 0)

"""
Admin Subscription Management API

純粹基於 subscription_periods 表的訂閱管理系統
不依賴 teacher_subscription_transactions
"""

from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, aliased
from sqlalchemy import func
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel, EmailStr
from datetime import datetime, timezone
from typing import Optional

from database import get_db
from models import (
    Teacher,
    SubscriptionPeriod,
    TeacherSubscriptionTransaction,
    TransactionType,
    Classroom,
    Student,
    Assignment,
    PointUsageLog,
    ClassroomStudent,
)
from models.credit_package import CreditPackage
from routers.admin import get_current_admin

router = APIRouter(prefix="/api/admin/subscription", tags=["admin-subscription"])


# ============ Request/Response Models ============
class CreateSubscriptionRequest(BaseModel):
    """創建訂閱請求"""

    teacher_email: EmailStr
    # "Free Trial" | "Tutor Teachers" | "School Teachers" |
    # "Demo Unlimited Plan" | "VIP"
    plan_name: str
    end_date: str  # YYYY-MM-DD (月底日期)
    quota_total: Optional[int] = None  # VIP 方案可自訂 quota
    reason: str


class EditSubscriptionRequest(BaseModel):
    """編輯訂閱請求"""

    teacher_email: EmailStr
    plan_name: Optional[str] = None
    quota_total: Optional[int] = None
    end_date: Optional[str] = None  # YYYY-MM-DD
    reason: str


class CancelSubscriptionRequest(BaseModel):
    """取消訂閱請求"""

    teacher_email: EmailStr
    reason: str


class SubscriptionResponse(BaseModel):
    """訂閱操作回應"""

    teacher_email: str
    plan_name: str
    quota_total: int
    quota_used: int
    end_date: str
    status: str


# ============ Helper Functions ============
def get_plan_quota(plan_name: str, db: Session = None) -> int:
    """根據方案名稱獲取對應的 quota（優先讀 Plan 表的 admin 覆寫值）"""
    from config.plans import get_plan_quota as _get_plan_quota

    return _get_plan_quota(plan_name, db=db)


def parse_end_date(date_str: str) -> datetime:
    """
    解析日期字串並設定為當天結束時間 (23:59:59)

    Args:
        date_str: YYYY-MM-DD format

    Returns:
        datetime object at end of day (23:59:59.999999)
    """
    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    return datetime(
        date_obj.year,
        date_obj.month,
        date_obj.day,
        23,
        59,
        59,
        999999,
    )


# ============ API Endpoints ============
@router.post("/create", response_model=SubscriptionResponse)
async def create_subscription(
    request: CreateSubscriptionRequest,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """
    為教師創建訂閱

    - 只更新 subscription_periods 表
    - payment_method = "admin_create"
    - end_date 設定為月底 23:59:59
    """
    # 查詢教師
    teacher = db.query(Teacher).filter_by(email=request.teacher_email).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    # 檢查是否已有活躍訂閱
    now = datetime.now(timezone.utc)
    existing = (
        db.query(SubscriptionPeriod)
        .filter_by(teacher_id=teacher.id, status="active")
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail=(
                "Teacher already has an active subscription. " "Use /edit to modify it."
            ),
        )

    # 計算 quota (VIP 方案可自訂)
    quota_total = get_plan_quota(request.plan_name, db=db)

    # VIP 方案：使用自訂 quota
    if request.plan_name == "VIP":
        if not request.quota_total or request.quota_total <= 0:
            raise HTTPException(
                status_code=400,
                detail="VIP plan requires custom quota_total (must be > 0)",
            )
        quota_total = request.quota_total
    # 其他方案：使用預設 quota
    elif quota_total == 0:
        raise HTTPException(status_code=400, detail="Invalid plan name")

    # 解析 end_date (設定為當天 23:59:59)
    end_date = parse_end_date(request.end_date)

    # 創建訂閱週期
    new_period = SubscriptionPeriod(
        teacher_id=teacher.id,
        plan_name=request.plan_name,
        amount_paid=0,  # Admin 創建，不涉及付款
        quota_total=quota_total,
        quota_used=0,
        start_date=now,
        end_date=end_date,
        payment_method="admin_create",
        payment_status="paid",
        status="active",
        created_at=now,
        # Admin 操作記錄
        admin_id=admin.id,
        admin_reason=request.reason,
        # 初始化 admin_metadata 並記錄創建操作
        admin_metadata={
            "operations": [
                {
                    "action": "create",
                    "timestamp": now.isoformat(),
                    "admin_id": admin.id,
                    "admin_email": admin.email,
                    "admin_name": admin.name,
                    "reason": request.reason,
                    "changes": {
                        "plan_name": request.plan_name,
                        "quota_total": quota_total,
                        "end_date": end_date.isoformat(),
                        "status": "active",
                    },
                }
            ]
        },
    )
    db.add(new_period)
    db.commit()
    db.refresh(new_period)

    return SubscriptionResponse(
        teacher_email=teacher.email,
        plan_name=new_period.plan_name,
        quota_total=new_period.quota_total,
        quota_used=new_period.quota_used,
        end_date=new_period.end_date.isoformat(),
        status=new_period.status,
    )


@router.post("/edit", response_model=SubscriptionResponse)
async def edit_subscription(
    request: EditSubscriptionRequest,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """
    編輯教師的訂閱

    - 可以修改 plan_name, quota_total, end_date
    - 只更新現有的 subscription_period
    """
    # 查詢教師
    teacher = db.query(Teacher).filter_by(email=request.teacher_email).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    # 查詢當前 active 訂閱（只找 active，不找 expired）
    current_period = (
        db.query(SubscriptionPeriod)
        .filter(
            SubscriptionPeriod.teacher_id == teacher.id,
            SubscriptionPeriod.status == "active",
        )
        .order_by(SubscriptionPeriod.end_date.desc())
        .first()
    )

    # 如果沒有 active 訂閱，返回錯誤（應該使用 /create API）
    if not current_period:
        raise HTTPException(
            status_code=404,
            detail=(
                "No active subscription found. "
                "Use /create to create a new subscription."
            ),
        )

    # 🔐 標記為 admin 操作
    current_period.payment_method = "admin_edit"
    current_period.admin_id = admin.id
    current_period.admin_reason = request.reason

    # 記錄修改前的值（用於 admin_metadata）
    changes = {}

    # 更新 plan_name (如果提供)
    if request.plan_name and request.plan_name != current_period.plan_name:
        changes["plan_name"] = {
            "from": current_period.plan_name,
            "to": request.plan_name,
        }
        current_period.plan_name = request.plan_name

        # VIP 方案：必須提供自訂 quota，否則保持原值
        if request.plan_name == "VIP":
            if request.quota_total and request.quota_total > 0:
                current_period.quota_total = request.quota_total
        else:
            # 其他方案：使用預設 quota
            base_quota = get_plan_quota(request.plan_name, db=db)

            new_quota = base_quota
            if new_quota != current_period.quota_total:
                changes["quota_total"] = {
                    "from": current_period.quota_total,
                    "to": new_quota,
                }
            current_period.quota_total = new_quota

    # 更新 quota_total (如果提供，會覆蓋 plan 的預設值)
    if request.quota_total is not None and request.quota_total > 0:
        if request.quota_total != current_period.quota_total:
            changes["quota_total"] = {
                "from": current_period.quota_total,
                "to": request.quota_total,
            }
        current_period.quota_total = request.quota_total

    # 更新 end_date (如果提供)
    if request.end_date:
        new_end_date = parse_end_date(request.end_date)
        if new_end_date != current_period.end_date:
            changes["end_date"] = {
                "from": current_period.end_date.isoformat()
                if current_period.end_date
                else None,
                "to": new_end_date.isoformat(),
            }
        current_period.end_date = new_end_date

    # 記錄修改歷史到 admin_metadata
    now = datetime.now(timezone.utc)
    if changes:  # 只有真的有修改才記錄
        # 初始化或讀取現有的 metadata
        if current_period.admin_metadata is None:
            current_period.admin_metadata = {"operations": []}
        elif not isinstance(current_period.admin_metadata, dict):
            current_period.admin_metadata = {"operations": []}
        elif "operations" not in current_period.admin_metadata:
            current_period.admin_metadata["operations"] = []

        # 新增操作記錄
        operation = {
            "timestamp": now.isoformat(),
            "admin_id": admin.id,
            "admin_email": admin.email,
            "admin_name": admin.name,
            "action": "edit",
            "changes": changes,
            "reason": request.reason,
        }
        current_period.admin_metadata["operations"].append(operation)

        # 🔑 重要：標記 JSONB 欄位已修改（SQLAlchemy 不會自動偵測 dict 內部變更）
        flag_modified(current_period, "admin_metadata")

    db.commit()
    db.refresh(current_period)

    return SubscriptionResponse(
        teacher_email=teacher.email,
        plan_name=current_period.plan_name,
        quota_total=current_period.quota_total,
        quota_used=current_period.quota_used,
        end_date=current_period.end_date.isoformat(),
        status=current_period.status,
    )


@router.post("/cancel")
async def cancel_subscription(
    request: CancelSubscriptionRequest,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """
    取消教師的訂閱

    - 將 status 改為 "cancelled"
    """
    # 查詢教師
    teacher = db.query(Teacher).filter_by(email=request.teacher_email).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    # 查詢當前活躍訂閱
    current_period = (
        db.query(SubscriptionPeriod)
        .filter_by(teacher_id=teacher.id, status="active")
        .first()
    )
    if not current_period:
        raise HTTPException(status_code=404, detail="No active subscription found")

    # 取消訂閱
    old_status = current_period.status
    current_period.status = "cancelled"

    # 記錄取消操作到 admin_metadata
    if not current_period.admin_metadata:
        current_period.admin_metadata = {"operations": []}
    if "operations" not in current_period.admin_metadata:
        current_period.admin_metadata["operations"] = []

    operation = {
        "action": "cancel",
        "timestamp": datetime.utcnow().isoformat(),
        "admin_id": admin.id,
        "admin_email": admin.email,
        "admin_name": admin.name,
        "reason": request.reason,
        "changes": {"status": {"from": old_status, "to": "cancelled"}},
    }

    current_period.admin_metadata["operations"].append(operation)

    # 🔑 重要：標記 JSONB 欄位已修改
    flag_modified(current_period, "admin_metadata")

    db.commit()

    return {
        "success": True,
        "message": "Subscription cancelled",
        "teacher_email": teacher.email,
        "status": "cancelled",
    }


@router.get("/all-teachers")
async def get_all_teachers_subscriptions(
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """
    第1層：獲取所有教師及其當前訂閱狀態
    """
    # 子查詢：找出每個教師最新的 active 訂閱
    subq = (
        db.query(
            SubscriptionPeriod.teacher_id,
            func.max(SubscriptionPeriod.id).label("latest_period_id"),
        )
        .filter(SubscriptionPeriod.status == "active")
        .group_by(SubscriptionPeriod.teacher_id)
        .subquery()
    )

    # 主查詢
    teachers_with_subs = (
        db.query(Teacher, SubscriptionPeriod)
        .outerjoin(subq, Teacher.id == subq.c.teacher_id)
        .outerjoin(SubscriptionPeriod, SubscriptionPeriod.id == subq.c.latest_period_id)
        .order_by(Teacher.id.desc())
        .all()
    )

    # 🔥 Preload credit packages for all teachers (avoid N+1)
    # Deduplicate teacher_ids since the same teacher may appear with multiple periods
    teacher_ids = list({t.id for t, _ in teachers_with_subs})
    all_credit_packages = (
        db.query(CreditPackage)
        .filter(
            CreditPackage.teacher_id.in_(teacher_ids),
            CreditPackage.status == "active",
        )
        .all()
    )
    credit_packages_by_teacher = defaultdict(list)
    for pkg in all_credit_packages:
        credit_packages_by_teacher[pkg.teacher_id].append(pkg)

    result = []
    for teacher, period in teachers_with_subs:
        # Credit package info
        teacher_pkgs = credit_packages_by_teacher.get(teacher.id, [])
        credit_points_total = sum(p.points_total for p in teacher_pkgs)
        credit_points_used = sum(p.points_used for p in teacher_pkgs)
        has_trial_bonus = any(p.source == "trial_bonus" for p in teacher_pkgs)

        teacher_data = {
            "teacher_id": teacher.id,
            "teacher_name": teacher.name,
            "teacher_email": teacher.email,
            "email_verified": teacher.email_verified or False,
            "current_subscription": None,
            "credit_points_total": credit_points_total,
            "credit_points_used": credit_points_used,
            "credit_points_remaining": credit_points_total - credit_points_used,
            "has_trial_bonus": has_trial_bonus,
        }

        if period:
            teacher_data["current_subscription"] = {
                "period_id": period.id,
                "plan_name": period.plan_name,
                "quota_total": period.quota_total,
                "quota_used": period.quota_used,
                "status": period.status,
                "end_date": period.end_date.isoformat() if period.end_date else None,
            }

        result.append(teacher_data)

    return {"teachers": result, "total": len(result)}


@router.get("/teacher/{teacher_id}/periods")
async def get_teacher_periods(
    teacher_id: int,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """
    第2層：獲取指定教師的所有訂閱歷史記錄
    """
    # 查詢教師資訊
    teacher = db.query(Teacher).filter_by(id=teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    # 查詢該教師的所有訂閱記錄
    AdminTeacher = aliased(Teacher)
    periods = (
        db.query(SubscriptionPeriod, AdminTeacher)
        .outerjoin(AdminTeacher, SubscriptionPeriod.admin_id == AdminTeacher.id)
        .filter(SubscriptionPeriod.teacher_id == teacher_id)
        .order_by(SubscriptionPeriod.created_at.desc())
        .all()
    )

    period_list = []
    for period, admin_teacher in periods:
        period_list.append(
            {
                "id": period.id,
                "plan_name": period.plan_name,
                "quota_total": period.quota_total,
                "quota_used": period.quota_used,
                "start_date": period.start_date.isoformat()
                if period.start_date
                else None,
                "end_date": period.end_date.isoformat() if period.end_date else None,
                "status": period.status,
                "payment_method": period.payment_method,
                "payment_id": period.payment_id,
                "payment_status": period.payment_status,
                "amount_paid": period.amount_paid,
                "admin_name": admin_teacher.name if admin_teacher else None,
                "admin_email": admin_teacher.email if admin_teacher else None,
                "admin_reason": period.admin_reason,
                "created_at": period.created_at.isoformat(),
            }
        )

    # 🔥 Approach A: 同時撈取 credit_packages（trial_bonus / admin_grant / 加購）
    credit_packages = (
        db.query(CreditPackage)
        .filter(CreditPackage.teacher_id == teacher_id)
        .order_by(CreditPackage.purchased_at.desc())
        .all()
    )

    credit_package_list = []
    for pkg in credit_packages:
        credit_package_list.append(
            {
                "id": pkg.id,
                "package_id": pkg.package_id,
                "source": pkg.source,
                "points_total": pkg.points_total,
                "points_used": pkg.points_used,
                "points_remaining": pkg.points_remaining,
                "price_paid": pkg.price_paid,
                "purchased_at": pkg.purchased_at.isoformat()
                if pkg.purchased_at
                else None,
                "expires_at": pkg.expires_at.isoformat() if pkg.expires_at else None,
                "status": pkg.status,
                "payment_id": pkg.payment_id,
            }
        )

    return {
        "teacher": {
            "id": teacher.id,
            "name": teacher.name,
            "email": teacher.email,
        },
        "periods": period_list,
        "credit_packages": credit_package_list,
        "total": len(period_list),
        "credit_packages_total": len(credit_package_list),
    }


@router.get("/period/{period_id}/history")
async def get_period_edit_history(
    period_id: int,
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """
    第3層：獲取指定 period 的編輯歷史（從 admin_metadata + REFUND transactions）
    """
    period = db.query(SubscriptionPeriod).filter_by(id=period_id).first()
    if not period:
        raise HTTPException(status_code=404, detail="Subscription period not found")

    # 解析 admin_metadata 中的 operations
    edit_history = []
    if period.admin_metadata and isinstance(period.admin_metadata, dict):
        operations = period.admin_metadata.get("operations", [])
        edit_history = operations

    # 🆕 查詢 REFUND transactions（透過 payment_id 關聯）
    if period.payment_id:
        # 先找出原始 RECHARGE transaction
        original_transaction = (
            db.query(TeacherSubscriptionTransaction)
            .filter_by(external_transaction_id=period.payment_id)
            .first()
        )

        if original_transaction:
            # 查詢所有關聯的 REFUND transactions
            refund_transactions = (
                db.query(TeacherSubscriptionTransaction)
                .filter_by(
                    original_transaction_id=original_transaction.id,
                    transaction_type=TransactionType.REFUND,
                )
                .order_by(TeacherSubscriptionTransaction.created_at)
                .all()
            )

            # 加入 REFUND 記錄到歷史中
            for refund_txn in refund_transactions:
                # 查詢操作者（admin）
                admin_user = (
                    db.query(Teacher)
                    .filter_by(id=refund_txn.refund_initiated_by)
                    .first()
                )

                edit_history.append(
                    {
                        "action": "refund",
                        "timestamp": refund_txn.created_at.isoformat(),
                        "admin_name": admin_user.name if admin_user else "Unknown",
                        "admin_email": admin_user.email if admin_user else "unknown",
                        "reason": refund_txn.refund_reason or "",
                        "notes": refund_txn.refund_notes or "",
                        "amount": abs(float(refund_txn.amount)),
                        "refund_id": refund_txn.external_transaction_id,
                        "changes": {
                            "status": {"from": "active", "to": "cancelled"},
                            "payment_status": {"from": "paid", "to": "refunded"},
                        },
                    }
                )

    # 按時間排序（最新的在前）
    edit_history.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

    return {
        "period_id": period.id,
        "plan_name": period.plan_name,
        "edit_history": edit_history,
    }


# ============ Analytics APIs ============
@router.get("/analytics/transactions")
async def get_transaction_analytics(
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """
    交易分析：獲取所有付款交易記錄
    返回：教師、時間、金額、方案
    """
    # 查詢所有成功的交易記錄（含 teacher 資訊）
    # Note: TeacherSubscriptionTransaction 使用 status 欄位，不是 payment_status
    # status 可能值: PENDING, SUCCESS, FAILED (參考 TransactionStatus enum)
    transactions = (
        db.query(TeacherSubscriptionTransaction, Teacher)
        .join(Teacher, TeacherSubscriptionTransaction.teacher_id == Teacher.id)
        .filter(TeacherSubscriptionTransaction.status.in_(["SUCCESS", "paid"]))  # 兼容舊資料
        .order_by(TeacherSubscriptionTransaction.created_at.desc())
        .all()
    )

    transaction_list = []
    for txn, teacher in transactions:
        transaction_list.append(
            {
                "id": txn.id,
                "teacher_id": teacher.id,
                "teacher_name": teacher.name,
                "teacher_email": teacher.email,
                "amount": txn.amount,
                # 使用 subscription_type 而非 plan_name (生產環境欄位)
                "plan_name": txn.subscription_type or "Unknown",
                "payment_method": txn.payment_method or "Unknown",
                "status": txn.status,
                "created_at": txn.created_at.isoformat(),
                # 使用 external_transaction_id 而非 rec_trade_id
                "rec_trade_id": txn.external_transaction_id or "",
            }
        )

    # 計算月度統計
    monthly_stats = defaultdict(lambda: {"total": 0, "by_teacher": defaultdict(int)})

    for txn, teacher in transactions:
        if txn.created_at:
            month_key = txn.created_at.strftime("%Y-%m")
            monthly_stats[month_key]["total"] += txn.amount
            monthly_stats[month_key]["by_teacher"][teacher.name] += txn.amount

    # 轉換為列表格式
    monthly_data = []
    for month, data in sorted(monthly_stats.items()):
        monthly_data.append(
            {
                "month": month,
                "total": data["total"],
                "by_teacher": dict(data["by_teacher"]),
            }
        )

    return {
        "transactions": transaction_list,
        "total_count": len(transaction_list),
        "total_revenue": sum(txn.amount for txn, _ in transactions),
        "monthly_stats": monthly_data,
    }


@router.get("/analytics/learning")
async def get_learning_analytics(
    db: Session = Depends(get_db),
    admin: Teacher = Depends(get_current_admin),
):
    """
    學習分析：獲取教師的班級、學生、作業、點數使用統計
    """
    # 1. 獲取所有教師的基本統計
    teachers = db.query(Teacher).all()

    teacher_stats = []
    for teacher in teachers:
        # 統計班級數
        classrooms_count = (
            db.query(Classroom)
            .filter(Classroom.teacher_id == teacher.id, Classroom.is_active.is_(True))
            .count()
        )

        # 統計學生數（透過 classroom_students 關聯表）
        students_count = (
            db.query(Student.id)
            .join(ClassroomStudent, Student.id == ClassroomStudent.student_id)
            .join(Classroom, ClassroomStudent.classroom_id == Classroom.id)
            .filter(
                Classroom.teacher_id == teacher.id,
                Student.is_active.is_(True),
                ClassroomStudent.is_active.is_(True),
            )
            .distinct()
            .count()
        )

        # 統計作業數
        assignments_count = (
            db.query(Assignment)
            .filter(Assignment.teacher_id == teacher.id, Assignment.is_active.is_(True))
            .count()
        )

        # 統計總點數使用
        total_points_used = (
            db.query(func.sum(PointUsageLog.points_used))
            .filter(PointUsageLog.teacher_id == teacher.id)
            .scalar()
            or 0
        )

        teacher_stats.append(
            {
                "teacher_id": teacher.id,
                "teacher_name": teacher.name,
                "teacher_email": teacher.email,
                "classrooms_count": classrooms_count,
                "students_count": students_count,
                "assignments_count": assignments_count,
                "total_points_used": total_points_used,
            }
        )

    # 2. 月度點數使用統計
    # 查詢所有點數使用記錄
    usage_logs = (
        db.query(PointUsageLog, Teacher, Classroom, Student)
        .join(Teacher, PointUsageLog.teacher_id == Teacher.id)
        .outerjoin(Student, PointUsageLog.student_id == Student.id)
        .outerjoin(ClassroomStudent, Student.id == ClassroomStudent.student_id)
        .outerjoin(Classroom, ClassroomStudent.classroom_id == Classroom.id)
        .order_by(PointUsageLog.created_at.desc())
        .all()
    )

    # 按月統計（group by teacher 和 classroom）
    monthly_points_by_teacher = defaultdict(
        lambda: defaultdict(lambda: {"total": 0, "by_classroom": defaultdict(int)})
    )

    for log, teacher, classroom, student in usage_logs:
        if log.created_at:
            month_key = log.created_at.strftime("%Y-%m")
            monthly_points_by_teacher[month_key][teacher.name][
                "total"
            ] += log.points_used
            if classroom:
                monthly_points_by_teacher[month_key][teacher.name]["by_classroom"][
                    classroom.name
                ] += log.points_used

    # 轉換為列表格式
    monthly_points_data = []
    for month, teachers_data in sorted(monthly_points_by_teacher.items()):
        for teacher_name, data in teachers_data.items():
            monthly_points_data.append(
                {
                    "month": month,
                    "teacher_name": teacher_name,
                    "total_points": data["total"],
                    "by_classroom": dict(data["by_classroom"]),
                }
            )

    return {
        "teacher_stats": teacher_stats,
        "monthly_points_usage": monthly_points_data,
        "total_teachers": len(teachers),
        "total_points_used": sum(t["total_points_used"] for t in teacher_stats),
    }

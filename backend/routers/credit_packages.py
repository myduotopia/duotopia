"""
Credit Packages API - Purchase and manage credit packages (point bundles)
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text, func
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP

from dateutil.relativedelta import relativedelta
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional, Dict, Any, List
import logging
import uuid
import os
import json
import time

from database import get_db
from models import (
    Teacher,
    CreditPackage,
    TeacherSubscriptionTransaction,
    TransactionType,
    Organization,
    TeacherOrganization,
    TeacherSchool,
    School,
    Plan,
    GroupBuyTeam,
    GroupBuyMember,
)
from routers.teachers import get_current_teacher
from services.tappay_service import TapPayService
from services.topup_discount import get_teacher_topup_discount
from services.group_buy import (
    add_group_buy_school_to_org,
    compute_group_buy_total,
    create_group_buy_org_and_school,
    create_group_buy_period,
    find_owned_group_buy_org,
    mirror_group_buy_dual_write,
    validate_group_buy_plan,
)
from config.plans import (
    CREDIT_PACKAGES,
    ORG_ALLOWED_PACKAGES,
    CREDIT_PACKAGE_VALIDITY_DAYS,
)
from utils.bigquery_logger import (
    log_payment_attempt,
    log_payment_success,
    log_payment_failure,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/credit-packages", tags=["credit-packages"])

ENABLE_PAYMENT = os.getenv("ENABLE_PAYMENT", "false").lower() == "true"
ENVIRONMENT = os.getenv("ENVIRONMENT", "local")


# === Request/Response Models ===


class CreditPackagePurchaseRequest(BaseModel):
    prime: str  # TapPay prime token
    package_id: str  # "pkg-1000", "pkg-5000", etc.
    cardholder: Optional[Dict[str, Any]] = None


class CreditPackagePurchaseResponse(BaseModel):
    success: bool
    transaction_id: Optional[str] = None
    message: str
    credit_package_id: Optional[int] = None
    points_total: Optional[int] = None
    expires_at: Optional[str] = None


class CreditPackageInfo(BaseModel):
    id: int
    package_id: str
    points_total: int
    points_used: int
    points_remaining: int
    price_paid: int
    purchased_at: str
    expires_at: str
    status: str
    source: str


class OrgPurchaseRequest(BaseModel):
    prime: str
    package_id: str
    organization_id: str  # UUID as string
    cardholder: Optional[Dict[str, Any]] = None


class OrgRenewRequest(BaseModel):
    prime: str
    organization_id: str  # UUID as string
    cardholder: Optional[Dict[str, Any]] = None


class GroupBuyPlanInfo(BaseModel):
    name: str
    teacher_seats: int
    annual_fee: int  # per teacher
    total_amount: int  # annual_fee × teacher_seats
    topup_discount: float  # 0.85 / 0.90 / 0.95 — for "加購折扣" display
    monthly_quota: int  # quota_total granted per teacher per month
    display_order: int


class GroupBuyOpenRequest(BaseModel):
    prime: str
    plan_name: str  # group-buy plan name e.g. "團購-30席"
    cardholder: Optional[Dict[str, Any]] = None
    # Issue #768 comment #3 — Roster flow: the team leader supplies all member
    # emails up-front. List length must equal plan.teacher_seats - 1 (the
    # leader takes 1 seat). Optional for backward compatibility: when empty,
    # only the leader's binding is created (legacy path; admin uses PR #841
    # to add members later via /admin/subscription/create).
    member_emails: List[EmailStr] = []
    # Issue #768 comment 4638082532 item 2 — team leader's contact phone.
    # The original spec said "連絡電話(必填)"; we capture it here and ship
    # it into BigQuery audit so support can reach the buyer on refunds /
    # disputes. Server-side `min_length=1` (after strip) so a client
    # bypassing the frontend with curl can't silently submit empty —
    # which would defeat the audit purpose. `max_length=20` mirrors a
    # reasonable phone-number ceiling (intl prefix + digits + dashes).
    leader_phone: Optional[str] = Field(None, max_length=20)

    @field_validator("leader_phone")
    @classmethod
    def _phone_non_blank(cls, v):
        if v is None:
            return v
        stripped = v.strip()
        if not stripped:
            raise ValueError("leader_phone must not be empty or whitespace-only")
        return stripped


class GroupBuyOpenResponse(BaseModel):
    success: bool
    message: str
    transaction_id: Optional[str] = None
    organization_id: Optional[str] = None
    school_id: Optional[str] = None
    subscription_end_date: Optional[str] = None
    teacher_seat_limit: Optional[int] = None
    members_bound: Optional[int] = None


class TeamEmailValidationRequest(BaseModel):
    emails: List[EmailStr]

    @field_validator("emails")
    @classmethod
    def _cap(cls, v):
        # Pydantic-level cap so the validation error comes back as a
        # 422 (consistent with other request schema violations) and the
        # constraint is visible in the OpenAPI schema. Previously this
        # was a runtime `if len(...) > 100: raise HTTPException(400)`
        # inside the endpoint — same outcome but invisible to schema
        # consumers and inconsistent with other size limits.
        if len(v) > 100:
            raise ValueError("max 100 emails per request")
        return v


class TeamEmailStatus(BaseModel):
    # Always lowercased. There are TWO normalisation sites by design:
    #   1) The endpoint normalises + dedupes the request list so it
    #      drives a single batched SQL query and stable response order.
    #   2) The @field_validator below normalises the response field
    #      itself, so OpenAPI consumers and direct callers of this
    #      model (tests, internal services) get the same contract even
    #      if they bypass the endpoint. This is defence-in-depth, not
    #      redundancy — removing the validator would let any future
    #      caller leak mixed-case values into the response.
    email: str
    exists: bool
    verified: bool
    in_group_buy_team: bool
    # "ok" | "not_registered" | "not_verified" | "in_group_buy_team"
    status: str

    @field_validator("email", mode="before")
    @classmethod
    def _lower(cls, v):
        return v.strip().lower() if isinstance(v, str) else v


class TeamEmailValidationResponse(BaseModel):
    results: List[TeamEmailStatus]


# === Endpoints ===


@router.get("", response_model=List[CreditPackageInfo])
async def list_credit_packages(
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """List all credit packages for the current teacher"""
    packages = (
        db.query(CreditPackage)
        .filter(
            CreditPackage.teacher_id == current_teacher.id,
            CreditPackage.status.in_(["active", "expired"]),
        )
        .order_by(CreditPackage.expires_at.asc())
        .all()
    )

    return [
        CreditPackageInfo(
            id=pkg.id,
            package_id=pkg.package_id,
            points_total=pkg.points_total,
            points_used=pkg.points_used,
            points_remaining=pkg.points_remaining,
            price_paid=pkg.price_paid,
            purchased_at=pkg.purchased_at.isoformat(),
            expires_at=pkg.expires_at.isoformat(),
            status=pkg.status,
            source=pkg.source,
        )
        for pkg in packages
    ]


@router.post("/purchase", response_model=CreditPackagePurchaseResponse)
async def purchase_credit_package(
    request: Request,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """Purchase a credit package (individual teacher)"""

    if not ENABLE_PAYMENT:
        return CreditPackagePurchaseResponse(success=False, message="付款功能尚未開放，敬請期待！")

    # Parse request
    try:
        body = await request.body()
        body_json = json.loads(body)
        purchase_request = CreditPackagePurchaseRequest(**body_json)
    except Exception as e:
        logger.error(f"Failed to parse purchase request: {e}")
        raise HTTPException(status_code=400, detail="Invalid request format")

    # Validate package_id
    package_id = purchase_request.package_id
    if package_id not in CREDIT_PACKAGES:
        raise HTTPException(status_code=400, detail=f"Invalid package_id: {package_id}")

    pkg_config = CREDIT_PACKAGES[package_id]
    amount = pkg_config["price"]
    points_total = pkg_config["points"] + pkg_config["bonus"]

    # Group-buy topup discount (issue #768 Phase 2): if the teacher belongs
    # to one or more active group-buy schools, charge the best discounted
    # amount instead of the package list price. Frontend price is never
    # trusted — amount is server-side from CREDIT_PACKAGES, then discounted.
    # Stay in Decimal end-to-end (no float conversion) for financial precision.
    topup_discount = get_teacher_topup_discount(current_teacher, db)
    if topup_discount is not None:
        amount = int(
            (Decimal(amount) * topup_discount).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )

    # Audit trail
    start_time = time.time()
    idempotency_key = str(uuid.uuid4())
    order_number = f"PKG_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}_{current_teacher.id}"
    client_host = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent", "")
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))

    # Log attempt
    log_payment_attempt(
        transaction_id=order_number,
        user_id=current_teacher.id,
        user_email=current_teacher.email,
        amount=amount,
        plan_name=f"credit_package:{package_id}",
        prime_token=purchase_request.prime,
        request_data=body_json,
        user_agent=user_agent,
        client_ip=client_host,
    )

    now = datetime.now(timezone.utc)

    # Idempotency check: prevent duplicate charges within 60 seconds
    recent_purchase = (
        db.query(CreditPackage)
        .filter(
            CreditPackage.teacher_id == current_teacher.id,
            CreditPackage.package_id == package_id,
            CreditPackage.status == "active",
            CreditPackage.purchased_at > now - timedelta(seconds=60),
        )
        .first()
    )
    if recent_purchase:
        logger.warning(
            f"Duplicate purchase detected: teacher={current_teacher.id} pkg={package_id}"
        )
        return CreditPackagePurchaseResponse(
            success=True,
            transaction_id=recent_purchase.payment_id,
            message=f"此筆訂單已完成購買",
            credit_package_id=recent_purchase.id,
            points_total=recent_purchase.points_total,
            expires_at=recent_purchase.expires_at.isoformat(),
        )

    try:
        # Call TapPay
        tappay_service = TapPayService()
        gateway_response = tappay_service.process_payment(
            prime=purchase_request.prime,
            amount=amount,
            details={
                "item_name": f"Credit Package: {package_id}",
                "type": "credit_package",
            },
            cardholder=purchase_request.cardholder
            or {"name": current_teacher.name, "email": current_teacher.email},
            order_number=order_number,
            remember=False,  # One-time purchase, no card saving needed
        )

        # Handle TapPay failure
        if gateway_response.get("status") != 0:
            error_msg = TapPayService.parse_error_code(
                gateway_response.get("status"), gateway_response.get("msg")
            )

            execution_time = int((time.time() - start_time) * 1000)
            log_payment_failure(
                transaction_id=order_number,
                user_id=current_teacher.id,
                user_email=current_teacher.email,
                amount=amount,
                plan_name=f"credit_package:{package_id}",
                error_stage="tappay_api",
                error_code=str(gateway_response.get("status")),
                error_message=error_msg,
                request_data=body_json,
                response_status=400,
                response_body=gateway_response,
                execution_time_ms=execution_time,
            )

            # Log failed transaction
            failed_txn = TeacherSubscriptionTransaction(
                teacher_id=current_teacher.id,
                teacher_email=current_teacher.email,
                transaction_type=TransactionType.RECHARGE,
                subscription_type=f"credit_package:{package_id}",
                amount=amount,
                currency="TWD",
                status="FAILED",
                months=0,
                period_start=now,
                period_end=now,
                new_end_date=now,
                idempotency_key=idempotency_key,
                ip_address=client_host,
                user_agent=user_agent,
                request_id=request_id,
                payment_provider="tappay",
                payment_method="credit_card",
                external_transaction_id=gateway_response.get("rec_trade_id"),
                failure_reason=error_msg,
                error_code=str(gateway_response.get("status")),
                gateway_response=gateway_response,
                processed_at=now,
            )
            db.add(failed_txn)
            db.commit()

            raise HTTPException(status_code=400, detail=error_msg)

        # Payment successful - create CreditPackage
        external_transaction_id = gateway_response.get("rec_trade_id")
        expires_at = now + timedelta(days=CREDIT_PACKAGE_VALIDITY_DAYS)

        credit_package = CreditPackage(
            teacher_id=current_teacher.id,
            package_id=package_id,
            points_total=points_total,
            points_used=0,
            price_paid=amount,
            purchased_at=now,
            expires_at=expires_at,
            status="active",
            payment_id=external_transaction_id,
            source="purchase",
        )
        db.add(credit_package)

        # Create transaction record
        txn = TeacherSubscriptionTransaction(
            teacher_id=current_teacher.id,
            teacher_email=current_teacher.email,
            transaction_type=TransactionType.RECHARGE,
            subscription_type=f"credit_package:{package_id}",
            amount=amount,
            currency="TWD",
            status="SUCCESS",
            months=0,
            period_start=now,
            period_end=expires_at,
            new_end_date=expires_at,
            processed_at=now,
            idempotency_key=idempotency_key,
            ip_address=client_host,
            user_agent=user_agent,
            request_id=request_id,
            payment_provider="tappay",
            payment_method="credit_card",
            external_transaction_id=external_transaction_id,
            gateway_response=gateway_response,
        )
        db.add(txn)
        db.commit()

        # Log success
        execution_time = int((time.time() - start_time) * 1000)
        log_payment_success(
            transaction_id=external_transaction_id,
            user_id=current_teacher.id,
            user_email=current_teacher.email,
            amount=amount,
            plan_name=f"credit_package:{package_id}",
            tappay_response=gateway_response,
            tappay_rec_trade_id=external_transaction_id,
            execution_time_ms=execution_time,
        )

        logger.info(
            f"Credit package purchased: teacher={current_teacher.id} "
            f"pkg={package_id} points={points_total} expires={expires_at.date()}"
        )

        # Issue #637: reward the referrer on the referred teacher's first paid
        # credit-package purchase (non-fatal — never block the purchase).
        try:
            from services.promo_reward_service import dispatch_credit_package_reward

            dispatch_credit_package_reward(db, current_teacher.id, package_id)
        except Exception as e:
            logger.error(
                f"Referral credit-package reward failed for teacher "
                f"{current_teacher.id}: {e}"
            )

        return CreditPackagePurchaseResponse(
            success=True,
            transaction_id=external_transaction_id,
            message=f"成功購買 {pkg_config['points']:,} 點數包",
            credit_package_id=credit_package.id,
            points_total=points_total,
            expires_at=expires_at.isoformat(),
        )

    except HTTPException:
        raise
    except Exception as e:
        execution_time = int((time.time() - start_time) * 1000)
        logger.error(f"Credit package purchase error: {e}")
        log_payment_failure(
            transaction_id=order_number,
            user_id=current_teacher.id,
            user_email=current_teacher.email,
            amount=amount,
            plan_name=f"credit_package:{package_id}",
            error_stage="server_error",
            error_code="INTERNAL_ERROR",
            error_message=str(e),
            request_data=body_json,
            response_status=500,
            response_body=None,
            execution_time_ms=execution_time,
        )
        raise HTTPException(status_code=500, detail="Purchase processing failed")


@router.post("/org-purchase", response_model=CreditPackagePurchaseResponse)
async def org_purchase_credit_package(
    request: Request,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """Purchase a credit package for an organization (org_owner only, pkg-20000 only)"""

    if not ENABLE_PAYMENT:
        return CreditPackagePurchaseResponse(success=False, message="付款功能尚未開放，敬請期待！")

    # Parse request
    try:
        body = await request.body()
        body_json = json.loads(body)
        purchase_request = OrgPurchaseRequest(**body_json)
    except Exception as e:
        logger.error(f"Failed to parse org purchase request: {e}")
        raise HTTPException(status_code=400, detail="Invalid request format")

    # Validate package
    package_id = purchase_request.package_id
    if package_id not in ORG_ALLOWED_PACKAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Organization can only purchase: {', '.join(ORG_ALLOWED_PACKAGES)}",
        )

    # Verify org_owner permission
    try:
        org_id = uuid.UUID(purchase_request.organization_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid organization_id format")

    organization = (
        db.query(Organization)
        .filter(Organization.id == org_id, Organization.is_active.is_(True))
        .first()
    )
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    membership = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == current_teacher.id,
            TeacherOrganization.organization_id == org_id,
            TeacherOrganization.is_active.is_(True),
        )
        .first()
    )
    if not membership or membership.role != "org_owner":
        raise HTTPException(
            status_code=403, detail="Only org_owner can purchase credit packages"
        )

    pkg_config = CREDIT_PACKAGES[package_id]
    amount = pkg_config["price"]
    points_total = pkg_config["points"] + pkg_config["bonus"]

    # Audit trail
    start_time = time.time()
    idempotency_key = str(uuid.uuid4())
    order_number = (
        f"ORG_PKG_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}_{org_id}"
    )
    client_host = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent", "")
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))

    # Log attempt
    log_payment_attempt(
        transaction_id=order_number,
        user_id=current_teacher.id,
        user_email=current_teacher.email,
        amount=amount,
        plan_name=f"org_credit_package:{package_id}",
        prime_token=purchase_request.prime,
        request_data=body_json,
        user_agent=user_agent,
        client_ip=client_host,
    )

    now = datetime.now(timezone.utc)

    try:
        # Call TapPay
        tappay_service = TapPayService()
        gateway_response = tappay_service.process_payment(
            prime=purchase_request.prime,
            amount=amount,
            details={
                "item_name": f"Org Credit Package: {package_id}",
                "type": "org_credit_package",
                "organization_id": str(org_id),
            },
            cardholder=purchase_request.cardholder
            or {"name": current_teacher.name, "email": current_teacher.email},
            order_number=order_number,
            remember=False,
        )

        if gateway_response.get("status") != 0:
            error_msg = TapPayService.parse_error_code(
                gateway_response.get("status"), gateway_response.get("msg")
            )

            execution_time = int((time.time() - start_time) * 1000)
            log_payment_failure(
                transaction_id=order_number,
                user_id=current_teacher.id,
                user_email=current_teacher.email,
                amount=amount,
                plan_name=f"org_credit_package:{package_id}",
                error_stage="tappay_api",
                error_code=str(gateway_response.get("status")),
                error_message=error_msg,
                request_data=body_json,
                response_status=400,
                response_body=gateway_response,
                execution_time_ms=execution_time,
            )

            raise HTTPException(status_code=400, detail=error_msg)

        # Payment successful - create org CreditPackage
        external_transaction_id = gateway_response.get("rec_trade_id")
        expires_at = now + timedelta(days=CREDIT_PACKAGE_VALIDITY_DAYS)

        credit_package = CreditPackage(
            organization_id=org_id,
            package_id=package_id,
            points_total=points_total,
            points_used=0,
            price_paid=amount,
            purchased_at=now,
            expires_at=expires_at,
            status="active",
            payment_id=external_transaction_id,
            source="org_purchase",
        )
        db.add(credit_package)
        db.commit()

        # Log success
        execution_time = int((time.time() - start_time) * 1000)
        log_payment_success(
            transaction_id=external_transaction_id,
            user_id=current_teacher.id,
            user_email=current_teacher.email,
            amount=amount,
            plan_name=f"org_credit_package:{package_id}",
            tappay_response=gateway_response,
            tappay_rec_trade_id=external_transaction_id,
            execution_time_ms=execution_time,
        )

        logger.info(
            f"Org credit package purchased: org={org_id} "
            f"pkg={package_id} points={points_total} expires={expires_at.date()}"
        )

        return CreditPackagePurchaseResponse(
            success=True,
            transaction_id=external_transaction_id,
            message=f"成功為機構購買 {pkg_config['points']:,} 點數包",
            credit_package_id=credit_package.id,
            points_total=points_total,
            expires_at=expires_at.isoformat(),
        )

    except HTTPException:
        raise
    except Exception as e:
        execution_time = int((time.time() - start_time) * 1000)
        logger.error(f"Org credit package purchase error: {e}")
        log_payment_failure(
            transaction_id=order_number,
            user_id=current_teacher.id,
            user_email=current_teacher.email,
            amount=amount,
            plan_name=f"org_credit_package:{package_id}",
            error_stage="server_error",
            error_code="INTERNAL_ERROR",
            error_message=str(e),
            request_data=body_json,
            response_status=500,
            response_body=None,
            execution_time_ms=execution_time,
        )
        raise HTTPException(status_code=500, detail="Purchase processing failed")


@router.post("/org-renew", response_model=CreditPackagePurchaseResponse)
async def org_renew_credit_package(
    request: Request,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """Renew org credit package - extends expiry and adds points to existing package"""

    if not ENABLE_PAYMENT:
        return CreditPackagePurchaseResponse(success=False, message="付款功能尚未開放，敬請期待！")

    # Parse request
    try:
        body = await request.body()
        body_json = json.loads(body)
        renew_request = OrgRenewRequest(**body_json)
    except Exception as e:
        logger.error(f"Failed to parse org renew request: {e}")
        raise HTTPException(status_code=400, detail="Invalid request format")

    # Verify org_owner permission
    try:
        org_id = uuid.UUID(renew_request.organization_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid organization_id format")

    organization = (
        db.query(Organization)
        .filter(Organization.id == org_id, Organization.is_active.is_(True))
        .first()
    )
    if not organization:
        raise HTTPException(status_code=404, detail="Organization not found")

    membership = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == current_teacher.id,
            TeacherOrganization.organization_id == org_id,
            TeacherOrganization.is_active.is_(True),
        )
        .first()
    )
    if not membership or membership.role != "org_owner":
        raise HTTPException(
            status_code=403, detail="Only org_owner can renew credit packages"
        )

    # Use pkg-20000 for org renewal
    package_id = "pkg-20000"
    pkg_config = CREDIT_PACKAGES[package_id]
    amount = pkg_config["price"]
    points_total = pkg_config["points"] + pkg_config["bonus"]

    start_time = time.time()
    order_number = (
        f"ORG_RENEW_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}_{org_id}"
    )
    now = datetime.now(timezone.utc)

    try:
        # Call TapPay
        tappay_service = TapPayService()
        gateway_response = tappay_service.process_payment(
            prime=renew_request.prime,
            amount=amount,
            details={
                "item_name": f"Org Credit Package Renewal: {package_id}",
                "type": "org_credit_package_renewal",
                "organization_id": str(org_id),
            },
            cardholder=renew_request.cardholder
            or {"name": current_teacher.name, "email": current_teacher.email},
            order_number=order_number,
            remember=False,
        )

        if gateway_response.get("status") != 0:
            error_msg = TapPayService.parse_error_code(
                gateway_response.get("status"), gateway_response.get("msg")
            )
            raise HTTPException(status_code=400, detail=error_msg)

        external_transaction_id = gateway_response.get("rec_trade_id")

        # Check for existing active org package
        existing_pkg = (
            db.query(CreditPackage)
            .filter(
                CreditPackage.organization_id == org_id,
                CreditPackage.status == "active",
                CreditPackage.expires_at > now,
            )
            .order_by(CreditPackage.expires_at.desc())
            .first()
        )

        if existing_pkg:
            # Extend existing package
            existing_pkg.expires_at = existing_pkg.expires_at + timedelta(
                days=CREDIT_PACKAGE_VALIDITY_DAYS
            )
            existing_pkg.points_total += points_total
            existing_pkg.updated_at = now
            credit_package = existing_pkg

            logger.info(
                f"Org credit package renewed: org={org_id} "
                f"extended_to={existing_pkg.expires_at.date()} "
                f"new_total={existing_pkg.points_total}"
            )
        else:
            # Create new package
            credit_package = CreditPackage(
                organization_id=org_id,
                package_id=package_id,
                points_total=points_total,
                points_used=0,
                price_paid=amount,
                purchased_at=now,
                expires_at=now + timedelta(days=CREDIT_PACKAGE_VALIDITY_DAYS),
                status="active",
                payment_id=external_transaction_id,
                source="org_purchase",
            )
            db.add(credit_package)

            logger.info(
                f"Org credit package created (no existing): org={org_id} "
                f"points={points_total}"
            )

        db.commit()

        return CreditPackagePurchaseResponse(
            success=True,
            transaction_id=external_transaction_id,
            message=f"成功為機構續購 {pkg_config['points']:,} 點數包",
            credit_package_id=credit_package.id,
            points_total=credit_package.points_total,
            expires_at=credit_package.expires_at.isoformat(),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Org credit package renewal error: {e}")
        raise HTTPException(status_code=500, detail="Renewal processing failed")


def _classify_team_emails(emails: list[str], db: Session) -> dict:
    """Batch-classify a list of (already-normalised, lowercased) teacher
    emails for group-buy team eligibility.

    Returns ``{email: (teacher_or_None, status)}`` keyed on the normalised
    address. Uses two SQL queries total — one for the teacher rows, one
    for the in-team membership check — regardless of input size. Replaces
    the prior per-email 2-3 round-trip helper that became an N+1 burden
    at the 100-email cap.

    status one of:
      - "ok"               teacher exists, email_verified, not in any group-buy team
      - "not_registered"   no Teacher row for this email
      - "not_verified"     Teacher exists but email_verified is False
      - "in_group_buy_team" Teacher is already an active member of some
                           active group-buy school (any team — they can't
                           be in two at once)
    """
    # Value tuple: (Teacher row or None when the email is unknown,
    # eligibility status string from the documented set).
    out: dict[str, tuple[Optional[Teacher], str]] = {}
    if not emails:
        return out
    # Filter on `is_active=True` so a deactivated teacher (admin off-board,
    # GDPR delete, etc.) is treated as not_registered rather than slipping
    # through with status="ok" and getting bound to a new team. Inactive
    # rows would otherwise pass both the verified-email and not-in-team
    # checks and cause a downstream binding to a disabled account.
    # Match emails case-insensitively (func.lower) — auth registration
    # normalises new emails to lowercase but legacy / admin-created rows
    # in this project (and confirmed in `auth.py` login at L114) carry
    # mixed-case addresses. Skipping `func.lower` here would leak those
    # legitimate accounts as `not_registered` and have the roster reject
    # real teachers. Dict key is also lowercased so the per-email lookup
    # in the loop below matches the input keys.
    teachers = (
        db.query(Teacher)
        .filter(
            func.lower(Teacher.email).in_(emails),
            Teacher.is_active.is_(True),
        )
        .all()
    )
    by_email = {t.email.lower(): t for t in teachers}
    teacher_ids_verified = [t.id for t in teachers if t.email_verified]
    in_team_ids: set[int] = set()
    if teacher_ids_verified:
        # issue #862 read-switch：改讀新表 group_buy_members → group_buy_teams
        # 判定「已在某團購團隊」，取代舊 TeacherSchool→School→Org(group_buy) join。
        in_team_ids = {
            row[0]
            for row in db.query(GroupBuyMember.teacher_id)
            .join(GroupBuyTeam, GroupBuyTeam.id == GroupBuyMember.team_id)
            .filter(
                GroupBuyMember.teacher_id.in_(teacher_ids_verified),
                GroupBuyMember.is_active.is_(True),
                GroupBuyTeam.is_active.is_(True),
            )
            .all()
        }
    for email in emails:
        teacher = by_email.get(email)
        if teacher is None:
            out[email] = (None, "not_registered")
        elif not teacher.email_verified:
            out[email] = (teacher, "not_verified")
        elif teacher.id in in_team_ids:
            out[email] = (teacher, "in_group_buy_team")
        else:
            out[email] = (teacher, "ok")
    return out


@router.post("/validate-team-emails", response_model=TeamEmailValidationResponse)
async def validate_team_emails(
    body: TeamEmailValidationRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """Batch-validate a list of teacher emails for group-buy roster (issue
    #768 comment #3). The frontend calls this on-blur per email plus once
    after CSV import to render ✓/✗ badges and offer the share-invite path
    for not_registered / not_verified emails.

    Auth: any authenticated teacher. Note: teacher auth is identity
    verification, NOT throttling — a determined attacker with a teacher
    account could enumerate up to 100 emails per call across many calls.
    Accepted risk for now because (a) caller is logged in and traceable
    via audit logs, (b) the response leaks only eligibility booleans, no
    PII like name / last-login / phone. A per-teacher rate limit (Redis
    token bucket) is the right follow-up if enumeration shows up in
    BigQuery scrutiny.
    """
    # Normalise then dedup so the response contract is "one row per unique
    # email", preserving first-occurrence order. Without the dedup, a
    # caller passing the same email twice gets two identical response
    # rows — surprising, and easy to silently break downstream consumers.
    # The 2-query batch is bounded regardless of input size.
    normalized: List[str] = []
    seen: set[str] = set()
    for raw in body.emails:
        email = raw.strip().lower()
        if email in seen:
            continue
        seen.add(email)
        normalized.append(email)
    classified = _classify_team_emails(normalized, db)
    results: List[TeamEmailStatus] = []
    for email in normalized:
        teacher, status = classified.get(email, (None, "not_registered"))
        results.append(
            TeamEmailStatus(
                email=email,
                exists=teacher is not None,
                verified=bool(teacher and teacher.email_verified),
                in_group_buy_team=(status == "in_group_buy_team"),
                status=status,
            )
        )
    return TeamEmailValidationResponse(results=results)


@router.get("/group-buy-plans", response_model=List[GroupBuyPlanInfo])
async def list_group_buy_plans(
    db: Session = Depends(get_db),
):
    """List active group-buy plans for the open-group page (issue #768 Phase 5-2).

    Auth: public (issue #768 comment #3 part 2). The /pricing marketing page
    fetches this for anonymous visitors so admin plan-edit changes flow
    through to the public site automatically. Returned data is pricing
    metadata only — never user-identifying information.
    """
    rows = (
        db.query(Plan)
        .filter(
            Plan.is_active.is_(True),
            Plan.teacher_seats.isnot(None),
            Plan.annual_fee.isnot(None),
            Plan.topup_discount.isnot(None),
        )
        .order_by(Plan.display_order.asc(), Plan.teacher_seats.asc())
        .all()
    )
    return [
        GroupBuyPlanInfo(
            name=p.name,
            teacher_seats=p.teacher_seats,
            annual_fee=p.annual_fee,
            total_amount=p.annual_fee * p.teacher_seats,
            topup_discount=float(p.topup_discount),
            monthly_quota=p.quota or 0,
            display_order=p.display_order,
        )
        for p in rows
    ]


@router.post("/group-buy-open", response_model=GroupBuyOpenResponse)
async def open_group_buy(
    request: Request,
    open_request: GroupBuyOpenRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """Open a new group-buy team (issue #768 Phase 3, 五.3).

    Charges `teacher_seats × annual_fee` (server-authoritative — frontend
    plan_name is the only input from the client, total is derived from the
    Plan row) via TapPay, then atomically creates a new Organization,
    School, owner TeacherSchool binding, and first month's SubscriptionPeriod
    for the team leader. Subsequent monthly grants are issued by
    /api/cron/monthly-renewal Phase 3.
    """
    if not ENABLE_PAYMENT:
        return GroupBuyOpenResponse(success=False, message="付款功能尚未開放，敬請期待！")

    # Reconstruct the raw body dict for audit logging (FastAPI already
    # validated `open_request` and would return 422 on bad input).
    body_json = open_request.model_dump()

    # Server-side plan validation and amount computation
    try:
        plan = validate_group_buy_plan(open_request.plan_name, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    amount = compute_group_buy_total(plan)
    now = datetime.now(timezone.utc)

    # Issue #768 comment #3 — Roster pre-validation. The leader's request
    # supplies all member emails up-front; we refuse to charge TapPay if
    # any one is ineligible. Three rules:
    #
    #   1. Shape: len(member_emails) == plan.teacher_seats - 1
    #      (the leader takes one seat themselves)
    #   2. Distinct: no duplicates within the list AND must NOT include the
    #      leader's own email
    #   3. Eligibility: each email is a registered, email-verified teacher
    #      AND is not already in another active group-buy team
    #
    # When `member_emails` is empty we keep the legacy behaviour (open team
    # with only the leader; admin uses PR #841's /admin/subscription/create
    # to backfill members). This matters because PR #841's flow is still
    # the recovery path when a member fails verification post-purchase.
    normalized_member_emails = [e.strip().lower() for e in open_request.member_emails]
    if normalized_member_emails:
        required_count = plan.teacher_seats - 1
        if len(normalized_member_emails) != required_count:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"This plan needs exactly {required_count} member "
                    f"emails (excluding the team leader); got "
                    f"{len(normalized_member_emails)}."
                ),
            )
        leader_email = current_teacher.email.strip().lower()
        if leader_email in normalized_member_emails:
            raise HTTPException(
                status_code=400,
                detail="Member emails must not include the team leader's email.",
            )
        if len(set(normalized_member_emails)) != len(normalized_member_emails):
            raise HTTPException(
                status_code=400,
                detail="Member emails must be distinct.",
            )
        # Single batched 2-query classification for the whole roster
        # (matches the validate-team-emails endpoint perf profile).
        classified = _classify_team_emails(normalized_member_emails, db)
        failed_members: list[dict] = []
        for email in normalized_member_emails:
            _t, status = classified.get(email, (None, "not_registered"))
            if status != "ok":
                failed_members.append({"email": email, "status": status})
        if failed_members:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": (
                        "Some member emails are not eligible. Please update "
                        "the roster and try again."
                    ),
                    "failed": failed_members,
                },
            )

    # Audit trail
    start_time = time.time()
    idempotency_key = str(uuid.uuid4())
    order_number = f"GBOPEN_{now.strftime('%Y%m%d%H%M%S%f')}_{current_teacher.id}"
    client_host = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent", "")
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))

    log_payment_attempt(
        transaction_id=order_number,
        user_id=current_teacher.id,
        user_email=current_teacher.email,
        amount=amount,
        plan_name=plan.name,
        prime_token=open_request.prime,
        request_data=body_json,
        user_agent=user_agent,
        client_ip=client_host,
    )

    # F2 — Race-safe concurrent-request guard: acquire a Postgres advisory
    # xact-lock keyed on teacher_id BEFORE the recent-transaction lookup so
    # two concurrent requests (mobile retry, double-tap) can't both pass the
    # check and double-charge. Lock auto-releases at request end.
    # SQLite tests are single-threaded; the dialect guard is a no-op there.
    # Use db.get_bind() (SQLAlchemy 2.x idiom) instead of db.bind.
    #
    # issue #838 — The lock key is scoped by teacher_id ONLY (previously
    # (teacher_id, plan_name)). Now that a repeat open accretes a new 分校
    # onto the teacher's single group-buy org, ALL of a teacher's concurrent
    # opens must serialise — otherwise two different-plan requests could race
    # `find_owned_group_buy_org` and either create two orphaned orgs or lose
    # an `org.teacher_limit` read-modify-write update. Serialising per-teacher
    # replaces the old R2-F2 409 guard that used to cover this edge. The 60s
    # idempotency shortcut below (keyed on teacher+plan) still prevents a
    # same-plan double-tap from double-charging once the lock is held.
    if db.get_bind().dialect.name == "postgresql":
        lock_key = f"group_buy_open:{current_teacher.id}"
        locked = db.execute(
            text("SELECT pg_try_advisory_xact_lock(hashtext(:k))"),
            {"k": lock_key},
        ).scalar()
        if not locked:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Another open-group request is in progress for this "
                    "teacher; please retry in a moment."
                ),
            )

    # issue #838 — A repeat open by the same 發起人 is NO LONGER rejected.
    # Instead it is treated as 新增一個分校: the provisioning block below
    # reuses the teacher's existing group-buy org and adds a new School.
    # Double-charge on an accidental double-submit is still prevented by the
    # per-teacher advisory xact-lock above (serialises all of a teacher's
    # concurrent opens) plus the 60s idempotency shortcut below (returns the
    # original transaction without re-charging).

    # Idempotency (post-lock): a recent SUCCESS transaction for this
    # (teacher, plan) within 60s means the previous request already opened
    # the group — return its transaction id without re-charging.
    recent = (
        db.query(TeacherSubscriptionTransaction)
        .filter(
            TeacherSubscriptionTransaction.teacher_id == current_teacher.id,
            TeacherSubscriptionTransaction.subscription_type == plan.name,
            TeacherSubscriptionTransaction.status == "SUCCESS",
            TeacherSubscriptionTransaction.processed_at > now - timedelta(seconds=60),
        )
        .first()
    )
    if recent is not None:
        logger.warning(
            f"Duplicate group-buy open detected: teacher={current_teacher.id} "
            f"plan={plan.name}"
        )
        # R2-F5 — Frontend uses org_id / school_id / subscription_end_date to
        # redirect the user to their new team page. On a 60s retry we must
        # populate the same fields, not return null.
        owned_org = (
            db.query(Organization)
            .join(
                TeacherOrganization,
                TeacherOrganization.organization_id == Organization.id,
            )
            .filter(
                TeacherOrganization.teacher_id == current_teacher.id,
                TeacherOrganization.role == "org_owner",
                TeacherOrganization.is_active.is_(True),
                Organization.org_type == "group_buy",
            )
            .order_by(Organization.created_at.desc())
            .first()
        )
        # 5-1 R3.2 — If a SUCCESS transaction exists but the org/school
        # records don't, the data is inconsistent (soft-delete race, manual
        # deactivation, or a partial provisioning failure that wasn't
        # caught). Returning success with null IDs would silently break
        # the frontend redirect — fail loud instead so ops can investigate.
        owned_school = (
            db.query(School)
            .filter(
                School.organization_id == owned_org.id,
                School.plan_id == plan.id,
            )
            .order_by(School.created_at.desc())
            .first()
            if owned_org is not None
            else None
        )
        if owned_org is None or owned_school is None:
            logger.error(
                "Idempotency-shortcut data inconsistency: SUCCESS txn "
                f"id={recent.id} rec_trade_id={recent.external_transaction_id} "
                f"for teacher={current_teacher.id} plan={plan.name} but "
                f"owned_org={owned_org!r} owned_school={owned_school!r}. "
                "Manual investigation required."
            )
            raise HTTPException(
                status_code=500,
                detail=(
                    "Team setup is incomplete despite a prior successful "
                    "charge. Our team has been alerted — please contact "
                    "support."
                ),
            )
        # Idempotent retry path — surface current bound member count so
        # the frontend can re-render the post-purchase success screen
        # with a count consistent with the new-path response. New path
        # returns `members_bound` = members only (leader excluded), so
        # we exclude `current_teacher.id` here too to keep the two paths
        # numerically interchangeable.
        retry_bound = (
            db.query(TeacherSchool)
            .filter(
                TeacherSchool.school_id == owned_school.id,
                TeacherSchool.is_active.is_(True),
                TeacherSchool.teacher_id != current_teacher.id,
            )
            .count()
        )
        return GroupBuyOpenResponse(
            success=True,
            message="此筆開團已完成",
            transaction_id=recent.external_transaction_id,
            organization_id=str(owned_org.id),
            school_id=str(owned_school.id),
            subscription_end_date=(
                owned_org.subscription_end_date.isoformat()
                if owned_org.subscription_end_date
                else None
            ),
            teacher_seat_limit=owned_school.teacher_seat_limit,
            members_bound=retry_bound,
        )

    try:
        tappay_service = TapPayService()
        gateway_response = tappay_service.process_payment(
            prime=open_request.prime,
            amount=amount,
            details={
                "item_name": f"Group Buy: {plan.name}",
                "type": "group_buy_open",
            },
            cardholder=open_request.cardholder
            or {"name": current_teacher.name, "email": current_teacher.email},
            order_number=order_number,
            remember=False,
        )

        if gateway_response.get("status") != 0:
            error_msg = TapPayService.parse_error_code(
                gateway_response.get("status"), gateway_response.get("msg")
            )
            execution_time = int((time.time() - start_time) * 1000)
            log_payment_failure(
                transaction_id=order_number,
                user_id=current_teacher.id,
                user_email=current_teacher.email,
                amount=amount,
                plan_name=plan.name,
                error_stage="tappay_api",
                error_code=str(gateway_response.get("status")),
                error_message=error_msg,
                request_data=body_json,
                response_status=400,
                response_body=gateway_response,
                execution_time_ms=execution_time,
            )
            failed_txn = TeacherSubscriptionTransaction(
                teacher_id=current_teacher.id,
                teacher_email=current_teacher.email,
                transaction_type=TransactionType.RECHARGE,
                subscription_type=plan.name,
                amount=amount,
                currency="TWD",
                status="FAILED",
                months=12,
                period_start=now,
                period_end=now + relativedelta(years=1),
                new_end_date=now,
                idempotency_key=idempotency_key,
                ip_address=client_host,
                user_agent=user_agent,
                request_id=request_id,
                payment_provider="tappay",
                payment_method="credit_card",
                external_transaction_id=gateway_response.get("rec_trade_id"),
                failure_reason=error_msg,
                error_code=str(gateway_response.get("status")),
                gateway_response=gateway_response,
                processed_at=now,
            )
            db.add(failed_txn)
            db.commit()
            raise HTTPException(status_code=400, detail=error_msg)

        # F1 — Payment captured. Card is already charged. Any DB failure
        # past this line means the user paid but did not receive their team,
        # so we MUST surface a compensation record (manual refund or hand-
        # provision) — we cannot silently 500 and swallow the rec_trade_id.
        external_transaction_id = gateway_response.get("rec_trade_id")
        try:
            # issue #838 — reuse-or-create. If the 發起人 already owns a
            # group-buy org, this repeat open adds a new 分校 (School) under
            # it; otherwise a fresh org+school is created. Either way the
            # 發起人 contact info (email + leader_phone) is persisted on the
            # org.
            existing_org = find_owned_group_buy_org(current_teacher, db)
            if existing_org is not None:
                org = existing_org
                school, _ = add_group_buy_school_to_org(
                    current_teacher,
                    org,
                    plan,
                    db,
                    now=now,
                    leader_phone=open_request.leader_phone,
                )
            else:
                org, school, _, _ = create_group_buy_org_and_school(
                    current_teacher,
                    plan,
                    db,
                    now=now,
                    leader_phone=open_request.leader_phone,
                )
            create_group_buy_period(
                current_teacher,
                plan,
                db,
                start=now,
                payment_id=external_transaction_id,
            )

            # Issue #768 comment #3 — Atomic multi-bind. Inside the same
            # post-payment txn as the org/school/leader-period creation, we
            # bind every roster member and grant them their first monthly
            # period. Any failure here propagates to the compensation block
            # below: card already charged ⇒ "REFUND REQUIRED" log line ⇒
            # 500 to the leader. We re-run eligibility inside this txn (the
            # leader-fill window from roster to pay is hours; a member
            # could have joined another team in between). All-or-nothing.
            members_bound = 0
            if normalized_member_emails:
                # Batch the defensive in-tx re-check too — at the 50-seat
                # ceiling the per-email helper was 49 × 2 = 98 queries
                # inside the payment transaction. Single batch call drops
                # it to 2 queries regardless of roster size.
                classified_post = _classify_team_emails(normalized_member_emails, db)
                for email in normalized_member_emails:
                    member, status = classified_post.get(
                        email, (None, "not_registered")
                    )
                    if status != "ok":
                        # The error tag distinguishes (a) genuine race —
                        # member joined another team between roster fill
                        # and pay, from (b) partial-write retry — a prior
                        # transaction committed some TeacherSchool rows
                        # before crashing, so a retry sees those members
                        # as `in_group_buy_team`. Both outcomes route to
                        # the REFUND-REQUIRED compensation path; the
                        # different tag helps incident responders pick
                        # the right remediation (refund vs hand-finish).
                        # `email=` / `status=` key-value layout (instead
                        # of colon-delimited) so an email containing a
                        # colon doesn't break the incident-response
                        # regex grepping these logs.
                        raise RuntimeError(
                            "member_became_ineligible_or_partial_retry "
                            f"email={email!r} status={status!r}"
                        )
                    db.add(
                        TeacherSchool(
                            teacher_id=member.id,
                            school_id=school.id,
                            roles=["teacher"],
                            is_active=True,
                        )
                    )
                    create_group_buy_period(
                        member,
                        plan,
                        db,
                        start=now,
                        payment_id=external_transaction_id,
                    )
                    members_bound += 1

            # issue #862 雙寫：舊表（org/school/名冊/續約窗口）寫完後，於同一交易
            # best-effort 鏡射進 group_buy_teams/members。鏡射失敗只回滾鏡射本身，
            # **不可**讓一筆已扣款且 org/school/名冊都正常的購買被 rollback→退款
            # （共用 helper 內含 SAVEPOINT + logging；drift 由每月 cron re-sync 補平）。
            mirror_group_buy_dual_write(org, db, logger)

            success_txn = TeacherSubscriptionTransaction(
                teacher_id=current_teacher.id,
                teacher_email=current_teacher.email,
                transaction_type=TransactionType.RECHARGE,
                subscription_type=plan.name,
                amount=amount,
                currency="TWD",
                status="SUCCESS",
                months=12,
                period_start=now,
                period_end=org.subscription_end_date,
                new_end_date=org.subscription_end_date,
                idempotency_key=idempotency_key,
                ip_address=client_host,
                user_agent=user_agent,
                request_id=request_id,
                payment_provider="tappay",
                payment_method="credit_card",
                external_transaction_id=external_transaction_id,
                gateway_response=gateway_response,
                processed_at=now,
            )
            db.add(success_txn)
            db.commit()
        except Exception as provisioning_err:
            db.rollback()
            logger.error(
                "🚨 GROUP-BUY OPEN COMPENSATION REQUIRED — card was charged "
                "but DB provisioning failed. Refund or hand-provision needed. "
                f"teacher={current_teacher.id} email={current_teacher.email} "
                f"plan={plan.name} amount={amount} "
                f"rec_trade_id={external_transaction_id} "
                f"error={provisioning_err!r}"
            )
            execution_time = int((time.time() - start_time) * 1000)
            log_payment_failure(
                transaction_id=order_number,
                user_id=current_teacher.id,
                user_email=current_teacher.email,
                amount=amount,
                plan_name=plan.name,
                error_stage="provisioning_after_payment",
                error_code="DB_PROVISIONING_FAILED",
                error_message=(
                    f"REFUND REQUIRED rec_trade_id={external_transaction_id}: "
                    f"{provisioning_err}"
                ),
                request_data=body_json,
                response_status=500,
                response_body={
                    "rec_trade_id": external_transaction_id,
                    "error": str(provisioning_err),
                },
                execution_time_ms=execution_time,
            )
            # Best-effort: persist a FAILED transaction record carrying the
            # rec_trade_id so finance/audit queries can find the orphaned charge.
            try:
                comp_txn = TeacherSubscriptionTransaction(
                    teacher_id=current_teacher.id,
                    teacher_email=current_teacher.email,
                    transaction_type=TransactionType.RECHARGE,
                    subscription_type=plan.name,
                    amount=amount,
                    currency="TWD",
                    status="FAILED",
                    months=12,
                    period_start=now,
                    period_end=now + relativedelta(years=1),
                    new_end_date=now,
                    idempotency_key=idempotency_key,
                    ip_address=client_host,
                    user_agent=user_agent,
                    request_id=request_id,
                    payment_provider="tappay",
                    payment_method="credit_card",
                    external_transaction_id=external_transaction_id,
                    failure_reason=(
                        "REFUND REQUIRED — provisioning failed after charge: "
                        f"{provisioning_err!r}"
                    ),
                    error_code="PROVISIONING_AFTER_PAYMENT",
                    gateway_response=gateway_response,
                    processed_at=now,
                )
                db.add(comp_txn)
                db.commit()
            except Exception as comp_persist_err:
                # 5-1 R3.3 — If even the FAILED-record insert fails (DB
                # connection dropped mid-handler, network partition), emit
                # a structured ERROR-level log line carrying ALL fields ops
                # needs to refund manually. Log scrapers / alert rules
                # should match on the "GROUP_BUY_COMPENSATION_DB_LOST"
                # token. Also re-issue the original log_payment_failure
                # with a distinct error_code so BigQuery's payment_log table
                # picks it up via the independent client (not affected by
                # the broken DB session).
                logger.error(
                    "🚨 GROUP_BUY_COMPENSATION_DB_LOST — "
                    f"teacher_id={current_teacher.id} "
                    f"teacher_email={current_teacher.email} "
                    f"plan={plan.name} amount={amount} currency=TWD "
                    f"rec_trade_id={external_transaction_id} "
                    f"order_number={order_number} "
                    f"provisioning_err={provisioning_err!r} "
                    f"compensation_persist_err={comp_persist_err!r}",
                    exc_info=comp_persist_err,
                )
                try:
                    log_payment_failure(
                        transaction_id=order_number,
                        user_id=current_teacher.id,
                        user_email=current_teacher.email,
                        amount=amount,
                        plan_name=plan.name,
                        error_stage="compensation_record_lost",
                        error_code="GROUP_BUY_COMPENSATION_DB_LOST",
                        error_message=(
                            f"REFUND REQUIRED rec_trade_id="
                            f"{external_transaction_id}: provisioning failed "
                            f"({provisioning_err!r}) AND compensation insert "
                            f"failed ({comp_persist_err!r})"
                        ),
                        request_data=body_json,
                        response_status=500,
                        response_body={
                            "rec_trade_id": external_transaction_id,
                            "order_number": order_number,
                            "provisioning_err": str(provisioning_err),
                            "compensation_persist_err": str(comp_persist_err),
                        },
                        execution_time_ms=execution_time,
                    )
                except Exception:
                    logger.exception(
                        "BigQuery log_payment_failure also failed during "
                        "compensation-loss path"
                    )
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Payment captured (rec_trade_id={external_transaction_id})"
                    " but team provisioning failed. Our team has been alerted"
                    " and will refund or complete setup manually."
                ),
            )

        execution_time = int((time.time() - start_time) * 1000)
        log_payment_success(
            transaction_id=order_number,
            user_id=current_teacher.id,
            user_email=current_teacher.email,
            amount=amount,
            plan_name=plan.name,
            tappay_response=gateway_response,
            tappay_rec_trade_id=external_transaction_id,
            execution_time_ms=execution_time,
        )

        return GroupBuyOpenResponse(
            success=True,
            message="開團成功",
            transaction_id=external_transaction_id,
            organization_id=str(org.id),
            school_id=str(school.id),
            subscription_end_date=org.subscription_end_date.isoformat(),
            teacher_seat_limit=school.teacher_seat_limit,
            members_bound=members_bound,
        )

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Group-buy open error: {e}")
        raise HTTPException(status_code=500, detail="Group-buy open failed")

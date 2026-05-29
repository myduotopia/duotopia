"""
Credit Packages API - Purchase and manage credit packages (point bundles)
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel
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
)
from routers.teachers import get_current_teacher
from services.tappay_service import TapPayService
from services.topup_discount import get_teacher_topup_discount
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
    topup_discount = get_teacher_topup_discount(current_teacher, db)
    if topup_discount is not None:
        amount = int(round(amount * float(topup_discount)))

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

"""1Campus SSO authentication endpoints.

Provides:
- GET /api/auth/1campus/callback — handle code exchange + account matching
- POST /api/auth/1campus/merge-confirm — confirm account merge (requires signed token)
"""

import base64
import binascii
import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import create_access_token, get_current_user
from core.config import settings
from core.limiter import limiter
from database import get_db
from models.user import Identity, Student, Teacher
from models.organization import TeacherOrganization, TeacherSchool
from routers.students.auth import (
    _get_aggregated_classrooms,
)
from services.one_campus_service import (
    OneCampusService,
    OneCampusCodeNotFoundError,
    OneCampusCodeExpiredError,
)
from services.one_campus_account_service import OneCampusAccountService

# Merge token validity: 10 minutes
MERGE_TOKEN_TTL = 600

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth/1campus", tags=["auth-1campus"])


# --- Schemas ---


class OneCampusCallbackResponse(BaseModel):
    access_token: Optional[str] = None
    token_type: str = "bearer"
    role_type: str = "student"  # "student" or "teacher"
    student: Optional[dict] = None
    user: Optional[dict] = None  # teacher login response
    action: str  # "login", "created", "merge_prompt"
    merge_info: Optional[dict] = None


class MergeConfirmRequest(BaseModel):
    merge_token: str


class BindAccountRequest(BaseModel):
    email: str


# --- Helpers ---


def _create_merge_token(
    existing_identity_id: int,
    one_campus_student_id: str,
    one_campus_account: str,
) -> str:
    """Create an HMAC-signed merge token encoding identity data + expiry.

    Format: base64(json_payload).signature
    """
    payload_dict = {
        "id": existing_identity_id,
        "sid": one_campus_student_id,
        "acc": one_campus_account,
        "exp": int(time.time()) + MERGE_TOKEN_TTL,
    }
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload_dict).encode()).decode()
    sig = hmac.HMAC(
        settings.JWT_SECRET.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()
    return f"{payload_b64}.{sig}"


def _verify_merge_token(token: str) -> dict:
    """Verify and decode a merge token. Raises ValueError on failure."""
    parts = token.split(".", 1)
    if len(parts) != 2:
        raise ValueError("Invalid merge token format")

    payload_b64, sig = parts
    expected_sig = hmac.HMAC(
        settings.JWT_SECRET.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(sig, expected_sig):
        raise ValueError("Invalid merge token signature")

    try:
        payload_dict = json.loads(base64.urlsafe_b64decode(payload_b64))
    except (json.JSONDecodeError, UnicodeDecodeError, KeyError, binascii.Error) as e:
        raise ValueError(f"Invalid merge token payload: {e}")

    if payload_dict.get("exp", 0) < int(time.time()):
        raise ValueError("Merge token expired")

    return {
        "existing_identity_id": payload_dict["id"],
        "one_campus_student_id": payload_dict["sid"],
        "one_campus_account": payload_dict["acc"],
    }


def _build_student_response(db: Session, student: Student) -> dict:
    """Build the student login response payload (same shape as email login)."""
    classrooms_list = _get_aggregated_classrooms(db, student)
    first_cr = classrooms_list[0] if classrooms_list else None

    linked_accounts_count = 0
    if student.identity_id:
        linked_accounts_count = (
            db.query(Student)
            .filter(
                Student.identity_id == student.identity_id,
                Student.id != student.id,
                Student.is_active.is_(True),
            )
            .count()
        )

    return {
        "id": student.id,
        "name": student.name,
        "email": student.email,
        "student_number": student.student_number,
        "classroom_id": first_cr["id"] if first_cr else None,
        "classroom_name": first_cr["name"] if first_cr else None,
        "school_id": first_cr.get("school_id") if first_cr else None,
        "school_name": first_cr.get("school_name") if first_cr else None,
        "organization_id": (first_cr.get("organization_id") if first_cr else None),
        "organization_name": (first_cr.get("organization_name") if first_cr else None),
        "has_linked_accounts": linked_accounts_count > 0,
        "linked_accounts_count": linked_accounts_count,
        "classrooms": classrooms_list,
        "classrooms_count": len(classrooms_list),
    }


def _build_teacher_response(db: Session, teacher: Teacher) -> dict:
    """Build the teacher login response payload (same shape as email login)."""
    # Query organization role
    teacher_org = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == teacher.id,
            TeacherOrganization.is_active.is_(True),
        )
        .first()
    )

    # Query school role
    teacher_school = (
        db.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == teacher.id,
            TeacherSchool.is_active.is_(True),
        )
        .first()
    )

    # Determine role (priority: org > school > teacher)
    role = "teacher"
    organization_id = None
    school_id = None

    if teacher_org:
        role = teacher_org.role
        organization_id = str(teacher_org.organization_id)
    elif teacher_school:
        if teacher_school.roles and len(teacher_school.roles) > 0:
            role = teacher_school.roles[0]
        school_id = str(teacher_school.school_id)

    return {
        "id": teacher.id,
        "email": teacher.email,
        "name": teacher.name,
        "is_demo": teacher.is_demo,
        "is_admin": teacher.is_admin,
        "role": role,
        "organization_id": organization_id,
        "school_id": school_id,
    }


# --- Endpoints ---


@router.get("/callback")
@limiter.limit("10/minute")
async def one_campus_callback(
    request: Request,
    code: str = Query(..., description="1Campus one-time identity code"),
    schoolDsns: str = Query(..., description="School DSNS identifier"),
    db: Session = Depends(get_db),
):
    """Handle 1Campus SSO callback.

    1. Exchange code for identity info
    2. Fetch extended data (idNumberHash) via Data API
    3. Match or create account
    4. Return JWT token
    """
    # Step 1: Exchange identity code
    try:
        identity_data = await OneCampusService.exchange_identity_code(schoolDsns, code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OneCampusCodeNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="Identity code not found or already used. Please try logging in again.",
        )
    except OneCampusCodeExpiredError:
        raise HTTPException(
            status_code=410,
            detail="Identity code expired (30 second limit). Please try again.",
        )
    except Exception as e:
        logger.error("1Campus identity code exchange failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Failed to communicate with 1Campus. Please try again.",
        )

    role_type = identity_data.get("roleType", "")
    account = identity_data.get("account", "")

    # Step 2: Fetch extended data (idNumberHash) via Data API
    national_id_hash = None
    try:
        user_role_data = await OneCampusService.get_user_role(account=account)
        for school in user_role_data.get("school", []):
            # Try student role first, then teacher role
            for role_key in ("studentRole", "teacherRole"):
                role_data = school.get(role_key)
                if role_data and role_data.get("idNumberHash"):
                    national_id_hash = role_data["idNumberHash"]
                    break
            if national_id_hash:
                break
    except Exception as e:
        logger.warning("1Campus getUserRole failed (non-fatal): %s", e)

    # --- Teacher flow ---
    if role_type == "teacher":
        teacher_data = identity_data.get("teacher", {})
        teacher_name = teacher_data.get("teacherName", account)

        identity, teacher, action = OneCampusAccountService.find_or_create_teacher(
            db=db,
            one_campus_account=account,
            teacher_name=teacher_name,
            national_id_hash=national_id_hash,
            school_dsns=schoolDsns,
        )

        teacher_response = _build_teacher_response(db, teacher)

        access_token = create_access_token(
            data={
                "sub": str(teacher.id),
                "email": teacher.email,
                "type": "teacher",
                "name": teacher.name,
                "role": teacher_response["role"],
            },
            expires_delta=timedelta(hours=24),
        )

        return OneCampusCallbackResponse(
            access_token=access_token,
            role_type="teacher",
            user=teacher_response,
            action=action,
        )

    # --- Student flow ---
    if role_type != "student" or not identity_data.get("student"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported role type: {role_type}. Currently only student and teacher SSO are supported.",
        )

    student_data = identity_data["student"]
    one_campus_student_id = str(student_data["studentID"])
    student_name = student_data.get("studentName", "")
    student_number = student_data.get("studentNumber")

    # Step 3: Match or create account
    identity, student, action = OneCampusAccountService.find_or_create_student(
        db=db,
        one_campus_student_id=one_campus_student_id,
        one_campus_account=account,
        student_name=student_name,
        student_number=student_number,
        national_id_hash=national_id_hash,
        school_dsns=schoolDsns,
    )

    # Step 4: Handle result
    if action == "merge_prompt":
        merge_token = _create_merge_token(
            existing_identity_id=identity.id,
            one_campus_student_id=one_campus_student_id,
            one_campus_account=account,
        )
        return OneCampusCallbackResponse(
            action="merge_prompt",
            merge_info={
                "merge_token": merge_token,
                "existing_student_name": student.name if student else None,
                "new_one_campus_account": account,
                "new_student_name": student_name,
                "message": (
                    "We found an existing account that may belong to you. "
                    "Would you like to merge these accounts?"
                ),
            },
        )

    access_token = create_access_token(
        data={"sub": str(student.id), "type": "student"},
        expires_delta=timedelta(hours=24),
    )

    student.last_login = datetime.now(timezone.utc)
    db.commit()

    return OneCampusCallbackResponse(
        access_token=access_token,
        role_type="student",
        student=_build_student_response(db, student),
        action=action,
    )


@router.post("/merge-confirm")
@limiter.limit("10/minute")
async def merge_confirm(
    request: Request,
    body: MergeConfirmRequest,
    db: Session = Depends(get_db),
):
    """Confirm account merge after duplicate detection.

    Requires a signed merge_token issued by the callback endpoint.
    """
    try:
        token_data = _verify_merge_token(body.merge_token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        target_identity, primary_student = OneCampusAccountService.merge_accounts(
            db=db,
            target_identity_id=token_data["existing_identity_id"],
            one_campus_student_id=token_data["one_campus_student_id"],
            one_campus_account=token_data["one_campus_account"],
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    if not primary_student:
        raise HTTPException(
            status_code=500,
            detail="Merge completed but no student account found",
        )

    access_token = create_access_token(
        data={"sub": str(primary_student.id), "type": "student"},
        expires_delta=timedelta(hours=24),
    )

    return OneCampusCallbackResponse(
        access_token=access_token,
        student=_build_student_response(db, primary_student),
        action="merged",
    )


@router.get("/verify-teacher-bind")
@limiter.limit("10/minute")
async def verify_teacher_bind(
    request: Request,
    token: str = Query(..., description="Bind verification token"),
    db: Session = Depends(get_db),
):
    """Verify teacher bind token and perform Identity merge.

    Called when the teacher clicks the verification link in the bind email.
    The token encodes: identity_id, one_campus_account, target_email.
    """
    try:
        token_data = _verify_merge_token(token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    identity_id = token_data["existing_identity_id"]
    target_email = token_data["one_campus_account"]  # target email stored here

    # Find the Identity
    sso_identity = db.get(Identity, identity_id)
    if not sso_identity or not sso_identity.is_active:
        raise HTTPException(status_code=404, detail="Identity not found")

    # Find the teacher with this bind token
    teacher = (
        db.query(Teacher)
        .filter(
            Teacher.identity_id == identity_id,
            Teacher.email_verification_token == token,
            Teacher.is_active.is_(True),
        )
        .first()
    )
    if not teacher:
        raise HTTPException(status_code=400, detail="Invalid or expired bind token")

    # Perform the bind
    from services.identity_service import identity_service

    surviving_identity = identity_service.bind_1campus_identity_to_email(
        db, sso_identity, target_email, user_type="teacher"
    )

    # Update teacher email to the verified target email
    teacher.email = target_email
    teacher.email_verified = True
    teacher.email_verified_at = datetime.now(timezone.utc)
    teacher.email_verification_token = None

    # Update Identity email verification
    surviving_identity.email = target_email
    surviving_identity.email_verified = True
    surviving_identity.email_verified_at = datetime.now(timezone.utc)

    db.commit()

    logger.info(
        "Teacher bind verified: teacher_id=%s, email=%s, identity_id=%s",
        teacher.id,
        target_email,
        surviving_identity.id,
    )

    return {
        "message": "帳號綁定成功",
        "teacher_name": teacher.name,
        "email": target_email,
        "verified": True,
    }


@router.post("/bind-account")
@limiter.limit("5/minute")
async def bind_account(
    request: Request,
    body: BindAccountRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Request to bind a 1Campus SSO account to a Duotopia email.

    The caller must be logged in via 1Campus SSO (has an Identity with
    one_campus_student_id or one_campus_account but no verified email).
    Sends a verification email to the provided address.
    After verification, the Identity merge happens in verify-email endpoint.
    """
    user_type = current_user.get("type")
    user_id = int(current_user.get("sub"))

    # Resolve the Identity for the current user
    if user_type == "student":
        user = db.query(Student).filter(Student.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="Student not found")
        identity = (
            db.query(Identity).filter(Identity.id == user.identity_id).first()
            if user.identity_id
            else None
        )
    elif user_type == "teacher":
        user = db.query(Teacher).filter(Teacher.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="Teacher not found")
        identity = (
            db.query(Identity).filter(Identity.id == user.identity_id).first()
            if user.identity_id
            else None
        )
    else:
        raise HTTPException(status_code=400, detail="Unsupported user type")

    if not identity:
        raise HTTPException(
            status_code=400,
            detail="No identity found. Please log in via 1Campus SSO first.",
        )

    # Must be a 1Campus SSO account
    if not identity.one_campus_account:
        raise HTTPException(
            status_code=400,
            detail="This account is not linked to 1Campus SSO.",
        )

    # Must not already have a verified email
    if identity.email_verified and identity.email:
        raise HTTPException(
            status_code=400,
            detail="This account already has a verified email.",
        )

    target_email = body.email.strip().lower()

    if user_type == "student":
        from services.email_service import email_service
        from services.identity_service import identity_service

        # Set the email on the student record for verification flow
        user.email = target_email
        user.email_verified = False
        user.email_verified_at = None

        # Ensure Identity has the email (unverified) for later merge
        if not identity.email or identity.email != target_email:
            identity.email = target_email
            identity.email_verified = False

        # Send verification email (reuse existing flow)
        success = email_service.send_verification_email(db, user, target_email)
        if not success:
            raise HTTPException(
                status_code=500, detail="Failed to send verification email"
            )

        return {
            "message": "Verification email sent. Please check your inbox.",
            "email": target_email,
            "action": "verification_sent",
        }

    else:
        # Teacher flow — Do NOT overwrite teacher.email or identity.email
        # before verification. Use a signed bind token that encodes the
        # target email, store it as the teacher's verification token,
        # and send the actual email.
        from services.email_service import email_service

        # Create bind token encoding: identity_id + target_email
        bind_token = _create_merge_token(
            existing_identity_id=identity.id,
            one_campus_student_id=identity.one_campus_account or "",
            one_campus_account=target_email,
        )

        # Store bind token on teacher and send verification email
        user.email_verification_token = bind_token
        user.email_verification_sent_at = datetime.now(timezone.utc)
        db.commit()

        success = email_service.send_teacher_bind_email(
            target_email=target_email,
            teacher_name=user.name,
            bind_token=bind_token,
        )
        if not success:
            raise HTTPException(
                status_code=500, detail="Failed to send verification email"
            )

        return {
            "message": "Verification email sent. Please check your inbox.",
            "email": target_email,
            "action": "verification_sent",
        }

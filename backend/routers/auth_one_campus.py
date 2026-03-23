"""1Campus SSO authentication endpoints.

Provides:
- GET /api/auth/1campus/callback — handle code exchange + account matching
- POST /api/auth/1campus/merge-confirm — confirm account merge (requires signed token)
"""

import base64
import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import create_access_token
from core.config import settings
from database import get_db
from models.user import Student
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
    student: Optional[dict] = None
    action: str  # "login", "created", "merge_prompt"
    merge_info: Optional[dict] = None


class MergeConfirmRequest(BaseModel):
    merge_token: str


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
    except (json.JSONDecodeError, UnicodeDecodeError, KeyError) as e:
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


# --- Endpoints ---


@router.get("/callback")
async def one_campus_callback(
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

    # For now, only handle student role
    if role_type != "student" or not identity_data.get("student"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported role type: {role_type}. Currently only student SSO is supported.",
        )

    student_data = identity_data["student"]
    one_campus_student_id = str(student_data["studentID"])
    student_name = student_data.get("studentName", "")
    student_number = student_data.get("studentNumber")

    # Step 2: Fetch extended data (idNumberHash) via Data API
    national_id_hash = None
    try:
        user_role_data = await OneCampusService.get_user_role(account=account)
        # Extract idNumberHash from the student role
        for school in user_role_data.get("school", []):
            student_role = school.get("studentRole")
            if student_role and student_role.get("idNumberHash"):
                national_id_hash = student_role["idNumberHash"]
                break
    except Exception as e:
        # Non-fatal: we can still login without idNumberHash
        logger.warning("1Campus getUserRole failed (non-fatal): %s", e)

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
        # Don't issue token yet — frontend needs to confirm merge
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

    # Issue JWT token
    access_token = create_access_token(
        data={"sub": str(student.id), "type": "student"},
        expires_delta=timedelta(hours=24),
    )

    # Update last_login
    student.last_login = datetime.now(timezone.utc)
    db.commit()

    return OneCampusCallbackResponse(
        access_token=access_token,
        student=_build_student_response(db, student),
        action=action,
    )


@router.post("/merge-confirm")
async def merge_confirm(
    request: MergeConfirmRequest,
    db: Session = Depends(get_db),
):
    """Confirm account merge after duplicate detection.

    Requires a signed merge_token issued by the callback endpoint.
    """
    try:
        token_data = _verify_merge_token(request.merge_token)
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

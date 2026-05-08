"""1Campus SSO authentication endpoints.

Provides:
- GET /api/auth/1campus/login-url — return OAuth authorize URL
- GET /api/auth/1campus/callback — handle code exchange + account matching
  - With schoolDsns: Identity Code flow (from 1Campus platform)
  - Without schoolDsns: OAuth 2.0 flow (from Duotopia login page)
- POST /api/auth/1campus/merge-confirm — confirm account merge (requires signed token)
"""

import base64
import binascii
import hashlib
import hmac
import json
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy import func
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
from services.cloud_tasks_service import enqueue_one_campus_class_sync

# Merge token validity: 10 minutes
MERGE_TOKEN_TTL = 600

# OAuth state token validity: 10 minutes
OAUTH_STATE_TTL = 600

# Prefix for OAuth merge state (different from plain OAuth state to avoid confusion)
OAUTH_MERGE_STATE_PREFIX = "merge"

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
    email: EmailStr


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


def _create_oauth_state(role_hint: Optional[str] = None) -> str:
    """Create a stateless HMAC-signed OAuth state token for CSRF protection.

    Format: base64(json({"nonce": ..., "exp": ..., "role"?: ...})).signature
    Verified on the OAuth callback to defend against forged state values.
    Stateless (no DB/session needed); per-issue and stateless deploys friendly.

    `role_hint` is which login button the user clicked ("teacher" or
    "student"). It travels through the OAuth round-trip inside the signed
    state, and is used as a fallback when 1Campus `getUserRole` cannot
    determine the role on its own. Because the state is HMAC-signed, the
    hint cannot be forged by the user.

    Note on replay: this token is reusable within its 10-minute TTL, but the
    OAuth authorization code (issued by 1Campus and tied to this state) is
    single-use, so a captured state alone cannot complete a login flow. The
    `.` separator is safe because base64url uses [A-Za-z0-9_-=] and a hex
    HMAC digest uses only [0-9a-f] — neither contains a dot.
    """
    payload_dict = {
        "nonce": secrets.token_urlsafe(16),
        "exp": int(time.time()) + OAUTH_STATE_TTL,
    }
    if role_hint in ("teacher", "student"):
        payload_dict["role"] = role_hint
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload_dict).encode()).decode()
    sig = hmac.HMAC(
        settings.JWT_SECRET.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()
    return f"{payload_b64}.{sig}"


def _verify_oauth_state(state: Optional[str]) -> Optional[dict]:
    """Verify an OAuth state token.

    Returns the decoded payload dict on success, None on any failure.
    Callers should treat None as 'invalid or expired state'.
    """
    if not state:
        return None
    parts = state.split(".", 1)
    if len(parts) != 2:
        return None
    payload_b64, sig = parts
    expected_sig = hmac.HMAC(
        settings.JWT_SECRET.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        return None
    try:
        payload_dict = json.loads(base64.urlsafe_b64decode(payload_b64))
    except (json.JSONDecodeError, UnicodeDecodeError, binascii.Error):
        return None
    if payload_dict.get("exp", 0) < int(time.time()):
        return None
    return payload_dict


def _create_oauth_merge_state(identity_id: int, user_type: str) -> str:
    """Create an HMAC-signed OAuth state token for the merge flow.

    Encodes the logged-in user's identity_id and user_type so the callback
    knows to run the merge flow instead of the regular login flow.

    Format: base64(json({"nonce": ..., "merge_for_identity_id": ...,
                         "merge_for_user_type": ..., "exp": ...})).signature
    """
    payload_dict = {
        "nonce": secrets.token_urlsafe(16),
        "merge_for_identity_id": identity_id,
        "merge_for_user_type": user_type,
        "exp": int(time.time()) + OAUTH_STATE_TTL,
    }
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload_dict).encode()).decode()
    sig = hmac.HMAC(
        settings.JWT_SECRET.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()
    return f"{payload_b64}.{sig}"


def _verify_oauth_merge_state(state: Optional[str]) -> Optional[dict]:
    """Verify an OAuth merge state token. Returns payload dict or None on failure."""
    if not state:
        return None
    parts = state.split(".", 1)
    if len(parts) != 2:
        return None
    payload_b64, sig = parts
    expected_sig = hmac.HMAC(
        settings.JWT_SECRET.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        return None
    try:
        payload_dict = json.loads(base64.urlsafe_b64decode(payload_b64))
    except (json.JSONDecodeError, UnicodeDecodeError, binascii.Error):
        return None
    if payload_dict.get("exp", 0) < int(time.time()):
        return None
    # Must contain merge fields to distinguish from plain oauth state
    if "merge_for_identity_id" not in payload_dict:
        return None
    return payload_dict


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


@router.get("/login-url")
@limiter.limit("30/minute")
async def get_login_url(
    request: Request,
    role: Optional[str] = Query(
        None,
        description=(
            "Which login button the user clicked: 'teacher' or 'student'. "
            "Used as a fallback when 1Campus getUserRole can't determine the "
            "role. Anything else is ignored."
        ),
        regex="^(teacher|student)$",
    ),
):
    """Return the 1Campus OAuth authorize URL with a CSRF state token.

    The frontend redirects users to this URL to initiate SSO login.
    The state is verified on the callback to defend against forged callbacks.
    """
    try:
        state = _create_oauth_state(role_hint=role)
        url = OneCampusService.get_oauth_authorize_url(state=state)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"url": url}


@router.get("/login-url-for-merge")
@limiter.limit("10/minute")
async def get_login_url_for_merge(
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Return a 1Campus OAuth URL with a merge state token.

    The merge state token encodes the logged-in user's identity_id and user_type
    so the callback knows to run Flow 2 (merge logged-in user A with 1Campus user B)
    instead of the regular login flow.

    Requires authentication. Used from the settings page.
    """
    user_type = current_user.get("type")
    user_id = int(current_user.get("sub"))

    # Resolve identity_id for current user
    if user_type == "student":
        user = db.query(Student).filter(Student.id == user_id).first()
    elif user_type == "teacher":
        user = db.query(Teacher).filter(Teacher.id == user_id).first()
    else:
        raise HTTPException(status_code=400, detail="Unsupported user type")

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.identity_id:
        raise HTTPException(
            status_code=400,
            detail="No identity found. Please ensure your account is set up correctly.",
        )

    try:
        merge_state = _create_oauth_merge_state(user.identity_id, user_type)
        url = OneCampusService.get_oauth_authorize_url(state=merge_state)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"url": url}


@router.get("/callback")
@limiter.limit("10/minute")
async def one_campus_callback(
    request: Request,
    code: str = Query(..., description="Authorization code or identity code"),
    schoolDsns: Optional[str] = Query(
        None, description="School DSNS (present for Identity Code flow only)"
    ),
    state: Optional[str] = Query(
        None, description="CSRF state token (required for OAuth flow)"
    ),
    db: Session = Depends(get_db),
):
    """Handle 1Campus SSO callback.

    Two flows are supported, detected by the presence of schoolDsns:
    - With schoolDsns: Identity Code flow (user comes from 1Campus platform)
    - Without schoolDsns: OAuth 2.0 flow (user clicks login on Duotopia) — state required
    """
    if schoolDsns:
        return await _handle_identity_code_flow(request, code, schoolDsns, db)

    # Check if state is a merge state token (Flow 2). Must come before the
    # regular state check because merge state has a different payload shape.
    merge_payload = _verify_oauth_merge_state(state)
    if merge_payload is not None:
        return await _handle_oauth_merge_flow_from_state(request, code, state, db)

    state_payload = _verify_oauth_state(state)
    if state_payload is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired OAuth state. Please try logging in again.",
        )
    role_hint = state_payload.get("role") if isinstance(state_payload, dict) else None
    return await _handle_oauth_flow(request, code, db, role_hint=role_hint)


async def _handle_oauth_merge_flow_from_state(
    request: Request,
    code: str,
    merge_state: str,
    db: Session,
) -> OneCampusCallbackResponse:
    """Handle Flow 2: logged-in user A merges with 1Campus account B.

    The merge_state token encodes target_identity_id (A) and user_type.
    Steps:
    1. Verify merge state token
    2. Exchange code for 1Campus user info → get uuid
    3. Verify target A has email_verified=True
    4. Find Identity_B by uuid
    5a. B doesn't exist → pure bind (write 1Campus fields to A)
    5b. B == A → no-op (already bound)
    5c. B exists and B != A → mark B merged into A, commit
    6. Return access_token for A's user
    """
    merge_payload = _verify_oauth_merge_state(merge_state)
    if not merge_payload:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired merge state. Please try again from settings.",
        )

    target_identity_id = merge_payload["merge_for_identity_id"]
    target_user_type = merge_payload["merge_for_user_type"]

    # Step 1: Exchange code for 1Campus access token
    try:
        token_data = await OneCampusService.exchange_oauth_code(code)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except httpx.HTTPError as e:
        logger.error("1Campus OAuth code exchange failed during merge: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Failed to communicate with 1Campus. Please try again.",
        )

    oauth_access_token = token_data.get("access_token")
    if not oauth_access_token:
        raise HTTPException(
            status_code=502, detail="1Campus did not return an access token."
        )

    # Step 2: Get user info
    try:
        user_info = await OneCampusService.get_oauth_user_info(oauth_access_token)
    except httpx.HTTPError as e:
        logger.error("1Campus user info fetch failed during merge: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Failed to fetch user info from 1Campus.",
        )

    uuid = user_info.get("uuid", "")
    mail = user_info.get("mail", "")

    if not uuid:
        raise HTTPException(
            status_code=502, detail="1Campus did not return a user UUID."
        )

    # Step 3: Load target Identity A
    target_identity = db.get(Identity, target_identity_id)
    if not target_identity or not target_identity.is_active:
        raise HTTPException(status_code=404, detail="Target identity not found.")

    # Step 4: A must have email_verified=True
    if not target_identity.email_verified:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "TARGET_NOT_VERIFIED",
                "message": (
                    "Please verify your Duotopia email address before binding "
                    "a 1Campus account."
                ),
            },
        )

    # Step 5: Find target user (Teacher or Student) under A
    if target_user_type == "teacher":
        target_user = (
            db.query(Teacher)
            .filter(
                Teacher.identity_id == target_identity_id,
                Teacher.is_active.is_(True),
            )
            .first()
        )
    else:
        target_user = (
            db.query(Student)
            .filter(
                Student.identity_id == target_identity_id,
                Student.is_active.is_(True),
            )
            .order_by(Student.is_primary_account.desc().nulls_last())
            .first()
        )

    if not target_user:
        raise HTTPException(
            status_code=404, detail="No active user found under target identity."
        )

    # Step 6: Find Identity B by uuid (including deactivated/merged)
    identity_b = db.query(Identity).filter(Identity.one_campus_uuid == uuid).first()

    if identity_b is None:
        # Pure bind: uuid not seen before, write 1Campus fields directly to A
        target_identity.one_campus_uuid = uuid
        target_identity.one_campus_account = mail
        db.commit()
        logger.info(
            "1Campus merge flow: pure bind, uuid=%s written to identity_id=%s",
            uuid,
            target_identity_id,
        )
    elif identity_b.id == target_identity_id:
        # No-op: A is already bound to this uuid
        logger.info(
            "1Campus merge flow: no-op, uuid=%s already bound to identity_id=%s",
            uuid,
            target_identity_id,
        )
    else:
        # Merge: B is a different identity → mark B merged into A
        from services.one_campus_account_service import OneCampusAccountService

        OneCampusAccountService.mark_identity_merged(
            db, identity_b.id, target_identity_id
        )
        db.commit()
        logger.info(
            "1Campus merge flow: merged identity_b_id=%s into identity_a_id=%s",
            identity_b.id,
            target_identity_id,
        )

    # Step 7: Return access_token for A's user
    if target_user_type == "teacher":
        teacher_response = _build_teacher_response(db, target_user)
        access_token = create_access_token(
            data={
                "sub": str(target_user.id),
                "email": target_user.email,
                "type": "teacher",
                "name": target_user.name,
                "role": teacher_response["role"],
            },
            expires_delta=timedelta(hours=24),
        )
        return OneCampusCallbackResponse(
            access_token=access_token,
            role_type="teacher",
            user=teacher_response,
            action="merge_complete",
        )
    else:
        access_token = create_access_token(
            data={"sub": str(target_user.id), "type": "student"},
            expires_delta=timedelta(hours=24),
        )
        target_user.last_login = datetime.now(timezone.utc)
        db.commit()
        return OneCampusCallbackResponse(
            access_token=access_token,
            role_type="student",
            student=_build_student_response(db, target_user),
            action="merge_complete",
        )


async def _handle_identity_code_flow(
    request: Request,
    code: str,
    school_dsns: str,
    db: Session,
) -> OneCampusCallbackResponse:
    """Handle the Identity Code flow (from 1Campus platform)."""
    # Step 1: Exchange identity code
    try:
        identity_data = await OneCampusService.exchange_identity_code(school_dsns, code)
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
            school_dsns=school_dsns,
        )

        teacher_response = _build_teacher_response(db, teacher)

        # Schedule a class roster sync for this school. Identity-code flow
        # always carries exactly one school_dsns (the school the user came
        # from), so we enqueue one task. Failures inside enqueue are logged
        # and swallowed — login must not break when the queue is down.
        try:
            await enqueue_one_campus_class_sync(school_dsns, teacher.id)
        except Exception as e:
            logger.warning("enqueue_one_campus_class_sync failed: %s", e)

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

    identity, student, action = OneCampusAccountService.find_or_create_student(
        db=db,
        one_campus_student_id=one_campus_student_id,
        one_campus_account=account,
        student_name=student_name,
        student_number=student_number,
        national_id_hash=national_id_hash,
        school_dsns=school_dsns,
    )

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


async def _handle_oauth_flow(
    request: Request,
    code: str,
    db: Session,
    role_hint: Optional[str] = None,
) -> OneCampusCallbackResponse:
    """Handle the OAuth 2.0 Authorization Code flow (from Duotopia login page).

    `role_hint` (optional) is the role the user picked when starting login —
    it travels back via the signed OAuth state. We trust it as a fallback
    only if 1Campus `getUserRole` couldn't determine the role on its own;
    `getUserRole` always wins when it returns a definitive answer.
    """
    # Step 1: Exchange authorization code for access token
    try:
        token_data = await OneCampusService.exchange_oauth_code(code)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except httpx.HTTPError as e:
        logger.error("1Campus OAuth code exchange failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Failed to communicate with 1Campus. Please try again.",
        )

    oauth_access_token = token_data.get("access_token")
    if not oauth_access_token:
        raise HTTPException(
            status_code=502, detail="1Campus did not return an access token."
        )

    # Step 2: Get user info
    try:
        user_info = await OneCampusService.get_oauth_user_info(oauth_access_token)
    except httpx.HTTPError as e:
        logger.error("1Campus OAuth user info fetch failed: %s", e)
        raise HTTPException(
            status_code=502,
            detail="Failed to fetch user info from 1Campus.",
        )

    uuid = user_info.get("uuid", "")
    first_name = user_info.get("firstName", "")
    last_name = user_info.get("lastName", "")
    mail = user_info.get("mail", "")

    if not uuid:
        raise HTTPException(
            status_code=502, detail="1Campus did not return a user UUID."
        )

    # Step 3: Try getUserRole to determine teacher/student role
    role_type = None
    national_id_hash = None
    one_campus_student_id = None
    student_name = None
    student_number = None
    teacher_name = None
    teacher_school_dsns_list: list[str] = []  # all schools where user is a teacher

    try:
        user_role_data = await OneCampusService.get_user_role(account=mail)
        for school in user_role_data.get("school", []):
            # Determine role and extract hash from the SAME role to keep them
            # in sync. A user may have both teacherRole and studentRole in one
            # school; if we extracted hash from one and role from the other,
            # the teacher account would be linked to the student's national ID
            # hash (and vice versa).
            if school.get("teacherRole"):
                # Collect every teacher school for the post-login class sync.
                dsns = school.get("schoolDsns")
                if dsns and dsns not in teacher_school_dsns_list:
                    teacher_school_dsns_list.append(dsns)

                if role_type is None:
                    role_type = "teacher"
                    tr = school["teacherRole"]
                    teacher_name = tr.get("teacherName")
                    if tr.get("idNumberHash"):
                        national_id_hash = tr["idNumberHash"]
            elif school.get("studentRole") and role_type is None:
                role_type = "student"
                sr = school["studentRole"]
                one_campus_student_id = str(sr.get("studentID", ""))
                student_name = sr.get("studentName")
                student_number = sr.get("studentNumber")
                if sr.get("idNumberHash"):
                    national_id_hash = sr["idNumberHash"]
                # Students don't trigger class sync (#635 is teacher-side).
                # We can't break here because a later school may add another
                # teacher_school_dsns; but if role_type is already set we stop
                # collecting student-only data.
    except httpx.HTTPError as e:
        logger.warning("1Campus getUserRole after OAuth failed (non-fatal): %s", e)

    if role_type is None:
        # Order of precedence when getUserRole couldn't tell us the role:
        #   1. Existing account (matched by uuid or verified email) — log in
        #      with whatever role they're already on file as.
        #   2. role_hint from the OAuth state — which login button the user
        #      clicked. Trustworthy because the state is HMAC-signed.
        #   3. Refuse with HTTP 400.
        existing_identity = OneCampusAccountService.find_by_uuid(db, uuid)
        if existing_identity is None and mail:
            existing_identity = (
                db.query(Identity)
                .filter(
                    func.lower(Identity.email) == mail.lower(),
                    Identity.email_verified.is_(True),
                    Identity.is_active.is_(True),
                )
                .first()
            )

        if existing_identity is not None:
            logger.warning(
                "1Campus OAuth: could not determine role for uuid=%s mail=%s "
                "but an existing account was found — proceeding with "
                "existing role.",
                uuid,
                mail,
            )
        elif role_hint in ("teacher", "student"):
            logger.info(
                "1Campus OAuth: getUserRole returned no role for uuid=%s "
                "mail=%s; falling back to role_hint=%s from signed state.",
                uuid,
                mail,
                role_hint,
            )
            role_type = role_hint
        else:
            logger.warning(
                "1Campus OAuth: could not determine role for uuid=%s mail=%s, "
                "no existing account, and no role_hint in state — refusing "
                "new-account creation.",
                uuid,
                mail,
            )
            raise HTTPException(
                status_code=400,
                detail=(
                    "We couldn't determine whether your 1Campus account is a "
                    "student or teacher. Please ensure your school has "
                    "authorized Duotopia, or contact your administrator."
                ),
            )

    # Step 4: Match or create account
    (
        identity,
        user,
        detected_role,
        action,
    ) = OneCampusAccountService.find_or_create_by_oauth(
        db=db,
        uuid=uuid,
        mail=mail,
        first_name=first_name,
        last_name=last_name,
        role_type=role_type,
        one_campus_student_id=one_campus_student_id,
        student_name=student_name,
        student_number=student_number,
        teacher_name=teacher_name,
        national_id_hash=national_id_hash,
    )

    # Step 5: Build response
    if detected_role == "student":
        access_token = create_access_token(
            data={"sub": str(user.id), "type": "student"},
            expires_delta=timedelta(hours=24),
        )
        user.last_login = datetime.now(timezone.utc)
        db.commit()
        return OneCampusCallbackResponse(
            access_token=access_token,
            role_type="student",
            student=_build_student_response(db, user),
            action=action,
        )
    else:
        teacher_response = _build_teacher_response(db, user)
        access_token = create_access_token(
            data={
                "sub": str(user.id),
                "email": user.email,
                "type": "teacher",
                "name": user.name,
                "role": teacher_response["role"],
            },
            expires_delta=timedelta(hours=24),
        )
        # Note: Teacher model has no last_login field (unlike Student); nothing to update.

        # Schedule class roster sync for every school where the user has a
        # teacherRole. Failures are swallowed so login isn't blocked by a
        # misbehaving Cloud Tasks queue.
        for dsns in teacher_school_dsns_list:
            try:
                await enqueue_one_campus_class_sync(dsns, user.id)
            except Exception as e:
                logger.warning(
                    "enqueue_one_campus_class_sync failed for %s: %s", dsns, e
                )

        return OneCampusCallbackResponse(
            access_token=access_token,
            role_type="teacher",
            user=teacher_response,
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

    # Update teacher email — check uniqueness first to avoid constraint violation.
    # Case-insensitive match so we don't collide with the unique functional index
    # ix_teachers_email_lower (see migration 20260420_1100).
    existing_teacher_with_email = (
        db.query(Teacher)
        .filter(
            func.lower(Teacher.email) == target_email.lower(),
            Teacher.id != teacher.id,
            Teacher.is_active.is_(True),
        )
        .first()
    )
    if not existing_teacher_with_email:
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

    The caller must be logged in via 1Campus SSO (the Identity has
    `one_campus_account` set). The Identity is resolved from the
    authenticated user's `identity_id` (NOT from a request parameter), so a
    logged-in user can only bind their own identity — there is no path to
    operate on another user's identity_id even if it were guessed.

    Identities created by the OAuth flow have `email_verified=True` with the
    1Campus mail. Users may still want to link an existing Duotopia account
    that uses a different email — we allow that here, then verify ownership
    by sending a verification email to the target_email. Merge happens in
    `verify-teacher-bind` (teachers) / verify-email endpoint (students)
    after the user clicks the verification link.
    """
    user_type = current_user.get("type")
    user_id = int(current_user.get("sub"))

    # Resolve the Identity for the current user (from the JWT subject, never
    # from request body) — this guards against impersonation attempts.
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

    target_email = body.email.strip().lower()

    # Block only when the identity is already bound to this exact email (no-op).
    # Allowing rebind to a *different* email is intentional: when OAuth creates
    # a new Identity for a 1Campus user, we set email=<1campus mail>,
    # email_verified=True (1Campus is the IdP and verifies institutional mails).
    # If we rejected on email_verified alone, the user could never link the
    # SSO identity to their existing Duotopia email. The verification email
    # sent below ensures the user actually owns the target_email before merge.
    if (
        identity.email_verified
        and identity.email
        and identity.email.lower() == target_email
    ):
        raise HTTPException(
            status_code=400,
            detail="This account is already bound to this email.",
        )

    # Scenario 4: target email exists but email_verified=False → reject with
    # structured error so the frontend can offer "Resend verification email".
    existing_target_identity = (
        db.query(Identity)
        .filter(
            func.lower(Identity.email) == target_email,
            Identity.is_active.is_(True),
        )
        .first()
    )
    if existing_target_identity and not existing_target_identity.email_verified:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "TARGET_EMAIL_NOT_VERIFIED",
                "message": (
                    f"Your Duotopia account ({target_email}) has not completed email "
                    "verification yet. Please verify first."
                ),
                "target_email": target_email,
            },
        )

    if user_type == "student":
        from services.email_service import email_service

        # Set unverified email on student for the existing verification flow.
        # send_verification_email() stores the token and commits internally.
        # The email is marked unverified — actual bind/merge happens in
        # verify-email endpoint after the user clicks the link.
        user.email = target_email
        user.email_verified = False
        user.email_verified_at = None

        # Ensure Identity has the email (unverified) for later merge
        if not identity.email or identity.email != target_email:
            identity.email = target_email
            identity.email_verified = False
        db.flush()

        # Send verification email (commits internally)
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

        # Create bind token. Field mapping note: we reuse _create_merge_token
        # with swapped semantics — "one_campus_student_id" carries the 1Campus
        # account, and "one_campus_account" carries the target Duotopia email.
        # verify_teacher_bind reads token_data["one_campus_account"] as target.
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


@router.get("/binding-status")
@limiter.limit("30/minute")
async def get_binding_status(
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Return current user's 1Campus binding and email verification status.

    Used by the settings page to show binding status and available actions.
    Requires authentication.
    """
    user_type = current_user.get("type")
    user_id = int(current_user.get("sub"))

    if user_type == "student":
        user = db.query(Student).filter(Student.id == user_id).first()
    elif user_type == "teacher":
        user = db.query(Teacher).filter(Teacher.id == user_id).first()
    else:
        raise HTTPException(status_code=400, detail="Unsupported user type")

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    identity = None
    if user.identity_id:
        identity = db.get(Identity, user.identity_id)

    one_campus_account = identity.one_campus_account if identity else None
    email_verified = identity.email_verified if identity else user.email_verified
    email = identity.email if identity else user.email

    return {
        "has_1campus_binding": one_campus_account is not None,
        "one_campus_account": one_campus_account,
        "email": email,
        "email_verified": email_verified,
        "user_type": user_type,
    }

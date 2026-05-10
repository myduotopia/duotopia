"""1Campus operations for teachers.

Manual class roster sync trigger (#635). Lives under /api/teachers because
it operates on the authenticated teacher's identity.

The sync runs inline (await) and returns aggregated SyncResult counts so the
UI can show how many classrooms / students were added or updated. 1Campus
rosters are small enough that running this inside the request finishes well
within Cloud Run's request timeout.
"""

import hashlib
import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

import httpx

from core.limiter import limiter
from database import get_db
from models import Teacher
from models.user import Identity
from services.one_campus_class_sync_service import (
    OneCampusClassSyncService,
    SyncResult,
    collect_teacher_school_dsns,
)
from services.one_campus_service import OneCampusService

from .dependencies import get_current_teacher

logger = logging.getLogger(__name__)
router = APIRouter()


def _sync_rate_limit_key(request: Request) -> str:
    """Per-teacher rate-limit key derived from the JWT in the Authorization
    header.

    The default `core.limiter.get_user_identifier` reads `email`/`id` from
    the request body, but the sync endpoint has no body, so it falls back to
    the remote IP. In Cloud Run that IP is the load balancer's, so every
    teacher in a school (sharing one egress IP) ends up in the same bucket
    and can DoS each other on the `1/minute` limit.

    We hash the raw token to avoid storing it in slowapi's internal state in
    plaintext. Each fresh login yields a new bucket (new JWT → new hash),
    which is acceptable — the goal is preventing one teacher from spamming
    the upstream 1Campus API, not enforcing a permanent per-account quota.
    """
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        digest = hashlib.sha256(auth.encode()).hexdigest()[:16]
        return f"sync-1campus:token:{digest}"
    return f"sync-1campus:ip:{get_remote_address(request)}"


class OneCampusSyncResponse(BaseModel):
    synced: bool
    schools: List[str]
    classrooms_added: int = 0
    classrooms_updated: int = 0
    students_added: int = 0
    students_updated: int = 0
    errors: List[str] = []
    message: str


@router.post("/me/sync-1campus-classes", response_model=OneCampusSyncResponse)
@limiter.limit("5/minute", key_func=_sync_rate_limit_key)
async def sync_one_campus_classes(
    request: Request,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Manually trigger a 1Campus class roster sync for the current teacher.

    Restricted to teachers logged in via 1Campus SSO (their Identity has
    `one_campus_account`). Runs the sync inline and returns the aggregated
    SyncResult so the UI can show counts in a toast.
    """
    if not current_teacher.identity_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This teacher is not linked to a 1Campus identity.",
        )

    identity = (
        db.query(Identity)
        .filter(
            Identity.id == current_teacher.identity_id,
            Identity.is_active.is_(True),
        )
        .first()
    )
    if not identity or not identity.one_campus_account:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This teacher is not linked to a 1Campus account.",
        )

    # Re-discover the teacher's schools via getUserRole — never trust the
    # client to supply schoolDsns. This also catches school changes since
    # the teacher last logged in.
    try:
        user_role_data = await OneCampusService.get_user_role(
            account=identity.one_campus_account
        )
    except (httpx.HTTPError, RuntimeError) as e:
        logger.error(
            "Manual sync: getUserRole failed for teacher_id=%s: %s",
            current_teacher.id,
            e,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to query 1Campus for your school list. Please try again later.",
        )

    teacher_school_dsns = collect_teacher_school_dsns(user_role_data)

    if not teacher_school_dsns:
        return OneCampusSyncResponse(
            synced=False,
            schools=[],
            message="No 1Campus schools with teacher role were found for your account.",
        )

    aggregated = SyncResult()
    for dsns in teacher_school_dsns:
        try:
            result = await OneCampusClassSyncService.sync_school(
                db,
                school_dsns=dsns,
                teacher_id=current_teacher.id,
                teacher_acc=identity.one_campus_account,
            )
        except Exception as e:
            # sync_school is designed to swallow upstream errors into
            # SyncResult.errors, so this branch is for truly unexpected
            # failures (e.g. DB-level). Surface them but don't 500 — the
            # other schools may still have synced.
            logger.exception(
                "Manual sync: sync_school crashed for school=%s teacher_id=%s: %s",
                dsns,
                current_teacher.id,
                e,
            )
            aggregated.errors.append(f"{dsns}: {e}")
            continue

        aggregated.classrooms_added += result.classrooms_added
        aggregated.classrooms_updated += result.classrooms_updated
        aggregated.students_added += result.students_added
        aggregated.students_updated += result.students_updated
        aggregated.errors.extend(f"{dsns}: {err}" for err in result.errors)

    return OneCampusSyncResponse(
        synced=True,
        schools=teacher_school_dsns,
        classrooms_added=aggregated.classrooms_added,
        classrooms_updated=aggregated.classrooms_updated,
        students_added=aggregated.students_added,
        students_updated=aggregated.students_updated,
        errors=aggregated.errors,
        message=(
            f"Synced {len(teacher_school_dsns)} school(s): "
            f"{aggregated.classrooms_added} classroom(s) added, "
            f"{aggregated.students_added} student(s) added."
        ),
    )

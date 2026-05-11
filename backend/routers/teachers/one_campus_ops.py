"""1Campus operations for teachers.

Manual class roster sync trigger (#635). Lives under /api/teachers because
it operates on the authenticated teacher's identity — it is NOT an internal
worker (those live under /api/internal/tasks).
"""

import logging
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

import httpx

from core.limiter import limiter
from database import get_db
from models import Teacher
from models.user import Identity
from services.cloud_tasks_service import enqueue_one_campus_class_sync
from services.one_campus_service import OneCampusService

from .dependencies import get_current_teacher

logger = logging.getLogger(__name__)
router = APIRouter()


class OneCampusSyncResponse(BaseModel):
    enqueued: bool
    schools: List[str]
    message: str


@router.post("/me/sync-1campus-classes", response_model=OneCampusSyncResponse)
@limiter.limit("1/minute")
async def sync_one_campus_classes(
    request: Request,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Manually trigger a 1Campus class roster sync for the current teacher.

    Restricted to teachers logged in via 1Campus SSO (their Identity has
    `one_campus_account`). The actual sync runs in the background via
    Cloud Tasks (or the inline fallback when not configured).
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

    teacher_school_dsns: list[str] = []
    for school in user_role_data.get("school", []) or []:
        if school.get("teacherRole"):
            dsns = school.get("schoolDsns")
            if dsns and dsns not in teacher_school_dsns:
                teacher_school_dsns.append(dsns)

    if not teacher_school_dsns:
        return OneCampusSyncResponse(
            enqueued=False,
            schools=[],
            message="No 1Campus schools with teacher role were found for your account.",
        )

    for dsns in teacher_school_dsns:
        try:
            await enqueue_one_campus_class_sync(dsns, current_teacher.id)
        except Exception as e:
            logger.warning(
                "Manual sync: enqueue failed for school=%s teacher_id=%s: %s",
                dsns,
                current_teacher.id,
                e,
            )

    return OneCampusSyncResponse(
        enqueued=True,
        schools=teacher_school_dsns,
        message=(
            f"Sync started for {len(teacher_school_dsns)} school(s). "
            "Refresh in a moment to see the latest roster."
        ),
    )

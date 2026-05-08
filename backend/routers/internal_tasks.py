"""Internal task worker endpoints.

These are called by Cloud Tasks (or any other internal scheduler) over HTTP.
Authenticated by the shared X-Cloud-Tasks-Secret header — never expose these
to end users. The router is mounted under /api/internal/tasks.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from services.cloud_tasks_service import verify_invoker_secret
from services.one_campus_class_sync_service import OneCampusClassSyncService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/internal/tasks", tags=["internal-tasks"])


class OneCampusSyncTaskBody(BaseModel):
    school_dsns: str
    teacher_id: int


@router.post("/sync-1campus-class")
async def sync_one_campus_class_task(
    body: OneCampusSyncTaskBody,
    db: Session = Depends(get_db),
    x_cloud_tasks_secret: Optional[str] = Header(None, alias="X-Cloud-Tasks-Secret"),
):
    """Worker endpoint that Cloud Tasks calls to run a school's class sync."""
    if not verify_invoker_secret(x_cloud_tasks_secret):
        # Fail closed when not configured — better than running unauthenticated.
        raise HTTPException(
            status_code=403, detail="Invalid or missing internal task secret"
        )

    result = await OneCampusClassSyncService.sync_school(
        db, school_dsns=body.school_dsns, teacher_id=body.teacher_id
    )
    logger.info(
        "Cloud Tasks sync done (school=%s, teacher=%s): %s",
        body.school_dsns,
        body.teacher_id,
        result.to_dict(),
    )
    return result.to_dict()

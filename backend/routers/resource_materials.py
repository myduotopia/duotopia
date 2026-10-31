"""
Resource Materials Router

API endpoints for browsing and copying resource materials from the resource account.

Endpoints:
1. GET /api/resource-materials - List resource materials (filtered by scope/visibility)
2. GET /api/resource-materials/{program_id} - Get material detail (read-only)
3. POST /api/resource-materials/{program_id}/copy - Copy to individual or organization
4. GET /api/resource-materials/copy-status - Check today's copy status
5. PATCH /api/resource-materials/{program_id}/visibility - Update visibility (resource account only)
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Literal, Optional, List
import logging
import uuid

from database import get_db
from models import Teacher
from services.resource_materials_service import (
    list_resource_materials,
    get_resource_material_detail,
    copy_resource_material,
    update_program_visibility,
    get_resource_account,
)
from utils.permissions import (
    has_manage_materials_permission,
    has_read_org_materials_permission,
)
from routers.teachers import get_current_teacher

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/resource-materials", tags=["resource-materials"])


# ============ Schemas ============


class CopyRequest(BaseModel):
    target_type: str  # 'individual' or 'organization'
    organization_id: Optional[str] = None


class VisibilityUpdateRequest(BaseModel):
    visibility: Literal["private", "public", "organization_only", "individual_only"]


# ============ Helpers ============


def _require_org_member(
    organization_id: Optional[str], teacher: Teacher, db: Session
) -> uuid.UUID:
    """Browsing resource materials in org scope only needs active membership;
    copying into the org is gated separately by manage_materials (#1162)."""
    if not organization_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="organization_id required for organization scope",
        )
    try:
        org_uuid = uuid.UUID(organization_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid organization_id format",
        )
    if not has_read_org_materials_permission(teacher.id, org_uuid, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No permission to access organization resources",
        )
    return org_uuid


# ============ Endpoints ============


@router.get("")
async def list_materials(
    scope: str = Query(
        "individual", description="Scope: 'individual' or 'organization'"
    ),
    organization_id: Optional[str] = Query(None, description="Organization ID"),
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """List available resource materials filtered by scope and visibility.

    `can_copy` tells the client whether the viewer may copy into the target:
    always true for individual scope; org scope needs manage_materials.
    """
    can_copy = True
    if scope == "organization":
        org_uuid = _require_org_member(organization_id, teacher, db)
        can_copy = has_manage_materials_permission(teacher.id, org_uuid, db)

    materials = list_resource_materials(
        db=db,
        scope=scope,
        viewer_teacher_id=teacher.id,
        organization_id=organization_id,
    )
    return {"materials": materials, "count": len(materials), "can_copy": can_copy}


@router.get("/copy-status")
async def get_copy_status(
    scope: str = Query("individual"),
    organization_id: Optional[str] = Query(None),
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Get today's copy status for all resource materials."""
    from sqlalchemy import cast, Date
    from models import ProgramCopyLog
    from models.program import COPIED_BY_INDIVIDUAL, COPIED_BY_ORGANIZATION
    from datetime import datetime, timezone

    today = datetime.now(timezone.utc).date()

    if scope == "individual":
        copied_by_type = COPIED_BY_INDIVIDUAL
        copied_by_id = str(teacher.id)
    elif scope == "organization":
        _require_org_member(organization_id, teacher, db)
        copied_by_type = COPIED_BY_ORGANIZATION
        copied_by_id = str(organization_id)
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid scope"
        )

    logs = (
        db.query(ProgramCopyLog)
        .filter(
            ProgramCopyLog.copied_by_type == copied_by_type,
            ProgramCopyLog.copied_by_id == copied_by_id,
            cast(ProgramCopyLog.copied_at, Date) == today,
        )
        .all()
    )

    return {
        "copied_program_ids": [log.source_program_id for log in logs],
        "date": today.isoformat(),
    }


@router.get("/{program_id}")
async def get_material_detail(
    program_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Get detailed view of a resource material (read-only)."""
    detail = get_resource_material_detail(db, program_id)
    if not detail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Resource material not found",
        )

    # Check visibility permission
    resource_account = get_resource_account(db)
    if resource_account and teacher.id != resource_account.id:
        visibility = detail.get("visibility", "private")
        if visibility not in ("public", "individual_only", "organization_only"):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Resource material not found",
            )

    return detail


@router.post("/{program_id}/copy")
async def copy_material(
    program_id: int,
    request: CopyRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Copy a resource material to individual's materials or organization."""
    if request.target_type == "organization":
        if not request.organization_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="organization_id required for organization copy",
            )
        try:
            org_uuid = uuid.UUID(request.organization_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid organization_id format",
            )
        if not has_manage_materials_permission(teacher.id, org_uuid, db):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No permission to copy to this organization",
            )

    try:
        result = copy_resource_material(
            db=db,
            program_id=program_id,
            target_type=request.target_type,
            teacher_id=teacher.id,
            organization_id=request.organization_id,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))


@router.patch("/{program_id}/visibility")
async def update_visibility(
    program_id: int,
    request: VisibilityUpdateRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """Update resource material visibility (resource account only)."""
    try:
        result = update_program_visibility(
            db=db,
            program_id=program_id,
            teacher_id=teacher.id,
            visibility=request.visibility,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(e))

"""
Teacher organizations endpoint
"""
from typing import List, Optional
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import SQLAlchemyError
from pydantic import BaseModel

from database import get_db
from models.user import Teacher
from models.organization import Organization, School, TeacherOrganization, TeacherSchool
from .dependencies import get_current_teacher


router = APIRouter()
logger = logging.getLogger(__name__)


# ============================================
# Response Schemas
# ============================================


class SchoolInfo(BaseModel):
    """School information in organization context"""

    id: str
    name: str
    roles: Optional[List[str]] = None  # teacher's roles in this school (if any)

    class Config:
        from_attributes = True


class OrganizationInfo(BaseModel):
    """Organization information with nested schools"""

    id: str
    name: str
    role: str  # teacher's role in this organization
    schools: List[SchoolInfo]

    class Config:
        from_attributes = True


class TeacherOrganizationsResponse(BaseModel):
    """Response for GET /api/teachers/{teacher_id}/organizations"""

    organizations: List[OrganizationInfo]


# ============================================
# Endpoints
# ============================================


@router.get(
    "/{teacher_id}/organizations",
    response_model=TeacherOrganizationsResponse,
    status_code=status.HTTP_200_OK,
)
def get_teacher_organizations(
    teacher_id: int,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Get all organizations and schools that a teacher belongs to.

    Returns nested structure:
    {
        "organizations": [
            {
                "id": "uuid",
                "name": "Organization Name",
                "role": "org_admin",
                "schools": [
                    {
                        "id": "uuid",
                        "name": "School Name",
                        "roles": ["teacher"]
                    }
                ]
            }
        ]
    }
    """
    # Authorization: Teachers can only view their own organizations
    if current_teacher.id != teacher_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only view your own organizations",
        )

    try:
        # Query teacher's ACTIVE organization memberships with eager loading
        teacher_orgs = (
            db.query(TeacherOrganization)
            .join(Organization, TeacherOrganization.organization_id == Organization.id)
            .filter(
                TeacherOrganization.teacher_id == teacher_id,
                TeacherOrganization.is_active.is_(True),  # Only active memberships
                Organization.is_active.is_(True),  # Only active organizations
                # issue #862：團購脫離機構 — group_buy org 不進 workspace，讓團購
                # 老師（含發起人）維持個人模式自管班級/學生。機構(institution)不受
                # 影響。帳務端點（/org-purchase、/org-renew）直接查 TeacherOrganization，
                # 不經此端點，故發起人續購/加購仍正常。
                Organization.org_type != "group_buy",
            )
            .options(joinedload(TeacherOrganization.organization))
            .all()
        )

        if not teacher_orgs:
            return TeacherOrganizationsResponse(organizations=[])

        # Optimization: Fetch all schools and teacher-school relationships in batch
        all_org_ids = [to.organization_id for to in teacher_orgs]

        # Single query for all ACTIVE schools across all organizations
        all_schools = (
            db.query(School)
            .filter(
                School.organization_id.in_(all_org_ids),
                School.is_active.is_(True),  # Only active schools
            )
            .all()
        )

        # Group schools by organization for O(1) lookup
        schools_by_org = {}
        for school in all_schools:
            schools_by_org.setdefault(school.organization_id, []).append(school)

        # Single query for all teacher-school relationships
        all_school_ids = [s.id for s in all_schools]
        teacher_schools = (
            db.query(TeacherSchool)
            .filter(
                TeacherSchool.teacher_id == teacher_id,
                TeacherSchool.school_id.in_(all_school_ids),
                TeacherSchool.is_active.is_(True),  # Only active memberships
            )
            .all()
        )

        # Build role mapping for O(1) lookup
        teacher_school_roles = {ts.school_id: ts.roles for ts in teacher_schools}

        # Build response using pre-fetched data
        organizations = []
        for teacher_org in teacher_orgs:
            org = teacher_org.organization
            schools_in_org = schools_by_org.get(org.id, [])

            # Build schools list
            schools = [
                SchoolInfo(
                    id=str(school.id),
                    name=school.name,
                    roles=teacher_school_roles.get(school.id),
                )
                for school in schools_in_org
            ]

            # Add organization to result
            organizations.append(
                OrganizationInfo(
                    id=str(org.id),
                    name=org.name,
                    role=teacher_org.role,
                    schools=schools,
                )
            )

        return TeacherOrganizationsResponse(organizations=organizations)

    except SQLAlchemyError as e:
        logger.error(
            f"Database error in get_teacher_organizations for teacher {teacher_id}: {str(e)}"
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch organizations",
        )

"""
Organization API Routes

CRUD operations for organizations with Casbin permission checks.

Note: Per-issue deploy now includes database migrations (2026-01-11 v4 - upgrade heads)
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import func, distinct, union, select
from sqlalchemy.orm import Session, joinedload, selectinload, load_only
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional
from datetime import datetime
import logging
import re
import uuid

from database import get_db
from models import (
    Teacher,
    Organization,
    TeacherOrganization,
    TeacherSchool,
    School,
    StudentSchool,
    InstitutionInvoiceEmail,
)
from auth import verify_token, get_password_hash
from services.casbin_service import get_casbin_service
from services.email_service import email_service
from services.institution_billing import compute_monthly_billing
from services.institution_invoice_pdf import build_invoice_pdf
from services.institution_invoice_email import send_monthly_invoice_email
from services.institution_invoice_ledger import upsert_invoice
import secrets


router = APIRouter(prefix="/api/organizations", tags=["organizations"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/teacher/login")


# ============ Dependencies ============


async def get_current_teacher(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> Teacher:
    """Get current authenticated teacher"""
    payload = verify_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )

    teacher_id = payload.get("sub")
    teacher_type = payload.get("type")

    if teacher_type != "teacher":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not a teacher"
        )

    teacher = db.query(Teacher).filter(Teacher.id == teacher_id).first()
    if not teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found"
        )

    return teacher


# ============ Request/Response Models ============


class OrganizationCreate(BaseModel):
    """Request model for creating an organization"""

    name: str = Field(..., min_length=1, max_length=100)
    display_name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    tax_id: Optional[str] = Field(None, max_length=20, description="統一編號 (8 digits)")
    teacher_limit: Optional[int] = Field(None, ge=1, description="教師授權數上限 (NULL = 無限制)")
    contact_email: Optional[str] = Field(None, max_length=200)
    contact_phone: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = None


class OrganizationUpdate(BaseModel):
    """Request model for updating an organization"""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    display_name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    tax_id: Optional[str] = Field(None, max_length=20, description="統一編號 (8 digits)")
    teacher_limit: Optional[int] = Field(None, ge=1, description="教師授權數上限 (NULL = 無限制)")
    contact_email: Optional[str] = Field(None, max_length=200)
    contact_phone: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = None
    is_active: Optional[bool] = None


class OrganizationResponse(BaseModel):
    """Response model for organization"""

    id: str
    name: str
    display_name: Optional[str]
    description: Optional[str]
    tax_id: Optional[str]
    teacher_limit: Optional[int]  # Decision #5: Teacher authorization limit
    contact_email: Optional[str]
    contact_phone: Optional[str]
    address: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime]
    owner_name: Optional[str] = None
    owner_email: Optional[str] = None

    class Config:
        from_attributes = True

    @classmethod
    def from_orm(cls, org: Organization, owner: Optional[Teacher] = None):
        """Convert Organization model to response"""
        return cls(
            id=str(org.id),
            name=org.name,
            display_name=org.display_name,
            description=org.description,
            tax_id=org.tax_id,
            teacher_limit=org.teacher_limit,  # Decision #5: Teacher authorization limit
            contact_email=org.contact_email,
            contact_phone=org.contact_phone,
            address=org.address,
            is_active=org.is_active,
            created_at=org.created_at,
            updated_at=org.updated_at,
            owner_name=owner.name if owner else None,
            owner_email=owner.email if owner else None,
        )


# ============ Helper Functions ============


def check_org_permission(
    teacher_id: int, org_id: uuid.UUID, db: Session, for_update: bool = False
) -> Organization:
    """
    Check if teacher has access to organization.
    Raises HTTPException if not found or no permission.
    Returns organization if permission granted.

    Args:
        for_update: If True, locks the organization row with SELECT FOR UPDATE
                   to prevent race conditions in concurrent operations.
    """
    # Check if organization exists and is active (soft delete strategy)
    query = db.query(Organization).filter(
        Organization.id == org_id, Organization.is_active.is_(True)
    )

    # Lock row if needed (prevents race conditions in teacher limit checks)
    if for_update:
        query = query.with_for_update()

    org = query.first()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found"
        )

    # Check if teacher is org owner
    teacher_org = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == teacher_id,
            TeacherOrganization.organization_id == org_id,
            TeacherOrganization.is_active.is_(True),
        )
        .first()
    )

    if not teacher_org:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to access this organization",
        )

    return org


# ============ API Endpoints ============


@router.post(
    "", status_code=status.HTTP_201_CREATED, response_model=OrganizationResponse
)
async def create_organization(
    org_data: OrganizationCreate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Create a new organization.
    The creating teacher automatically becomes the org_owner.
    """
    casbin_service = get_casbin_service()

    # Check tax_id uniqueness if provided (only among active organizations)
    # Per #151 Decision #2: Partial unique index allows tax_id reuse after deactivation
    if org_data.tax_id:
        existing = (
            db.query(Organization)
            .filter(
                Organization.tax_id == org_data.tax_id, Organization.is_active.is_(True)
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="此統一編號已被使用"
            )

    # Create organization
    org = Organization(
        name=org_data.name,
        display_name=org_data.display_name,
        description=org_data.description,
        tax_id=org_data.tax_id,
        teacher_limit=org_data.teacher_limit,  # Decision #5: Teacher authorization limit
        contact_email=org_data.contact_email,
        contact_phone=org_data.contact_phone,
        address=org_data.address,
        is_active=True,
    )

    db.add(org)
    db.commit()
    db.refresh(org)

    # Create teacher-organization relationship (org_owner)
    teacher_org = TeacherOrganization(
        teacher_id=teacher.id,
        organization_id=org.id,
        role="org_owner",
        is_active=True,
    )
    db.add(teacher_org)
    db.commit()

    # Add Casbin role
    casbin_service.add_role_for_user(teacher.id, "org_owner", f"org-{org.id}")

    return OrganizationResponse.from_orm(org)


@router.get("", response_model=List[OrganizationResponse])
async def list_organizations(
    owner_only: bool = False,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    List all organizations that the current teacher has access to.

    Args:
        owner_only: If True, only return organizations where teacher is org_owner

    Returns:
        List of organizations (empty list if teacher has no organizations)

    Performance: Fetches owners with selectinload to avoid N+1 queries.
    """
    import logging

    logger = logging.getLogger(__name__)

    try:
        # Get all teacher-organization relationships
        logger.info(
            f"Fetching organizations for teacher_id={teacher.id}, owner_only={owner_only}"
        )

        query = db.query(TeacherOrganization).filter(
            TeacherOrganization.teacher_id == teacher.id,
            TeacherOrganization.is_active.is_(True),
        )

        # Filter by owner role if requested
        if owner_only:
            query = query.filter(TeacherOrganization.role == "org_owner")

        teacher_orgs = query.all()
        logger.info(f"Found {len(teacher_orgs)} teacher-organization relationships")

        # Return empty list if teacher has no organizations (not an error)
        if not teacher_orgs:
            logger.info("Teacher has no organizations, returning empty list")
            return []

        # Validate and collect organization IDs (defensive coding - same as stats endpoint)
        org_ids = []
        for to in teacher_orgs:
            if isinstance(to.organization_id, uuid.UUID):
                org_ids.append(to.organization_id)
            else:
                try:
                    org_ids.append(uuid.UUID(str(to.organization_id)))
                except ValueError:
                    logger.warning(
                        f"Invalid UUID for organization_id: {to.organization_id}"
                    )
                    continue  # Skip invalid UUIDs

        # If all UUIDs were invalid, return empty list
        if not org_ids:
            logger.warning("All organization UUIDs were invalid, returning empty list")
            return []
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching teacher organizations: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="獲取組織列表失敗"
        )

    try:
        # Get organizations
        logger.info(f"Fetching {len(org_ids)} organizations, org_ids={org_ids}")
        organizations = (
            db.query(Organization)
            .filter(Organization.id.in_(org_ids), Organization.is_active.is_(True))
            .all()
        )
        logger.info(f"Found {len(organizations)} active organizations")

        # ✅ PERFORMANCE FIX: Fetch all org owners in a single query to avoid N+1
        # ✅ FIX #157: Use selectinload + load_only to prevent loading all Teacher relationships
        # This avoids massive JOINs that cause timeout in Cloud Run (30s statement_timeout)
        logger.info("Fetching organization owners...")
        owner_rels = (
            db.query(TeacherOrganization)
            .options(
                selectinload(TeacherOrganization.teacher).load_only(
                    Teacher.id, Teacher.name, Teacher.email
                )
            )
            .filter(
                TeacherOrganization.organization_id.in_(org_ids),
                TeacherOrganization.role == "org_owner",
                TeacherOrganization.is_active.is_(True),
            )
            .all()
        )
        logger.info(f"Found {len(owner_rels)} organization owners")

        # Create a mapping of org_id -> owner for O(1) lookup
        owner_map = {rel.organization_id: rel.teacher for rel in owner_rels}
        logger.info(f"Built owner_map with {len(owner_map)} entries")

        # Build response with owner information
        result = []
        for i, org in enumerate(organizations):
            try:
                owner = owner_map.get(org.id)
                logger.info(
                    f"Building response for org {i}: id={org.id}, name={org.name}"
                )
                response = OrganizationResponse.from_orm(org, owner)
                result.append(response)
            except Exception as org_error:
                logger.error(
                    f"Error building response for org {org.id}: {str(org_error)}",
                    exc_info=True,
                )
                raise

        logger.info(f"Successfully built {len(result)} organization responses")
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Error building organization list: {type(e).__name__}: {str(e)}",
            exc_info=True,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"建立組織列表失敗: {type(e).__name__}",
        )


class OrganizationStatsResponse(BaseModel):
    """Response model for organization statistics"""

    total_organizations: int
    total_schools: int
    total_teachers: int
    total_students: int


@router.get("/stats", response_model=OrganizationStatsResponse)
async def get_organization_stats(
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Get aggregated statistics for organizations the current teacher can access.
    Returns counts of organizations, schools, teachers, and students.
    """
    logger = logging.getLogger(__name__)

    try:
        # Get teacher's organizations
        teacher_orgs = (
            db.query(TeacherOrganization)
            .filter(
                TeacherOrganization.teacher_id == teacher.id,
                TeacherOrganization.is_active.is_(True),
            )
            .all()
        )

        # Validate and collect organization IDs (defensive coding)
        org_ids = []
        for to in teacher_orgs:
            if isinstance(to.organization_id, uuid.UUID):
                org_ids.append(to.organization_id)
            else:
                try:
                    org_ids.append(uuid.UUID(str(to.organization_id)))
                except ValueError:
                    continue  # Skip invalid UUIDs

        # If no organizations, return zeros
        if not org_ids:
            return OrganizationStatsResponse(
                total_organizations=0,
                total_schools=0,
                total_teachers=0,
                total_students=0,
            )

        # Count active organizations
        total_orgs = (
            db.query(func.count(Organization.id))
            .filter(Organization.id.in_(org_ids), Organization.is_active.is_(True))
            .scalar()
        )

        # Count schools under these organizations
        total_schools = (
            db.query(func.count(School.id))
            .filter(School.organization_id.in_(org_ids), School.is_active.is_(True))
            .scalar()
        )

        # Count unique teachers (org members + school members) - Use UNION to deduplicate
        # A teacher can be both org member AND school member, so we must deduplicate
        # Get school IDs for counting school-level teachers
        school_ids = (
            db.query(School.id)
            .filter(School.organization_id.in_(org_ids), School.is_active.is_(True))
            .all()
        )
        school_id_list = [s.id for s in school_ids]

        # Build UNION query to get unique teacher IDs
        # Query 1: Organization-level teachers
        org_teacher_query = select(TeacherOrganization.teacher_id).where(
            TeacherOrganization.organization_id.in_(org_ids),
            TeacherOrganization.is_active.is_(True),
        )

        # Query 2: School-level teachers (only if schools exist)
        if school_id_list:
            school_teacher_query = select(TeacherSchool.teacher_id).where(
                TeacherSchool.school_id.in_(school_id_list),
                TeacherSchool.is_active.is_(True),
            )
            # UNION deduplicates automatically
            unique_teachers_query = union(org_teacher_query, school_teacher_query)
        else:
            unique_teachers_query = org_teacher_query

        # Count unique teachers from the UNION
        total_teachers = (
            db.query(func.count())
            .select_from(unique_teachers_query.alias("unique_teachers"))
            .scalar()
        ) or 0

        # Count unique active students across all schools in these organizations
        if school_id_list:
            total_students = (
                db.query(func.count(distinct(StudentSchool.student_id)))
                .filter(
                    StudentSchool.school_id.in_(school_id_list),
                    StudentSchool.is_active.is_(True),
                )
                .scalar()
            ) or 0
        else:
            total_students = 0

        return OrganizationStatsResponse(
            total_organizations=total_orgs or 0,
            total_schools=total_schools or 0,
            total_teachers=total_teachers,
            total_students=total_students,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching organization stats: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="獲取組織統計資料失敗",
        )


@router.get("/{org_id}", response_model=OrganizationResponse)
async def get_organization(
    org_id: uuid.UUID,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Get organization details.
    Requires teacher to be a member of the organization.
    """
    org = check_org_permission(teacher.id, org_id, db)

    # Get org_owner for response
    owner = (
        db.query(Teacher)
        .join(TeacherOrganization)
        .filter(
            TeacherOrganization.organization_id == org_id,
            TeacherOrganization.role == "org_owner",
            TeacherOrganization.is_active.is_(True),
        )
        .first()
    )

    return OrganizationResponse.from_orm(org, owner=owner)


@router.patch("/{org_id}", response_model=OrganizationResponse)
async def update_organization(
    org_id: uuid.UUID,
    org_data: OrganizationUpdate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Update organization details.
    Requires org_owner role.
    """
    org = check_org_permission(teacher.id, org_id, db)

    # Update fields if provided
    if org_data.name is not None:
        org.name = org_data.name
    if org_data.display_name is not None:
        org.display_name = org_data.display_name
    if org_data.description is not None:
        org.description = org_data.description
    if org_data.tax_id is not None:
        # Check uniqueness if tax_id is being changed (only among active organizations)
        # Per #151 Decision #2: Partial unique index allows tax_id reuse after deactivation
        if org_data.tax_id != org.tax_id:
            existing = (
                db.query(Organization)
                .filter(
                    Organization.tax_id == org_data.tax_id,
                    Organization.id != org_id,
                    Organization.is_active.is_(True),
                )
                .first()
            )
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="此統一編號已被使用"
                )
        org.tax_id = org_data.tax_id
    if org_data.teacher_limit is not None:
        org.teacher_limit = org_data.teacher_limit  # Decision #5: Update teacher limit
    if org_data.contact_email is not None:
        org.contact_email = org_data.contact_email
    if org_data.contact_phone is not None:
        org.contact_phone = org_data.contact_phone
    if org_data.address is not None:
        org.address = org_data.address
    if org_data.is_active is not None:
        org.is_active = org_data.is_active

    db.commit()
    db.refresh(org)

    return OrganizationResponse.from_orm(org)


@router.delete("/{org_id}")
async def delete_organization(
    org_id: uuid.UUID,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Delete organization (soft delete).
    Requires org_owner role.
    """
    org = check_org_permission(teacher.id, org_id, db)

    # Soft delete
    org.is_active = False
    db.commit()

    return {"message": "Organization deleted successfully"}


# ============ Teacher Management Endpoints ============


class AddTeacherRequest(BaseModel):
    """Request model for adding teacher to organization"""

    teacher_id: int
    role: str = Field(..., pattern="^(org_owner|org_admin)$")


class InviteTeacherRequest(BaseModel):
    """Request model for inviting teacher to organization"""

    email: str = Field(..., max_length=200)
    name: str = Field(..., min_length=1, max_length=100)
    role: str = Field(default="teacher", pattern="^(org_admin|teacher)$")


class TeacherRelationResponse(BaseModel):
    """Response model for teacher-organization relationship"""

    id: int
    teacher_id: int
    organization_id: str
    role: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

    @classmethod
    def from_orm(cls, rel: TeacherOrganization):
        return cls(
            id=rel.id,
            teacher_id=rel.teacher_id,
            organization_id=str(rel.organization_id),
            role=rel.role,
            is_active=rel.is_active,
            created_at=rel.created_at,
        )


class TeacherUpdateRequest(BaseModel):
    """Request model for updating teacher in organization"""

    role: str  # "org_owner" | "org_admin" | "teacher"
    is_active: Optional[bool] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class TeacherInfo(BaseModel):
    """Teacher information in organization"""

    id: int
    email: str
    name: str
    role: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/{org_id}/teachers", response_model=List[TeacherInfo])
async def list_organization_teachers(
    org_id: uuid.UUID,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    List all teachers (including inactive) in an organization.
    Requires teacher to be a member of the organization.

    Performance optimization: Uses joinedload to fetch teachers in a single query.
    """
    # Check permission
    check_org_permission(teacher.id, org_id, db)

    # Get all teacher relationships with eager loading (eliminates N+1 query)
    # ✅ FIX #157: Use selectinload + load_only (same fix as list_organizations)
    teacher_orgs = (
        db.query(TeacherOrganization)
        .options(
            selectinload(TeacherOrganization.teacher).load_only(
                Teacher.id, Teacher.name, Teacher.email
            )
        )
        .filter(
            TeacherOrganization.organization_id == org_id,
        )
        .all()
    )

    result = []
    for to in teacher_orgs:
        if to.teacher:
            result.append(
                TeacherInfo(
                    id=to.teacher.id,
                    email=to.teacher.email,
                    name=to.teacher.name,
                    role=to.role,
                    is_active=to.is_active,
                    created_at=to.created_at,
                )
            )

    # Sort by role priority: org_owner > org_admin > school_admin > teacher
    role_priority = {
        "org_owner": 0,
        "org_admin": 1,
        "school_admin": 2,
        "teacher": 3,
    }
    result.sort(key=lambda t: role_priority.get(t.role, 999))

    return result


@router.post(
    "/{org_id}/teachers/invite",
    status_code=status.HTTP_201_CREATED,
    response_model=TeacherRelationResponse,
)
async def invite_teacher_to_organization(
    org_id: uuid.UUID,
    request: InviteTeacherRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Invite a teacher to organization by email.
    If teacher exists, adds them to org.
    If teacher doesn't exist, creates account and adds to org.
    Requires manage_teachers permission.
    """
    casbin_service = get_casbin_service()

    # Check permission and get organization (with row lock for teacher limit check)
    # for_update=True prevents race conditions when checking teacher limit
    org = check_org_permission(teacher.id, org_id, db, for_update=True)

    # Use Casbin to check manage_teachers permission
    has_permission = casbin_service.enforcer.enforce(
        str(teacher.id), f"org-{org_id}", "manage_teachers", "write"
    )

    if not has_permission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to invite teachers to this organization",
        )

    # Check teacher limit (Decision #5: Teacher Authorization Count)
    # org is already fetched above with SELECT FOR UPDATE lock
    if org.teacher_limit is not None:
        # Count active teachers (excluding org_owner)
        # org_owner doesn't count towards teacher authorization limit
        active_teacher_count = (
            db.query(TeacherOrganization)
            .filter(
                TeacherOrganization.organization_id == org_id,
                TeacherOrganization.is_active.is_(True),
                TeacherOrganization.role != "org_owner",  # Exclude org_owner from count
            )
            .count()
        )

        if active_teacher_count >= org.teacher_limit:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"已達教師授權上限（{org.teacher_limit} 位）",
            )

    # Check if teacher already exists by email
    existing_teacher = db.query(Teacher).filter(Teacher.email == request.email).first()

    if existing_teacher:
        # Teacher exists - check if already in org
        existing_rel = (
            db.query(TeacherOrganization)
            .filter(
                TeacherOrganization.teacher_id == existing_teacher.id,
                TeacherOrganization.organization_id == org_id,
                TeacherOrganization.is_active.is_(True),
            )
            .first()
        )

        if existing_rel:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="此教師已在組織中",
            )

        # Add existing teacher to organization
        teacher_org = TeacherOrganization(
            teacher_id=existing_teacher.id,
            organization_id=org_id,
            role=request.role,
            is_active=True,
        )
        db.add(teacher_org)

        # Fix TOCTOU race condition: flush to DB but keep transaction open
        # This allows us to verify the actual count after insert
        db.flush()
        db.refresh(teacher_org)

        # Re-verify teacher limit AFTER insert to prevent race condition
        # Even with SELECT FOR UPDATE, concurrent transactions can insert between
        # check and commit. We must verify the final state.
        if org.teacher_limit is not None:
            actual_count = (
                db.query(TeacherOrganization)
                .filter(
                    TeacherOrganization.organization_id == org_id,
                    TeacherOrganization.is_active.is_(True),
                    TeacherOrganization.role != "org_owner",
                )
                .count()
            )

            if actual_count > org.teacher_limit:
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"已達教師授權上限（{org.teacher_limit} 位）。目前: {actual_count}",
                )

        # All checks passed, commit the transaction
        db.commit()
        db.refresh(teacher_org)

        # Sync Casbin roles
        try:
            casbin_service.sync_teacher_roles(existing_teacher.id)
        except Exception as e:
            import logging

            logger = logging.getLogger(__name__)
            logger.error(
                f"Failed to sync Casbin roles for teacher {existing_teacher.id}: {e}"
            )

        return TeacherRelationResponse.from_orm(teacher_org)

    else:
        # Teacher doesn't exist - create new account
        # Generate random password (user should reset via "forgot password")
        random_password = secrets.token_urlsafe(16)

        new_teacher = Teacher(
            email=request.email,
            password_hash=get_password_hash(random_password),
            name=request.name,
            is_active=True,  # Active immediately for org invites
            is_demo=False,
            email_verified=True,  # Org invites are trusted, allow password reset
        )
        db.add(new_teacher)
        db.commit()
        db.refresh(new_teacher)

        # Add to organization
        teacher_org = TeacherOrganization(
            teacher_id=new_teacher.id,
            organization_id=org_id,
            role=request.role,
            is_active=True,
        )
        db.add(teacher_org)

        # Fix TOCTOU race condition: flush to DB but keep transaction open
        # This allows us to verify the actual count after insert
        db.flush()
        db.refresh(teacher_org)

        # Re-verify teacher limit AFTER insert to prevent race condition
        # Even with SELECT FOR UPDATE, concurrent transactions can insert between
        # check and commit. We must verify the final state.
        if org.teacher_limit is not None:
            actual_count = (
                db.query(TeacherOrganization)
                .filter(
                    TeacherOrganization.organization_id == org_id,
                    TeacherOrganization.is_active.is_(True),
                    TeacherOrganization.role != "org_owner",
                )
                .count()
            )

            if actual_count > org.teacher_limit:
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"已達教師授權上限（{org.teacher_limit} 位）。目前: {actual_count}",
                )

        # All checks passed, commit the transaction
        db.commit()
        db.refresh(teacher_org)

        # Sync Casbin roles
        try:
            casbin_service.sync_teacher_roles(new_teacher.id)
        except Exception as e:
            import logging

            logger = logging.getLogger(__name__)
            logger.error(
                f"Failed to sync Casbin roles for teacher {new_teacher.id}: {e}"
            )

        # Send password setup email to the new teacher
        try:
            email_sent = email_service.send_password_setup_email(
                db, new_teacher, org.display_name or org.name
            )
            if email_sent:
                import logging

                logger = logging.getLogger(__name__)
                logger.info(
                    f"Password setup email sent to {new_teacher.email} for organization {org.name}"
                )
        except Exception as e:
            import logging

            logger = logging.getLogger(__name__)
            logger.error(
                f"Failed to send password setup email to {new_teacher.email}: {e}"
            )
            # Don't fail the request if email sending fails

        return TeacherRelationResponse.from_orm(teacher_org)


@router.post(
    "/{org_id}/teachers",
    status_code=status.HTTP_201_CREATED,
    response_model=TeacherRelationResponse,
)
async def add_teacher_to_organization(
    org_id: uuid.UUID,
    request: AddTeacherRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Add a teacher to organization with specified role.
    Requires manage_teachers permission.
    Role can be org_owner or org_admin.
    """
    casbin_service = get_casbin_service()

    # Check permission and get organization (with row lock for teacher limit check)
    # for_update=True prevents race conditions when checking teacher limit
    org = check_org_permission(teacher.id, org_id, db, for_update=True)

    # Use Casbin to check manage_teachers permission
    has_permission = casbin_service.enforcer.enforce(
        str(teacher.id), f"org-{org_id}", "manage_teachers", "write"
    )

    if not has_permission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to add teachers to this organization",
        )

    # Check if adding org_owner and limit to 1
    if request.role == "org_owner":
        existing_owner = (
            db.query(TeacherOrganization)
            .filter(
                TeacherOrganization.organization_id == org_id,
                TeacherOrganization.role == "org_owner",
                TeacherOrganization.is_active.is_(True),
            )
            .first()
        )

        if existing_owner:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Organization already has an owner",
            )

    # Check teacher limit (Decision #5: Teacher Authorization Count)
    # org is already fetched above with SELECT FOR UPDATE lock
    if org.teacher_limit is not None:
        # Count active teachers (excluding org_owner)
        # org_owner doesn't count towards teacher authorization limit
        active_teacher_count = (
            db.query(TeacherOrganization)
            .filter(
                TeacherOrganization.organization_id == org_id,
                TeacherOrganization.is_active.is_(True),
                TeacherOrganization.role != "org_owner",  # Exclude org_owner from count
            )
            .count()
        )

        if active_teacher_count >= org.teacher_limit:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"已達教師授權上限（{org.teacher_limit} 位）",
            )

    # Check if teacher already has relationship
    existing = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == request.teacher_id,
            TeacherOrganization.organization_id == org_id,
            TeacherOrganization.is_active.is_(True),
        )
        .first()
    )

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Teacher already belongs to this organization",
        )

    # Verify teacher exists
    target_teacher = db.query(Teacher).filter(Teacher.id == request.teacher_id).first()
    if not target_teacher:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found"
        )

    # Create relationship
    teacher_org = TeacherOrganization(
        teacher_id=request.teacher_id,
        organization_id=org_id,
        role=request.role,
        is_active=True,
    )
    db.add(teacher_org)

    # Fix TOCTOU race condition: flush to DB but keep transaction open
    # This allows us to verify the actual count after insert
    db.flush()
    db.refresh(teacher_org)

    # Re-verify teacher limit AFTER insert to prevent race condition
    # Even with SELECT FOR UPDATE, concurrent transactions can insert between
    # check and commit. We must verify the final state.
    if org.teacher_limit is not None and request.role != "org_owner":
        actual_count = (
            db.query(TeacherOrganization)
            .filter(
                TeacherOrganization.organization_id == org_id,
                TeacherOrganization.is_active.is_(True),
                TeacherOrganization.role != "org_owner",
            )
            .count()
        )

        if actual_count > org.teacher_limit:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"已達教師授權上限（{org.teacher_limit} 位）。目前: {actual_count}",
            )

    # All checks passed, commit the transaction
    db.commit()
    db.refresh(teacher_org)

    # Sync Casbin roles for this teacher
    try:
        casbin_service.sync_teacher_roles(request.teacher_id)
    except Exception as e:
        # Log error but don't fail the request
        import logging

        logger = logging.getLogger(__name__)
        logger.error(
            f"Failed to sync Casbin roles for teacher {request.teacher_id}: {e}"
        )

    return TeacherRelationResponse.from_orm(teacher_org)


@router.put("/{org_id}/teachers/{teacher_id}")
async def update_teacher_role(
    org_id: uuid.UUID,
    teacher_id: int,
    update_data: TeacherUpdateRequest,
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Update teacher's role in organization.
    Requires org_owner role or manage_teachers permission.
    """
    from datetime import timezone

    casbin_service = get_casbin_service()

    # Check org exists
    organization = (
        db.query(Organization)
        .filter(Organization.id == org_id, Organization.is_active.is_(True))
        .first()
    )
    if not organization:
        raise HTTPException(404, f"Organization {org_id} not found")

    # Get current teacher's relation
    current_relation = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == current_teacher.id,
            TeacherOrganization.organization_id == org_id,
            TeacherOrganization.is_active.is_(True),
        )
        .first()
    )
    if not current_relation:
        raise HTTPException(403, "Not a member of this organization")

    # Permission check
    if current_relation.role != "org_owner":
        has_permission = casbin_service.enforcer.enforce(
            str(current_teacher.id), f"org-{org_id}", "manage_teachers", "write"
        )
        if not has_permission:
            raise HTTPException(403, "No permission to update teacher roles")

    # Prevent self-modification
    if teacher_id == current_teacher.id:
        raise HTTPException(400, "Cannot change your own role")

    # Get target teacher (include inactive members so we can re-activate them)
    target_relation = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == teacher_id,
            TeacherOrganization.organization_id == org_id,
        )
        .first()
    )
    if not target_relation:
        raise HTTPException(404, f"Teacher {teacher_id} not found in organization")

    # Determine the final role (use requested role, fallback to current)
    final_role = update_data.role or target_relation.role

    # Handle is_active change
    if (
        update_data.is_active is not None
        and update_data.is_active != target_relation.is_active
    ):
        # Prevent deactivating org_owner (must transfer ownership first)
        if not update_data.is_active and target_relation.role == "org_owner":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="無法停用組織擁有者，請先轉移擁有權",
            )
        if update_data.is_active:
            # Re-activating: check teacher_limit (org_owner exempt)
            if organization.teacher_limit is not None and final_role != "org_owner":
                active_teacher_count = (
                    db.query(TeacherOrganization)
                    .filter(
                        TeacherOrganization.organization_id == org_id,
                        TeacherOrganization.is_active.is_(True),
                        TeacherOrganization.role != "org_owner",
                        TeacherOrganization.teacher_id != teacher_id,
                    )
                    .count()
                )
                if active_teacher_count >= organization.teacher_limit:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"已達教師授權上限（{organization.teacher_limit} 位），無法重新啟用",
                    )
        target_relation.is_active = update_data.is_active

    # Handle org_owner transfer (only when target is/will be active)
    if final_role == "org_owner" and target_relation.is_active:
        current_owner = (
            db.query(TeacherOrganization)
            .filter(
                TeacherOrganization.organization_id == org_id,
                TeacherOrganization.role == "org_owner",
                TeacherOrganization.is_active.is_(True),
            )
            .first()
        )
        if current_owner and current_owner.teacher_id != teacher_id:
            current_owner.role = "org_admin"
            current_owner.updated_at = datetime.now(timezone.utc)

    # Update role
    target_relation.role = final_role
    target_relation.updated_at = datetime.now(timezone.utc)

    # Update teacher info if provided
    if update_data.first_name or update_data.last_name:
        target_teacher = db.query(Teacher).filter(Teacher.id == teacher_id).first()
        if update_data.first_name:
            target_teacher.first_name = update_data.first_name
        if update_data.last_name:
            target_teacher.last_name = update_data.last_name

    db.flush()

    # Re-verify teacher limit AFTER update to prevent race condition (TOCTOU)
    # Matches the pattern in invite/add endpoints (see RACE_CONDITION_FIX.md)
    if (
        target_relation.is_active
        and organization.teacher_limit is not None
        and target_relation.role != "org_owner"
    ):
        from sqlalchemy import func

        actual_count = (
            db.query(func.count(TeacherOrganization.id))
            .filter(
                TeacherOrganization.organization_id == org_id,
                TeacherOrganization.is_active.is_(True),
                TeacherOrganization.role != "org_owner",
            )
            .scalar()
        )
        if actual_count > organization.teacher_limit:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"已達教師授權上限（{organization.teacher_limit} 位），無法重新啟用",
            )

    db.commit()
    db.refresh(target_relation)

    return {
        "id": target_relation.id,
        "teacher_id": target_relation.teacher_id,
        "organization_id": str(target_relation.organization_id),
        "role": target_relation.role,
        "is_active": target_relation.is_active,
        "updated_at": target_relation.updated_at.isoformat(),
    }


@router.delete("/{org_id}/teachers/{teacher_id}")
async def remove_teacher_from_organization(
    org_id: uuid.UUID,
    teacher_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Remove a teacher from organization (soft delete).
    Requires manage_teachers permission.
    """
    casbin_service = get_casbin_service()

    # Check permission
    check_org_permission(teacher.id, org_id, db)

    # Use Casbin to check manage_teachers permission
    has_permission = casbin_service.enforcer.enforce(
        str(teacher.id), f"org-{org_id}", "manage_teachers", "write"
    )

    if not has_permission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to remove teachers from this organization",
        )

    # Find relationship
    teacher_org = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == teacher_id,
            TeacherOrganization.organization_id == org_id,
            TeacherOrganization.is_active.is_(True),
        )
        .first()
    )

    if not teacher_org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Teacher relationship not found",
        )

    # Soft delete
    teacher_org.is_active = False
    db.commit()

    # Sync Casbin roles for this teacher (will remove inactive roles)
    try:
        casbin_service.sync_teacher_roles(teacher_id)
    except Exception as e:
        # Log error but don't fail the request
        import logging

        logger = logging.getLogger(__name__)
        logger.error(f"Failed to sync Casbin roles for teacher {teacher_id}: {e}")

    return {"message": "Teacher removed from organization successfully"}


# ============ Permission Management Endpoints ============


class TeacherPermissionsUpdate(BaseModel):
    """Request model for updating teacher permissions"""

    can_create_classrooms: Optional[bool] = None
    can_view_other_teachers: Optional[bool] = None
    can_manage_students: Optional[bool] = None
    max_classrooms: Optional[int] = None
    allowed_actions: Optional[
        List[str]
    ] = None  # ["create", "read", "update", "delete"]


class TeacherPermissionsResponse(BaseModel):
    """Response model for teacher permissions"""

    teacher_id: int
    school_id: str
    roles: List[str]
    permissions: Optional[dict] = None

    class Config:
        from_attributes = True


@router.put("/{org_id}/teachers/{teacher_id}/permissions")
async def update_teacher_permissions(
    org_id: uuid.UUID,
    teacher_id: int,
    permissions_data: TeacherPermissionsUpdate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Update teacher's custom permissions within schools of this organization.
    Requires manage_teachers permission.

    Permissions are stored in teacher_schools.permissions (JSONB) and override default role permissions.
    """
    casbin_service = get_casbin_service()

    # Check if current teacher has manage_teachers permission
    check_org_permission(teacher.id, org_id, db)

    # Use Casbin to check manage_teachers permission
    has_permission = casbin_service.enforcer.enforce(
        str(teacher.id), f"org-{org_id}", "manage_teachers", "write"
    )

    if not has_permission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to manage teacher permissions in this organization",
        )

    # Get teacher_school relationships with JOIN on schools (performance optimization)
    teacher_schools = (
        db.query(TeacherSchool)
        .join(School, School.id == TeacherSchool.school_id)
        .filter(
            TeacherSchool.teacher_id == teacher_id,
            School.organization_id == org_id,
            School.is_active.is_(True),
            TeacherSchool.is_active.is_(True),
        )
        .all()
    )

    if not teacher_schools:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Teacher not found in any schools of this organization",
        )

    # Build permissions dict from request
    new_permissions = {}
    if permissions_data.can_create_classrooms is not None:
        new_permissions[
            "can_create_classrooms"
        ] = permissions_data.can_create_classrooms
    if permissions_data.can_view_other_teachers is not None:
        new_permissions[
            "can_view_other_teachers"
        ] = permissions_data.can_view_other_teachers
    if permissions_data.can_manage_students is not None:
        new_permissions["can_manage_students"] = permissions_data.can_manage_students
    if permissions_data.max_classrooms is not None:
        new_permissions["max_classrooms"] = permissions_data.max_classrooms
    if permissions_data.allowed_actions is not None:
        new_permissions["allowed_actions"] = permissions_data.allowed_actions

    # Update permissions for all teacher_school relationships
    updated_count = 0
    for ts in teacher_schools:
        # Merge with existing permissions
        current_permissions = ts.permissions or {}
        current_permissions.update(new_permissions)
        ts.permissions = current_permissions
        updated_count += 1

    db.commit()

    return {
        "message": f"Permissions updated for teacher {teacher_id} in {updated_count} school(s)",
        "updated_schools": updated_count,
        "permissions": new_permissions,
    }


@router.get("/{org_id}/teachers/{teacher_id}/permissions")
async def get_teacher_permissions(
    org_id: uuid.UUID,
    teacher_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Get teacher's permissions across all schools in this organization.
    Requires org_owner or org_admin role.

    Performance optimization: Uses JOIN to fetch teacher_schools in a single query.
    """
    # Check if current teacher has access to org
    check_org_permission(teacher.id, org_id, db)

    # Get teacher_school relationships with JOIN on schools
    # This eliminates the need to query schools separately
    teacher_schools = (
        db.query(TeacherSchool)
        .join(School, School.id == TeacherSchool.school_id)
        .filter(
            TeacherSchool.teacher_id == teacher_id,
            School.organization_id == org_id,
            School.is_active.is_(True),
            TeacherSchool.is_active.is_(True),
        )
        .all()
    )

    if not teacher_schools:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Teacher not found in any schools of this organization",
        )

    # Return permissions for each school
    result = []
    for ts in teacher_schools:
        result.append(
            {
                "teacher_id": ts.teacher_id,
                "school_id": str(ts.school_id),
                "roles": ts.roles,
                "permissions": ts.permissions,
            }
        )

    return {"teacher_id": teacher_id, "schools": result}


# ============ Phase 4 (issue #768 五.5) — Institution monthly billing ============


class StudentBillingBreakdown(BaseModel):
    student_id: int
    name: str
    billable: bool


class MonthlyBillingResponse(BaseModel):
    org_id: str
    year: int
    month: int
    per_student_price: int
    billable_student_count: int
    total_amount: int
    currency: str
    students: List[StudentBillingBreakdown]


def _load_billing_org_or_error(
    org_id: uuid.UUID, current_teacher: Teacher, db: Session
) -> Organization:
    """Load an active org and enforce billing auth: platform admin OR the
    org's `org_owner` specifically. Billing exposes PII (student names +
    billable status) so org_admin / teacher roles are excluded. Shared by
    the JSON and PDF billing endpoints. Raises 404 / 403.
    """
    org = (
        db.query(Organization)
        .filter(Organization.id == org_id, Organization.is_active.is_(True))
        .first()
    )
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found"
        )

    if not current_teacher.is_admin:
        is_owner = (
            db.query(TeacherOrganization)
            .filter(
                TeacherOrganization.teacher_id == current_teacher.id,
                TeacherOrganization.organization_id == org_id,
                TeacherOrganization.role == "org_owner",
                TeacherOrganization.is_active.is_(True),
            )
            .first()
            is not None
        )
        if not is_owner:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only org_owner can query monthly billing.",
            )
    return org


def _billing_filename_slug(org: Organization) -> str:
    """ASCII slug of the org name for the download filename (Content-
    Disposition needs ASCII). Chinese-only names collapse to 'invoice'."""
    base = org.name or org.display_name or "invoice"
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", base).strip("-").lower()
    return slug or "invoice"


@router.get("/{org_id}/billing/monthly", response_model=MonthlyBillingResponse)
async def get_monthly_billing(
    org_id: uuid.UUID,
    year: int = Query(..., ge=1, le=9998, description="Calendar year (Taipei)"),
    month: int = Query(..., ge=1, le=12, description="Calendar month (1-12)"),
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """Compute the institution's monthly invoice for a given (year, month).

    Auth: platform admin OR an org_owner of this org.
    Validation: org must be `org_type='institution'` with `per_student_price`
    set. 400 otherwise.

    Billing rule (issue #768 五.5): a student is billable for the month iff
    they were 'active' at any moment during the Taipei month window. See
    `services.institution_billing` for the detailed derivation.
    """
    org = _load_billing_org_or_error(org_id, current_teacher, db)

    try:
        result = compute_monthly_billing(org, year, month, db)
    # `_month_window` (and the Query(ge=1, le=9998) decorator) converts every
    # year/month range error into a ValueError before any datetime arithmetic,
    # so raw OverflowError cannot reach this layer. See
    # test_month_window_rejects_year_9999_to_prevent_overflow for the invariant.
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return result


@router.get("/{org_id}/billing/monthly.pdf")
async def get_monthly_billing_pdf(
    org_id: uuid.UUID,
    year: int = Query(..., ge=1, le=9998, description="Calendar year (Taipei)"),
    month: int = Query(..., ge=1, le=12, description="Calendar month (1-12)"),
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """Render the monthly 請款單 as a downloadable PDF (issue #838 Phase B).

    Same auth + validation as the JSON endpoint (admin OR org_owner). Reuses
    `compute_monthly_billing`; the PDF is presentation-only (no DB writes).
    Deterministic 請款單編號 (INV-{org 前8碼}-{YYYYMM}); remittance account
    comes from env config so it differs per environment.
    """
    org = _load_billing_org_or_error(org_id, current_teacher, db)

    try:
        billing = compute_monthly_billing(org, year, month, db)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    pdf_bytes = build_invoice_pdf(org, year, month, billing)
    filename = f"{_billing_filename_slug(org)}-{year:04d}-{month:02d}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class SendInvoiceEmailRequest(BaseModel):
    year: int = Field(..., ge=1, le=9998, description="Calendar year (Taipei)")
    month: int = Field(..., ge=1, le=12, description="Calendar month (1-12)")
    # EmailStr (not str) so malformed addresses fail with a 422 up front and,
    # critically, cannot inject CRLF into the raw Cc header built in
    # email_service._build_message. Capped to avoid a fat-fingered huge list.
    cc: Optional[List[EmailStr]] = Field(
        default=None, max_length=50, description="Optional CC emails"
    )


@router.post("/{org_id}/billing/monthly/send-email")
async def send_monthly_billing_email(
    org_id: uuid.UUID,
    body: SendInvoiceEmailRequest,
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """Email the monthly 請款單 (PDF attached) to the org's contact_email and
    record an append-only audit row (issue #838 Phase C).

    Auth: admin OR org_owner (same as the query/PDF endpoints). 400 if the
    org has no contact_email set. Repeat sends accumulate audit history and
    never delete prior rows.
    """
    org = _load_billing_org_or_error(org_id, current_teacher, db)

    if not org.contact_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="此機構尚未設定聯絡 email，請先於機構設定填寫聯絡 email 後再寄送。",
        )

    try:
        billing = compute_monthly_billing(org, body.year, body.month, db)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    try:
        record = send_monthly_invoice_email(
            db,
            org,
            body.year,
            body.month,
            billing,
            org.contact_email,
            cc=body.cc,
            sent_by_id=current_teacher.id,
            email_service=email_service,
        )
    except RuntimeError:
        # Email transport failed — no audit row written; surface a retryable
        # error rather than a phantom success.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="請款 Email 發送失敗，請稍後再試。",
        )

    # issue #838 Phase D — sending the 請款 email also locks a pending
    # accounts-receivable invoice (idempotent on (org, year, month); a repeat
    # send does not disturb an already-paid invoice). The email has ALREADY
    # been sent and audited at this point, so a lock failure must NOT surface
    # as a request failure (that would wrongly prompt the admin to re-send a
    # duplicate email) — log and continue.
    try:
        upsert_invoice(db, org.id, body.year, body.month, billing["total_amount"])
    except Exception:  # pragma: no cover - defensive
        logging.getLogger(__name__).exception(
            "Invoice lock after send-email failed (email already sent) "
            f"org={org.id} {body.year}-{body.month:02d}"
        )

    return {
        "success": True,
        "recipient": record.recipient,
        "cc": record.cc or [],
        "sent_at": record.sent_at.isoformat() if record.sent_at else None,
    }


@router.get("/{org_id}/billing/monthly/email-history")
async def get_monthly_billing_email_history(
    org_id: uuid.UUID,
    year: int = Query(..., ge=1, le=9998),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_teacher: Teacher = Depends(get_current_teacher),
):
    """List prior 請款 email sends for (org, year, month), newest first, so
    the UI can show the last-sent time. Same auth as the billing endpoints.
    """
    _load_billing_org_or_error(org_id, current_teacher, db)

    rows = (
        db.query(InstitutionInvoiceEmail)
        .filter(
            InstitutionInvoiceEmail.organization_id == org_id,
            InstitutionInvoiceEmail.year == year,
            InstitutionInvoiceEmail.month == month,
        )
        .order_by(InstitutionInvoiceEmail.sent_at.desc())
        .all()
    )
    return {
        "last_sent_at": (
            rows[0].sent_at.isoformat() if rows and rows[0].sent_at else None
        ),
        "history": [
            {
                "recipient": r.recipient,
                "cc": r.cc or [],
                "sent_at": r.sent_at.isoformat() if r.sent_at else None,
                "sent_by_admin_id": r.sent_by_admin_id,
            }
            for r in rows
        ],
    }

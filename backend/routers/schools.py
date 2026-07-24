"""
School API Routes

CRUD operations for schools with Casbin permission checks.
Only org_owner and org_admin can manage schools.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone
import uuid

from database import get_db
from models import (
    Teacher,
    Organization,
    School,
    TeacherOrganization,
    TeacherSchool,
    ClassroomSchool,
    ClassroomStudent,
)
from auth import verify_token
from services.casbin_service import get_casbin_service
from services.group_buy import resume_member_on_group_buy_unbind


router = APIRouter(prefix="/api/schools", tags=["schools"])
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


class SchoolCreate(BaseModel):
    """Request model for creating a school"""

    organization_id: str = Field(..., description="Organization UUID")
    name: str = Field(..., min_length=1, max_length=100)
    display_name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    contact_email: Optional[str] = Field(None, max_length=200)
    contact_phone: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = None


class SchoolUpdate(BaseModel):
    """Request model for updating a school"""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    display_name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    contact_email: Optional[str] = Field(None, max_length=200)
    contact_phone: Optional[str] = Field(None, max_length=50)
    address: Optional[str] = None
    is_active: Optional[bool] = None


class SchoolResponse(BaseModel):
    """Response model for school"""

    id: str
    organization_id: str
    name: str
    display_name: Optional[str]
    description: Optional[str]
    contact_email: Optional[str]
    contact_phone: Optional[str]
    address: Optional[str]
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime]
    admin_name: Optional[str] = None
    admin_email: Optional[str] = None
    classroom_count: int = 0
    teacher_count: int = 0
    student_count: int = 0

    class Config:
        from_attributes = True

    @classmethod
    def from_orm(
        cls,
        school: School,
        admin_name: Optional[str] = None,
        admin_email: Optional[str] = None,
        classroom_count: int = 0,
        teacher_count: int = 0,
        student_count: int = 0,
    ):
        """Convert School model to response"""
        return cls(
            id=str(school.id),
            organization_id=str(school.organization_id),
            name=school.name,
            display_name=school.display_name,
            description=school.description,
            contact_email=school.contact_email,
            contact_phone=school.contact_phone,
            address=school.address,
            is_active=school.is_active,
            created_at=school.created_at,
            updated_at=school.updated_at,
            admin_name=admin_name,
            admin_email=admin_email,
            classroom_count=classroom_count,
            teacher_count=teacher_count,
            student_count=student_count,
        )


# ============ Helper Functions ============


def check_org_permission(
    teacher_id: int, org_id: uuid.UUID, db: Session
) -> Organization:
    """
    Check if teacher has org-level access (org_owner or org_admin).
    Raises HTTPException if not found or no permission.
    Returns organization if permission granted.
    """
    # Check if organization exists and is active (soft delete strategy)
    org = (
        db.query(Organization)
        .filter(Organization.id == org_id, Organization.is_active.is_(True))
        .first()
    )
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found"
        )

    # Check if teacher is org_owner or org_admin
    teacher_org = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == teacher_id,
            TeacherOrganization.organization_id == org_id,
            TeacherOrganization.role.in_(["org_owner", "org_admin"]),
            TeacherOrganization.is_active.is_(True),
        )
        .first()
    )

    if not teacher_org:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to manage schools in this organization",
        )

    return org


def check_school_permission(
    teacher_id: int, school_id: uuid.UUID, db: Session
) -> School:
    """
    Check if teacher has access to school.
    Requires org_owner or org_admin of the school's organization.
    """
    # Check if school exists and is active (soft delete strategy)
    school = (
        db.query(School)
        .filter(School.id == school_id, School.is_active.is_(True))
        .first()
    )
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="School not found"
        )

    # Check org-level permission
    check_org_permission(teacher_id, school.organization_id, db)

    return school


# ============ API Endpoints ============


@router.post("", status_code=status.HTTP_201_CREATED, response_model=SchoolResponse)
async def create_school(
    school_data: SchoolCreate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Create a new school.
    Requires org_owner or org_admin role in the organization.
    """
    org_id = uuid.UUID(school_data.organization_id)

    # Check permission (org_owner or org_admin)
    check_org_permission(teacher.id, org_id, db)

    # Create school
    school = School(
        organization_id=org_id,
        name=school_data.name,
        display_name=school_data.display_name,
        description=school_data.description,
        contact_email=school_data.contact_email,
        contact_phone=school_data.contact_phone,
        address=school_data.address,
        is_active=True,
    )

    db.add(school)
    db.commit()
    db.refresh(school)

    return SchoolResponse.from_orm(school)


@router.get("", response_model=List[SchoolResponse])
async def list_schools(
    organization_id: Optional[str] = Query(
        None, description="Filter by organization ID"
    ),
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    List all schools that the current teacher has access to.
    Returns schools where teacher has:
    - org_owner or org_admin role (organization level)
    - school_admin or school_director role (school level)

    If organization_id is provided, filter by that organization.
    """
    # 1. Get all organizations where teacher is org_owner or org_admin
    teacher_orgs = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == teacher.id,
            TeacherOrganization.role.in_(["org_owner", "org_admin"]),
            TeacherOrganization.is_active.is_(True),
        )
        .all()
    )

    org_ids = [to.organization_id for to in teacher_orgs]

    # 2. Get schools where teacher has school-level roles (school_admin, school_director)
    # Note: roles is a JSONB array in PostgreSQL, we need to check if it contains any of the roles
    teacher_schools = (
        db.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == teacher.id,
            or_(
                TeacherSchool.roles.op("@>")(
                    ["school_admin"]
                ),  # JSONB contains operator
                TeacherSchool.roles.op("@>")(["school_director"]),
            ),
            TeacherSchool.is_active.is_(True),
        )
        .all()
    )
    school_ids_from_roles = [ts.school_id for ts in teacher_schools]

    # 3. Build query combining both organization-level and school-level access
    if org_ids and school_ids_from_roles:
        # User has both org-level and school-level access
        query = db.query(School).filter(
            or_(
                School.organization_id.in_(org_ids),
                School.id.in_(school_ids_from_roles),
            ),
            School.is_active.is_(True),
        )
    elif org_ids:
        # Only org-level access (org_owner, org_admin)
        query = db.query(School).filter(
            School.organization_id.in_(org_ids), School.is_active.is_(True)
        )
    elif school_ids_from_roles:
        # Only school-level access (school_admin, school_director)
        query = db.query(School).filter(
            School.id.in_(school_ids_from_roles), School.is_active.is_(True)
        )
    else:
        # No access - return empty list
        schools = []
        school_ids = []
        # Skip to stats calculation with empty lists
        classroom_counts = {}
        teacher_counts = {}
        student_counts = {}
        # Jump to result building
        result = []
        return result

    # Apply organization filter if provided
    if organization_id:
        query = query.filter(School.organization_id == uuid.UUID(organization_id))

    schools = query.all()
    school_ids = [s.id for s in schools]

    # Batch query for classroom counts
    classroom_counts = dict(
        db.query(ClassroomSchool.school_id, func.count(ClassroomSchool.classroom_id))
        .filter(
            ClassroomSchool.school_id.in_(school_ids),
            ClassroomSchool.is_active.is_(True),
        )
        .group_by(ClassroomSchool.school_id)
        .all()
    )

    # Batch query for teacher counts (unique teachers per school)
    teacher_counts = dict(
        db.query(
            TeacherSchool.school_id, func.count(func.distinct(TeacherSchool.teacher_id))
        )
        .filter(
            TeacherSchool.school_id.in_(school_ids), TeacherSchool.is_active.is_(True)
        )
        .group_by(TeacherSchool.school_id)
        .all()
    )

    # Batch query for student counts (via classrooms)
    student_counts_raw = (
        db.query(
            ClassroomSchool.school_id,
            func.count(func.distinct(ClassroomStudent.student_id)),
        )
        .join(
            ClassroomStudent,
            ClassroomSchool.classroom_id == ClassroomStudent.classroom_id,
        )
        .filter(
            ClassroomSchool.school_id.in_(school_ids),
            ClassroomSchool.is_active.is_(True),
        )
        .group_by(ClassroomSchool.school_id)
        .all()
    )
    student_counts = dict(student_counts_raw)

    # Batch fetch all school admins in one JOIN query (instead of N+1)
    admin_rows = (
        db.query(TeacherSchool.school_id, Teacher.name, Teacher.email)
        .join(Teacher, Teacher.id == TeacherSchool.teacher_id)
        .filter(
            TeacherSchool.school_id.in_(school_ids),
            TeacherSchool.roles.op("@>")(["school_admin"]),
            TeacherSchool.is_active.is_(True),
        )
        .all()
    )
    admin_map = {row.school_id: (row.name, row.email) for row in admin_rows}

    # Build response with admin info and counts
    result = []
    for school in schools:
        admin_info = admin_map.get(school.id)

        result.append(
            SchoolResponse.from_orm(
                school,
                admin_name=admin_info[0] if admin_info else None,
                admin_email=admin_info[1] if admin_info else None,
                classroom_count=classroom_counts.get(school.id, 0),
                teacher_count=teacher_counts.get(school.id, 0),
                student_count=student_counts.get(school.id, 0),
            )
        )

    return result


@router.get("/{school_id}", response_model=SchoolResponse)
async def get_school(
    school_id: uuid.UUID,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Get school details.
    Requires org_owner or org_admin role.
    """
    school = check_school_permission(teacher.id, school_id, db)

    # Find school admin with single JOIN query
    admin = (
        db.query(Teacher.name, Teacher.email)
        .join(TeacherSchool, Teacher.id == TeacherSchool.teacher_id)
        .filter(
            TeacherSchool.school_id == school.id,
            TeacherSchool.roles.op("@>")(["school_admin"]),
            TeacherSchool.is_active.is_(True),
        )
        .first()
    )

    return SchoolResponse.from_orm(
        school,
        admin_name=admin.name if admin else None,
        admin_email=admin.email if admin else None,
    )


@router.patch("/{school_id}", response_model=SchoolResponse)
async def update_school(
    school_id: uuid.UUID,
    school_data: SchoolUpdate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Update school details.
    Requires org_owner or org_admin role.
    """
    school = check_school_permission(teacher.id, school_id, db)

    # Update fields if provided
    if school_data.name is not None:
        school.name = school_data.name
    if school_data.display_name is not None:
        school.display_name = school_data.display_name
    if school_data.description is not None:
        school.description = school_data.description
    if school_data.contact_email is not None:
        school.contact_email = school_data.contact_email
    if school_data.contact_phone is not None:
        school.contact_phone = school_data.contact_phone
    if school_data.address is not None:
        school.address = school_data.address
    if school_data.is_active is not None:
        school.is_active = school_data.is_active

    db.commit()
    db.refresh(school)

    return SchoolResponse.from_orm(school)


@router.delete("/{school_id}")
async def delete_school(
    school_id: uuid.UUID,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Delete school (soft delete).
    Requires org_owner or org_admin role.
    """
    school = check_school_permission(teacher.id, school_id, db)

    # Soft delete
    school.is_active = False
    db.commit()

    return {"message": "School deleted successfully"}


# ============ Teacher Management Endpoints ============


class AddTeacherToSchoolRequest(BaseModel):
    """Request model for adding teacher to school"""

    teacher_id: int
    roles: List[str] = Field(..., description="List of roles: school_admin, teacher")


class UpdateTeacherRolesRequest(BaseModel):
    """Request model for updating teacher roles"""

    roles: Optional[List[str]] = Field(
        None, description="List of roles: school_admin, teacher"
    )
    is_active: Optional[bool] = Field(
        None, description="Activate or deactivate teacher in this school"
    )


class TeacherSchoolRelationResponse(BaseModel):
    """Response model for teacher-school relationship"""

    id: int
    teacher_id: int
    school_id: str
    roles: List[str]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

    @classmethod
    def from_orm(cls, rel: TeacherSchool):
        return cls(
            id=rel.id,
            teacher_id=rel.teacher_id,
            school_id=str(rel.school_id),
            roles=rel.roles if rel.roles else [],
            is_active=rel.is_active,
            created_at=rel.created_at,
        )


class SchoolTeacherInfo(BaseModel):
    """Teacher information in school"""

    id: int
    email: str
    name: str
    roles: List[str]
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/{school_id}/teachers", response_model=List[SchoolTeacherInfo])
async def list_school_teachers(
    school_id: uuid.UUID,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    List all teachers in a school.
    Requires teacher to be a member of the school or organization.
    """
    # Check permission
    check_school_permission(teacher.id, school_id, db)

    # Single JOIN query instead of N+1
    rows = (
        db.query(Teacher, TeacherSchool)
        .join(TeacherSchool, Teacher.id == TeacherSchool.teacher_id)
        .filter(
            TeacherSchool.school_id == school_id,
            TeacherSchool.is_active.is_(True),
        )
        .all()
    )

    result = []
    for t, ts in rows:
        # Ensure roles is a list (handle both JSON string and list)
        roles = ts.roles if ts.roles else []
        if isinstance(roles, str):
            import json

            try:
                roles = json.loads(roles)
            except Exception:
                roles = []

        result.append(
            SchoolTeacherInfo(
                id=t.id,
                email=t.email,
                name=t.name,
                roles=roles,
                is_active=ts.is_active,
                created_at=ts.created_at,
            )
        )

    return result


@router.post(
    "/{school_id}/teachers",
    status_code=status.HTTP_201_CREATED,
    response_model=TeacherSchoolRelationResponse,
)
async def add_teacher_to_school(
    school_id: uuid.UUID,
    request: AddTeacherToSchoolRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Add a teacher to school with specified roles.
    Requires org_owner or org_admin role.
    """
    casbin_service = get_casbin_service()

    # Check permission
    check_school_permission(teacher.id, school_id, db)

    # Validate roles
    valid_roles = ["school_admin", "school_director", "teacher"]
    for role in request.roles:
        if role not in valid_roles:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid role: {role}. Must be one of {valid_roles}",
            )

    # Check if teacher already has active relationship
    existing_active = (
        db.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == request.teacher_id,
            TeacherSchool.school_id == school_id,
            TeacherSchool.is_active.is_(True),
        )
        .first()
    )

    if existing_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Teacher already belongs to this school",
        )

    # Check if teacher has inactive relationship (soft-deleted)
    existing_inactive = (
        db.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == request.teacher_id,
            TeacherSchool.school_id == school_id,
            TeacherSchool.is_active.is_(False),
        )
        .first()
    )

    if existing_inactive:
        # Reactivate and update roles
        existing_inactive.is_active = True
        existing_inactive.roles = request.roles
        teacher_school = existing_inactive
    else:
        # Verify teacher exists
        target_teacher = (
            db.query(Teacher).filter(Teacher.id == request.teacher_id).first()
        )
        if not target_teacher:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found"
            )

        # Create new relationship
        teacher_school = TeacherSchool(
            teacher_id=request.teacher_id,
            school_id=school_id,
            roles=request.roles,
            is_active=True,
        )
        db.add(teacher_school)

    db.commit()
    db.refresh(teacher_school)

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

    return TeacherSchoolRelationResponse.from_orm(teacher_school)


@router.patch(
    "/{school_id}/teachers/{teacher_id}", response_model=TeacherSchoolRelationResponse
)
async def update_teacher_school_roles(
    school_id: uuid.UUID,
    teacher_id: int,
    request: UpdateTeacherRolesRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Update teacher's roles in school.
    Requires org_owner or org_admin role.
    """
    casbin_service = get_casbin_service()

    # Check permission
    check_school_permission(teacher.id, school_id, db)

    # Validate roles if provided
    if request.roles is not None:
        valid_roles = ["school_admin", "school_director", "teacher"]
        for role in request.roles:
            if role not in valid_roles:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid role: {role}. Must be one of {valid_roles}",
                )

    # At least one field must be provided
    if request.roles is None and request.is_active is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one of 'roles' or 'is_active' must be provided",
        )

    # Find relationship (include inactive if toggling is_active)
    query_filter = [
        TeacherSchool.teacher_id == teacher_id,
        TeacherSchool.school_id == school_id,
    ]
    if request.is_active is None:
        query_filter.append(TeacherSchool.is_active.is_(True))

    teacher_school = db.query(TeacherSchool).filter(*query_filter).first()

    if not teacher_school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Teacher relationship not found",
        )

    # Update roles if provided
    if request.roles is not None:
        teacher_school.roles = request.roles

    # Update is_active if provided
    if request.is_active is not None:
        teacher_school.is_active = request.is_active
    # issue #862 §4.8 A：把團購成員從團購 school 停用（退團）時，立即恢復其暫停的
    # 個人訂閱殘值（非團購 school / 非 paused 為 no-op）。
    if teacher_school.is_active is False:
        resume_member_on_group_buy_unbind(
            teacher_id, school_id, db, now=datetime.now(timezone.utc)
        )
    db.commit()
    db.refresh(teacher_school)

    # Sync Casbin roles for this teacher (will update all roles)
    try:
        casbin_service.sync_teacher_roles(teacher_id)
    except Exception as e:
        # Log error but don't fail the request
        import logging

        logger = logging.getLogger(__name__)
        logger.error(f"Failed to sync Casbin roles for teacher {teacher_id}: {e}")

    return TeacherSchoolRelationResponse.from_orm(teacher_school)


@router.delete("/{school_id}/teachers/{teacher_id}")
async def remove_teacher_from_school(
    school_id: uuid.UUID,
    teacher_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Remove a teacher from school (soft delete).
    Requires org_owner or org_admin role.
    """
    casbin_service = get_casbin_service()

    # Check permission
    check_school_permission(teacher.id, school_id, db)

    # Find relationship
    teacher_school = (
        db.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == teacher_id,
            TeacherSchool.school_id == school_id,
            TeacherSchool.is_active.is_(True),
        )
        .first()
    )

    if not teacher_school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Teacher relationship not found",
        )

    # Soft delete
    teacher_school.is_active = False
    # issue #862 §4.8 A：退團即恢復暫停的個人訂閱殘值（非團購 / 非 paused 為 no-op）。
    resume_member_on_group_buy_unbind(
        teacher_id, school_id, db, now=datetime.now(timezone.utc)
    )
    db.commit()

    # Sync Casbin roles for this teacher (will remove inactive roles)
    try:
        casbin_service.sync_teacher_roles(teacher_id)
    except Exception as e:
        # Log error but don't fail the request
        import logging

        logger = logging.getLogger(__name__)
        logger.error(f"Failed to sync Casbin roles for teacher {teacher_id}: {e}")

    return {"message": "Teacher removed from school successfully"}

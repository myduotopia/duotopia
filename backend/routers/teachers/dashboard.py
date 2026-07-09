"""
Dashboard operations for teachers.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from uuid import UUID
from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy import func
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta

from database import get_db
from models import Teacher, Classroom, Student, Program, Lesson, Content, ContentItem
from models import ClassroomStudent, Assignment, AssignmentContent
from models import (
    ProgramLevel,
    TeacherOrganization,
    TeacherSchool,
    Organization,
    School,
    ClassroomSchool,
)
from services.quota_service import QuotaService
from .dependencies import get_current_teacher
from .validators import *
from .utils import parse_birthdate  # TEST_SUBSCRIPTION_WHITELIST is defined locally

router = APIRouter()


@router.get("/dashboard", response_model=TeacherDashboard)
async def get_teacher_dashboard(
    mode: Optional[str] = Query(
        None, description="Filter mode: personal|school|organization"
    ),
    school_id: Optional[str] = Query(
        None, description="School UUID (requires mode=school)"
    ),
    organization_id: Optional[str] = Query(None, description="Organization UUID"),
    current_teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    取得教師儀表板資料

    Args:
        mode: Filter mode (personal|school|organization)
        school_id: School UUID for school mode
        organization_id: Organization UUID for organization mode
    """

    # Query teacher's organization via TeacherOrganization (with eager loading)
    teacher_org = (
        db.query(TeacherOrganization)
        .filter(
            TeacherOrganization.teacher_id == current_teacher.id,
            TeacherOrganization.is_active.is_(True),
        )
        .options(joinedload(TeacherOrganization.organization))
        .first()
    )

    organization_info = None
    if teacher_org and teacher_org.organization and teacher_org.organization.is_active:
        org = teacher_org.organization
        organization_info = OrganizationInfo(
            id=str(org.id),
            name=org.display_name or org.name,
            type="organization",
        )

    # Query teacher's schools via TeacherSchool (with eager loading)
    teacher_schools = (
        db.query(TeacherSchool)
        .filter(
            TeacherSchool.teacher_id == current_teacher.id,
            TeacherSchool.is_active.is_(True),
        )
        .options(joinedload(TeacherSchool.school))
        .all()
    )

    schools_info = []
    all_roles_set = set()

    # Add organization role if exists
    if teacher_org:
        all_roles_set.add(teacher_org.role)

    # Process schools and collect roles
    for ts in teacher_schools:
        if ts.school and ts.school.is_active:
            schools_info.append(
                SchoolInfo(
                    id=str(ts.school.id),
                    name=ts.school.display_name or ts.school.name,
                )
            )
            # Add school roles
            if ts.roles:
                all_roles_set.update(ts.roles)

    # Get classrooms with student count (only active classrooms)
    # Also load classroom_schools to get school_id and organization_id
    classrooms = (
        db.query(Classroom)
        .filter(
            Classroom.teacher_id == current_teacher.id,
            Classroom.is_active.is_(True),  # Filter out soft-deleted classrooms
        )
        .options(
            selectinload(Classroom.students).selectinload(ClassroomStudent.student),
            selectinload(Classroom.classroom_schools)
            .selectinload(ClassroomSchool.school)
            .selectinload(School.organization),
        )
        .all()
    )

    # Server-side filtering based on mode (security enhancement)
    if mode == "personal":
        # Only show classrooms without school link
        classrooms = [c for c in classrooms if not c.classroom_schools]

    elif mode == "school" and school_id:
        # Authorization check: verify teacher has access to this school
        has_access = (
            db.query(TeacherSchool)
            .filter(
                TeacherSchool.teacher_id == current_teacher.id,
                TeacherSchool.school_id == school_id,
                TeacherSchool.is_active.is_(True),
            )
            .first()
        )

        if not has_access:
            raise HTTPException(403, detail="Access denied to this school")

        # Filter classrooms belonging to this school
        classrooms = [
            c
            for c in classrooms
            if any(
                cs.school_id == UUID(school_id) and cs.is_active
                for cs in c.classroom_schools
            )
        ]

    elif mode == "organization" and organization_id:
        # Authorization check: verify teacher has access to this organization
        has_access = (
            db.query(TeacherOrganization)
            .filter(
                TeacherOrganization.teacher_id == current_teacher.id,
                TeacherOrganization.organization_id == organization_id,
                TeacherOrganization.is_active.is_(True),
            )
            .first()
        )

        if not has_access:
            raise HTTPException(403, detail="Access denied to this organization")

        # Filter classrooms in schools under this organization
        classrooms = [
            c
            for c in classrooms
            if any(
                cs.school
                and cs.school.organization_id == UUID(organization_id)
                and cs.is_active
                for cs in c.classroom_schools
            )
        ]

    # If no mode specified, return all classrooms (backward compatibility)

    classroom_summaries = []
    total_students = 0
    recent_students = []

    for classroom in classrooms:
        # Only count active students in active enrollments
        # Also check that student exists (not None) to avoid null reference errors
        active_students = [
            cs
            for cs in classroom.students
            if cs.is_active and cs.student and cs.student.is_active
        ]
        student_count = len(active_students)
        total_students += student_count

        # Get school_id and organization_id from classroom_schools relationship
        school_id = None
        school_name = None
        organization_id = None

        if classroom.classroom_schools:
            # Get the first active classroom_school record
            active_cs = next(
                (cs for cs in classroom.classroom_schools if cs.is_active), None
            )
            if active_cs and active_cs.school:
                school_id = str(active_cs.school.id)
                school_name = active_cs.school.display_name or active_cs.school.name
                if active_cs.school.organization:
                    organization_id = str(active_cs.school.organization.id)

        classroom_summaries.append(
            ClassroomSummary(
                id=classroom.id,
                name=classroom.name,
                description=classroom.description,
                student_count=student_count,
                school_id=school_id,
                school_name=school_name,
                organization_id=organization_id,
            )
        )

        # Add recent students (first 3 active students from each classroom)
        for classroom_student in active_students[:3]:
            if (
                len(recent_students) < 10 and classroom_student.student
            ):  # Limit to 10 recent students
                recent_students.append(
                    StudentSummary(
                        id=classroom_student.student.id,
                        name=classroom_student.student.name,
                        email=classroom_student.student.email,  # Can be None now
                        classroom_name=classroom.name,
                    )
                )

    # Get program count (programs created by this teacher)
    program_count = (
        db.query(Program)
        .filter(Program.teacher_id == current_teacher.id, Program.is_active.is_(True))
        .count()
    )

    # 測試訂閱白名單（與 routers/subscription.py 保持一致）
    TEST_SUBSCRIPTION_WHITELIST = [
        "demo@duotopia.com",
        "expired@duotopia.com",
        "trial@duotopia.com",
        "purpleice9765@msn.com",
        "kaddyeunice@apps.ntpc.edu.tw",
        "ceeks.edu@gmail.com",
    ]
    is_test_account = current_teacher.email in TEST_SUBSCRIPTION_WHITELIST

    # 暫時停用 can_assign_homework 計算（保留邏輯以便日後恢復）
    if False:  # pragma: no cover
        can_assign_homework = current_teacher.can_assign_homework
    else:
        can_assign_homework = True

    # 檢查教師/機構是否有 AI 分析額度
    can_use_ai_grading = QuotaService.check_ai_analysis_availability(
        current_teacher.id, db
    )

    return TeacherDashboard(
        teacher=TeacherProfile.model_validate(current_teacher),
        classroom_count=len(classrooms),
        student_count=total_students,
        program_count=program_count,
        classrooms=classroom_summaries,
        recent_students=recent_students,
        # Subscription information
        subscription_status=current_teacher.subscription_status,
        subscription_end_date=current_teacher.subscription_end_date.isoformat()
        if current_teacher.subscription_end_date
        else None,
        days_remaining=current_teacher.days_remaining,
        can_assign_homework=can_assign_homework,
        can_use_ai_grading=can_use_ai_grading,
        is_test_account=is_test_account,
        # Organization and roles information
        organization=organization_info,
        schools=schools_info,
        roles=sorted(list(all_roles_set)),
    )

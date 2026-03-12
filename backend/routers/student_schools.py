"""
Student-School Relationship API Routes

Manages students within schools and their relationships to classrooms.
Supports many-to-many relationships: students can belong to multiple schools
and multiple classrooms.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, or_
from typing import List, Optional
from datetime import date, datetime
from zoneinfo import ZoneInfo
import uuid
import json

from database import get_db
from models import (
    Teacher,
    School,
    Student,
    StudentSchool,
    Classroom,
    ClassroomSchool,
    ClassroomStudent,
)
from auth import verify_token, get_password_hash
from utils.permissions import (
    check_school_student_permission,
    check_student_in_school,
    check_classroom_in_school,
    validate_student_classroom_school,
)
from routers.schemas.student import (
    SchoolStudentCreate,
    SchoolStudentUpdate,
    SchoolStudentResponse,
    SchoolInfo,
    ClassroomInfo,
    AssignClassroomRequest,
    BatchAssignRequest,
    BatchStudentImport,
    BatchStudentImportItem,
)


router = APIRouter(tags=["student-schools"])
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


# ============ Helper Functions ============


def build_student_response(student: Student, db: Session) -> dict:
    """Build student response with schools and classrooms"""
    # Get all schools the student belongs to
    student_schools = (
        db.query(StudentSchool)
        .filter(
            StudentSchool.student_id == student.id, StudentSchool.is_active.is_(True)
        )
        .all()
    )

    schools = []
    for ss in student_schools:
        school = db.query(School).filter(School.id == ss.school_id).first()
        if school:
            schools.append({"id": str(school.id), "name": school.name})

    # Get all classrooms the student belongs to
    classroom_enrollments = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.student_id == student.id,
            ClassroomStudent.is_active.is_(True),
        )
        .all()
    )

    classrooms = []
    for cs in classroom_enrollments:
        classroom = db.query(Classroom).filter(Classroom.id == cs.classroom_id).first()
        if classroom:
            # Get school for this classroom
            classroom_school = (
                db.query(ClassroomSchool)
                .filter(
                    ClassroomSchool.classroom_id == classroom.id,
                    ClassroomSchool.is_active.is_(True),
                )
                .first()
            )
            if classroom_school:
                classrooms.append(
                    {
                        "id": classroom.id,
                        "name": classroom.name,
                        "school_id": str(classroom_school.school_id),
                    }
                )

    return {
        "id": student.id,
        "name": student.name,
        "email": student.email,
        "student_number": student.student_number,
        "birthdate": student.birthdate.isoformat() if student.birthdate else None,
        "is_active": student.is_active,
        "password_changed": student.password_changed or False,
        "created_at": student.created_at.isoformat() if student.created_at else None,
        "last_login": student.last_login.isoformat() if student.last_login else None,
        "schools": schools,
        "classrooms": classrooms,
    }


# ============ GET Endpoints ============


@router.get("/api/schools/{school_id}/students", response_model=List[dict])
async def get_school_students(
    school_id: uuid.UUID,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    search: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    classroom_id: Optional[int] = None,
    unassigned: Optional[bool] = None,
):
    """
    Get all students in a school.

    Permissions: school_admin, org_admin, org_owner
    """
    # Check permission
    if not check_school_student_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to view students in this school",
        )

    # Verify school exists
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="School not found"
        )

    # Base query: students in this school
    query = (
        db.query(Student)
        .join(StudentSchool, Student.id == StudentSchool.student_id)
        .filter(StudentSchool.school_id == school_id, StudentSchool.is_active.is_(True))
    )

    # Apply filters
    if status_filter == "active":
        query = query.filter(Student.is_active.is_(True))
    elif status_filter == "inactive":
        query = query.filter(Student.is_active.is_(False))

    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                Student.name.ilike(search_term),
                Student.student_number.ilike(search_term),
                Student.email.ilike(search_term),
            )
        )

    # Filter by classroom if specified
    if classroom_id is not None:
        query = query.join(
            ClassroomStudent, Student.id == ClassroomStudent.student_id
        ).filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.is_active.is_(True),
        )

    # Filter unassigned students
    if unassigned:
        query = query.outerjoin(
            ClassroomStudent, Student.id == ClassroomStudent.student_id
        ).filter(ClassroomStudent.id.is_(None))

    # Apply pagination
    total = query.count()
    students = query.offset((page - 1) * limit).limit(limit).all()

    # Build response
    result = [build_student_response(student, db) for student in students]

    return result


@router.get(
    "/api/schools/{school_id}/classrooms/{classroom_id}/students",
    response_model=List[dict],
)
async def get_classroom_students(
    school_id: uuid.UUID,
    classroom_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Get all students in a classroom.

    Permissions: school_admin, org_admin, org_owner
    """
    # Check permission
    if not check_school_student_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
        )

    # Verify classroom belongs to school
    if not check_classroom_in_school(classroom_id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom not found in this school",
        )

    # Get students in classroom
    classroom_students = (
        db.query(Student)
        .join(ClassroomStudent, Student.id == ClassroomStudent.student_id)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.is_active.is_(True),
            Student.is_active.is_(True),
        )
        .all()
    )

    return [build_student_response(student, db) for student in classroom_students]


# ============ POST Endpoints ============


@router.post(
    "/api/schools/{school_id}/students",
    status_code=status.HTTP_201_CREATED,
    response_model=dict,
)
async def create_school_student(
    school_id: uuid.UUID,
    student_data: SchoolStudentCreate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Create a new student in school.

    Permissions: school_admin, org_admin, org_owner
    """
    # Check permission
    if not check_school_student_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions to create students in this school",
        )

    # Verify school exists
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="School not found"
        )

    # Parse birthdate (optional)
    birthdate = None
    if student_data.birthdate:
        try:
            birthdate = date.fromisoformat(student_data.birthdate)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid birthdate format. Please use YYYY-MM-DD format",
            )

    default_password = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y%m%d")

    # Check if student_number already exists in school (if provided)
    if student_data.student_number:
        existing = (
            db.query(Student)
            .join(StudentSchool, Student.id == StudentSchool.student_id)
            .filter(
                StudentSchool.school_id == school_id,
                StudentSchool.is_active.is_(True),
                Student.student_number == student_data.student_number,
                Student.is_active.is_(True),
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"學號 '{student_data.student_number}' 已存在於此學校中",
            )

    # Create student
    student = Student(
        name=student_data.name,
        email=student_data.email,
        student_number=student_data.student_number,
        birthdate=birthdate,
        password_hash=get_password_hash(default_password),
        password_changed=False,
        is_active=True,
    )

    try:
        db.add(student)
        db.flush()  # Get student ID without committing

        # Create StudentSchool relationship
        student_school = StudentSchool(
            student_id=student.id, school_id=school_id, is_active=True
        )
        db.add(student_school)
        db.commit()
        db.refresh(student)

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create student: {str(e)}",
        )

    response = build_student_response(student, db)
    response["default_password"] = default_password
    return response


@router.post(
    "/api/schools/{school_id}/students/batch-import",
    status_code=status.HTTP_200_OK,
    response_model=dict,
)
async def batch_import_students(
    school_id: uuid.UUID,
    import_data: BatchStudentImport,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Batch import students to school.

    Permissions: school_admin, org_admin, org_owner
    """
    # Check permission
    if not check_school_student_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
        )

    # Verify school exists
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="School not found"
        )

    created_count = 0
    updated_count = 0
    skipped_count = 0
    errors = []

    for idx, student_item in enumerate(import_data.students):
        try:
            # Parse birthdate (optional)
            birthdate = None
            if student_item.birthdate:
                try:
                    birthdate = date.fromisoformat(student_item.birthdate)
                except ValueError:
                    errors.append(f"Row {idx + 1}: Invalid birthdate format")
                    continue

            default_password = datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y%m%d")

            # Check for duplicates based on duplicate_action
            existing = None
            if student_item.student_number:
                existing = (
                    db.query(Student)
                    .join(StudentSchool, Student.id == StudentSchool.student_id)
                    .filter(
                        StudentSchool.school_id == school_id,
                        StudentSchool.is_active.is_(True),
                        Student.student_number == student_item.student_number,
                    )
                    .first()
                )

            if existing:
                if import_data.duplicate_action == "skip":
                    skipped_count += 1
                    continue
                elif import_data.duplicate_action == "update":
                    # Update existing student
                    existing.name = student_item.name
                    if student_item.email:
                        existing.email = student_item.email
                    existing.birthdate = birthdate
                    db.commit()
                    updated_count += 1

                    # Add to classroom if specified
                    if student_item.classroom_id:
                        if check_classroom_in_school(
                            student_item.classroom_id, school_id, db
                        ):
                            enrollment = (
                                db.query(ClassroomStudent)
                                .filter(
                                    ClassroomStudent.student_id == existing.id,
                                    ClassroomStudent.classroom_id
                                    == student_item.classroom_id,
                                )
                                .first()
                            )
                            if not enrollment:
                                enrollment = ClassroomStudent(
                                    student_id=existing.id,
                                    classroom_id=student_item.classroom_id,
                                    is_active=True,
                                )
                                db.add(enrollment)
                                db.commit()
                    continue
                elif import_data.duplicate_action == "add_suffix":
                    # Add suffix to student_number
                    suffix = 1
                    while True:
                        new_number = f"{student_item.student_number}_{suffix}"
                        check = (
                            db.query(Student)
                            .filter(Student.student_number == new_number)
                            .first()
                        )
                        if not check:
                            student_item.student_number = new_number
                            break
                        suffix += 1

            # Create new student
            student = Student(
                name=student_item.name,
                email=student_item.email,
                student_number=student_item.student_number,
                birthdate=birthdate,
                password_hash=get_password_hash(default_password),
                password_changed=False,
                is_active=True,
            )
            db.add(student)
            db.flush()

            # Create StudentSchool relationship
            student_school = StudentSchool(
                student_id=student.id, school_id=school_id, is_active=True
            )
            db.add(student_school)

            # Add to classroom if specified
            if student_item.classroom_id:
                if check_classroom_in_school(student_item.classroom_id, school_id, db):
                    enrollment = ClassroomStudent(
                        student_id=student.id,
                        classroom_id=student_item.classroom_id,
                        is_active=True,
                    )
                    db.add(enrollment)

            db.commit()
            created_count += 1

        except Exception as e:
            db.rollback()
            errors.append(f"Row {idx + 1}: {str(e)}")

    return {
        "message": "Batch import completed",
        "created": created_count,
        "updated": updated_count,
        "skipped": skipped_count,
        "errors": errors if errors else None,
    }


@router.post(
    "/api/schools/{school_id}/students/{student_id}",
    status_code=status.HTTP_200_OK,
    response_model=dict,
)
async def add_student_to_school(
    school_id: uuid.UUID,
    student_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Add an existing student to school.

    Permissions: school_admin, org_admin, org_owner
    """
    # Check permission
    if not check_school_student_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
        )

    # Verify school exists
    school = db.query(School).filter(School.id == school_id).first()
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="School not found"
        )

    # Verify student exists
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )

    # Check if already in school
    existing = (
        db.query(StudentSchool)
        .filter(
            StudentSchool.student_id == student_id, StudentSchool.school_id == school_id
        )
        .first()
    )

    if existing:
        if existing.is_active:
            # Already active, return success
            return build_student_response(student, db)
        else:
            # Reactivate
            existing.is_active = True
            db.commit()
            return build_student_response(student, db)

    # Create new relationship
    student_school = StudentSchool(
        student_id=student_id, school_id=school_id, is_active=True
    )
    db.add(student_school)
    db.commit()

    return build_student_response(student, db)


@router.post(
    "/api/schools/{school_id}/students/{student_id}/classrooms",
    status_code=status.HTTP_200_OK,
    response_model=dict,
)
async def add_student_to_classroom(
    school_id: uuid.UUID,
    student_id: int,
    request: AssignClassroomRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Add student to classroom.

    Permissions: school_admin, org_admin, org_owner
    Business rule: Student must belong to the school that the classroom belongs to
    """
    # Check permission
    if not check_school_student_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
        )

    # Verify student belongs to school
    if not check_student_in_school(student_id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student does not belong to this school",
        )

    # Verify classroom belongs to school
    if not check_classroom_in_school(request.classroom_id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom not found in this school",
        )

    # Validate student can join classroom
    if not validate_student_classroom_school(student_id, request.classroom_id, db):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student cannot join this classroom (school mismatch)",
        )

    # Check if already enrolled
    existing = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.student_id == student_id,
            ClassroomStudent.classroom_id == request.classroom_id,
        )
        .first()
    )

    if existing:
        if existing.is_active:
            # Already active
            student = db.query(Student).filter(Student.id == student_id).first()
            return build_student_response(student, db)
        else:
            # Reactivate
            existing.is_active = True
            db.commit()
            student = db.query(Student).filter(Student.id == student_id).first()
            return build_student_response(student, db)

    # Create new enrollment
    enrollment = ClassroomStudent(
        student_id=student_id, classroom_id=request.classroom_id, is_active=True
    )
    db.add(enrollment)
    db.commit()

    student = db.query(Student).filter(Student.id == student_id).first()
    return build_student_response(student, db)


@router.post(
    "/api/schools/{school_id}/classrooms/{classroom_id}/students/batch",
    status_code=status.HTTP_200_OK,
    response_model=dict,
)
async def batch_add_students_to_classroom(
    school_id: uuid.UUID,
    classroom_id: int,
    request: BatchAssignRequest,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Batch add students to classroom.

    Permissions: school_admin, org_admin, org_owner
    """
    # Check permission
    if not check_school_student_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
        )

    # Verify classroom belongs to school
    if not check_classroom_in_school(classroom_id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom not found in this school",
        )

    # Verify all students belong to school and can join classroom
    for student_id in request.student_ids:
        if not check_student_in_school(student_id, school_id, db):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Student {student_id} does not belong to this school",
            )
        if not validate_student_classroom_school(student_id, classroom_id, db):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Student {student_id} cannot join this classroom",
            )

    # Add students to classroom (skip if already enrolled)
    added_count = 0
    for student_id in request.student_ids:
        existing = (
            db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.student_id == student_id,
                ClassroomStudent.classroom_id == classroom_id,
            )
            .first()
        )

        if not existing:
            enrollment = ClassroomStudent(
                student_id=student_id, classroom_id=classroom_id, is_active=True
            )
            db.add(enrollment)
            added_count += 1
        elif not existing.is_active:
            existing.is_active = True
            added_count += 1

    db.commit()

    return {
        "message": f"Successfully added {added_count} students to classroom",
        "added_count": added_count,
        "total_requested": len(request.student_ids),
    }


# ============ PUT Endpoints ============


@router.put(
    "/api/schools/{school_id}/students/{student_id}",
    status_code=status.HTTP_200_OK,
    response_model=dict,
)
async def update_school_student(
    school_id: uuid.UUID,
    student_id: int,
    update_data: SchoolStudentUpdate,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Update student information.

    Permissions: school_admin, org_admin, org_owner
    """
    # Check permission
    if not check_school_student_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
        )

    # Verify student belongs to school
    if not check_student_in_school(student_id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found in this school",
        )

    # Get student
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )

    # Update fields
    if update_data.name is not None:
        student.name = update_data.name

    if update_data.email is not None:
        # Reset email verification if email changed
        if student.email != update_data.email:
            student.email_verified = False
            student.email_verified_at = None
            student.email_verification_token = None
            # 建立/關聯 Identity（非系統 email 才處理）
            if "@duotopia.local" not in update_data.email:
                from services.identity_service import identity_service

                identity_service.ensure_identity_on_email_bind(
                    db, student, update_data.email
                )
        student.email = update_data.email

    if update_data.student_number is not None:
        # Check for duplicates in school
        if (
            update_data.student_number
            and update_data.student_number != student.student_number
        ):
            existing = (
                db.query(Student)
                .join(StudentSchool, Student.id == StudentSchool.student_id)
                .filter(
                    StudentSchool.school_id == school_id,
                    StudentSchool.is_active.is_(True),
                    Student.student_number == update_data.student_number,
                    Student.is_active.is_(True),
                    Student.id != student_id,
                )
                .first()
            )
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"學號 '{update_data.student_number}' 已存在於此學校中",
                )
        student.student_number = update_data.student_number

    if update_data.birthdate is not None:
        try:
            new_birthdate = date.fromisoformat(update_data.birthdate)
            student.birthdate = new_birthdate
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid birthdate format",
            )

    if update_data.phone is not None:
        student.parent_phone = update_data.phone

    if update_data.is_active is not None:
        student.is_active = update_data.is_active

    try:
        db.commit()
        db.refresh(student)
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update student: {str(e)}",
        )

    return build_student_response(student, db)


# ============ Password Management ============


@router.post(
    "/api/schools/{school_id}/students/{student_id}/reset-password",
    response_model=dict,
)
async def reset_school_student_password(
    school_id: uuid.UUID,
    student_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Reset student password to default (creation date YYYYMMDD).

    Permissions: school_admin, org_admin, org_owner
    """
    if not check_school_student_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions",
        )

    student = (
        db.query(Student)
        .join(StudentSchool, Student.id == StudentSchool.student_id)
        .filter(
            Student.id == student_id,
            StudentSchool.school_id == school_id,
            StudentSchool.is_active.is_(True),
        )
        .first()
    )

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )

    if not student.created_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student creation date not available",
        )

    taipei_tz = ZoneInfo("Asia/Taipei")
    created_at_tw = (
        student.created_at.astimezone(taipei_tz)
        if student.created_at.tzinfo
        else student.created_at.replace(tzinfo=ZoneInfo("UTC")).astimezone(taipei_tz)
    )
    default_password = created_at_tw.strftime("%Y%m%d")
    student.password_hash = get_password_hash(default_password)
    student.password_changed = False

    db.commit()

    return {
        "message": "Password reset successfully",
        "default_password": default_password,
    }


# ============ DELETE Endpoints ============


@router.delete(
    "/api/schools/{school_id}/students/{student_id}/classrooms/{classroom_id}",
    status_code=status.HTTP_200_OK,
    response_model=dict,
)
async def remove_student_from_classroom(
    school_id: uuid.UUID,
    student_id: int,
    classroom_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Remove student from classroom (soft delete).

    Permissions: school_admin, org_admin, org_owner
    """
    # Check permission
    if not check_school_student_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
        )

    # Verify classroom belongs to school
    if not check_classroom_in_school(classroom_id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Classroom not found in this school",
        )

    # Get enrollment
    enrollment = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.student_id == student_id,
            ClassroomStudent.classroom_id == classroom_id,
        )
        .first()
    )

    if not enrollment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student is not enrolled in this classroom",
        )

    # Soft delete
    enrollment.is_active = False
    db.commit()

    return {"message": "Student removed from classroom"}


@router.delete(
    "/api/schools/{school_id}/classrooms/{classroom_id}/students/{student_id}",
    status_code=status.HTTP_200_OK,
    response_model=dict,
)
async def remove_classroom_student(
    school_id: uuid.UUID,
    classroom_id: int,
    student_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Remove student from classroom (alternative endpoint).

    Same as above but with different parameter order.
    """
    return await remove_student_from_classroom(
        school_id, student_id, classroom_id, teacher, db
    )


@router.delete(
    "/api/schools/{school_id}/students/{student_id}",
    status_code=status.HTTP_200_OK,
    response_model=dict,
)
async def remove_student_from_school(
    school_id: uuid.UUID,
    student_id: int,
    teacher: Teacher = Depends(get_current_teacher),
    db: Session = Depends(get_db),
):
    """
    Remove student from school (soft delete).

    This will also remove the student from all classrooms in this school.

    Permissions: school_admin, org_admin, org_owner
    """
    # Check permission
    if not check_school_student_permission(teacher.id, school_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions"
        )

    # Get StudentSchool relationship
    student_school = (
        db.query(StudentSchool)
        .filter(
            StudentSchool.student_id == student_id, StudentSchool.school_id == school_id
        )
        .first()
    )

    if not student_school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student is not enrolled in this school",
        )

    # Soft delete StudentSchool relationship
    student_school.is_active = False

    # Also remove from all classrooms in this school
    classroom_ids = (
        db.query(ClassroomSchool.classroom_id)
        .filter(
            ClassroomSchool.school_id == school_id, ClassroomSchool.is_active.is_(True)
        )
        .all()
    )

    classroom_ids = [cid[0] for cid in classroom_ids]

    if classroom_ids:
        enrollments = (
            db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.student_id == student_id,
                ClassroomStudent.classroom_id.in_(classroom_ids),
                ClassroomStudent.is_active.is_(True),
            )
            .all()
        )

        for enrollment in enrollments:
            enrollment.is_active = False

    db.commit()

    return {"message": "Student removed from school and all classrooms"}

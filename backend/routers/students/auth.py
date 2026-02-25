"""Student authentication endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from datetime import timedelta

from database import get_db
from models import Student, Classroom, ClassroomStudent, StudentIdentity
from models.organization import ClassroomSchool, School, Organization
from auth import create_access_token, verify_password, _get_student_password_hash
from .validators import StudentValidateRequest, StudentLoginResponse

router = APIRouter()


@router.post("/validate", response_model=StudentLoginResponse)
async def validate_student(
    request: StudentValidateRequest, db: Session = Depends(get_db)
):
    """學生登入驗證（支援 Identity 統一密碼）"""
    # 查詢學生
    student = db.query(Student).filter(Student.email == request.email).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )

    # 驗證密碼 - 支援 Identity 統一密碼
    password_hash = _get_student_password_hash(db, student)
    if not verify_password(request.password, password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid password"
        )

    # 建立 token
    access_token = create_access_token(
        data={"sub": str(student.id), "type": "student"},
        expires_delta=timedelta(minutes=30),
    )

    # 取得班級資訊 - 使用 JOIN 優化查詢（避免 N+1）
    # 原本：3次查詢 (Student + ClassroomStudent + Classroom)
    # 現在：1次查詢 (JOIN + joinedload)
    # 擴充：加入 organization 和 school 資訊
    classroom = (
        db.query(Classroom)
        .join(ClassroomStudent)
        .outerjoin(ClassroomSchool, Classroom.id == ClassroomSchool.classroom_id)
        .outerjoin(School, ClassroomSchool.school_id == School.id)
        .outerjoin(Organization, School.organization_id == Organization.id)
        .options(
            joinedload(Classroom.classroom_schools)
            .joinedload(ClassroomSchool.school)
            .joinedload(School.organization)
        )
        .filter(ClassroomStudent.student_id == student.id)
        .first()
    )

    classroom_id = classroom.id if classroom else None
    classroom_name = classroom.name if classroom else None

    # Extract organization and school information
    school_id = None
    school_name = None
    organization_id = None
    organization_name = None

    if classroom and classroom.classroom_schools:
        # Get the first active classroom_school relationship
        classroom_school = next(
            (cs for cs in classroom.classroom_schools if cs.is_active), None
        )

        if classroom_school and classroom_school.school:
            school = classroom_school.school
            school_id = str(school.id)
            school_name = school.name

            if school.organization:
                org = school.organization
                organization_id = str(org.id)
                organization_name = org.name

    # 查詢關聯帳號數量
    has_linked_accounts = False
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
        has_linked_accounts = linked_accounts_count > 0

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "student": {
            "id": student.id,
            "name": student.name,
            "email": student.email,
            "student_number": student.student_number,
            "classroom_id": classroom_id,
            "classroom_name": classroom_name,
            "school_id": school_id,
            "school_name": school_name,
            "organization_id": organization_id,
            "organization_name": organization_name,
            "has_linked_accounts": has_linked_accounts,
            "linked_accounts_count": linked_accounts_count,
        },
    }

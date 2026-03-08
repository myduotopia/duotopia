"""Student authentication endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from datetime import timedelta

from database import get_db
from models import Student, Classroom, ClassroomStudent, Identity
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

    # 取得所有班級資訊（支援多班級切換）
    all_classrooms = (
        db.query(Classroom)
        .join(ClassroomStudent)
        .outerjoin(ClassroomSchool, Classroom.id == ClassroomSchool.classroom_id)
        .outerjoin(School, ClassroomSchool.school_id == School.id)
        .outerjoin(Organization, School.organization_id == Organization.id)
        .options(
            joinedload(Classroom.classroom_schools)
            .joinedload(ClassroomSchool.school)
            .joinedload(School.organization),
            joinedload(Classroom.teacher),
        )
        .filter(
            ClassroomStudent.student_id == student.id,
            ClassroomStudent.is_active.is_(True),
        )
        .all()
    )

    # 建立班級列表
    classrooms_list = []
    for cr in all_classrooms:
        cr_info = {
            "id": cr.id,
            "name": cr.name,
            "teacher_name": cr.teacher.name if cr.teacher else None,
        }
        # 取得學校和機構
        cs = next((c for c in (cr.classroom_schools or []) if c.is_active), None)
        if cs and cs.school:
            cr_info["school_id"] = str(cs.school.id)
            cr_info["school_name"] = cs.school.name
            if cs.school.organization:
                cr_info["organization_id"] = str(cs.school.organization.id)
                cr_info["organization_name"] = cs.school.organization.name
        classrooms_list.append(cr_info)

    # 預設使用第一個班級
    first = all_classrooms[0] if all_classrooms else None
    classroom_id = first.id if first else None
    classroom_name = first.name if first else None

    # 從 classrooms_list 取得第一個的學校/機構資訊
    school_id = classrooms_list[0].get("school_id") if classrooms_list else None
    school_name = classrooms_list[0].get("school_name") if classrooms_list else None
    organization_id = (
        classrooms_list[0].get("organization_id") if classrooms_list else None
    )
    organization_name = (
        classrooms_list[0].get("organization_name") if classrooms_list else None
    )

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
            "classrooms": classrooms_list,
            "classrooms_count": len(classrooms_list),
        },
    }

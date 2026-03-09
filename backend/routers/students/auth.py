"""Student authentication endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from datetime import timedelta, datetime, timezone

from database import get_db
from models import Student, Classroom, ClassroomStudent, Identity
from models.organization import ClassroomSchool, School, Organization
from auth import (
    create_access_token,
    verify_password,
    get_current_user,
    _get_student_password_hash,
)
from .validators import (
    StudentValidateRequest,
    StudentLoginResponse,
    SwitchClassroomRequest,
)

router = APIRouter()


def _get_classrooms_for_student(db: Session, student_id: int) -> list:
    """取得指定學生的所有班級資訊"""
    classrooms = (
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
            ClassroomStudent.student_id == student_id,
            ClassroomStudent.is_active.is_(True),
        )
        .all()
    )

    result = []
    for cr in classrooms:
        cr_info = {
            "id": cr.id,
            "name": cr.name,
            "teacher_name": cr.teacher.name if cr.teacher else None,
            "student_id": student_id,
        }
        cs = next((c for c in (cr.classroom_schools or []) if c.is_active), None)
        if cs and cs.school:
            cr_info["school_id"] = str(cs.school.id)
            cr_info["school_name"] = cs.school.name
            if cs.school.organization:
                cr_info["organization_id"] = str(cs.school.organization.id)
                cr_info["organization_name"] = cs.school.organization.name
        result.append(cr_info)

    return result


def _get_aggregated_classrooms(db: Session, student: Student) -> list:
    """取得學生的所有班級（含跨帳號已驗證 email 的 sibling students）"""
    classrooms_list = _get_classrooms_for_student(db, student.id)

    if student.email_verified and student.email:
        sibling_students = (
            db.query(Student)
            .filter(
                Student.email == student.email,
                Student.email_verified.is_(True),
                Student.id != student.id,
                Student.is_active.is_(True),
            )
            .all()
        )
        for sibling in sibling_students:
            classrooms_list.extend(_get_classrooms_for_student(db, sibling.id))

    return classrooms_list


@router.post("/validate", response_model=StudentLoginResponse)
async def validate_student(
    request: StudentValidateRequest, db: Session = Depends(get_db)
):
    """學生登入驗證（支援 Identity 統一密碼 + 跨帳號班級聚合）"""
    # 查詢學生
    student = db.query(Student).filter(Student.email == request.email).first()

    if not student:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # 驗證密碼 - 支援 Identity 統一密碼
    password_hash = _get_student_password_hash(db, student)
    if not verify_password(request.password, password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    # 建立 token
    access_token = create_access_token(
        data={"sub": str(student.id), "type": "student"},
        expires_delta=timedelta(hours=24),
    )

    # 取得登入學生的所有班級（含跨帳號聚合）
    classrooms_list = _get_aggregated_classrooms(db, student)

    # 預設使用第一個班級
    first_cr = classrooms_list[0] if classrooms_list else None
    classroom_id = first_cr["id"] if first_cr else None
    classroom_name = first_cr["name"] if first_cr else None
    school_id = first_cr.get("school_id") if first_cr else None
    school_name = first_cr.get("school_name") if first_cr else None
    organization_id = first_cr.get("organization_id") if first_cr else None
    organization_name = first_cr.get("organization_name") if first_cr else None

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


@router.post("/switch-classroom")
async def switch_classroom(
    request: SwitchClassroomRequest,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """切換到另一個班級（跨 student_id，需同 email 且已驗證）"""
    if current_user.get("type") != "student":
        raise HTTPException(status_code=403, detail="Only students can switch")

    current_student_id = int(current_user.get("sub"))
    current_student = db.query(Student).filter(Student.id == current_student_id).first()
    if not current_student:
        raise HTTPException(status_code=404, detail="Current student not found")

    # 如果切換到自己，直接回傳現有 token
    if request.target_student_id == current_student_id:
        return {
            "access_token": create_access_token(
                data={"sub": str(current_student_id), "type": "student"},
                expires_delta=timedelta(hours=24),
            ),
            "token_type": "bearer",
            "student_id": current_student_id,
        }

    # 查找目標學生
    target_student = (
        db.query(Student).filter(Student.id == request.target_student_id).first()
    )
    if not target_student:
        raise HTTPException(status_code=404, detail="Target student not found")
    if not target_student.is_active:
        raise HTTPException(status_code=400, detail="Target account is inactive")

    # 驗證：兩者必須同 email 且都已驗證
    if not (
        current_student.email
        and current_student.email_verified
        and target_student.email == current_student.email
        and target_student.email_verified
    ):
        raise HTTPException(
            status_code=403,
            detail="Cannot switch: accounts not linked by verified email",
        )

    # 更新最後登入時間
    target_student.last_login = datetime.now(timezone.utc)
    db.commit()

    # 建立新 token
    access_token = create_access_token(
        data={"sub": str(target_student.id), "type": "student"},
        expires_delta=timedelta(hours=24),
    )

    # 取得目標學生的所有班級（含跨帳號聚合）
    classrooms_list = _get_aggregated_classrooms(db, target_student)

    first_cr = classrooms_list[0] if classrooms_list else None

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "student": {
            "id": target_student.id,
            "name": target_student.name,
            "email": target_student.email,
            "student_number": target_student.student_number,
            "classroom_id": first_cr["id"] if first_cr else None,
            "classroom_name": first_cr["name"] if first_cr else None,
            "school_id": first_cr.get("school_id") if first_cr else None,
            "school_name": first_cr.get("school_name") if first_cr else None,
            "organization_id": first_cr.get("organization_id") if first_cr else None,
            "organization_name": (
                first_cr.get("organization_name") if first_cr else None
            ),
            "classrooms": classrooms_list,
            "classrooms_count": len(classrooms_list),
        },
    }

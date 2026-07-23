"""get_teacher_organizations 排除 group_buy（issue #862 PR2 — 方案 A 那一刀）.

團購脫離機構後，團購老師（含發起人）不應被回傳任何 organization，否則前端會
把他推進 organization workspace 模式而停用班級/學生自管。此測試鎖定：
  - 只屬 group_buy org 的發起人 → 回傳空
  - institution org 老師 → 照常回傳（回歸保護，確保沒誤傷機構方案）
  - 同時屬兩者 → 只回 institution

直接呼叫 endpoint 函式（避開 test_client/casbin 本機限制）。
"""

from auth import get_password_hash
from models import (
    Organization,
    School,
    Teacher,
    TeacherOrganization,
    TeacherSchool,
)
from routers.teachers.teacher_organizations import get_teacher_organizations


def _teacher(db, email):
    t = Teacher(
        email=email,
        password_hash=get_password_hash("x"),
        name=email.split("@")[0],
        is_active=True,
        email_verified=True,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _org_with_school(db, teacher, org_type, role="org_owner"):
    org = Organization(name=f"{org_type}-org", org_type=org_type, is_active=True)
    db.add(org)
    db.flush()
    school = School(organization_id=org.id, name="S", is_active=True)
    db.add(school)
    db.flush()
    db.add(
        TeacherOrganization(
            teacher_id=teacher.id,
            organization_id=org.id,
            role=role,
            is_active=True,
        )
    )
    db.add(
        TeacherSchool(
            teacher_id=teacher.id,
            school_id=school.id,
            roles=["school_admin"],
            is_active=True,
        )
    )
    db.commit()
    return org, school


def test_group_buy_only_owner_returns_empty(shared_test_session):
    db = shared_test_session
    owner = _teacher(db, "gb_only@duotopia.com")
    _org_with_school(db, owner, "group_buy")

    resp = get_teacher_organizations(teacher_id=owner.id, current_teacher=owner, db=db)
    assert resp.organizations == []


def test_institution_teacher_unaffected(shared_test_session):
    db = shared_test_session
    t = _teacher(db, "inst@duotopia.com")
    _org_with_school(db, t, "institution")

    resp = get_teacher_organizations(teacher_id=t.id, current_teacher=t, db=db)
    assert len(resp.organizations) == 1
    assert resp.organizations[0].role == "org_owner"


def test_mixed_returns_only_institution(shared_test_session):
    db = shared_test_session
    t = _teacher(db, "mixed@duotopia.com")
    inst_org, _ = _org_with_school(db, t, "institution")
    _org_with_school(db, t, "group_buy")

    resp = get_teacher_organizations(teacher_id=t.id, current_teacher=t, db=db)
    assert [o.id for o in resp.organizations] == [str(inst_org.id)]

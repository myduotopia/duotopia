"""Tests for classroom deactivate vs delete (#1097, round 3)

涵蓋：
- utils.classroom_grade.classroom_display_name 組合班名規則
- POST /api/teachers/classrooms/batch-update（年級／等級／啟用狀態）
- 老師 DELETE 設 deleted_at；老師列表排除已刪除、照常列出停用班級並回傳 is_active
- 學生端（validate、my-classrooms、me、作業列表）看不到停用／已刪除班級，並回傳 grade
- 公開 teacher-classrooms 回傳 grade、排除停用／已刪除
- 機構列表照常列出停用班級、排除已刪除
"""

import uuid
from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from models import (
    Assignment,
    AssignmentStatus,
    Classroom,
    ClassroomSchool,
    ClassroomStudent,
    Identity,
    Organization,
    School,
    Student,
    StudentAssignment,
    Teacher,
    TeacherSchool,
)
from models.base import ProgramLevel
from database import get_db
from auth import create_access_token, get_password_hash
from utils.classroom_grade import classroom_display_name

STUDENT_PASSWORD = "secret123"


# ============ Fixtures ============


@pytest.fixture
def test_db(tmp_path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from database import Base

    db_path = tmp_path / "test_classroom_status.db"
    engine = create_engine(
        f"sqlite:///{db_path}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client(test_db):
    def override_get_db():
        try:
            yield test_db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def _make_teacher(db: Session, email: str, name: str = "Teacher") -> Teacher:
    teacher = Teacher(
        email=email,
        name=name,
        password_hash="hashed",
        is_active=True,
        email_verified=True,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return teacher


def _auth(teacher: Teacher) -> dict:
    token = create_access_token(
        {"sub": str(teacher.id), "email": teacher.email, "type": "teacher"}
    )
    return {"Authorization": f"Bearer {token}"}


def _student_auth(student: Student) -> dict:
    token = create_access_token({"sub": str(student.id), "type": "student"})
    return {"Authorization": f"Bearer {token}"}


def _make_classroom(
    db: Session,
    name: str,
    teacher_id=None,
    grade=None,
    is_active=True,
    deleted=False,
    level=ProgramLevel.A1,
) -> Classroom:
    classroom = Classroom(
        name=name,
        teacher_id=teacher_id,
        level=level,
        grade=grade,
        is_active=is_active,
        deleted_at=datetime.now(timezone.utc) if deleted else None,
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    return classroom


def _make_school(db: Session) -> School:
    org = Organization(id=uuid.uuid4(), name="Org", is_active=True)
    db.add(org)
    db.commit()
    school = School(id=uuid.uuid4(), organization_id=org.id, name="S", is_active=True)
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


def _link_to_school(db: Session, classroom: Classroom, school: School) -> None:
    db.add(
        ClassroomSchool(classroom_id=classroom.id, school_id=school.id, is_active=True)
    )
    db.commit()


def _enroll(db: Session, classroom: Classroom, student: Student) -> None:
    db.add(
        ClassroomStudent(
            classroom_id=classroom.id, student_id=student.id, is_active=True
        )
    )
    db.commit()


def _make_student_with_identity(db: Session, email: str) -> Student:
    identity = Identity(
        email=email,
        password_hash=get_password_hash(STUDENT_PASSWORD),
        email_verified=True,
        is_active=True,
    )
    db.add(identity)
    db.flush()
    student = Student(
        email=email,
        password_hash=get_password_hash(STUDENT_PASSWORD),
        name="Learner",
        birthdate=date(2012, 1, 1),
        email_verified=True,
        is_active=True,
        identity_id=identity.id,
        is_primary_account=True,
    )
    db.add(student)
    db.commit()
    db.refresh(student)
    return student


def _assign(
    db: Session, teacher: Teacher, classroom, student: Student, title: str
) -> StudentAssignment:
    assignment = Assignment(
        title=title,
        teacher_id=teacher.id,
        classroom_id=classroom.id if classroom else None,
    )
    db.add(assignment)
    db.flush()
    sa = StudentAssignment(
        assignment_id=assignment.id,
        student_id=student.id,
        classroom_id=classroom.id if classroom else None,
        title=title,
        status=AssignmentStatus.NOT_STARTED,
    )
    db.add(sa)
    db.commit()
    db.refresh(sa)
    return sa


@pytest.fixture
def teacher(test_db: Session):
    return _make_teacher(test_db, "teacher@test.com", "Personal Teacher")


@pytest.fixture
def other_teacher(test_db: Session):
    return _make_teacher(test_db, "other@test.com", "Other Teacher")


# ============ classroom_display_name ============


class TestClassroomDisplayName:
    @pytest.mark.parametrize(
        "name,grade,expected",
        [
            ("12", "8", "8年12班"),
            ("12", 8, "8年12班"),
            ("A", "9", "9年A班"),
            ("三年甲班", "3", "三年甲班"),  # 已含「年」「班」
            ("忠班", "5", "忠班"),  # 已含「班」
            ("三年級", "3", "三年級"),  # 已含「年」
            ("Class A", "4", "Class A"),  # 整字 class
            ("grade 3 A", "3", "grade 3 A"),  # 整字 grade（不分大小寫）
            ("甲Class", "4", "甲Class"),  # 中文後接 Class 仍算整字（與前端一致）
            ("Masterclass", "4", "4年Masterclass班"),  # 非整字 → 組合
            ("Upgrade 3", "4", "4年Upgrade 3班"),  # 非整字 → 組合
            ("12", None, "12"),  # 沒有年級
            ("12", "Grade 5", "12"),  # 歷史雜值視為未設定
            ("12", "13", "12"),  # 超出範圍
            (None, None, ""),
            (" 12 ", "8", "8年12班"),  # 前後空白去除
            ("   ", "8", "   "),  # 去空白後為空 → 回原字串
        ],
    )
    def test_rules(self, name, grade, expected):
        assert classroom_display_name(name, grade) == expected


# ============ batch-update ============


class TestTeacherBatchUpdate:
    URL = "/api/teachers/classrooms/batch-update"

    def test_batch_level(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "C1", teacher_id=teacher.id)
        c2 = _make_classroom(test_db, "C2", teacher_id=teacher.id)

        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={
                "items": [
                    {"classroom_id": c1.id, "level": "b1"},
                    {"classroom_id": c2.id, "level": "PRE_A"},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        by_id = {u["id"]: u for u in data["updated"]}
        assert by_id[c1.id]["level"] == "B1"
        assert by_id[c2.id]["level"] == "preA"
        assert by_id[c1.id]["is_active"] is True

        test_db.refresh(c1)
        test_db.refresh(c2)
        assert c1.level == ProgramLevel.B1
        assert c2.level == ProgramLevel.PRE_A

    @pytest.mark.parametrize("level", ["preA", "PREA", "pre-a", "A1", "c2"])
    def test_level_aliases_accepted(self, client, test_db, teacher, level):
        c1 = _make_classroom(test_db, "C1", teacher_id=teacher.id)
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={"items": [{"classroom_id": c1.id, "level": level}]},
        )
        assert response.status_code == 200

    @pytest.mark.parametrize("level", ["D1", "", "A3", "beginner"])
    def test_invalid_level_is_422(self, client, test_db, teacher, level):
        c1 = _make_classroom(test_db, "C1", teacher_id=teacher.id)
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={"items": [{"classroom_id": c1.id, "level": level}]},
        )
        assert response.status_code == 422

    def test_batch_deactivate_and_reactivate(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "C1", teacher_id=teacher.id)
        c2 = _make_classroom(test_db, "C2", teacher_id=teacher.id)

        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={
                "items": [
                    {"classroom_id": c1.id, "is_active": False},
                    {"classroom_id": c2.id, "is_active": False},
                ]
            },
        )
        assert response.status_code == 200
        assert all(u["is_active"] is False for u in response.json()["updated"])
        test_db.refresh(c1)
        assert c1.is_active is False
        assert c1.deleted_at is None  # 停用不是刪除

        # 停用的班級仍可被找到並重新啟用
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={"items": [{"classroom_id": c1.id, "is_active": True}]},
        )
        assert response.status_code == 200
        assert response.json()["updated"][0]["is_active"] is True
        test_db.refresh(c1)
        test_db.refresh(c2)
        assert c1.is_active is True
        assert c2.is_active is False

    def test_batch_combined_fields(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "C1", teacher_id=teacher.id, grade="3")
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={
                "items": [
                    {
                        "classroom_id": c1.id,
                        "grade": 4,
                        "level": "A2",
                        "is_active": False,
                    }
                ]
            },
        )
        assert response.status_code == 200
        assert response.json()["updated"][0] == {
            "id": c1.id,
            "grade": 4,
            "level": "A2",
            "is_active": False,
        }

    def test_deleted_classroom_is_404_and_writes_nothing(
        self, client, test_db, teacher
    ):
        alive = _make_classroom(test_db, "Alive", teacher_id=teacher.id)
        deleted = _make_classroom(
            test_db, "Deleted", teacher_id=teacher.id, is_active=False, deleted=True
        )
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={
                "items": [
                    {"classroom_id": alive.id, "level": "C1"},
                    {"classroom_id": deleted.id, "is_active": True},
                ]
            },
        )
        assert response.status_code == 404
        test_db.refresh(alive)
        test_db.refresh(deleted)
        assert alive.level == ProgramLevel.A1
        assert deleted.is_active is False

    def test_not_owned_is_404(self, client, test_db, teacher, other_teacher):
        theirs = _make_classroom(test_db, "Theirs", teacher_id=other_teacher.id)
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={"items": [{"classroom_id": theirs.id, "is_active": False}]},
        )
        assert response.status_code == 404
        test_db.refresh(theirs)
        assert theirs.is_active is True

    def test_school_linked_is_403_and_writes_nothing(self, client, test_db, teacher):
        school = _make_school(test_db)
        personal = _make_classroom(test_db, "Personal", teacher_id=teacher.id)
        school_cls = _make_classroom(test_db, "SchoolCls", teacher_id=teacher.id)
        _link_to_school(test_db, school_cls, school)

        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={
                "items": [
                    {"classroom_id": personal.id, "is_active": False},
                    {"classroom_id": school_cls.id, "is_active": False},
                ]
            },
        )
        assert response.status_code == 403
        test_db.refresh(personal)
        assert personal.is_active is True

    def test_item_without_fields_is_422(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "C1", teacher_id=teacher.id)
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={"items": [{"classroom_id": c1.id}]},
        )
        assert response.status_code == 422

    def test_empty_items_is_422(self, client, teacher):
        response = client.post(self.URL, headers=_auth(teacher), json={"items": []})
        assert response.status_code == 422

    def test_duplicate_ids_is_422(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "C1", teacher_id=teacher.id)
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={
                "items": [
                    {"classroom_id": c1.id, "level": "A2"},
                    {"classroom_id": c1.id, "is_active": False},
                ]
            },
        )
        assert response.status_code == 422

    def test_over_cap_is_422(self, client, teacher):
        items = [{"classroom_id": i, "is_active": False} for i in range(1, 202)]
        response = client.post(self.URL, headers=_auth(teacher), json={"items": items})
        assert response.status_code == 422


# ============ 刪除 vs 停用（老師端） ============


class TestTeacherDeleteVsDeactivate:
    def test_delete_sets_deleted_at_and_hides_from_list(self, client, test_db, teacher):
        doomed = _make_classroom(test_db, "Doomed", teacher_id=teacher.id)
        inactive = _make_classroom(
            test_db, "Inactive", teacher_id=teacher.id, is_active=False
        )
        active = _make_classroom(test_db, "Active", teacher_id=teacher.id, grade="8")

        response = client.delete(
            f"/api/teachers/classrooms/{doomed.id}", headers=_auth(teacher)
        )
        assert response.status_code == 200
        test_db.refresh(doomed)
        assert doomed.deleted_at is not None
        assert doomed.is_active is False

        # 預設（選單用）：只列啟用班級
        response = client.get("/api/teachers/classrooms", headers=_auth(teacher))
        assert response.status_code == 200
        by_id = {c["id"]: c for c in response.json()}
        assert set(by_id) == {active.id}
        assert by_id[active.id]["is_active"] is True
        assert by_id[active.id]["grade"] == 8

        # include_inactive=true（我的班級頁）：含停用班級，已刪除仍排除
        response = client.get(
            "/api/teachers/classrooms",
            params={"include_inactive": "true"},
            headers=_auth(teacher),
        )
        assert response.status_code == 200
        by_id = {c["id"]: c for c in response.json()}
        assert set(by_id) == {active.id, inactive.id}
        assert by_id[inactive.id]["is_active"] is False
        assert by_id[active.id]["is_active"] is True

    def test_deleted_classroom_is_404_on_detail_update_delete(
        self, client, test_db, teacher
    ):
        deleted = _make_classroom(
            test_db, "Deleted", teacher_id=teacher.id, is_active=False, deleted=True
        )
        url = f"/api/teachers/classrooms/{deleted.id}"
        assert client.get(url, headers=_auth(teacher)).status_code == 404
        assert (
            client.put(
                url, headers=_auth(teacher), json={"is_active": True}
            ).status_code
            == 404
        )
        assert client.delete(url, headers=_auth(teacher)).status_code == 404
        test_db.refresh(deleted)
        assert deleted.is_active is False

    def test_put_toggles_is_active(self, client, test_db, teacher):
        classroom = _make_classroom(test_db, "C", teacher_id=teacher.id)
        url = f"/api/teachers/classrooms/{classroom.id}"

        response = client.put(url, headers=_auth(teacher), json={"is_active": False})
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        # 停用的班級單筆仍可讀取
        response = client.get(url, headers=_auth(teacher))
        assert response.status_code == 200
        assert response.json()["is_active"] is False

        response = client.put(url, headers=_auth(teacher), json={"is_active": True})
        assert response.json()["is_active"] is True
        test_db.refresh(classroom)
        assert classroom.is_active is True
        assert classroom.deleted_at is None

    @pytest.mark.parametrize(
        "level,expected",
        [("preA", "preA"), ("PRE_A", "preA"), ("a1", "A1"), ("b2", "B2")],
    )
    def test_put_level_is_normalized(self, client, test_db, teacher, level, expected):
        classroom = _make_classroom(test_db, "C", teacher_id=teacher.id)
        response = client.put(
            f"/api/teachers/classrooms/{classroom.id}",
            headers=_auth(teacher),
            json={"level": level},
        )
        assert response.status_code == 200
        assert response.json()["level"] == expected
        test_db.refresh(classroom)
        assert classroom.level == ProgramLevel(expected)

    def test_put_invalid_level_is_422(self, client, test_db, teacher):
        classroom = _make_classroom(test_db, "C", teacher_id=teacher.id)
        response = client.put(
            f"/api/teachers/classrooms/{classroom.id}",
            headers=_auth(teacher),
            json={"level": "D9"},
        )
        assert response.status_code == 422
        test_db.refresh(classroom)
        assert classroom.level == ProgramLevel.A1

    def test_create_level_normalized_and_invalid_rejected(self, client, teacher):
        response = client.post(
            "/api/teachers/classrooms",
            headers=_auth(teacher),
            json={"name": "P", "level": "PRE_A", "grade": 1},
        )
        assert response.status_code == 200
        assert response.json()["level"] == "preA"

        response = client.post(
            "/api/teachers/classrooms",
            headers=_auth(teacher),
            json={"name": "Bad", "level": "beginner", "grade": 1},
        )
        assert response.status_code == 422


# ============ 停用班級政策：老師端可用，但不可派新作業 ============


class TestInactiveClassroomTeacherPolicy:
    def test_create_assignment_on_inactive_classroom_is_400(
        self, client, test_db, teacher
    ):
        inactive = _make_classroom(
            test_db, "Inactive", teacher_id=teacher.id, is_active=False
        )
        response = client.post(
            "/api/teachers/assignments/create",
            headers=_auth(teacher),
            json={"title": "HW", "classroom_id": inactive.id, "content_ids": [1]},
        )
        assert response.status_code == 400
        assert response.json()["detail"] == "班級已停用，無法派發作業"
        assert test_db.query(Assignment).count() == 0

    def test_create_assignment_on_deleted_classroom_is_404(
        self, client, test_db, teacher
    ):
        deleted = _make_classroom(
            test_db, "Deleted", teacher_id=teacher.id, is_active=False, deleted=True
        )
        response = client.post(
            "/api/teachers/assignments/create",
            headers=_auth(teacher),
            json={"title": "HW", "classroom_id": deleted.id, "content_ids": [1]},
        )
        assert response.status_code == 404

    def test_inactive_classroom_of_other_teacher_is_404_not_400(
        self, client, test_db, teacher, other_teacher
    ):
        """授權檢查在停用檢查之前，不對無權限者透露班級狀態"""
        theirs = _make_classroom(
            test_db, "Theirs", teacher_id=other_teacher.id, is_active=False
        )
        response = client.post(
            "/api/teachers/assignments/create",
            headers=_auth(teacher),
            json={"title": "HW", "classroom_id": theirs.id, "content_ids": [1]},
        )
        assert response.status_code == 404

    def test_groups_and_students_readable_for_inactive_classroom(
        self, client, test_db, teacher
    ):
        inactive = _make_classroom(
            test_db, "Inactive", teacher_id=teacher.id, is_active=False
        )
        response = client.get(
            f"/api/teachers/classrooms/{inactive.id}/groups", headers=_auth(teacher)
        )
        assert response.status_code == 200
        response = client.get(
            f"/api/teachers/classrooms/{inactive.id}/students", headers=_auth(teacher)
        )
        assert response.status_code == 200

        deleted = _make_classroom(
            test_db, "Deleted", teacher_id=teacher.id, is_active=False, deleted=True
        )
        response = client.get(
            f"/api/teachers/classrooms/{deleted.id}/groups", headers=_auth(teacher)
        )
        assert response.status_code == 404


# ============ 學生端 ============


@pytest.fixture
def student_setup(test_db: Session, teacher: Teacher):
    """學生同時在：停用班（先加入）、已刪除班、啟用班（8 年 12 班）"""
    student = _make_student_with_identity(test_db, "learner@example.com")
    inactive = _make_classroom(
        test_db, "Inactive", teacher_id=teacher.id, grade="7", is_active=False
    )
    deleted = _make_classroom(
        test_db,
        "Deleted",
        teacher_id=teacher.id,
        grade="7",
        is_active=False,
        deleted=True,
    )
    active = _make_classroom(test_db, "12", teacher_id=teacher.id, grade="8")
    for c in (inactive, deleted, active):
        _enroll(test_db, c, student)
    return {
        "student": student,
        "inactive": inactive,
        "deleted": deleted,
        "active": active,
    }


class TestStudentVisibility:
    def test_validate_omits_inactive_and_deleted(self, client, student_setup):
        response = client.post(
            "/api/students/validate",
            json={"email": "learner@example.com", "password": STUDENT_PASSWORD},
        )
        assert response.status_code == 200
        student = response.json()["student"]
        active = student_setup["active"]
        assert [c["id"] for c in student["classrooms"]] == [active.id]
        assert student["classrooms"][0]["grade"] == 8
        assert student["classroom_id"] == active.id
        assert student["classroom_name"] == "12"
        assert student["classroom_grade"] == 8
        assert student["classrooms_count"] == 1

    def test_my_classrooms_omits_inactive_and_deleted(self, client, student_setup):
        response = client.get(
            "/api/students/my-classrooms",
            headers=_student_auth(student_setup["student"]),
        )
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        assert data["classrooms"][0]["id"] == student_setup["active"].id
        assert data["classrooms"][0]["grade"] == 8

    def test_me_picks_first_visible_classroom(self, client, student_setup):
        response = client.get(
            "/api/students/me", headers=_student_auth(student_setup["student"])
        )
        assert response.status_code == 200
        data = response.json()
        assert data["classroom_id"] == student_setup["active"].id
        assert data["classroom_name"] == "12"
        assert data["classroom_grade"] == 8

    def test_me_without_visible_classroom_is_null(self, client, test_db, student_setup):
        active = student_setup["active"]
        active.is_active = False
        test_db.commit()

        response = client.get(
            "/api/students/me", headers=_student_auth(student_setup["student"])
        )
        assert response.status_code == 200
        assert response.json()["classroom_id"] is None
        assert response.json()["classroom_grade"] is None

    def test_assignment_list_omits_inactive_and_deleted_classrooms(
        self, client, test_db, teacher, student_setup
    ):
        student = student_setup["student"]
        visible = _assign(test_db, teacher, student_setup["active"], student, "Seen")
        _assign(test_db, teacher, student_setup["inactive"], student, "HiddenInactive")
        _assign(test_db, teacher, student_setup["deleted"], student, "HiddenDeleted")
        no_class = _assign(test_db, teacher, None, student, "NoClassroom")

        response = client.get(
            "/api/students/assignments", headers=_student_auth(student)
        )
        assert response.status_code == 200
        ids = {a["id"] for a in response.json()}
        assert ids == {visible.id, no_class.id}

        # 分頁模式（含 tab 計數）也一致
        response = client.get(
            "/api/students/assignments?page_size=10", headers=_student_auth(student)
        )
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 2
        assert data["stats"]["todo"] == 2

        # 重新啟用後作業回來
        student_setup["inactive"].is_active = True
        test_db.commit()
        response = client.get(
            "/api/students/assignments", headers=_student_auth(student)
        )
        assert len(response.json()) == 3

    @pytest.mark.parametrize(
        "path",
        [
            "/api/students/assignments/{id}/activities",
            "/api/students/assignments/{id}/submit",
            "/api/students/assignments/{id}/practice-words",
            "/api/students/assignments/{id}/rearrangement-questions",
            "/api/students/assignments/{id}/quiz/status",
        ],
    )
    @pytest.mark.parametrize("which", ["inactive", "deleted"])
    def test_assignment_detail_blocked_for_hidden_classroom(
        self, client, test_db, teacher, student_setup, path, which
    ):
        student = student_setup["student"]
        sa = _assign(test_db, teacher, student_setup[which], student, "Hidden")
        url = path.format(id=sa.id)
        method = client.post if path.endswith("/submit") else client.get

        response = method(url, headers=_student_auth(student))
        assert response.status_code == 403
        assert response.json()["detail"] == "classroom_inactive"

    def test_assignment_detail_guard_skips_other_students_assignment(
        self, client, test_db, teacher, student_setup
    ):
        """別人的作業 id 不由守門回 403，交給端點本身處理（不透露班級狀態）"""
        other = Student(name="Other", is_active=True)
        test_db.add(other)
        test_db.commit()
        sa = _assign(test_db, teacher, student_setup["inactive"], other, "NotMine")

        response = client.get(
            f"/api/students/assignments/{sa.id}/activities",
            headers=_student_auth(student_setup["student"]),
        )
        assert response.status_code != 403 or (
            response.json().get("detail") != "classroom_inactive"
        )


# ============ 公開端與機構端 ============


class TestPublicAndSchoolLists:
    def test_public_teacher_classrooms_returns_grade_and_omits_hidden(
        self, client, test_db, teacher
    ):
        active = _make_classroom(test_db, "12", teacher_id=teacher.id, grade="8")
        no_grade = _make_classroom(test_db, "Free", teacher_id=teacher.id)
        _make_classroom(test_db, "Inactive", teacher_id=teacher.id, is_active=False)
        _make_classroom(
            test_db, "Deleted", teacher_id=teacher.id, is_active=False, deleted=True
        )

        response = client.get(
            "/api/public/teacher-classrooms", params={"email": teacher.email}
        )
        assert response.status_code == 200
        by_id = {c["id"]: c for c in response.json()}
        assert set(by_id) == {active.id, no_grade.id}
        assert by_id[active.id]["grade"] == 8
        assert by_id[no_grade.id]["grade"] is None

    def test_school_list_shows_inactive_and_omits_deleted(self, client, test_db):
        school = _make_school(test_db)
        admin = _make_teacher(test_db, "admin@test.com", "Admin")
        test_db.add(
            TeacherSchool(
                teacher_id=admin.id,
                school_id=school.id,
                roles=["school_admin"],
                is_active=True,
            )
        )
        test_db.commit()

        active = _make_classroom(test_db, "Active")
        inactive = _make_classroom(test_db, "Inactive", is_active=False)
        deleted = _make_classroom(test_db, "Deleted", is_active=False, deleted=True)
        for c in (active, inactive, deleted):
            _link_to_school(test_db, c, school)

        # 預設只列啟用班級
        response = client.get(
            f"/api/schools/{school.id}/classrooms", headers=_auth(admin)
        )
        assert response.status_code == 200
        assert {c["id"] for c in response.json()} == {str(active.id)}

        # include_inactive=true：含停用，已刪除仍排除
        response = client.get(
            f"/api/schools/{school.id}/classrooms",
            params={"include_inactive": "true"},
            headers=_auth(admin),
        )
        assert response.status_code == 200
        by_id = {c["id"]: c for c in response.json()}
        assert set(by_id) == {str(active.id), str(inactive.id)}
        assert by_id[str(inactive.id)]["is_active"] is False
        assert by_id[str(active.id)]["is_active"] is True

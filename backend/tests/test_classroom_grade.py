"""Tests for classroom grade field (#1097)

涵蓋：
- utils.classroom_grade.parse_grade 對歷史雜值的容錯
- 個人老師 /api/teachers/classrooms：新建必填、更新、列表／單筆回傳、批次設定
- 機構 /api/schools/{school_id}/classrooms：新建必填、更新、列表回傳、批次設定
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from models import (
    Teacher,
    School,
    Organization,
    TeacherSchool,
    Classroom,
    ClassroomSchool,
)
from models.base import ProgramLevel
from database import get_db
from auth import create_access_token
from utils.classroom_grade import parse_grade


# ============ Fixtures ============


@pytest.fixture
def test_db(tmp_path):
    """Create test database"""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from database import Base

    db_path = tmp_path / "test_classroom_grade.db"
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
    """Create test client with database override"""

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


def _make_classroom(
    db: Session, name: str, teacher_id=None, grade=None, is_active=True
) -> Classroom:
    classroom = Classroom(
        name=name,
        teacher_id=teacher_id,
        level=ProgramLevel.A1,
        grade=grade,
        is_active=is_active,
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    return classroom


def _link_to_school(db: Session, classroom: Classroom, school: School) -> None:
    db.add(
        ClassroomSchool(classroom_id=classroom.id, school_id=school.id, is_active=True)
    )
    db.commit()


@pytest.fixture
def teacher(test_db: Session):
    return _make_teacher(test_db, "teacher@test.com", "Personal Teacher")


@pytest.fixture
def other_teacher(test_db: Session):
    return _make_teacher(test_db, "other@test.com", "Other Teacher")


@pytest.fixture
def organization(test_db: Session):
    org = Organization(id=uuid.uuid4(), name="Test Org", is_active=True)
    test_db.add(org)
    test_db.commit()
    test_db.refresh(org)
    return org


def _make_school(db: Session, organization: Organization, name: str) -> School:
    school = School(
        id=uuid.uuid4(), organization_id=organization.id, name=name, is_active=True
    )
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


@pytest.fixture
def school(test_db: Session, organization: Organization):
    return _make_school(test_db, organization, "Test School")


@pytest.fixture
def other_school(test_db: Session, organization: Organization):
    return _make_school(test_db, organization, "Other School")


@pytest.fixture
def school_admin(test_db: Session, school: School):
    admin = _make_teacher(test_db, "admin@test.com", "School Admin")
    test_db.add(
        TeacherSchool(
            teacher_id=admin.id,
            school_id=school.id,
            roles=["school_admin"],
            is_active=True,
        )
    )
    test_db.commit()
    return admin


# ============ parse_grade ============


class TestParseGrade:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("1", 1),
            ("3", 3),
            ("12", 12),
            (" 5 ", 5),
            (7, 7),
        ],
    )
    def test_valid_values(self, raw, expected):
        assert parse_grade(raw) == expected

    @pytest.mark.parametrize(
        "raw",
        [None, "", "0", "13", "-1", "Grade 5", "國小三年級", "３", "3.5", True],
    )
    def test_invalid_values_are_none(self, raw):
        assert parse_grade(raw) is None


# ============ 個人老師端 ============


class TestTeacherClassroomGrade:
    def test_create_requires_grade(self, client, teacher):
        response = client.post(
            "/api/teachers/classrooms",
            headers=_auth(teacher),
            json={"name": "No Grade", "level": "A1"},
        )
        assert response.status_code == 422

    @pytest.mark.parametrize("grade", [0, 13])
    def test_create_rejects_out_of_range(self, client, teacher, grade):
        response = client.post(
            "/api/teachers/classrooms",
            headers=_auth(teacher),
            json={"name": "Bad Grade", "level": "A1", "grade": grade},
        )
        assert response.status_code == 422

    def test_create_with_grade(self, client, test_db, teacher):
        response = client.post(
            "/api/teachers/classrooms",
            headers=_auth(teacher),
            json={"name": "Grade 3 Class", "level": "A1", "grade": 3},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["grade"] == 3

        stored = test_db.query(Classroom).filter(Classroom.id == data["id"]).first()
        assert stored.grade == "3"

    def test_update_sets_grade(self, client, test_db, teacher):
        classroom = _make_classroom(test_db, "Class", teacher_id=teacher.id)
        response = client.put(
            f"/api/teachers/classrooms/{classroom.id}",
            headers=_auth(teacher),
            json={"grade": 6},
        )
        assert response.status_code == 200
        assert response.json()["grade"] == 6
        test_db.refresh(classroom)
        assert classroom.grade == "6"

    def test_update_rejects_out_of_range(self, client, test_db, teacher):
        classroom = _make_classroom(test_db, "Class", teacher_id=teacher.id)
        response = client.put(
            f"/api/teachers/classrooms/{classroom.id}",
            headers=_auth(teacher),
            json={"grade": 13},
        )
        assert response.status_code == 422

    def test_list_and_get_return_int_grade(self, client, test_db, teacher):
        graded = _make_classroom(test_db, "Graded", teacher_id=teacher.id, grade="4")
        unset = _make_classroom(test_db, "Unset", teacher_id=teacher.id)
        junk = _make_classroom(test_db, "Junk", teacher_id=teacher.id, grade="Grade 5")
        junk_zh = _make_classroom(
            test_db, "JunkZh", teacher_id=teacher.id, grade="國小三年級"
        )

        response = client.get("/api/teachers/classrooms", headers=_auth(teacher))
        assert response.status_code == 200
        by_id = {c["id"]: c for c in response.json()}
        assert by_id[graded.id]["grade"] == 4
        assert by_id[unset.id]["grade"] is None
        assert by_id[junk.id]["grade"] is None
        assert by_id[junk_zh.id]["grade"] is None

        response = client.get(
            f"/api/teachers/classrooms/{graded.id}", headers=_auth(teacher)
        )
        assert response.status_code == 200
        assert response.json()["grade"] == 4

        response = client.get(
            f"/api/teachers/classrooms/{junk.id}", headers=_auth(teacher)
        )
        assert response.json()["grade"] is None


class TestTeacherBatchGrade:
    URL = "/api/teachers/classrooms/batch-grade"

    def test_batch_success(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "C1", teacher_id=teacher.id, grade="3")
        c2 = _make_classroom(test_db, "C2", teacher_id=teacher.id)

        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={
                "items": [
                    {"classroom_id": c1.id, "grade": 4},
                    {"classroom_id": c2.id, "grade": 7},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        assert {(u["id"], u["grade"]) for u in data["updated"]} == {
            (c1.id, 4),
            (c2.id, 7),
        }

        test_db.refresh(c1)
        test_db.refresh(c2)
        assert c1.grade == "4"
        assert c2.grade == "7"
        # 調整年級不改名稱
        assert c1.name == "C1"

    def test_batch_not_owned_is_404_and_writes_nothing(
        self, client, test_db, teacher, other_teacher
    ):
        mine = _make_classroom(test_db, "Mine", teacher_id=teacher.id, grade="3")
        theirs = _make_classroom(
            test_db, "Theirs", teacher_id=other_teacher.id, grade="3"
        )

        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={
                "items": [
                    {"classroom_id": mine.id, "grade": 4},
                    {"classroom_id": theirs.id, "grade": 4},
                ]
            },
        )
        assert response.status_code == 404
        test_db.refresh(mine)
        test_db.refresh(theirs)
        assert mine.grade == "3"
        assert theirs.grade == "3"

    def test_batch_inactive_classroom_is_404(self, client, test_db, teacher):
        deleted = _make_classroom(
            test_db, "Deleted", teacher_id=teacher.id, is_active=False
        )
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={"items": [{"classroom_id": deleted.id, "grade": 4}]},
        )
        assert response.status_code == 404

    def test_batch_school_classroom_is_403(self, client, test_db, teacher, school):
        personal = _make_classroom(
            test_db, "Personal", teacher_id=teacher.id, grade="2"
        )
        school_cls = _make_classroom(
            test_db, "SchoolCls", teacher_id=teacher.id, grade="2"
        )
        _link_to_school(test_db, school_cls, school)

        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={
                "items": [
                    {"classroom_id": personal.id, "grade": 3},
                    {"classroom_id": school_cls.id, "grade": 3},
                ]
            },
        )
        assert response.status_code == 403
        test_db.refresh(personal)
        assert personal.grade == "2"

    @pytest.mark.parametrize("grade", [0, 13])
    def test_batch_out_of_range_is_422(self, client, test_db, teacher, grade):
        c1 = _make_classroom(test_db, "C1", teacher_id=teacher.id)
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={"items": [{"classroom_id": c1.id, "grade": grade}]},
        )
        assert response.status_code == 422

    def test_batch_empty_items_is_422(self, client, teacher):
        response = client.post(self.URL, headers=_auth(teacher), json={"items": []})
        assert response.status_code == 422

    def test_batch_duplicate_ids_is_422(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "C1", teacher_id=teacher.id)
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={
                "items": [
                    {"classroom_id": c1.id, "grade": 3},
                    {"classroom_id": c1.id, "grade": 4},
                ]
            },
        )
        assert response.status_code == 422

    def test_batch_over_cap_is_422(self, client, teacher):
        items = [{"classroom_id": i, "grade": 3} for i in range(1, 202)]
        response = client.post(self.URL, headers=_auth(teacher), json={"items": items})
        assert response.status_code == 422


# ============ 機構端 ============


class TestSchoolClassroomGrade:
    def test_create_requires_grade(self, client, school, school_admin):
        response = client.post(
            f"/api/schools/{school.id}/classrooms",
            headers=_auth(school_admin),
            json={"name": "No Grade", "level": "A1"},
        )
        assert response.status_code == 422

    def test_create_rejects_out_of_range(self, client, school, school_admin):
        response = client.post(
            f"/api/schools/{school.id}/classrooms",
            headers=_auth(school_admin),
            json={"name": "Bad", "level": "A1", "grade": 13},
        )
        assert response.status_code == 422

    def test_create_with_grade(self, client, test_db, school, school_admin):
        response = client.post(
            f"/api/schools/{school.id}/classrooms",
            headers=_auth(school_admin),
            json={"name": "三年級 A 班", "level": "A1", "grade": 3},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["grade"] == 3
        stored = (
            test_db.query(Classroom).filter(Classroom.id == int(data["id"])).first()
        )
        assert stored.grade == "3"

    def test_update_sets_grade(self, client, test_db, school, school_admin):
        classroom = _make_classroom(test_db, "Class")
        _link_to_school(test_db, classroom, school)

        response = client.put(
            f"/api/classrooms/{classroom.id}",
            headers=_auth(school_admin),
            json={"grade": 9},
        )
        assert response.status_code == 200
        assert response.json()["grade"] == 9
        test_db.refresh(classroom)
        assert classroom.grade == "9"

    def test_list_returns_int_grade(self, client, test_db, school, school_admin):
        graded = _make_classroom(test_db, "Graded", grade="11")
        junk = _make_classroom(test_db, "Junk", grade="國小三年級")
        unset = _make_classroom(test_db, "Unset")
        for c in (graded, junk, unset):
            _link_to_school(test_db, c, school)

        response = client.get(
            f"/api/schools/{school.id}/classrooms", headers=_auth(school_admin)
        )
        assert response.status_code == 200
        by_id = {c["id"]: c for c in response.json()}
        assert by_id[str(graded.id)]["grade"] == 11
        assert by_id[str(junk.id)]["grade"] is None
        assert by_id[str(unset.id)]["grade"] is None


class TestSchoolBatchGrade:
    @staticmethod
    def _url(school_id) -> str:
        return f"/api/schools/{school_id}/classrooms/batch-grade"

    def test_batch_success(self, client, test_db, school, school_admin):
        c1 = _make_classroom(test_db, "C1", grade="5")
        c2 = _make_classroom(test_db, "C2")
        for c in (c1, c2):
            _link_to_school(test_db, c, school)

        response = client.post(
            self._url(school.id),
            headers=_auth(school_admin),
            json={
                "items": [
                    {"classroom_id": c1.id, "grade": 6},
                    {"classroom_id": c2.id, "grade": 1},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        assert {(u["id"], u["grade"]) for u in data["updated"]} == {
            (c1.id, 6),
            (c2.id, 1),
        }
        test_db.refresh(c1)
        test_db.refresh(c2)
        assert c1.grade == "6"
        assert c2.grade == "1"

    def test_batch_other_school_classroom_is_404(
        self, client, test_db, school, other_school, school_admin
    ):
        mine = _make_classroom(test_db, "Mine", grade="5")
        _link_to_school(test_db, mine, school)
        foreign = _make_classroom(test_db, "Foreign", grade="5")
        _link_to_school(test_db, foreign, other_school)

        response = client.post(
            self._url(school.id),
            headers=_auth(school_admin),
            json={
                "items": [
                    {"classroom_id": mine.id, "grade": 6},
                    {"classroom_id": foreign.id, "grade": 6},
                ]
            },
        )
        assert response.status_code == 404
        test_db.refresh(mine)
        test_db.refresh(foreign)
        assert mine.grade == "5"
        assert foreign.grade == "5"

    def test_batch_personal_classroom_is_404(
        self, client, test_db, school, school_admin
    ):
        personal = _make_classroom(test_db, "Personal", teacher_id=school_admin.id)
        response = client.post(
            self._url(school.id),
            headers=_auth(school_admin),
            json={"items": [{"classroom_id": personal.id, "grade": 3}]},
        )
        assert response.status_code == 404

    def test_batch_without_permission_is_403(self, client, test_db, school, teacher):
        c1 = _make_classroom(test_db, "C1", grade="5")
        _link_to_school(test_db, c1, school)

        response = client.post(
            self._url(school.id),
            headers=_auth(teacher),
            json={"items": [{"classroom_id": c1.id, "grade": 6}]},
        )
        assert response.status_code == 403
        test_db.refresh(c1)
        assert c1.grade == "5"

    @pytest.mark.parametrize("grade", [0, 13])
    def test_batch_out_of_range_is_422(
        self, client, test_db, school, school_admin, grade
    ):
        c1 = _make_classroom(test_db, "C1")
        _link_to_school(test_db, c1, school)
        response = client.post(
            self._url(school.id),
            headers=_auth(school_admin),
            json={"items": [{"classroom_id": c1.id, "grade": grade}]},
        )
        assert response.status_code == 422

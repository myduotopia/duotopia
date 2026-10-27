"""Tests for classroom batch edit — name + grade (#1139)

涵蓋：
- 個人老師 POST /api/teachers/classrooms/batch-update：只改名、名稱＋年級、
  名稱去頭尾空白、全空白／101 字 → 422、重複 id → 422
- 個人老師 PUT /api/teachers/classrooms/{id}：名稱長度驗證
- 機構 POST /api/schools/{school_id}/classrooms/batch-update：只改名、名稱＋年級、
  停用班級可改、無權限 → 403、跨校班 → 404（全有或全無）、驗證 422
- 機構 PUT /api/classrooms/{id}：名稱去頭尾空白、全空白 → 422
"""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from main import app
from models import (
    Teacher,
    School,
    Organization,
    TeacherSchool,
    TeacherOrganization,
    Classroom,
    ClassroomSchool,
)
from models.base import ProgramLevel
from database import get_db
from auth import create_access_token
from routers.schemas.classroom import BATCH_GRADE_MAX_ITEMS


# ============ Fixtures ============


@pytest.fixture
def test_db(tmp_path):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from database import Base

    db_path = tmp_path / "test_classroom_batch_edit.db"
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


def _make_classroom(
    db: Session, name: str, teacher_id=None, grade=None, is_active=True, deleted=False
) -> Classroom:
    classroom = Classroom(
        name=name,
        teacher_id=teacher_id,
        level=ProgramLevel.A1,
        grade=grade,
        is_active=is_active,
        deleted_at=datetime.now(timezone.utc) if deleted else None,
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


def _make_school(db: Session, organization: Organization, name: str) -> School:
    school = School(
        id=uuid.uuid4(), organization_id=organization.id, name=name, is_active=True
    )
    db.add(school)
    db.commit()
    db.refresh(school)
    return school


@pytest.fixture
def teacher(test_db: Session):
    return _make_teacher(test_db, "teacher@test.com", "Personal Teacher")


@pytest.fixture
def organization(test_db: Session):
    org = Organization(id=uuid.uuid4(), name="Test Org", is_active=True)
    test_db.add(org)
    test_db.commit()
    test_db.refresh(org)
    return org


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


# ============ 老師 batch-update：名稱 ============


class TestTeacherBatchUpdateName:
    URL = "/api/teachers/classrooms/batch-update"

    def test_name_only(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "五年12班", teacher_id=teacher.id, grade="5")
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={"items": [{"classroom_id": c1.id, "name": "12"}]},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        assert data["updated"][0]["id"] == c1.id
        assert data["updated"][0]["name"] == "12"
        assert data["updated"][0]["grade"] == 5
        test_db.refresh(c1)
        assert c1.name == "12"
        assert c1.grade == "5"

    def test_name_and_grade(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "八年12班", teacher_id=teacher.id)
        c2 = _make_classroom(test_db, "七年3班", teacher_id=teacher.id, grade="7")
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={
                "items": [
                    {"classroom_id": c1.id, "name": "12", "grade": 8},
                    {"classroom_id": c2.id, "name": "3", "grade": 7},
                ]
            },
        )
        assert response.status_code == 200
        updated = {u["id"]: u for u in response.json()["updated"]}
        assert updated[c1.id]["name"] == "12"
        assert updated[c1.id]["grade"] == 8
        assert updated[c2.id]["name"] == "3"
        test_db.refresh(c1)
        test_db.refresh(c2)
        assert (c1.name, c1.grade) == ("12", "8")
        assert (c2.name, c2.grade) == ("3", "7")

    def test_name_is_trimmed(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "Old", teacher_id=teacher.id)
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={"items": [{"classroom_id": c1.id, "name": "  忠班  "}]},
        )
        assert response.status_code == 200
        test_db.refresh(c1)
        assert c1.name == "忠班"

    @pytest.mark.parametrize("name", ["", "   ", "a" * 101])
    def test_invalid_name_is_422_and_writes_nothing(
        self, client, test_db, teacher, name
    ):
        c1 = _make_classroom(test_db, "Keep", teacher_id=teacher.id)
        c2 = _make_classroom(test_db, "Keep2", teacher_id=teacher.id)
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={
                "items": [
                    {"classroom_id": c1.id, "name": "OK"},
                    {"classroom_id": c2.id, "name": name},
                ]
            },
        )
        assert response.status_code == 422
        test_db.refresh(c1)
        assert c1.name == "Keep"

    def test_name_100_chars_ok(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "Old", teacher_id=teacher.id)
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={"items": [{"classroom_id": c1.id, "name": "a" * 100}]},
        )
        assert response.status_code == 200
        test_db.refresh(c1)
        assert c1.name == "a" * 100

    def test_duplicate_ids_is_422(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "C1", teacher_id=teacher.id)
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={
                "items": [
                    {"classroom_id": c1.id, "name": "A"},
                    {"classroom_id": c1.id, "name": "B"},
                ]
            },
        )
        assert response.status_code == 422

    def test_school_linked_is_403(self, client, test_db, teacher, school):
        c1 = _make_classroom(test_db, "C1", teacher_id=teacher.id)
        _link_to_school(test_db, c1, school)
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={"items": [{"classroom_id": c1.id, "name": "New"}]},
        )
        assert response.status_code == 403
        test_db.refresh(c1)
        assert c1.name == "C1"

    def test_inactive_classroom_name_is_updatable(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "Old", teacher_id=teacher.id, is_active=False)
        response = client.post(
            self.URL,
            headers=_auth(teacher),
            json={"items": [{"classroom_id": c1.id, "name": "New"}]},
        )
        assert response.status_code == 200
        test_db.refresh(c1)
        assert c1.name == "New"
        assert c1.is_active is False


# ============ 老師單班 PUT：名稱驗證 ============


class TestTeacherPutName:
    @pytest.mark.parametrize("name", ["   ", "a" * 101])
    def test_invalid_name_is_422(self, client, test_db, teacher, name):
        c1 = _make_classroom(test_db, "Keep", teacher_id=teacher.id)
        response = client.put(
            f"/api/teachers/classrooms/{c1.id}",
            headers=_auth(teacher),
            json={"name": name},
        )
        assert response.status_code == 422
        test_db.refresh(c1)
        assert c1.name == "Keep"

    def test_name_is_trimmed(self, client, test_db, teacher):
        c1 = _make_classroom(test_db, "Old", teacher_id=teacher.id)
        response = client.put(
            f"/api/teachers/classrooms/{c1.id}",
            headers=_auth(teacher),
            json={"name": "  New  "},
        )
        assert response.status_code == 200
        assert response.json()["name"] == "New"


# ============ 機構 batch-update ============


class TestSchoolBatchUpdate:
    @staticmethod
    def _url(school_id) -> str:
        return f"/api/schools/{school_id}/classrooms/batch-update"

    def test_name_only_and_name_with_grade(self, client, test_db, school, school_admin):
        c1 = _make_classroom(test_db, "五年12班", grade="5")
        c2 = _make_classroom(test_db, "八年3班")
        for c in (c1, c2):
            _link_to_school(test_db, c, school)

        response = client.post(
            self._url(school.id),
            headers=_auth(school_admin),
            json={
                "items": [
                    {"classroom_id": c1.id, "name": "12"},
                    {"classroom_id": c2.id, "name": " 3 ", "grade": 8},
                ]
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        updated = {u["id"]: u for u in data["updated"]}
        assert updated[c1.id] == {"id": c1.id, "name": "12", "grade": 5}
        assert updated[c2.id] == {"id": c2.id, "name": "3", "grade": 8}
        test_db.refresh(c1)
        test_db.refresh(c2)
        assert (c1.name, c1.grade) == ("12", "5")
        assert (c2.name, c2.grade) == ("3", "8")

    def test_grade_only(self, client, test_db, school, school_admin):
        c1 = _make_classroom(test_db, "C1")
        _link_to_school(test_db, c1, school)
        response = client.post(
            self._url(school.id),
            headers=_auth(school_admin),
            json={"items": [{"classroom_id": c1.id, "grade": 7}]},
        )
        assert response.status_code == 200
        test_db.refresh(c1)
        assert (c1.name, c1.grade) == ("C1", "7")

    def test_inactive_classroom_is_updatable(
        self, client, test_db, school, school_admin
    ):
        c1 = _make_classroom(test_db, "Old", is_active=False)
        _link_to_school(test_db, c1, school)
        response = client.post(
            self._url(school.id),
            headers=_auth(school_admin),
            json={"items": [{"classroom_id": c1.id, "name": "New"}]},
        )
        assert response.status_code == 200
        test_db.refresh(c1)
        assert c1.name == "New"
        assert c1.is_active is False

    def test_deleted_classroom_is_404(self, client, test_db, school, school_admin):
        c1 = _make_classroom(test_db, "Gone", deleted=True)
        _link_to_school(test_db, c1, school)
        response = client.post(
            self._url(school.id),
            headers=_auth(school_admin),
            json={"items": [{"classroom_id": c1.id, "name": "New"}]},
        )
        assert response.status_code == 404

    def test_without_permission_is_403(self, client, test_db, school, teacher):
        c1 = _make_classroom(test_db, "Keep")
        _link_to_school(test_db, c1, school)
        response = client.post(
            self._url(school.id),
            headers=_auth(teacher),
            json={"items": [{"classroom_id": c1.id, "name": "New"}]},
        )
        assert response.status_code == 403
        test_db.refresh(c1)
        assert c1.name == "Keep"

    def test_other_school_classroom_is_404_and_writes_nothing(
        self, client, test_db, school, other_school, school_admin
    ):
        mine = _make_classroom(test_db, "Mine")
        _link_to_school(test_db, mine, school)
        foreign = _make_classroom(test_db, "Foreign")
        _link_to_school(test_db, foreign, other_school)

        response = client.post(
            self._url(school.id),
            headers=_auth(school_admin),
            json={
                "items": [
                    {"classroom_id": mine.id, "name": "Changed"},
                    {"classroom_id": foreign.id, "name": "Changed"},
                ]
            },
        )
        assert response.status_code == 404
        test_db.refresh(mine)
        test_db.refresh(foreign)
        assert mine.name == "Mine"
        assert foreign.name == "Foreign"

    def test_personal_classroom_is_404(self, client, test_db, school, school_admin):
        personal = _make_classroom(test_db, "Personal", teacher_id=school_admin.id)
        response = client.post(
            self._url(school.id),
            headers=_auth(school_admin),
            json={"items": [{"classroom_id": personal.id, "name": "New"}]},
        )
        assert response.status_code == 404
        test_db.refresh(personal)
        assert personal.name == "Personal"

    @pytest.mark.parametrize(
        "item",
        [
            {"name": "   "},
            {"name": "a" * 101},
            {"grade": 13},
            {"grade": 0},
            {},
        ],
    )
    def test_invalid_item_is_422(self, client, test_db, school, school_admin, item):
        c1 = _make_classroom(test_db, "Keep")
        _link_to_school(test_db, c1, school)
        response = client.post(
            self._url(school.id),
            headers=_auth(school_admin),
            json={"items": [{"classroom_id": c1.id, **item}]},
        )
        assert response.status_code == 422
        test_db.refresh(c1)
        assert c1.name == "Keep"

    def test_duplicate_ids_is_422(self, client, test_db, school, school_admin):
        c1 = _make_classroom(test_db, "C1")
        _link_to_school(test_db, c1, school)
        response = client.post(
            self._url(school.id),
            headers=_auth(school_admin),
            json={
                "items": [
                    {"classroom_id": c1.id, "name": "A"},
                    {"classroom_id": c1.id, "name": "B"},
                ]
            },
        )
        assert response.status_code == 422

    def test_over_cap_is_422(self, client, school, school_admin):
        items = [
            {"classroom_id": i, "name": f"C{i}"}
            for i in range(1, BATCH_GRADE_MAX_ITEMS + 2)
        ]
        response = client.post(
            self._url(school.id), headers=_auth(school_admin), json={"items": items}
        )
        assert response.status_code == 422

    def test_org_owner_without_school_role_succeeds(
        self, client, test_db, organization, school
    ):
        owner = _make_teacher(test_db, "owner@test.com", "Org Owner")
        test_db.add(
            TeacherOrganization(
                teacher_id=owner.id,
                organization_id=organization.id,
                role="org_owner",
                is_active=True,
            )
        )
        test_db.commit()
        c1 = _make_classroom(test_db, "Old")
        _link_to_school(test_db, c1, school)

        response = client.post(
            self._url(school.id),
            headers=_auth(owner),
            json={"items": [{"classroom_id": c1.id, "name": "New", "grade": 4}]},
        )
        assert response.status_code == 200
        test_db.refresh(c1)
        assert (c1.name, c1.grade) == ("New", "4")


# ============ 機構單班 PUT：名稱去空白 ============


class TestSchoolPutName:
    def test_whitespace_name_is_422(self, client, test_db, school, school_admin):
        c1 = _make_classroom(test_db, "Keep")
        _link_to_school(test_db, c1, school)
        response = client.put(
            f"/api/classrooms/{c1.id}",
            headers=_auth(school_admin),
            json={"name": "   "},
        )
        assert response.status_code == 422
        test_db.refresh(c1)
        assert c1.name == "Keep"

    def test_name_is_trimmed(self, client, test_db, school, school_admin):
        c1 = _make_classroom(test_db, "Old")
        _link_to_school(test_db, c1, school)
        response = client.put(
            f"/api/classrooms/{c1.id}",
            headers=_auth(school_admin),
            json={"name": "  New  "},
        )
        assert response.status_code == 200
        test_db.refresh(c1)
        assert c1.name == "New"

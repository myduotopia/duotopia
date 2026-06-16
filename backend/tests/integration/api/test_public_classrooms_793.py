"""Integration tests for #793 — scoped public teacher-classrooms endpoint.

The public endpoint ``GET /api/public/teacher-classrooms`` was extended with
optional view-filter query params (``scope``, ``org_id``, ``school_id``):

  - ``scope=personal``            → only classrooms with NO active
    ``ClassroomSchool`` link (personal classrooms).
  - ``scope=school`` + ``school_id`` → only classrooms linked to that school.
  - ``scope=org`` + ``org_id``    → only classrooms in any school under that org.
  - no scope (or scope present but its id missing) → ALL active classrooms of
    the teacher (backward compat with already-circulating QR codes).

The endpoint is PUBLIC (no auth) — every test is a plain GET with query params.
"""

from datetime import datetime

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from auth import get_password_hash
from database import Base, get_db
from main import app
from models import (
    Classroom,
    ClassroomSchool,
    ClassroomStudent,
    Organization,
    School,
    Student,
    Teacher,
)

SQLALCHEMY_DATABASE_URL = "sqlite:///./test_public_classrooms_793.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


client = TestClient(app)

TEACHER_EMAIL = "teacher793@test.com"

# UUIDs for the org/school graph — generated once so tests can pass them as
# query params.
ORG_A_ID = str(uuid.uuid4())
ORG_B_ID = str(uuid.uuid4())
SCHOOL_A1_ID = str(uuid.uuid4())
SCHOOL_A2_ID = str(uuid.uuid4())
SCHOOL_B1_ID = str(uuid.uuid4())


@pytest.fixture(scope="function")
def setup_database():
    # Re-bind the dependency override INSIDE the fixture (not at import time) so
    # that when several self-contained test modules run together they don't
    # collide on the shared ``app.dependency_overrides`` global.
    app.dependency_overrides[get_db] = _override_get_db
    Base.metadata.create_all(bind=engine)
    _seed()
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.pop(get_db, None)


def _seed():
    """Seed one teacher with personal + school-linked + org-spanning classrooms.

    Classrooms (all teacher_id=1, is_active=True):
      - ca1 (id=1)  → linked to School A1 (active link)
      - cb1 (id=2)  → linked to School B1 (active link)
      - cp1 (id=3)  → personal (NO ClassroomSchool row)
      - ca2 (id=4)  → linked to School A2 (active link); proves org spans schools
      - cx1 (id=5)  → INACTIVE classroom, linked to School A1 (must never show)
      - cd1 (id=6)  → linked to School B1 but link is_active=False
                       (behaves as personal/unlinked)
    """
    db = TestingSessionLocal()

    teacher = Teacher(
        id=1,
        name="t",
        email=TEACHER_EMAIL,
        password_hash=get_password_hash("password123"),
        email_verified=True,
        is_active=True,
    )
    db.add(teacher)

    # Organizations + schools
    db.add_all(
        [
            Organization(id=ORG_A_ID, name="Org A", is_active=True),
            Organization(id=ORG_B_ID, name="Org B", is_active=True),
        ]
    )
    db.commit()
    db.add_all(
        [
            School(
                id=SCHOOL_A1_ID,
                organization_id=ORG_A_ID,
                name="School A1",
                is_active=True,
            ),
            School(
                id=SCHOOL_A2_ID,
                organization_id=ORG_A_ID,
                name="School A2",
                is_active=True,
            ),
            School(
                id=SCHOOL_B1_ID,
                organization_id=ORG_B_ID,
                name="School B1",
                is_active=True,
            ),
        ]
    )
    db.commit()

    # Classrooms
    db.add_all(
        [
            Classroom(id=1, name="ca1", teacher_id=1, is_active=True),
            Classroom(id=2, name="cb1", teacher_id=1, is_active=True),
            Classroom(id=3, name="cp1", teacher_id=1, is_active=True),
            Classroom(id=4, name="ca2", teacher_id=1, is_active=True),
            Classroom(id=5, name="cx1", teacher_id=1, is_active=False),
            Classroom(id=6, name="cd1", teacher_id=1, is_active=True),
        ]
    )
    db.commit()

    # Classroom ↔ School links
    db.add_all(
        [
            ClassroomSchool(classroom_id=1, school_id=SCHOOL_A1_ID, is_active=True),
            ClassroomSchool(classroom_id=2, school_id=SCHOOL_B1_ID, is_active=True),
            ClassroomSchool(classroom_id=4, school_id=SCHOOL_A2_ID, is_active=True),
            # inactive classroom but active link → still excluded (classroom dead)
            ClassroomSchool(classroom_id=5, school_id=SCHOOL_A1_ID, is_active=True),
            # active classroom but INACTIVE link → behaves as personal/unlinked
            ClassroomSchool(classroom_id=6, school_id=SCHOOL_B1_ID, is_active=False),
        ]
    )
    db.commit()

    # A couple of students so studentCount is exercised on ca1.
    db.add_all(
        [
            Student(
                id=1,
                name="s1",
                email="s1_793@test.com",
                password_hash=get_password_hash("password123"),
                email_verified=True,
                is_active=True,
                birthdate=datetime(2010, 1, 1).date(),
            ),
            Student(
                id=2,
                name="s2",
                email="s2_793@test.com",
                password_hash=get_password_hash("password123"),
                email_verified=True,
                is_active=True,
                birthdate=datetime(2011, 1, 1).date(),
            ),
        ]
    )
    db.commit()
    db.add_all(
        [
            ClassroomStudent(classroom_id=1, student_id=1, is_active=True),
            ClassroomStudent(classroom_id=1, student_id=2, is_active=True),
        ]
    )
    db.commit()
    db.close()


def _get(params):
    return client.get("/api/public/teacher-classrooms", params=params)


def _names(resp):
    return sorted(item["name"] for item in resp.json())


def test_no_scope_returns_all_active_classrooms(setup_database):
    """No scope → all active classrooms (backward compat)."""
    resp = _get({"email": TEACHER_EMAIL})
    assert resp.status_code == 200, resp.text
    # cx1 is inactive → excluded; cd1 active classroom → included regardless of
    # its (inactive) school link.
    assert _names(resp) == ["ca1", "ca2", "cb1", "cd1", "cp1"]

    # studentCount is surfaced (ca1 has 2 students).
    by_name = {item["name"]: item for item in resp.json()}
    assert by_name["ca1"]["studentCount"] == 2
    assert by_name["cp1"]["studentCount"] == 0
    # Shape check.
    assert set(by_name["ca1"].keys()) == {"id", "name", "studentCount"}


def test_scope_personal_returns_only_unlinked(setup_database):
    """scope=personal → only classrooms with no ACTIVE school link.

    cp1 has no link at all; cd1's only link is inactive, so it counts as
    personal too.
    """
    resp = _get({"email": TEACHER_EMAIL, "scope": "personal"})
    assert resp.status_code == 200, resp.text
    assert _names(resp) == ["cd1", "cp1"]


def test_scope_school_returns_only_that_school(setup_database):
    """scope=school + school_id → only classrooms linked to that school."""
    resp = _get({"email": TEACHER_EMAIL, "scope": "school", "school_id": SCHOOL_A1_ID})
    assert resp.status_code == 200, resp.text
    # ca1 linked to A1. cx1 also links A1 but is inactive → excluded.
    assert _names(resp) == ["ca1"]


def test_scope_org_single_school(setup_database):
    """scope=org + org_id (Org B has one school) → that school's classrooms."""
    resp = _get({"email": TEACHER_EMAIL, "scope": "org", "org_id": ORG_B_ID})
    assert resp.status_code == 200, resp.text
    # cb1 linked to B1 (active). cd1 link to B1 is inactive → excluded.
    assert _names(resp) == ["cb1"]


def test_scope_org_spans_multiple_schools(setup_database):
    """scope=org spans every school under the org (proves org-level reach)."""
    resp = _get({"email": TEACHER_EMAIL, "scope": "org", "org_id": ORG_A_ID})
    assert resp.status_code == 200, resp.text
    # ca1 (A1) + ca2 (A2) both under Org A. cx1 (A1) inactive → excluded.
    assert _names(resp) == ["ca1", "ca2"]


def test_scope_org_missing_id_falls_back_to_all(setup_database):
    """scope=org but org_id missing → backward-compat: return ALL."""
    resp = _get({"email": TEACHER_EMAIL, "scope": "org"})
    assert resp.status_code == 200, resp.text
    assert _names(resp) == ["ca1", "ca2", "cb1", "cd1", "cp1"]


def test_inactive_classroom_excluded_and_inactive_link_is_personal(setup_database):
    """Inactive classroom never appears; an inactive link → personal/unlinked.

    cx1 (inactive classroom, active A1 link) must NOT appear in School A1 scope.
    cd1 (active classroom, inactive B1 link) must NOT appear in School B1 scope
    but DOES appear in scope=personal (covered above).
    """
    a1 = _get({"email": TEACHER_EMAIL, "scope": "school", "school_id": SCHOOL_A1_ID})
    assert "cx1" not in _names(a1)

    b1 = _get({"email": TEACHER_EMAIL, "scope": "school", "school_id": SCHOOL_B1_ID})
    assert _names(b1) == ["cb1"]  # cd1 excluded because its link is inactive


def test_unknown_teacher_email_returns_404(setup_database):
    """Unknown teacher email → 404."""
    resp = _get({"email": "nobody793@test.com"})
    assert resp.status_code == 404, resp.text

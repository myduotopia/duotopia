"""Tests for school classroom CRUD API"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
import uuid

from main import app
from models import Teacher, School, TeacherSchool, Classroom, ClassroomSchool
from models.base import ProgramLevel
from database import get_db
from auth import create_access_token


@pytest.fixture
def test_db(tmp_path):
    """Create test database"""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from database import Base

    db_path = tmp_path / "test_school_classrooms.db"
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


@pytest.fixture
def school_admin_teacher(test_db: Session):
    """Create teacher with school_admin role"""
    teacher = Teacher(
        email="admin@test.com",
        name="School Admin",
        password_hash="hashed",
        is_active=True,
    )
    test_db.add(teacher)
    test_db.commit()
    test_db.refresh(teacher)
    return teacher


@pytest.fixture
def school(test_db: Session):
    """Create test school"""
    org_id = uuid.uuid4()
    school = School(
        id=uuid.uuid4(), organization_id=org_id, name="Test School", is_active=True
    )
    test_db.add(school)
    test_db.commit()
    test_db.refresh(school)
    return school


@pytest.fixture
def link_teacher_to_school(test_db: Session, school_admin_teacher, school):
    """Link teacher to school with school_admin role"""
    link = TeacherSchool(
        teacher_id=school_admin_teacher.id,
        school_id=school.id,
        roles=["school_admin"],
        is_active=True,
    )
    test_db.add(link)
    test_db.commit()


def get_test_token(teacher_id: int) -> str:
    """Generate test JWT token"""
    return create_access_token({"sub": str(teacher_id), "type": "teacher"})


def test_create_classroom_without_teacher_assignment(
    client, test_db, school_admin_teacher, school, link_teacher_to_school
):
    """Test: School admin can create classroom without assigning teacher"""
    # This test will FAIL until we implement the endpoint
    response = client.post(
        f"/api/schools/{school.id}/classrooms",
        json={
            "name": "一年級 A 班",
            "description": "Test classroom",
            "level": "A1",
            "grade": 1,
        },
        headers={"Authorization": f"Bearer {get_test_token(school_admin_teacher.id)}"},
    )

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "一年級 A 班"
    assert data["program_level"] == "A1"
    assert data.get("teacher_id") is None or data.get("teacher_name") is None


def test_create_classroom_with_teacher_assignment(
    client, test_db, school_admin_teacher, school, link_teacher_to_school
):
    """Test: School admin can create classroom and assign teacher"""
    # Create another teacher to assign
    teacher = Teacher(
        email="teacher@test.com", name="Teacher", password_hash="hashed", is_active=True
    )
    test_db.add(teacher)
    test_db.commit()
    test_db.refresh(teacher)

    response = client.post(
        f"/api/schools/{school.id}/classrooms",
        json={
            "name": "一年級 B 班",
            "level": "A1",
            "grade": 1,
            "teacher_id": teacher.id,
        },
        headers={"Authorization": f"Bearer {get_test_token(school_admin_teacher.id)}"},
    )

    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "一年級 B 班"
    assert data["program_level"] == "A1"
    # Check that teacher is assigned (either by id or name)
    assert data.get("teacher_id") == teacher.id or data.get("teacher_name") == "Teacher"


def test_create_classroom_without_permission_fails(client, test_db, school):
    """Test: Regular teacher cannot create classroom in school"""
    teacher = Teacher(
        email="regular@test.com", name="Regular", password_hash="hashed", is_active=True
    )
    test_db.add(teacher)
    test_db.commit()
    test_db.refresh(teacher)

    response = client.post(
        f"/api/schools/{school.id}/classrooms",
        json={"name": "Unauthorized", "level": "A1", "grade": 1},
        headers={"Authorization": f"Bearer {get_test_token(teacher.id)}"},
    )

    assert response.status_code == 403


def test_assign_teacher_to_classroom(
    client, test_db, school_admin_teacher, school, link_teacher_to_school
):
    """Test: Assign teacher to existing classroom"""
    # Create classroom without teacher
    classroom = Classroom(name="Test Class", level=ProgramLevel.A1, is_active=True)
    test_db.add(classroom)
    test_db.flush()

    # Link to school
    link = ClassroomSchool(
        classroom_id=classroom.id, school_id=school.id, is_active=True
    )
    test_db.add(link)
    test_db.commit()
    test_db.refresh(classroom)

    # Create teacher to assign
    teacher = Teacher(
        email="new@test.com", name="New Teacher", password_hash="hashed", is_active=True
    )
    test_db.add(teacher)
    test_db.commit()
    test_db.refresh(teacher)

    response = client.put(
        f"/api/classrooms/{classroom.id}/teacher",
        json={"teacher_id": teacher.id},
        headers={"Authorization": f"Bearer {get_test_token(school_admin_teacher.id)}"},
    )

    assert response.status_code == 200
    data = response.json()
    assert (
        data.get("teacher_id") == teacher.id
        or data.get("teacher_name") == "New Teacher"
    )


def test_unassign_teacher_from_classroom(
    client, test_db, school_admin_teacher, school, link_teacher_to_school
):
    """Test: Unassign teacher (set to null)"""
    teacher = Teacher(
        email="assigned@test.com",
        name="Assigned",
        password_hash="hashed",
        is_active=True,
    )
    test_db.add(teacher)
    test_db.flush()

    classroom = Classroom(
        name="Test", level=ProgramLevel.A1, teacher_id=teacher.id, is_active=True
    )
    test_db.add(classroom)
    test_db.flush()

    link = ClassroomSchool(
        classroom_id=classroom.id, school_id=school.id, is_active=True
    )
    test_db.add(link)
    test_db.commit()
    test_db.refresh(classroom)

    response = client.put(
        f"/api/classrooms/{classroom.id}/teacher",
        json={"teacher_id": None},
        headers={"Authorization": f"Bearer {get_test_token(school_admin_teacher.id)}"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data.get("teacher_id") is None or data.get("teacher_name") is None


def test_update_classroom_details(
    client, test_db, school_admin_teacher, school, link_teacher_to_school
):
    """Test: Update classroom name, level, description"""
    classroom = Classroom(
        name="Old Name",
        description="Old description",
        level=ProgramLevel.A1,
        is_active=True,
    )
    test_db.add(classroom)
    test_db.flush()

    link = ClassroomSchool(
        classroom_id=classroom.id, school_id=school.id, is_active=True
    )
    test_db.add(link)
    test_db.commit()
    test_db.refresh(classroom)

    response = client.put(
        f"/api/classrooms/{classroom.id}",
        json={"name": "New Name", "description": "New description", "level": "A2"},
        headers={"Authorization": f"Bearer {get_test_token(school_admin_teacher.id)}"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "New Name"
    assert data["program_level"] == "A2"


def test_deactivate_classroom(
    client, test_db, school_admin_teacher, school, link_teacher_to_school
):
    """Test: Deactivate classroom"""
    classroom = Classroom(name="Active", level=ProgramLevel.A1, is_active=True)
    test_db.add(classroom)
    test_db.flush()

    link = ClassroomSchool(
        classroom_id=classroom.id, school_id=school.id, is_active=True
    )
    test_db.add(link)
    test_db.commit()
    test_db.refresh(classroom)

    response = client.put(
        f"/api/classrooms/{classroom.id}",
        json={"is_active": False},
        headers={"Authorization": f"Bearer {get_test_token(school_admin_teacher.id)}"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["is_active"] is False

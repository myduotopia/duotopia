"""End-to-end workflow test for school classroom management"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
import uuid

from main import app
from models import (
    Teacher,
    School,
    TeacherSchool,
    Organization,
    TeacherOrganization,
    ClassroomSchool,
)
from database import get_db
from auth import create_access_token


@pytest.fixture
def test_db(tmp_path):
    """Create test database"""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from database import Base

    db_path = tmp_path / "test_classroom_workflow.db"
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


def get_test_token(teacher_id: int) -> str:
    """Generate test JWT token"""
    return create_access_token({"sub": str(teacher_id), "type": "teacher"})


def test_complete_classroom_lifecycle(client, test_db):
    """
    Test complete classroom lifecycle:
    1. Create classroom without teacher
    2. Assign teacher
    3. Update details
    4. Reassign to different teacher
    5. Deactivate
    """
    # Setup: Create organization, school, and admin
    org_id = uuid.uuid4()
    org = Organization(id=org_id, name="Test Org", is_active=True)
    test_db.add(org)

    school_id = uuid.uuid4()
    school = School(
        id=school_id, organization_id=org_id, name="Test School", is_active=True
    )
    test_db.add(school)

    admin = Teacher(
        email="admin@test.com", name="Admin", password_hash="hashed", is_active=True
    )
    test_db.add(admin)
    test_db.flush()

    # Link admin to org and school
    org_link = TeacherOrganization(
        teacher_id=admin.id, organization_id=org_id, role="org_owner", is_active=True
    )
    school_link = TeacherSchool(
        teacher_id=admin.id, school_id=school_id, roles=["school_admin"], is_active=True
    )
    test_db.add_all([org_link, school_link])

    # Create teachers to assign
    teacher1 = Teacher(
        email="t1@test.com", name="Teacher 1", password_hash="hashed", is_active=True
    )
    teacher2 = Teacher(
        email="t2@test.com", name="Teacher 2", password_hash="hashed", is_active=True
    )
    test_db.add_all([teacher1, teacher2])
    test_db.commit()
    test_db.refresh(admin)
    test_db.refresh(teacher1)
    test_db.refresh(teacher2)

    token = get_test_token(admin.id)

    # Step 1: Create classroom without teacher
    response = client.post(
        f"/api/schools/{school_id}/classrooms",
        json={"name": "一年級 A 班", "level": "A1", "grade": 1},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201
    data = response.json()
    classroom_id = int(data["id"])

    # Step 2: Assign teacher1
    response = client.put(
        f"/api/classrooms/{classroom_id}/teacher",
        json={"teacher_id": teacher1.id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert (
        data.get("teacher_id") == teacher1.id or data.get("teacher_name") == "Teacher 1"
    )

    # Step 3: Update details
    response = client.put(
        f"/api/classrooms/{classroom_id}",
        json={"name": "一年級 A 班（進階）", "level": "A2"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "一年級 A 班（進階）"
    assert data["program_level"] == "A2"

    # Step 4: Reassign to teacher2
    response = client.put(
        f"/api/classrooms/{classroom_id}/teacher",
        json={"teacher_id": teacher2.id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert (
        data.get("teacher_id") == teacher2.id or data.get("teacher_name") == "Teacher 2"
    )

    # Step 5: Deactivate
    response = client.put(
        f"/api/classrooms/{classroom_id}",
        json={"is_active": False},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["is_active"] is False

    # Verify classroom not in active list
    response = client.get(
        f"/api/schools/{school_id}/classrooms",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    active_classrooms = response.json()
    # Convert classroom_id to string for comparison since API returns IDs as strings
    assert str(classroom_id) not in [c["id"] for c in active_classrooms]

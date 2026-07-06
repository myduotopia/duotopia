"""
Unit Tests for Program CRUD API Endpoints
測試 Program 的 Create, Read, Update, Delete API 端點

Issue #314: uses the shared conftest test_client/db_session fixtures instead of
a module-level TestClient + app.dependency_overrides. The old pattern set the
get_db override at import time; the conftest test_client fixture clears
app.dependency_overrides between tests, which wiped this file's override mid
run and made these tests hit the real DB in the full suite.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from auth import create_access_token
from models import Teacher, Classroom


@pytest.fixture
def auth_token(db_session: Session):
    """Seed a teacher + classroom and return a teacher access token.

    conftest cleans every table between tests, so the seeded rows get id=1
    (the ids the request bodies below reference).
    """
    teacher = Teacher(
        email="test@teacher.com",
        name="Test Teacher",
        password_hash="x",
        email_verified=True,
    )
    db_session.add(teacher)
    db_session.commit()

    classroom = Classroom(name="Test Classroom", teacher_id=teacher.id, grade="Grade 1")
    db_session.add(classroom)
    db_session.commit()

    return create_access_token({"sub": str(teacher.id), "type": "teacher"})


class TestProgramCRUD:
    """測試 Program CRUD API"""

    def test_create_program(self, test_client: TestClient, auth_token):
        """測試創建 Program (CREATE)"""
        response = test_client.post(
            "/api/teachers/programs",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Test Program",
                "description": "Test Description",
                "classroom_id": 1,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Test Program"
        assert data["description"] == "Test Description"
        assert "id" in data

    def test_read_program(self, test_client: TestClient, auth_token):
        """測試讀取 Program (READ)"""
        # 先創建一個 program
        create_response = test_client.post(
            "/api/teachers/programs",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Read Test Program",
                "description": "For reading",
                "classroom_id": 1,
            },
        )
        program_id = create_response.json()["id"]

        # 讀取 program
        response = test_client.get(
            f"/api/teachers/programs/{program_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == program_id
        assert data["name"] == "Read Test Program"

    def test_update_program(self, test_client: TestClient, auth_token):
        """測試更新 Program (UPDATE)"""
        # 先創建一個 program
        create_response = test_client.post(
            "/api/teachers/programs",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Original Name",
                "description": "Original",
                "classroom_id": 1,
            },
        )
        program_id = create_response.json()["id"]

        # 更新 program
        response = test_client.put(
            f"/api/teachers/programs/{program_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Updated Name",
                "description": "Updated Description",
                "estimated_hours": 20,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["description"] == "Updated Description"
        assert data["estimated_hours"] == 20

    def test_update_program_level_and_tags(self, test_client: TestClient, auth_token):
        """測試更新 Program 的 level 和 tags"""
        # 先創建一個 program
        create_response = test_client.post(
            "/api/teachers/programs",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Test Program",
                "description": "Test Description",
                "classroom_id": 1,
            },
        )
        program_id = create_response.json()["id"]

        # 更新 level 和 tags
        response = test_client.put(
            f"/api/teachers/programs/{program_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Updated Program",
                "description": "Updated Description",
                "level": "B1",
                "estimated_hours": 35,
                "tags": ["英語", "基礎"],
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Program"
        assert data["description"] == "Updated Description"
        assert data["level"] == "B1", f"Expected level='B1', got {data.get('level')}"
        assert data["estimated_hours"] == 35
        assert data["tags"] == ["英語", "基礎"]

    def test_delete_program(self, test_client: TestClient, auth_token):
        """測試刪除 Program (DELETE)"""
        # 先創建一個 program
        create_response = test_client.post(
            "/api/teachers/programs",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Delete Test",
                "description": "To be deleted",
                "classroom_id": 1,
            },
        )
        program_id = create_response.json()["id"]

        # 刪除 program
        response = test_client.delete(
            f"/api/teachers/programs/{program_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )

        assert response.status_code == 200

        # 驗證已刪除（應該 404）
        get_response = test_client.get(
            f"/api/teachers/programs/{program_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert get_response.status_code == 404

    def test_list_programs(self, test_client: TestClient, auth_token):
        """測試列出所有 Programs"""
        # 創建幾個 programs
        for i in range(3):
            test_client.post(
                "/api/teachers/programs",
                headers={"Authorization": f"Bearer {auth_token}"},
                json={
                    "name": f"Program {i}",
                    "description": f"Description {i}",
                    "classroom_id": 1,
                },
            )

        # 列出所有 programs
        response = test_client.get(
            "/api/teachers/programs",
            headers={"Authorization": f"Bearer {auth_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 3

    def test_unauthorized_access(self, test_client: TestClient):
        """測試未授權存取"""
        # 沒有 token
        response = test_client.get("/api/teachers/programs")
        assert response.status_code == 401

        # 錯誤的 token
        response = test_client.get(
            "/api/teachers/programs",
            headers={"Authorization": "Bearer invalid_token"},
        )
        assert response.status_code == 401

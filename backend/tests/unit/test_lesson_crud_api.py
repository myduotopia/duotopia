"""
Unit Tests for Lesson CRUD API Endpoints
測試 Lesson 的 Create, Read, Update, Delete API 端點

Issue #314: uses the shared conftest test_client/db_session fixtures instead of
a module-level TestClient + app.dependency_overrides (which got wiped by the
conftest fixture's override cleanup mid-suite).
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from auth import create_access_token
from models import Teacher, Program, Classroom


@pytest.fixture
def auth_token(db_session: Session):
    """Seed teacher + classroom + program (all id=1) and return a teacher token.

    conftest cleans every table between tests, so the seeded rows get id=1.
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

    program = Program(
        name="Test Program",
        description="Test Program Description",
        teacher_id=teacher.id,
        classroom_id=classroom.id,
    )
    db_session.add(program)
    db_session.commit()

    return create_access_token({"sub": str(teacher.id), "type": "teacher"})


class TestLessonCRUD:
    """測試 Lesson CRUD API"""

    def test_create_lesson(self, test_client: TestClient, auth_token):
        """測試創建 Lesson (CREATE)"""
        response = test_client.post(
            "/api/teachers/programs/1/lessons",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Test Lesson",
                "description": "Test Description",
                "order_index": 1,
                "estimated_minutes": 30,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Test Lesson"
        assert data["description"] == "Test Description"
        assert data["order_index"] == 1
        assert data["estimated_minutes"] == 30
        assert "id" in data

    def test_read_lesson(self, test_client: TestClient, auth_token):
        """測試讀取 Lesson (透過 Program) (READ)"""
        # 先創建一個 lesson
        create_response = test_client.post(
            "/api/teachers/programs/1/lessons",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Read Test Lesson",
                "description": "For reading",
                "order_index": 1,
                "estimated_minutes": 45,
            },
        )
        lesson_id = create_response.json()["id"]

        # 透過 GET program 讀取 lesson
        response = test_client.get(
            "/api/teachers/programs/1",
            headers={"Authorization": f"Bearer {auth_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert "lessons" in data
        # 找到剛創建的 lesson
        lesson = next(
            (
                lesson_item
                for lesson_item in data["lessons"]
                if lesson_item["id"] == lesson_id
            ),
            None,
        )
        assert lesson is not None
        assert lesson["name"] == "Read Test Lesson"

    def test_update_lesson(self, test_client: TestClient, auth_token):
        """測試更新 Lesson (UPDATE)"""
        # 先創建一個 lesson
        create_response = test_client.post(
            "/api/teachers/programs/1/lessons",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Original Lesson",
                "description": "Original",
                "order_index": 1,
                "estimated_minutes": 30,
            },
        )
        lesson_id = create_response.json()["id"]

        # 更新 lesson
        response = test_client.put(
            f"/api/teachers/lessons/{lesson_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Updated Lesson",
                "description": "Updated Description",
                "order_index": 2,
                "estimated_minutes": 60,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Lesson"
        assert data["description"] == "Updated Description"
        assert data["order_index"] == 2
        assert data["estimated_minutes"] == 60

    def test_delete_lesson(self, test_client: TestClient, auth_token):
        """測試刪除 Lesson (DELETE) - 軟刪除"""
        # 先創建一個 lesson
        create_response = test_client.post(
            "/api/teachers/programs/1/lessons",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Delete Test",
                "description": "To be deleted",
                "order_index": 1,
                "estimated_minutes": 30,
            },
        )
        lesson_id = create_response.json()["id"]

        # 刪除 lesson
        response = test_client.delete(
            f"/api/teachers/lessons/{lesson_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )

        assert response.status_code == 200

        # 驗證軟刪除：嘗試更新應該返回 404
        update_response = test_client.put(
            f"/api/teachers/lessons/{lesson_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Should Not Work",
                "description": "Should Not Work",
                "order_index": 1,
                "estimated_minutes": 30,
            },
        )
        assert update_response.status_code == 404

    def test_cannot_create_lesson_in_deleted_program(
        self, test_client: TestClient, db_session: Session, auth_token
    ):
        """測試無法在已刪除的 Program 中創建 Lesson"""
        # 創建一個新 program
        program = Program(
            name="To Delete Program",
            description="Will be deleted",
            teacher_id=1,
            classroom_id=1,
        )
        db_session.add(program)
        db_session.commit()
        program_id = program.id

        # 刪除 program
        test_client.delete(
            f"/api/teachers/programs/{program_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )

        # 嘗試在已刪除的 program 中創建 lesson
        response = test_client.post(
            f"/api/teachers/programs/{program_id}/lessons",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "name": "Should Not Work",
                "description": "Should Not Work",
                "order_index": 1,
                "estimated_minutes": 30,
            },
        )

        assert response.status_code == 404

    def test_unauthorized_access(self, test_client: TestClient):
        """測試未授權存取"""
        # 沒有 token
        response = test_client.post(
            "/api/teachers/programs/1/lessons",
            json={
                "name": "Test",
                "description": "Test",
                "order_index": 1,
                "estimated_minutes": 30,
            },
        )
        assert response.status_code == 401

        # 錯誤的 token
        response = test_client.put(
            "/api/teachers/lessons/1",
            headers={"Authorization": "Bearer invalid_token"},
            json={
                "name": "Test",
                "description": "Test",
                "order_index": 1,
                "estimated_minutes": 30,
            },
        )
        assert response.status_code == 401

"""
Tests for teacher password reset functionality
測試老師密碼重設功能
"""

import pytest
from models import Teacher
from auth import get_password_hash


class TestTeacherPasswordReset:
    """Test teacher password reset API endpoints"""

    @pytest.fixture
    def test_teacher(self, test_session):
        """Create a test teacher with unique email"""
        import uuid

        email = f"teacher_{uuid.uuid4().hex[:8]}@test.com"
        teacher = Teacher(
            email=email,
            name="Test Teacher",
            password_hash=get_password_hash("oldpassword123"),
            is_active=True,
            is_demo=False,
            is_admin=False,
        )
        test_session.add(teacher)
        test_session.commit()
        return teacher

    @pytest.fixture
    def teacher_token(self, test_client, test_teacher):
        """Get teacher auth token"""
        response = test_client.post(
            "/api/auth/teacher/login",
            json={"email": test_teacher.email, "password": "oldpassword123"},
        )
        assert response.status_code == 200
        data = response.json()
        return data["access_token"]

    def test_update_password_success(self, test_client, test_teacher, teacher_token):
        """Test successful password update"""
        response = test_client.put(
            "/api/teachers/me/password",
            headers={"Authorization": f"Bearer {teacher_token}"},
            json={
                "current_password": "oldpassword123",
                "new_password": "newpassword123",
            },
        )

        assert response.status_code == 200
        assert response.json()["message"] == "Password updated successfully"

    def test_update_password_wrong_current_password(self, test_client, teacher_token):
        """Test password update with wrong current password"""
        response = test_client.put(
            "/api/teachers/me/password",
            headers={"Authorization": f"Bearer {teacher_token}"},
            json={
                "current_password": "wrongpassword",
                "new_password": "newpassword123",
            },
        )

        assert response.status_code == 400
        assert "incorrect" in response.json()["detail"].lower()

    def test_update_password_too_short(self, test_client, teacher_token):
        """Test password update with too short new password"""
        response = test_client.put(
            "/api/teachers/me/password",
            headers={"Authorization": f"Bearer {teacher_token}"},
            json={"current_password": "oldpassword123", "new_password": "123"},
        )

        assert response.status_code == 400
        assert "at least 8 characters" in response.json()["detail"]

    def test_update_password_without_auth(self, test_client):
        """Test password update without authentication"""
        response = test_client.put(
            "/api/teachers/me/password",
            json={
                "current_password": "oldpassword123",
                "new_password": "newpassword123",
            },
        )

        assert response.status_code == 401


class TestTeacherProfileUpdate:
    """Test teacher profile update API endpoints"""

    @pytest.fixture
    def test_teacher(self, test_session):
        """Create a test teacher with unique email"""
        import uuid

        email = f"teacher_{uuid.uuid4().hex[:8]}@test.com"
        teacher = Teacher(
            email=email,
            name="Original Teacher",
            phone="1234567890",
            password_hash=get_password_hash("password123"),
            is_active=True,
            is_demo=False,
            is_admin=False,
        )
        test_session.add(teacher)
        test_session.commit()
        return teacher

    @pytest.fixture
    def teacher_token(self, test_client, test_teacher):
        """Get teacher auth token"""
        response = test_client.post(
            "/api/auth/teacher/login",
            json={"email": test_teacher.email, "password": "password123"},
        )
        assert response.status_code == 200
        return response.json()["access_token"]

    def test_update_profile_name(
        self, test_client, test_teacher, teacher_token, test_session
    ):
        """Test updating teacher name"""
        response = test_client.put(
            "/api/teachers/me",
            headers={"Authorization": f"Bearer {teacher_token}"},
            json={"name": "New Teacher Name"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "New Teacher Name"

        # Verify in database
        test_session.refresh(test_teacher)
        assert test_teacher.name == "New Teacher Name"

    def test_update_profile_phone(
        self, test_client, test_teacher, teacher_token, test_session
    ):
        """Test updating teacher phone"""
        response = test_client.put(
            "/api/teachers/me",
            headers={"Authorization": f"Bearer {teacher_token}"},
            json={"phone": "0987654321"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["phone"] == "0987654321"

        # Verify in database
        test_session.refresh(test_teacher)
        assert test_teacher.phone == "0987654321"

    def test_update_profile_name_and_phone(
        self, test_client, test_teacher, teacher_token, test_session
    ):
        """Test updating both name and phone"""
        response = test_client.put(
            "/api/teachers/me",
            headers={"Authorization": f"Bearer {teacher_token}"},
            json={"name": "Updated Name", "phone": "1111111111"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Name"
        assert data["phone"] == "1111111111"

        # Verify in database
        test_session.refresh(test_teacher)
        assert test_teacher.name == "Updated Name"
        assert test_teacher.phone == "1111111111"

    def test_update_profile_without_auth(self, test_client):
        """Test profile update without authentication"""
        response = test_client.put("/api/teachers/me", json={"name": "New Name"})

        assert response.status_code == 401

    def test_get_profile_returns_correct_data(
        self, test_client, test_teacher, teacher_token
    ):
        """Test that profile endpoint returns correct teacher data"""
        response = test_client.put(
            "/api/teachers/me",
            headers={"Authorization": f"Bearer {teacher_token}"},
            json={"name": "Updated Teacher"},
        )

        assert response.status_code == 200
        data = response.json()

        # Verify all expected fields are present
        assert "id" in data
        assert "name" in data
        assert "email" in data
        assert "phone" in data
        assert "is_active" in data
        assert "is_demo" in data
        assert "is_admin" in data
        assert data["name"] == "Updated Teacher"
        assert data["email"] == test_teacher.email
        assert data["is_active"] is True

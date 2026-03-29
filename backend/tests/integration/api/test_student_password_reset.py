"""
Tests for student password reset functionality
測試學生密碼重設功能
"""

import pytest
from datetime import date
from models import Student, Classroom, ClassroomStudent
from auth import get_password_hash


class TestStudentPasswordReset:
    """Test student password reset API endpoints"""

    @pytest.fixture
    def test_student(self, test_session):
        """Create a test student"""
        from models import Teacher

        # Create teacher first
        teacher = Teacher(
            email="test_teacher@test.com",
            name="Test Teacher",
            password_hash=get_password_hash("teacher123"),
            is_active=True,
        )
        test_session.add(teacher)
        test_session.commit()

        # Create classroom
        classroom = Classroom(
            name="Test Classroom",
            teacher_id=teacher.id,
            grade="Grade 5",
        )
        test_session.add(classroom)
        test_session.commit()

        # Create student
        # Initial password is birthdate (20100101)
        student = Student(
            email="student@test.com",
            name="Test Student",
            password_hash=get_password_hash("20100101"),
            student_number="S12345",
            birthdate=date(2010, 1, 1),
            email_verified=True,
            password_changed=False,
        )
        test_session.add(student)
        test_session.commit()

        # Assign to classroom
        classroom_student = ClassroomStudent(
            classroom_id=classroom.id, student_id=student.id
        )
        test_session.add(classroom_student)
        test_session.commit()

        return student

    @pytest.fixture
    def student_token(self, test_client, test_student):
        """Get student auth token using initial password (birthdate)"""
        response = test_client.post(
            "/api/students/validate",
            json={"email": "student@test.com", "password": "20100101"},
        )
        assert response.status_code == 200
        data = response.json()
        return data["access_token"]

    def test_update_password_success(
        self, test_client, test_student, student_token, test_session
    ):
        """Test successful password update and login with new password"""
        # Update password
        response = test_client.put(
            "/api/students/me/password",
            headers={"Authorization": f"Bearer {student_token}"},
            json={
                "current_password": "20100101",  # Initial password is birthdate
                "new_password": "newpassword123",
            },
        )

        assert response.status_code == 200
        assert response.json()["message"] == "Password updated successfully"

        # Verify password_changed flag is set
        test_session.refresh(test_student)
        assert test_student.password_changed is True

        # ✅ Verify can login with NEW password
        new_login = test_client.post(
            "/api/students/validate",
            json={"email": "student@test.com", "password": "newpassword123"},
        )
        assert new_login.status_code == 200
        assert "access_token" in new_login.json()

        # ❌ Verify CANNOT login with OLD password (actual birthdate)
        old_login = test_client.post(
            "/api/students/validate",
            json={"email": "student@test.com", "password": "20100101"},
        )
        assert old_login.status_code == 400
        assert "password" in old_login.json()["detail"].lower()

    def test_update_password_wrong_current_password(self, test_client, student_token):
        """Test password update with wrong current password"""
        response = test_client.put(
            "/api/students/me/password",
            headers={"Authorization": f"Bearer {student_token}"},
            json={
                "current_password": "wrongpassword",
                "new_password": "newpassword123",
            },
        )

        assert response.status_code == 400
        assert "incorrect" in response.json()["detail"].lower()

    def test_update_password_too_short(self, test_client, student_token):
        """Test password update with too short new password"""
        response = test_client.put(
            "/api/students/me/password",
            headers={"Authorization": f"Bearer {student_token}"},
            json={"current_password": "20100101", "new_password": "123"},
        )

        assert response.status_code == 400
        assert "at least 6 characters" in response.json()["detail"]

    def test_update_password_without_auth(self, test_client):
        """Test password update without authentication"""
        response = test_client.put(
            "/api/students/me/password",
            json={
                "current_password": "20100101",
                "new_password": "newpassword123",
            },
        )

        assert response.status_code == 401

    def test_update_password_marks_password_changed(
        self, test_client, test_student, student_token, test_session
    ):
        """Test that password update marks password_changed as True"""
        # Initial state
        assert test_student.password_changed is False

        # Update password
        response = test_client.put(
            "/api/students/me/password",
            headers={"Authorization": f"Bearer {student_token}"},
            json={
                "current_password": "20100101",  # Initial password is birthdate
                "new_password": "newpassword123",
            },
        )

        assert response.status_code == 200

        # Refresh student from DB
        test_session.refresh(test_student)
        assert test_student.password_changed is True

    def test_update_password_with_special_characters(self, test_client, student_token):
        """Test password update with special characters"""
        special_password = "P@ssw0rd!"

        response = test_client.put(
            "/api/students/me/password",
            headers={"Authorization": f"Bearer {student_token}"},
            json={
                "current_password": "20100101",  # Initial password is birthdate
                "new_password": special_password,
            },
        )

        assert response.status_code == 200
        assert response.json()["message"] == "Password updated successfully"

    def test_update_password_digits_only(self, test_client, student_token):
        """Test student can set a pure-digit password (min 6 chars) - Issue #454"""
        response = test_client.put(
            "/api/students/me/password",
            headers={"Authorization": f"Bearer {student_token}"},
            json={
                "current_password": "20100101",
                "new_password": "123456",
            },
        )

        assert response.status_code == 200
        assert response.json()["message"] == "Password updated successfully"


class TestStudentProfileUpdate:
    """Test student profile update API endpoints"""

    @pytest.fixture
    def test_student(self, test_session):
        """Create a test student"""
        from models import Teacher

        # Create teacher first
        teacher = Teacher(
            email="test_teacher2@test.com",
            name="Test Teacher 2",
            password_hash=get_password_hash("teacher123"),
            is_active=True,
        )
        test_session.add(teacher)
        test_session.commit()

        classroom = Classroom(
            name="Test Classroom", teacher_id=teacher.id, grade="Grade 5"
        )
        test_session.add(classroom)
        test_session.commit()

        student = Student(
            email="student@test.com",
            name="Original Name",
            password_hash=get_password_hash(
                "20100101"
            ),  # Initial password is birthdate
            student_number="S12345",
            birthdate=date(2010, 1, 1),
            email_verified=True,
        )
        test_session.add(student)
        test_session.commit()

        classroom_student = ClassroomStudent(
            classroom_id=classroom.id, student_id=student.id
        )
        test_session.add(classroom_student)
        test_session.commit()

        return student

    @pytest.fixture
    def student_token(self, test_client, test_student):
        """Get student auth token using initial password (birthdate)"""
        response = test_client.post(
            "/api/students/validate",
            json={"email": "student@test.com", "password": "20100101"},
        )
        assert response.status_code == 200
        return response.json()["access_token"]

    def test_update_profile_name(
        self, test_client, test_student, student_token, test_session
    ):
        """Test updating student name"""
        response = test_client.put(
            "/api/students/me",
            headers={"Authorization": f"Bearer {student_token}"},
            json={"name": "New Name"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "New Name"

        # Verify in database
        test_session.refresh(test_student)
        assert test_student.name == "New Name"

    def test_update_profile_without_auth(self, test_client):
        """Test profile update without authentication"""
        response = test_client.put("/api/students/me", json={"name": "New Name"})

        assert response.status_code == 401

    def test_get_profile_returns_correct_data(
        self, test_client, test_student, student_token
    ):
        """Test that profile endpoint returns correct student data"""
        response = test_client.put(
            "/api/students/me",
            headers={"Authorization": f"Bearer {student_token}"},
            json={"name": "Updated Name"},
        )

        assert response.status_code == 200
        data = response.json()

        # Verify all expected fields are present
        assert "id" in data
        assert "name" in data
        assert "email" in data
        assert "student_id" in data
        assert "classroom_id" in data
        assert "classroom_name" in data
        assert data["name"] == "Updated Name"
        assert data["email"] == "student@test.com"

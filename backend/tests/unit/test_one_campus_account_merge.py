"""
Tests for 1Campus SSO account merge with existing Duotopia email accounts.

Covers:
- Path A: Auto-merge when 1Campus account matches verified Duotopia email
- Aggregated classrooms via identity_id path
"""

import pytest
from models.user import Identity, Student, Teacher
from services.one_campus_account_service import OneCampusAccountService
from auth import get_password_hash


# ---------------------------------------------------------------------------
# Student: auto-merge by email (Step 2.5)
# ---------------------------------------------------------------------------


class TestStudentEmailAutoMerge:
    """find_or_create_student should merge when 1Campus account == existing verified email."""

    def test_auto_merge_when_email_matches(self, shared_test_session):
        """1Campus account matches an existing verified email → merge into that Identity."""
        db = shared_test_session

        # Pre-existing Duotopia Identity with verified email
        existing_identity = Identity(
            email="student@school.edu.tw",
            email_verified=True,
            is_active=True,
        )
        db.add(existing_identity)
        db.flush()

        existing_student = Student(
            name="Existing Student",
            email="student@school.edu.tw",
            password_hash=get_password_hash("pass123"),
            identity_id=existing_identity.id,
            is_primary_account=True,
            is_active=True,
            email_verified=True,
        )
        db.add(existing_student)
        db.commit()

        # 1Campus SSO login with same email as account
        identity, student, action = OneCampusAccountService.find_or_create_student(
            db,
            one_campus_student_id="SC001",
            one_campus_account="student@school.edu.tw",
            student_name="SSO Student",
            national_id_hash="abc123def456" * 4 + "abcd" * 4,  # 64 chars
        )

        assert action == "existing"
        assert identity.id == existing_identity.id
        assert student.id == existing_student.id
        # 1Campus fields written to existing Identity
        assert identity.one_campus_student_id == "SC001"
        assert identity.one_campus_account == "student@school.edu.tw"

    def test_no_merge_when_email_not_verified(self, shared_test_session):
        """Unverified email should NOT trigger auto-merge → create new."""
        db = shared_test_session

        unverified_identity = Identity(
            email="unverified@school.edu.tw",
            email_verified=False,
            is_active=True,
        )
        db.add(unverified_identity)
        db.flush()

        unverified_student = Student(
            name="Unverified Student",
            email="unverified@school.edu.tw",
            identity_id=unverified_identity.id,
            is_primary_account=True,
            is_active=True,
        )
        db.add(unverified_student)
        db.commit()

        identity, student, action = OneCampusAccountService.find_or_create_student(
            db,
            one_campus_student_id="SC002",
            one_campus_account="unverified@school.edu.tw",
            student_name="SSO Student 2",
        )

        assert action == "created"
        assert identity.id != unverified_identity.id

    def test_no_merge_when_email_differs(self, shared_test_session):
        """Different email → no merge, create new Identity."""
        db = shared_test_session

        existing_identity = Identity(
            email="other@school.edu.tw",
            email_verified=True,
            is_active=True,
        )
        db.add(existing_identity)
        db.commit()

        identity, student, action = OneCampusAccountService.find_or_create_student(
            db,
            one_campus_student_id="SC003",
            one_campus_account="different@1campus.net",
            student_name="SSO Student 3",
        )

        assert action == "created"
        assert identity.id != existing_identity.id

    def test_national_id_merge_prompt_takes_priority(self, shared_test_session):
        """national_id_hash match (Step 2) should take priority over email match (Step 2.5)."""
        db = shared_test_session

        # Identity with national_id_hash AND email
        existing_identity = Identity(
            email="priority@school.edu.tw",
            email_verified=True,
            one_campus_student_id="SC_OLD",
            national_id_hash="a" * 64,
            is_active=True,
        )
        db.add(existing_identity)
        db.flush()

        existing_student = Student(
            name="Priority Student",
            identity_id=existing_identity.id,
            is_primary_account=True,
            is_active=True,
        )
        db.add(existing_student)
        db.commit()

        # New SSO login with same national_id_hash but different 1campus_student_id
        identity, student, action = OneCampusAccountService.find_or_create_student(
            db,
            one_campus_student_id="SC_NEW",
            one_campus_account="priority@school.edu.tw",
            student_name="New SSO",
            national_id_hash="a" * 64,
        )

        # Should hit Step 2 (merge_prompt) before Step 2.5
        assert action == "merge_prompt"


# ---------------------------------------------------------------------------
# Teacher: auto-merge by email (Step 2.5)
# ---------------------------------------------------------------------------


class TestTeacherEmailAutoMerge:
    """find_or_create_teacher should merge when 1Campus account == existing verified email."""

    def test_auto_merge_teacher_by_email(self, shared_test_session):
        """Teacher 1Campus account matches verified email → merge."""
        db = shared_test_session

        existing_identity = Identity(
            email="teacher@school.edu.tw",
            email_verified=True,
            is_active=True,
        )
        db.add(existing_identity)
        db.flush()

        existing_teacher = Teacher(
            name="Existing Teacher",
            email="teacher@school.edu.tw",
            password_hash=get_password_hash("pass123"),
            identity_id=existing_identity.id,
            is_active=True,
        )
        db.add(existing_teacher)
        db.commit()

        identity, teacher, action = OneCampusAccountService.find_or_create_teacher(
            db,
            one_campus_account="teacher@school.edu.tw",
            teacher_name="SSO Teacher",
            national_id_hash="b" * 64,
        )

        assert action == "existing"
        assert identity.id == existing_identity.id
        assert teacher.id == existing_teacher.id
        assert identity.one_campus_account == "teacher@school.edu.tw"
        assert identity.national_id_hash == "b" * 64

    def test_no_merge_teacher_unverified(self, shared_test_session):
        """Unverified teacher email → create new."""
        db = shared_test_session

        unverified = Identity(
            email="unteacher@school.edu.tw",
            email_verified=False,
            is_active=True,
        )
        db.add(unverified)
        db.flush()

        unverified_teacher = Teacher(
            name="Unverified Teacher",
            email="unteacher@school.edu.tw",
            identity_id=unverified.id,
            is_active=True,
        )
        db.add(unverified_teacher)
        db.commit()

        identity, teacher, action = OneCampusAccountService.find_or_create_teacher(
            db,
            one_campus_account="unteacher@school.edu.tw",
            teacher_name="SSO Teacher 2",
        )

        assert action == "created"
        assert identity.id != unverified.id


# ---------------------------------------------------------------------------
# Aggregated classrooms via identity_id
# ---------------------------------------------------------------------------


class TestAggregatedClassroomsIdentityPath:
    """_get_aggregated_classrooms should aggregate by identity_id."""

    def test_identity_siblings_aggregated(self, shared_test_session):
        """Students under the same Identity should have their classrooms aggregated."""
        from routers.students.auth import _get_aggregated_classrooms
        from models import Classroom, ClassroomStudent, Teacher as TeacherModel

        db = shared_test_session

        # Create a teacher for classrooms
        teacher = TeacherModel(
            name="CR Teacher",
            email="crteacher@test.com",
            password_hash="x",
            is_active=True,
        )
        db.add(teacher)
        db.flush()

        # Shared Identity (no email, SSO-only — like 1Campus)
        shared_identity = Identity(
            email_verified=False,
            is_active=True,
        )
        db.add(shared_identity)
        db.flush()

        # Student A in Classroom 1
        student_a = Student(
            name="Student A",
            identity_id=shared_identity.id,
            is_primary_account=True,
            is_active=True,
        )
        db.add(student_a)
        db.flush()

        cr1 = Classroom(name="Classroom 1", teacher_id=teacher.id)
        db.add(cr1)
        db.flush()
        db.add(
            ClassroomStudent(
                classroom_id=cr1.id, student_id=student_a.id, is_active=True
            )
        )

        # Student B (sibling) in Classroom 2
        student_b = Student(
            name="Student B",
            identity_id=shared_identity.id,
            is_active=True,
        )
        db.add(student_b)
        db.flush()

        cr2 = Classroom(name="Classroom 2", teacher_id=teacher.id)
        db.add(cr2)
        db.flush()
        db.add(
            ClassroomStudent(
                classroom_id=cr2.id, student_id=student_b.id, is_active=True
            )
        )

        db.commit()

        # Aggregate from Student A should include both classrooms
        result = _get_aggregated_classrooms(db, student_a)
        classroom_names = {r["name"] for r in result}
        assert "Classroom 1" in classroom_names
        assert "Classroom 2" in classroom_names

    def test_no_duplicate_when_identity_and_email_overlap(self, shared_test_session):
        """If sibling is found by both identity_id and email, classrooms should not duplicate."""
        from routers.students.auth import _get_aggregated_classrooms
        from models import Classroom, ClassroomStudent, Teacher as TeacherModel

        db = shared_test_session

        teacher = TeacherModel(
            name="Dup Teacher",
            email="dupteacher@test.com",
            password_hash="x",
            is_active=True,
        )
        db.add(teacher)
        db.flush()

        shared_identity = Identity(
            email="shared@test.com",
            email_verified=True,
            is_active=True,
        )
        db.add(shared_identity)
        db.flush()

        student_a = Student(
            name="Dup A",
            email="shared@test.com",
            email_verified=True,
            identity_id=shared_identity.id,
            is_primary_account=True,
            is_active=True,
        )
        db.add(student_a)
        db.flush()

        student_b = Student(
            name="Dup B",
            email="shared@test.com",
            email_verified=True,
            identity_id=shared_identity.id,
            is_active=True,
        )
        db.add(student_b)
        db.flush()

        cr = Classroom(name="Shared CR", teacher_id=teacher.id)
        db.add(cr)
        db.flush()
        db.add(
            ClassroomStudent(
                classroom_id=cr.id, student_id=student_b.id, is_active=True
            )
        )
        db.commit()

        result = _get_aggregated_classrooms(db, student_a)
        # Student B's classroom should appear exactly once (via identity path),
        # not duplicated via email path
        cr_names = [r["name"] for r in result]
        assert cr_names.count("Shared CR") == 1

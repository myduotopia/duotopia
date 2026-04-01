"""
Tests for 1Campus SSO manual account binding (Path B).

Covers:
- Teacher creation with real email (not placeholder)
- bind_1campus_identity_to_email: merge into existing email Identity
- bind_1campus_identity_to_email: set email on SSO-only Identity
- Password merge between Identities
- Student/Teacher binding with deactivation of old Identity
"""

import pytest
from models.user import Identity, Student, Teacher
from services.identity_service import identity_service
from services.one_campus_account_service import OneCampusAccountService
from auth import get_password_hash


# ---------------------------------------------------------------------------
# Part 0: Teacher creation uses real email
# ---------------------------------------------------------------------------


class TestTeacherCreationRealEmail:
    """find_or_create_teacher Step 3 should use real 1Campus account as email."""

    def test_teacher_created_with_real_email(self, shared_test_session):
        """New teacher should have the real 1Campus email, not a placeholder."""
        db = shared_test_session

        identity, teacher, action = OneCampusAccountService.find_or_create_teacher(
            db,
            one_campus_account="dev.teacher01@1campus.net",
            teacher_name="Teacher One",
        )

        assert action == "created"
        assert teacher.email == "dev.teacher01@1campus.net"
        assert identity.email == "dev.teacher01@1campus.net"
        assert identity.one_campus_account == "dev.teacher01@1campus.net"
        # Should NOT be a placeholder
        assert "sso.duotopia.com" not in teacher.email

    def test_teacher_identity_has_real_email(self, shared_test_session):
        """The Identity created for teacher should also have the real email."""
        db = shared_test_session

        identity, teacher, action = OneCampusAccountService.find_or_create_teacher(
            db,
            one_campus_account="real.teacher@school.edu.tw",
            teacher_name="Real Teacher",
            national_id_hash="c" * 64,
        )

        assert action == "created"
        assert identity.email == "real.teacher@school.edu.tw"
        assert identity.national_id_hash == "c" * 64


# ---------------------------------------------------------------------------
# Part 1: bind_1campus_identity_to_email — Student
# ---------------------------------------------------------------------------


class TestBindStudentToEmail:
    """Test binding a 1Campus SSO student Identity to an email-based Identity."""

    def test_bind_merge_into_existing_email_identity(self, shared_test_session):
        """SSO Identity should merge into existing email Identity, deactivating SSO Identity."""
        db = shared_test_session

        # Existing Duotopia Identity with verified email
        email_identity = Identity(
            email="existing@duotopia.com",
            email_verified=True,
            password_hash=get_password_hash("existing_pass"),
            password_changed=True,
            is_active=True,
        )
        db.add(email_identity)
        db.flush()

        email_student = Student(
            name="Existing Student",
            email="existing@duotopia.com",
            password_hash=get_password_hash("existing_pass"),
            identity_id=email_identity.id,
            is_primary_account=True,
            is_active=True,
            email_verified=True,
        )
        db.add(email_student)
        db.flush()

        # SSO-only Identity (no email)
        sso_identity = Identity(
            one_campus_student_id="SC_BIND_01",
            one_campus_account="sso_student@1campus.net",
            national_id_hash="d" * 64,
            email_verified=False,
            is_active=True,
        )
        db.add(sso_identity)
        db.flush()

        sso_student = Student(
            name="SSO Student",
            identity_id=sso_identity.id,
            is_primary_account=True,
            is_active=True,
        )
        db.add(sso_student)
        db.commit()

        # Perform bind
        result = identity_service.bind_1campus_identity_to_email(
            db, sso_identity, "existing@duotopia.com", user_type="student"
        )
        db.commit()

        # Should merge into the email Identity
        assert result.id == email_identity.id
        assert result.one_campus_student_id == "SC_BIND_01"
        assert result.one_campus_account == "sso_student@1campus.net"
        assert result.national_id_hash == "d" * 64

        # SSO Identity should be deactivated
        db.refresh(sso_identity)
        assert sso_identity.is_active is False

        # SSO student should now be linked to email Identity
        db.refresh(sso_student)
        assert sso_student.identity_id == email_identity.id

    def test_bind_set_email_on_sso_identity(self, shared_test_session):
        """If no existing email Identity, set email directly on SSO Identity."""
        db = shared_test_session

        sso_identity = Identity(
            one_campus_student_id="SC_BIND_02",
            one_campus_account="solo@1campus.net",
            email_verified=False,
            is_active=True,
        )
        db.add(sso_identity)
        db.flush()

        sso_student = Student(
            name="Solo SSO Student",
            identity_id=sso_identity.id,
            is_primary_account=True,
            is_active=True,
        )
        db.add(sso_student)
        db.commit()

        # Bind to a new email (no existing Identity with this email)
        result = identity_service.bind_1campus_identity_to_email(
            db, sso_identity, "newemail@duotopia.com", user_type="student"
        )
        db.commit()

        # Should set email on the SSO Identity itself
        assert result.id == sso_identity.id
        assert result.email == "newemail@duotopia.com"
        assert result.one_campus_student_id == "SC_BIND_02"
        assert sso_identity.is_active is True

    def test_bind_password_merge_sso_has_custom(self, shared_test_session):
        """If SSO Identity has custom password and email Identity doesn't, adopt SSO's."""
        db = shared_test_session

        email_identity = Identity(
            email="nopass@duotopia.com",
            email_verified=True,
            password_hash=get_password_hash("default"),
            password_changed=False,
            is_active=True,
        )
        db.add(email_identity)
        db.flush()

        email_student = Student(
            name="NoPass Student",
            email="nopass@duotopia.com",
            identity_id=email_identity.id,
            is_primary_account=True,
            is_active=True,
        )
        db.add(email_student)

        sso_identity = Identity(
            one_campus_student_id="SC_BIND_03",
            one_campus_account="custompass@1campus.net",
            password_hash=get_password_hash("custom_pass"),
            password_changed=True,
            email_verified=False,
            is_active=True,
        )
        db.add(sso_identity)
        db.flush()

        sso_student = Student(
            name="CustomPass SSO",
            identity_id=sso_identity.id,
            is_primary_account=True,
            is_active=True,
        )
        db.add(sso_student)
        db.commit()

        result = identity_service.bind_1campus_identity_to_email(
            db, sso_identity, "nopass@duotopia.com", user_type="student"
        )
        db.commit()

        # Email Identity should now have the custom password
        db.refresh(email_identity)
        assert email_identity.password_changed is True

    def test_bind_primary_account_not_overridden(self, shared_test_session):
        """When merging, existing primary student should keep primary status."""
        db = shared_test_session

        email_identity = Identity(
            email="primary@duotopia.com",
            email_verified=True,
            is_active=True,
        )
        db.add(email_identity)
        db.flush()

        primary_student = Student(
            name="Primary",
            email="primary@duotopia.com",
            identity_id=email_identity.id,
            is_primary_account=True,
            is_active=True,
        )
        db.add(primary_student)

        sso_identity = Identity(
            one_campus_student_id="SC_BIND_04",
            one_campus_account="incoming@1campus.net",
            email_verified=False,
            is_active=True,
        )
        db.add(sso_identity)
        db.flush()

        incoming_student = Student(
            name="Incoming",
            identity_id=sso_identity.id,
            is_primary_account=True,
            is_active=True,
        )
        db.add(incoming_student)
        db.commit()

        identity_service.bind_1campus_identity_to_email(
            db, sso_identity, "primary@duotopia.com", user_type="student"
        )
        db.commit()

        db.refresh(primary_student)
        db.refresh(incoming_student)
        assert primary_student.is_primary_account is True
        assert incoming_student.is_primary_account is False


# ---------------------------------------------------------------------------
# Part 2: bind_1campus_identity_to_email — Teacher
# ---------------------------------------------------------------------------


class TestBindTeacherToEmail:
    """Test binding a 1Campus SSO teacher Identity to an email-based Identity."""

    def test_bind_teacher_merge_into_existing(self, shared_test_session):
        """Teacher SSO Identity should merge into existing email Identity."""
        db = shared_test_session

        email_identity = Identity(
            email="existingteacher@duotopia.com",
            email_verified=True,
            is_active=True,
        )
        db.add(email_identity)
        db.flush()

        email_teacher = Teacher(
            name="Existing Teacher",
            email="existingteacher@duotopia.com",
            password_hash=get_password_hash("pass"),
            identity_id=email_identity.id,
            is_active=True,
        )
        db.add(email_teacher)

        sso_identity = Identity(
            one_campus_account="sso.teacher@1campus.net",
            national_id_hash="e" * 64,
            email="sso.teacher@1campus.net",
            email_verified=False,
            is_active=True,
        )
        db.add(sso_identity)
        db.flush()

        sso_teacher = Teacher(
            name="SSO Teacher",
            email="sso.teacher@1campus.net",
            password_hash=None,
            identity_id=sso_identity.id,
            is_active=True,
        )
        db.add(sso_teacher)
        db.commit()

        result = identity_service.bind_1campus_identity_to_email(
            db, sso_identity, "existingteacher@duotopia.com", user_type="teacher"
        )
        db.commit()

        assert result.id == email_identity.id
        assert result.one_campus_account == "sso.teacher@1campus.net"
        assert result.national_id_hash == "e" * 64

        # SSO teacher should be moved to email Identity
        # Email stays as original because existing teacher already has target email
        db.refresh(sso_teacher)
        assert sso_teacher.identity_id == email_identity.id
        assert sso_teacher.email == "sso.teacher@1campus.net"

        # SSO Identity deactivated
        db.refresh(sso_identity)
        assert sso_identity.is_active is False

"""Integration tests for Issue #648 — case-insensitive email lookup across auth paths.

Covers teacher login / register / forgot-password / resend-verification, the
Identity-based student login path, and the 1Campus SSO bind collision check.
Each test stores an account with one casing and hits the endpoint with a
different casing; the endpoint must still resolve to the same account.

Rate-limit note: the login endpoint is throttled to 3/minute per IP. Tests use
different endpoints per test method and keep login attempts minimal to avoid
cross-test interference.

Scope note: direct `Student.email` queries (authenticate_student and
student_forgot_password) intentionally remain case-sensitive until the
follow-up issue lands (data cleanup + ix_students_email_lower migration).
"""
from datetime import date

from fastapi import status
from sqlalchemy import func

from auth import get_password_hash
from models import Student, Teacher
from models.user import Identity


PASSWORD = "Password1!"


class TestTeacherLoginCaseInsensitive:
    def test_login_with_uppercase_variant_resolves_to_lowercase_account(
        self, test_client, shared_test_session
    ):
        teacher = Teacher(
            email="kelly@example.com",
            password_hash=get_password_hash(PASSWORD),
            name="Kelly",
            is_active=True,
            email_verified=True,
        )
        shared_test_session.add(teacher)
        shared_test_session.commit()

        response = test_client.post(
            "/api/auth/teacher/login",
            json={"email": "KELLY@example.com", "password": PASSWORD},
        )

        assert response.status_code == status.HTTP_200_OK, response.text
        body = response.json()
        assert body.get("access_token"), "login must return an access token"
        assert body["user"]["email"] == "kelly@example.com", (
            "login with uppercase variant must resolve to the lowercase-stored "
            "account"
        )


class TestTeacherRegisterCaseInsensitive:
    def test_register_rejects_case_variant_of_verified_email(
        self, test_client, shared_test_session
    ):
        existing = Teacher(
            email="alice@example.com",
            password_hash=get_password_hash(PASSWORD),
            name="Alice",
            is_active=True,
            email_verified=True,
        )
        shared_test_session.add(existing)
        shared_test_session.commit()

        response = test_client.post(
            "/api/auth/teacher/register",
            json={
                "email": "ALICE@example.com",
                "password": PASSWORD,
                "name": "Alice Dup",
            },
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "already registered" in response.json()["detail"].lower()

    def test_register_replaces_unverified_case_variant(
        self, test_client, shared_test_session
    ):
        existing = Teacher(
            email="bob@example.com",
            password_hash=get_password_hash(PASSWORD),
            name="Bob",
            is_active=False,
            email_verified=False,
        )
        shared_test_session.add(existing)
        shared_test_session.commit()

        response = test_client.post(
            "/api/auth/teacher/register",
            json={
                "email": "Bob@Example.com",
                "password": PASSWORD,
                "name": "Bob Fresh",
            },
        )

        assert response.status_code == status.HTTP_200_OK, response.text
        shared_test_session.expire_all()
        # The original unverified "Bob" row must be gone; the only remaining
        # teacher matching the case-variant email should be the new "Bob Fresh".
        remaining = (
            shared_test_session.query(Teacher)
            .filter(Teacher.name.in_(["Bob", "Bob Fresh"]))
            .all()
        )
        assert len(remaining) == 1, (
            f"Exactly one teacher row should remain after case-variant "
            f"re-registration, got {[(t.name, t.email) for t in remaining]}"
        )
        assert remaining[0].name == "Bob Fresh"


class TestResendVerificationCaseInsensitive:
    def test_resend_verification_finds_case_variant_teacher(
        self, test_client, shared_test_session
    ):
        teacher = Teacher(
            email="dan@example.com",
            password_hash=get_password_hash(PASSWORD),
            name="Dan",
            is_active=False,
            email_verified=False,
        )
        shared_test_session.add(teacher)
        shared_test_session.commit()

        response = test_client.post(
            "/api/auth/resend-verification",
            json={"email": "DAN@example.com"},
        )

        # Legitimate outcomes once the teacher is located: 200 (email sent) or
        # 429 (resend cooldown). 404 means the case-variant lookup failed, which
        # is the regression this test guards against.
        assert response.status_code in (
            status.HTTP_200_OK,
            status.HTTP_429_TOO_MANY_REQUESTS,
        ), response.text


class TestForgotPasswordCaseInsensitive:
    def test_teacher_forgot_password_accepts_case_variant(
        self, test_client, shared_test_session
    ):
        teacher = Teacher(
            email="carol@example.com",
            password_hash=get_password_hash(PASSWORD),
            name="Carol",
            is_active=True,
            email_verified=True,
        )
        shared_test_session.add(teacher)
        shared_test_session.commit()

        response = test_client.post(
            "/api/auth/teacher/forgot-password",
            json={"email": "CAROL@example.com"},
        )

        assert response.status_code == status.HTTP_200_OK
        shared_test_session.refresh(teacher)
        assert (
            teacher.password_reset_token is not None
        ), "forgot-password must locate the teacher regardless of email casing"


class TestStudentIdentityValidateCaseInsensitive:
    def test_validate_finds_identity_regardless_of_casing(
        self, test_client, shared_test_session
    ):
        identity = Identity(
            email="learner@example.com",
            password_hash=get_password_hash(PASSWORD),
            email_verified=True,
            is_active=True,
        )
        shared_test_session.add(identity)
        shared_test_session.flush()

        student = Student(
            email="learner@example.com",
            password_hash=get_password_hash(PASSWORD),
            name="Learner",
            birthdate=date(2010, 1, 1),
            email_verified=True,
            is_active=True,
            identity_id=identity.id,
            is_primary_account=True,
        )
        shared_test_session.add(student)
        shared_test_session.commit()

        response = test_client.post(
            "/api/students/validate",
            json={"email": "LEARNER@example.com", "password": PASSWORD},
        )

        assert response.status_code != status.HTTP_401_UNAUTHORIZED, response.text


class TestOneCampusBindCaseInsensitive:
    """The 1Campus bind code checks whether a different Teacher already has the
    target email (so we don't violate the unique constraint). That check must
    also be case-insensitive — otherwise we could still collide on insert.

    Here we verify the underlying query pattern directly rather than driving
    the full SSO flow (which requires multiple upstream mocks).
    """

    def test_teacher_email_collision_check_is_case_insensitive(
        self, shared_test_session
    ):
        existing = Teacher(
            email="sso.user@example.com",
            password_hash=get_password_hash(PASSWORD),
            name="SSO User",
            is_active=True,
            email_verified=True,
        )
        shared_test_session.add(existing)
        shared_test_session.commit()

        target_email = "SSO.User@example.com"
        collision = (
            shared_test_session.query(Teacher)
            .filter(
                func.lower(Teacher.email) == target_email.lower(),
                Teacher.id != 0,
                Teacher.is_active.is_(True),
            )
            .first()
        )
        assert collision is not None, (
            "Case-insensitive collision check must find the existing teacher; "
            "otherwise 1Campus bind would create a duplicate row."
        )

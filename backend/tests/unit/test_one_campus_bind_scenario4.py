"""
Tests for /bind-account Scenario 4:
When target email exists but email_verified=False → reject with structured error.

These tests call the router function directly (not via TestClient) to avoid
Casbin permission system startup issues in the unit test environment.

Covers:
- 400 with code=TARGET_EMAIL_NOT_VERIFIED when target Identity is unverified
- Existing behavior preserved for verified target Identity
- Existing behavior preserved when target email not in system
"""

import pytest
from fastapi import HTTPException

from models.user import Identity, Student, Teacher
from auth import get_password_hash


async def _call_bind_account(db, current_user: dict, email: str):
    """Call bind_account router function directly, bypassing HTTP layer."""
    from routers.auth_one_campus import bind_account, BindAccountRequest

    class MockRequest:
        pass

    req_body = BindAccountRequest(email=email)
    return await bind_account(
        request=MockRequest(),
        body=req_body,
        db=db,
        current_user=current_user,
    )


class TestBindAccountScenario4:
    """Scenario 4: target email exists but email_verified=False → 400 with structured error."""

    def test_student_bind_to_unverified_target_returns_400_with_code(
        self, shared_test_session
    ):
        """Student bind-account: target email has unverified Identity → HTTPException 400."""
        import asyncio
        db = shared_test_session

        # 1Campus SSO student identity (already logged in via OAuth)
        sso_identity = Identity(
            email="sc4_sso_student1@1campus.net",
            email_verified=True,
            one_campus_account="sc4_sso_student1@1campus.net",
            one_campus_uuid="sc4-uuid-sso-st1",
            is_active=True,
        )
        db.add(sso_identity)
        db.flush()

        sso_student = Student(
            name="SC4 SSO Student 1",
            identity_id=sso_identity.id,
            is_active=True,
            is_primary_account=True,
        )
        db.add(sso_student)
        db.flush()

        # Target: existing Duotopia account with UNVERIFIED email
        target_identity = Identity(
            email="sc4_target_unverified1@school.edu.tw",
            email_verified=False,
            is_active=True,
        )
        db.add(target_identity)
        db.flush()

        target_student = Student(
            name="SC4 Target Unverified Student",
            email="sc4_target_unverified1@school.edu.tw",
            identity_id=target_identity.id,
            is_active=True,
        )
        db.add(target_student)
        db.commit()

        current_user = {"sub": str(sso_student.id), "type": "student"}

        with pytest.raises(HTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(
                _call_bind_account(
                    db=db,
                    current_user=current_user,
                    email="sc4_target_unverified1@school.edu.tw",
                )
            )

        assert exc_info.value.status_code == 400
        detail = exc_info.value.detail
        if isinstance(detail, dict):
            assert detail.get("code") == "TARGET_EMAIL_NOT_VERIFIED"
            assert detail.get("target_email") == "sc4_target_unverified1@school.edu.tw"
        else:
            assert "TARGET_EMAIL_NOT_VERIFIED" in str(detail)

    def test_teacher_bind_to_unverified_target_returns_400_with_code(
        self, shared_test_session
    ):
        """Teacher bind-account: target email has unverified Identity → HTTPException 400."""
        import asyncio
        db = shared_test_session

        sso_identity = Identity(
            email="sc4_sso_teacher1@1campus.net",
            email_verified=True,
            one_campus_account="sc4_sso_teacher1@1campus.net",
            one_campus_uuid="sc4-uuid-sso-tc1",
            is_active=True,
        )
        db.add(sso_identity)
        db.flush()

        sso_teacher = Teacher(
            name="SC4 SSO Teacher 1",
            email="sc4_sso_teacher1@1campus.net",
            identity_id=sso_identity.id,
            is_active=True,
        )
        db.add(sso_teacher)
        db.flush()

        target_identity = Identity(
            email="sc4_target_unverified_tc1@school.edu.tw",
            email_verified=False,
            is_active=True,
        )
        db.add(target_identity)
        db.commit()

        current_user = {"sub": str(sso_teacher.id), "type": "teacher"}

        with pytest.raises(HTTPException) as exc_info:
            asyncio.get_event_loop().run_until_complete(
                _call_bind_account(
                    db=db,
                    current_user=current_user,
                    email="sc4_target_unverified_tc1@school.edu.tw",
                )
            )

        assert exc_info.value.status_code == 400
        detail = exc_info.value.detail
        if isinstance(detail, dict):
            assert detail.get("code") == "TARGET_EMAIL_NOT_VERIFIED"
        else:
            assert "TARGET_EMAIL_NOT_VERIFIED" in str(detail)

    def test_bind_to_verified_target_does_not_raise_scenario4_error(
        self, shared_test_session
    ):
        """Bind to verified target Identity → does NOT raise scenario 4 error.

        The scenario 4 check happens before any email service call, so we can
        verify it doesn't trigger even if later steps may fail for other reasons.
        """
        import asyncio
        from sqlalchemy.exc import IntegrityError as SQLAIntegrityError
        db = shared_test_session

        sso_identity = Identity(
            email="sc4_sso_student2@1campus.net",
            email_verified=True,
            one_campus_account="sc4_sso_student2@1campus.net",
            one_campus_uuid="sc4-uuid-sso-st2",
            is_active=True,
        )
        db.add(sso_identity)
        db.flush()

        sso_student = Student(
            name="SC4 SSO Student 2",
            identity_id=sso_identity.id,
            is_active=True,
            is_primary_account=True,
        )
        db.add(sso_student)
        db.flush()

        # Target: VERIFIED Identity with a DIFFERENT email than the sso_identity
        target_identity = Identity(
            email="sc4_target_verified2@school.edu.tw",
            email_verified=True,
            is_active=True,
        )
        db.add(target_identity)
        db.flush()

        target_student = Student(
            name="SC4 Target Verified Student",
            email="sc4_target_verified2@school.edu.tw",
            email_verified=True,
            identity_id=target_identity.id,
            is_active=True,
        )
        db.add(target_student)
        db.commit()

        current_user = {"sub": str(sso_student.id), "type": "student"}

        # Should NOT raise the scenario 4 error.
        # Any other exception (DB constraint, email service) is acceptable;
        # we only care that scenario 4 is not what's raised.
        raised_scenario4 = False
        try:
            asyncio.get_event_loop().run_until_complete(
                _call_bind_account(
                    db=db,
                    current_user=current_user,
                    email="sc4_target_verified2@school.edu.tw",
                )
            )
        except HTTPException as e:
            detail = e.detail
            if isinstance(detail, dict) and detail.get("code") == "TARGET_EMAIL_NOT_VERIFIED":
                raised_scenario4 = True
        except Exception:
            # Other failures (DB errors, email service mock missing, etc.) are OK
            pass

        assert not raised_scenario4, "Should NOT raise TARGET_EMAIL_NOT_VERIFIED for verified target"

    def test_bind_to_nonexistent_email_does_not_raise_scenario4_error(
        self, shared_test_session
    ):
        """Bind to email not in system → not rejected by scenario 4 check."""
        import asyncio
        db = shared_test_session

        sso_identity = Identity(
            email="sc4_sso_student3@1campus.net",
            email_verified=True,
            one_campus_account="sc4_sso_student3@1campus.net",
            one_campus_uuid="sc4-uuid-sso-st3",
            is_active=True,
        )
        db.add(sso_identity)
        db.flush()

        sso_student = Student(
            name="SC4 SSO Student 3",
            identity_id=sso_identity.id,
            is_active=True,
            is_primary_account=True,
        )
        db.add(sso_student)
        db.commit()

        current_user = {"sub": str(sso_student.id), "type": "student"}

        try:
            asyncio.get_event_loop().run_until_complete(
                _call_bind_account(
                    db=db,
                    current_user=current_user,
                    email="sc4_totally_new_email@nowhere.com",
                )
            )
        except HTTPException as e:
            if isinstance(e.detail, dict):
                assert e.detail.get("code") != "TARGET_EMAIL_NOT_VERIFIED"
            else:
                assert "TARGET_EMAIL_NOT_VERIFIED" not in str(e.detail)

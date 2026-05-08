"""
Tests for Flow 2: A triggers 1Campus OAuth merge from settings.

These tests call router/service functions directly to avoid Casbin startup issues.

Covers:
- login-url-for-merge requires auth, returns URL with merge state
- _handle_oauth_merge_flow: uuid matches B → B merged into A, returns A's token
- _handle_oauth_merge_flow: A.email_verified=False → HTTPException 400
- _handle_oauth_merge_flow: uuid not in system → pure bind (writes fields to A)
- _handle_oauth_merge_flow: uuid == A's identity → no-op (already bound)
"""

import pytest
import time
import base64
import json
import hmac
import hashlib
from datetime import timedelta, datetime, timezone
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException

from models.user import Identity, Student, Teacher
from auth import create_access_token


def _make_merge_state_token(identity_id: int, user_type: str) -> str:
    """Create a valid OAuth merge state token using same logic as router."""
    from core.config import settings

    payload_dict = {
        "nonce": "testmerge",
        "merge_for_identity_id": identity_id,
        "merge_for_user_type": user_type,
        "exp": int(time.time()) + 600,
    }
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload_dict).encode()).decode()
    sig = hmac.HMAC(
        settings.JWT_SECRET.encode(), payload_b64.encode(), hashlib.sha256
    ).hexdigest()
    return f"{payload_b64}.{sig}"


async def _call_login_url_for_merge(db, current_user: dict):
    """Call login_url_for_merge router function directly."""
    from routers.auth_one_campus import get_login_url_for_merge

    class MockRequest:
        pass

    return await get_login_url_for_merge(
        request=MockRequest(),
        db=db,
        current_user=current_user,
    )


async def _call_handle_oauth_merge_flow(db, code: str, merge_state_token: str):
    """Call _handle_oauth_merge_flow through the callback handler."""
    from routers.auth_one_campus import _handle_oauth_merge_flow_from_state

    class MockRequest:
        pass

    return await _handle_oauth_merge_flow_from_state(
        request=MockRequest(),
        code=code,
        merge_state=merge_state_token,
        db=db,
    )


class TestLoginUrlForMerge:
    """GET /api/auth/1campus/login-url-for-merge"""

    def test_teacher_gets_url_with_merge_state(self, shared_test_session):
        """Authenticated teacher → returns url containing merge state."""
        import asyncio

        db = shared_test_session

        identity = Identity(
            email="mergeurl_teacher@test.com",
            email_verified=True,
            is_active=True,
        )
        db.add(identity)
        db.flush()

        teacher = Teacher(
            name="Merge URL Teacher",
            email="mergeurl_teacher@test.com",
            identity_id=identity.id,
            is_active=True,
        )
        db.add(teacher)
        db.commit()

        current_user = {"sub": str(teacher.id), "type": "teacher"}

        with patch(
            "services.one_campus_service.OneCampusService.get_oauth_authorize_url",
            return_value="https://auth.ischool.com.tw/oauth?state=MERGE_STATE",
        ):
            result = asyncio.get_event_loop().run_until_complete(
                _call_login_url_for_merge(db=db, current_user=current_user)
            )

        assert "url" in result
        assert "https://" in result["url"]

    def test_student_gets_url_with_merge_state(self, shared_test_session):
        """Authenticated student → returns url."""
        import asyncio

        db = shared_test_session

        identity = Identity(
            email="mergeurl_student@test.com",
            email_verified=True,
            is_active=True,
        )
        db.add(identity)
        db.flush()

        student = Student(
            name="Merge URL Student",
            email="mergeurl_student@test.com",
            identity_id=identity.id,
            is_active=True,
        )
        db.add(student)
        db.commit()

        current_user = {"sub": str(student.id), "type": "student"}

        with patch(
            "services.one_campus_service.OneCampusService.get_oauth_authorize_url",
            return_value="https://auth.ischool.com.tw/oauth?state=MERGE_STATE_S",
        ):
            result = asyncio.get_event_loop().run_until_complete(
                _call_login_url_for_merge(db=db, current_user=current_user)
            )

        assert "url" in result


class TestCallbackWithMergeState:
    """OAuth callback with merge state token triggers merge flow."""

    def test_uuid_matches_b_marks_b_merged_into_a(self, shared_test_session):
        """UUID matches B → B merged into A, returns A's token."""
        import asyncio

        db = shared_test_session

        # Target identity A (email-logged-in user requesting merge)
        identity_a = Identity(
            email="mf_target_a@test.com",
            email_verified=True,
            is_active=True,
        )
        db.add(identity_a)
        db.flush()

        teacher_a = Teacher(
            name="MF Teacher A",
            email="mf_target_a@test.com",
            identity_id=identity_a.id,
            is_active=True,
        )
        db.add(teacher_a)
        db.flush()

        # Source identity B (1Campus SSO account, found by uuid)
        identity_b = Identity(
            email="mf_source_b@1campus.net",
            one_campus_uuid="mf-uuid-source-b",
            one_campus_account="mf_source_b@1campus.net",
            email_verified=True,
            is_active=True,
        )
        db.add(identity_b)
        db.flush()

        teacher_b = Teacher(
            name="MF Teacher B",
            email="mf_source_b@1campus.net",
            identity_id=identity_b.id,
            is_active=True,
        )
        db.add(teacher_b)
        db.commit()

        merge_state = _make_merge_state_token(identity_a.id, "teacher")

        mock_token = {"access_token": "1campus_token_xyz"}
        mock_user_info = {
            "uuid": "mf-uuid-source-b",
            "firstName": "B",
            "lastName": "Teacher",
            "mail": "mf_source_b@1campus.net",
        }

        with patch(
            "services.one_campus_service.OneCampusService.exchange_oauth_code",
            new=AsyncMock(return_value=mock_token),
        ), patch(
            "services.one_campus_service.OneCampusService.get_oauth_user_info",
            new=AsyncMock(return_value=mock_user_info),
        ), patch(
            "services.one_campus_service.OneCampusService.get_user_role",
            new=AsyncMock(return_value={"school": []}),
        ):
            result = asyncio.get_event_loop().run_until_complete(
                _call_handle_oauth_merge_flow(
                    db=db, code="test_code", merge_state_token=merge_state
                )
            )

        # Should return access_token for target user A
        assert result.access_token is not None

        db.refresh(identity_b)
        # B should be marked as merged into A
        assert identity_b.merged_into_identity_id == identity_a.id
        assert identity_b.merged_at is not None
        assert identity_b.is_active is False

    def test_target_unverified_raises_400(self, shared_test_session):
        """If A.email_verified=False → HTTPException 400."""
        import asyncio

        db = shared_test_session

        identity_a_unverified = Identity(
            email="mf_unverified_a@test.com",
            email_verified=False,
            is_active=True,
        )
        db.add(identity_a_unverified)
        db.flush()

        teacher_a = Teacher(
            name="MF Unverified A",
            email="mf_unverified_a@test.com",
            identity_id=identity_a_unverified.id,
            is_active=True,
        )
        db.add(teacher_a)
        db.commit()

        merge_state = _make_merge_state_token(identity_a_unverified.id, "teacher")

        mock_token = {"access_token": "1campus_token_xyz"}
        mock_user_info = {
            "uuid": "mf-uuid-unverified-test",
            "firstName": "X",
            "lastName": "Y",
            "mail": "mf_x@1campus.net",
        }

        with patch(
            "services.one_campus_service.OneCampusService.exchange_oauth_code",
            new=AsyncMock(return_value=mock_token),
        ), patch(
            "services.one_campus_service.OneCampusService.get_oauth_user_info",
            new=AsyncMock(return_value=mock_user_info),
        ), patch(
            "services.one_campus_service.OneCampusService.get_user_role",
            new=AsyncMock(return_value={"school": []}),
        ):
            with pytest.raises(HTTPException) as exc_info:
                asyncio.get_event_loop().run_until_complete(
                    _call_handle_oauth_merge_flow(
                        db=db, code="test_code", merge_state_token=merge_state
                    )
                )

        assert exc_info.value.status_code == 400

    def test_uuid_not_in_system_pure_bind(self, shared_test_session):
        """UUID not in system → pure bind: write 1Campus fields to target (A)."""
        import asyncio

        db = shared_test_session

        identity_a = Identity(
            email="mf_purebind_a@test.com",
            email_verified=True,
            is_active=True,
        )
        db.add(identity_a)
        db.flush()

        teacher_a = Teacher(
            name="MF Pure Bind Teacher",
            email="mf_purebind_a@test.com",
            identity_id=identity_a.id,
            is_active=True,
        )
        db.add(teacher_a)
        db.commit()

        merge_state = _make_merge_state_token(identity_a.id, "teacher")

        mock_token = {"access_token": "1campus_token_xyz"}
        mock_user_info = {
            "uuid": "mf-uuid-brand-new-never-seen",
            "firstName": "New",
            "lastName": "User",
            "mail": "mf_newuser@1campus.net",
        }

        with patch(
            "services.one_campus_service.OneCampusService.exchange_oauth_code",
            new=AsyncMock(return_value=mock_token),
        ), patch(
            "services.one_campus_service.OneCampusService.get_oauth_user_info",
            new=AsyncMock(return_value=mock_user_info),
        ), patch(
            "services.one_campus_service.OneCampusService.get_user_role",
            new=AsyncMock(return_value={"school": []}),
        ):
            result = asyncio.get_event_loop().run_until_complete(
                _call_handle_oauth_merge_flow(
                    db=db, code="test_code", merge_state_token=merge_state
                )
            )

        assert result.access_token is not None

        db.refresh(identity_a)
        # 1Campus fields written to A
        assert identity_a.one_campus_uuid == "mf-uuid-brand-new-never-seen"

    def test_uuid_matches_target_noop(self, shared_test_session):
        """UUID == A's identity → no-op (already bound), returns A's token."""
        import asyncio

        db = shared_test_session

        identity_a = Identity(
            email="mf_already_bound@test.com",
            email_verified=True,
            one_campus_uuid="mf-uuid-already-bound",
            one_campus_account="mf_already_bound@1campus.net",
            is_active=True,
        )
        db.add(identity_a)
        db.flush()

        teacher_a = Teacher(
            name="MF Already Bound Teacher",
            email="mf_already_bound@test.com",
            identity_id=identity_a.id,
            is_active=True,
        )
        db.add(teacher_a)
        db.commit()

        merge_state = _make_merge_state_token(identity_a.id, "teacher")

        mock_token = {"access_token": "1campus_token_xyz"}
        mock_user_info = {
            "uuid": "mf-uuid-already-bound",
            "firstName": "Already",
            "lastName": "Bound",
            "mail": "mf_already_bound@1campus.net",
        }

        with patch(
            "services.one_campus_service.OneCampusService.exchange_oauth_code",
            new=AsyncMock(return_value=mock_token),
        ), patch(
            "services.one_campus_service.OneCampusService.get_oauth_user_info",
            new=AsyncMock(return_value=mock_user_info),
        ), patch(
            "services.one_campus_service.OneCampusService.get_user_role",
            new=AsyncMock(return_value={"school": []}),
        ):
            result = asyncio.get_event_loop().run_until_complete(
                _call_handle_oauth_merge_flow(
                    db=db, code="test_code", merge_state_token=merge_state
                )
            )

        assert result.access_token is not None

        # A should still be active and not marked as merged
        db.refresh(identity_a)
        assert identity_a.is_active is True
        assert identity_a.merged_into_identity_id is None

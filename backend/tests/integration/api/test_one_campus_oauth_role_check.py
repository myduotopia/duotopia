"""Tests for the OAuth callback's role-determination guard (#635 follow-up).

When 1Campus `getUserRole` returns no school with `teacherRole` or
`studentRole`, the previous behaviour silently created a teacher account
and routed the user to the teacher dashboard — which broke students whose
schools hadn't authorised the jasmine scope.

The new behaviour:
- Existing users (matched by uuid or verified email) still log in cleanly
  using their on-file role.
- Brand-new logins with no detectable role get HTTP 400 instead of being
  silently created as teachers.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from models.user import Identity, Teacher


@pytest.fixture(autouse=True)
def _bypass_casbin_init():
    """Skip Casbin role sync (needs a real Postgres) for these tests."""
    fake = MagicMock()
    fake.sync_from_database = MagicMock(return_value=None)
    with patch("services.casbin_service.get_casbin_service", return_value=fake):
        yield


def _patch_oauth_token_and_user_info(role_payload):
    """Patch the 1Campus OAuth token + user info + getUserRole calls."""
    return (
        patch(
            "services.one_campus_service.OneCampusService.exchange_oauth_code",
            new_callable=AsyncMock,
            return_value={"access_token": "test-token"},
        ),
        patch(
            "services.one_campus_service.OneCampusService.get_oauth_user_info",
            new_callable=AsyncMock,
            return_value={
                "uuid": "test-uuid-123",
                "firstName": "Test",
                "lastName": "User",
                "mail": "newuser@example.school",
            },
        ),
        patch(
            "services.one_campus_service.OneCampusService.get_user_role",
            new_callable=AsyncMock,
            return_value=role_payload,
        ),
    )


def _valid_oauth_state(role_hint: str = None) -> str:
    """Build a valid OAuth state token (mirrors auth_one_campus._create_oauth_state)."""
    import base64
    import hashlib
    import hmac
    import json
    import secrets
    import time

    from core.config import settings

    secret = settings.JWT_SECRET.encode()
    payload = {
        "nonce": secrets.token_urlsafe(16),
        "exp": int(time.time()) + 600,
    }
    if role_hint in ("teacher", "student"):
        payload["role"] = role_hint
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    sig = hmac.HMAC(secret, payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


class TestRoleDeterminationGuard:
    def test_400_when_role_undetermined_and_user_is_new(
        self, test_client, shared_test_session
    ):
        """Brand-new login with no teacherRole or studentRole → 400."""
        # No matching Identity in DB; getUserRole returns empty schools.
        p_token, p_info, p_role = _patch_oauth_token_and_user_info({"school": []})
        with p_token, p_info, p_role:
            resp = test_client.get(
                "/api/auth/1campus/callback",
                params={"code": "test-code", "state": _valid_oauth_state()},
            )

        assert resp.status_code == 400, resp.text
        body = resp.json()
        assert "couldn't determine" in body["detail"].lower()

    def test_role_hint_used_when_getuserrole_fails_for_new_student(
        self, test_client, shared_test_session
    ):
        """No matching Identity, getUserRole empty, but role_hint=student → 200 student."""
        p_token, p_info, p_role = _patch_oauth_token_and_user_info({"school": []})
        with p_token, p_info, p_role:
            resp = test_client.get(
                "/api/auth/1campus/callback",
                params={
                    "code": "test-code",
                    "state": _valid_oauth_state(role_hint="student"),
                },
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["role_type"] == "student"
        assert body["student"]["email"] is None or body["student"]["email"].endswith(
            "@example.school"
        )

    def test_role_hint_used_when_getuserrole_fails_for_new_teacher(
        self, test_client, shared_test_session
    ):
        """No matching Identity, getUserRole empty, but role_hint=teacher → 200 teacher."""
        p_token, p_info, p_role = _patch_oauth_token_and_user_info({"school": []})
        with p_token, p_info, p_role:
            resp = test_client.get(
                "/api/auth/1campus/callback",
                params={
                    "code": "test-code",
                    "state": _valid_oauth_state(role_hint="teacher"),
                },
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["role_type"] == "teacher"

    def test_existing_user_can_login_even_without_role(
        self, test_client, shared_test_session
    ):
        """Returning user matched by uuid → log in with on-file role, no 400."""
        # Pre-seed an existing teacher with this uuid.
        identity = Identity(
            one_campus_uuid="test-uuid-123",
            email="newuser@example.school",
            email_verified=True,
            is_active=True,
        )
        shared_test_session.add(identity)
        shared_test_session.flush()
        teacher = Teacher(
            name="Existing Teacher",
            email="newuser@example.school",
            password_hash=None,
            has_password=False,
            identity_id=identity.id,
            is_active=True,
        )
        shared_test_session.add(teacher)
        shared_test_session.commit()

        # getUserRole returns no role — but we should still log them in.
        p_token, p_info, p_role = _patch_oauth_token_and_user_info({"school": []})
        with p_token, p_info, p_role:
            resp = test_client.get(
                "/api/auth/1campus/callback",
                params={"code": "test-code", "state": _valid_oauth_state()},
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["role_type"] == "teacher"
        assert body["user"]["email"] == "newuser@example.school"

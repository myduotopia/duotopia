"""HTTP-level tests for the 1Campus manual sync endpoint.

Covers:
- POST /api/teachers/me/sync-1campus-classes
    - 403 when teacher has no Identity / no one_campus_account
    - 200 returns SyncResult counts when teacher has 1Campus identity
    - empty schools when getUserRole returns no teacherRole
    - per-school errors are surfaced in the response
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from auth import create_access_token
from models.user import Identity, Teacher
from services.one_campus_class_sync_service import SyncResult


# The FastAPI app's startup event syncs Casbin roles from a real Postgres
# database. These tests don't exercise authorization, so bypass that init —
# otherwise TestClient's startup phase fails when no PG is available.
@pytest.fixture(autouse=True)
def _bypass_casbin_init():
    fake_service = MagicMock()
    fake_service.sync_from_database = MagicMock(return_value=None)
    with patch("services.casbin_service.get_casbin_service", return_value=fake_service):
        yield


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _make_teacher(db, *, with_one_campus=True) -> Teacher:
    if with_one_campus:
        identity = Identity(
            one_campus_account="t@school.example",
            email_verified=False,
            is_active=True,
        )
        db.add(identity)
        db.flush()
        identity_id = identity.id
    else:
        identity_id = None

    teacher = Teacher(
        name="Sync Tester",
        email="sync-tester@duotopia.com",
        password_hash=None,
        has_password=False,
        identity_id=identity_id,
        is_active=True,
    )
    db.add(teacher)
    db.commit()
    db.refresh(teacher)
    return teacher


def _auth_headers(teacher: Teacher) -> dict:
    token = create_access_token(
        data={"sub": str(teacher.id), "type": "teacher", "email": teacher.email}
    )
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Manual sync endpoint (teacher-facing)
# ---------------------------------------------------------------------------


class TestManualSyncEndpoint:
    def test_403_when_teacher_has_no_identity(self, test_client, shared_test_session):
        teacher = _make_teacher(shared_test_session, with_one_campus=False)
        resp = test_client.post(
            "/api/teachers/me/sync-1campus-classes",
            headers=_auth_headers(teacher),
        )
        assert resp.status_code == 403
        assert "1Campus" in resp.json()["detail"]

    def test_runs_sync_for_each_teacher_school_and_returns_aggregated_counts(
        self, test_client, shared_test_session
    ):
        teacher = _make_teacher(shared_test_session, with_one_campus=True)

        get_user_role_payload = {
            "school": [
                {"schoolDsns": "school.a", "teacherRole": {"teacherName": "T"}},
                {"schoolDsns": "school.b", "teacherRole": {"teacherName": "T"}},
                {"schoolDsns": "school.c", "studentRole": {"studentID": "X"}},
            ]
        }

        async def _fake_sync(db, school_dsns, teacher_id):
            # Each per-school result contributes; the endpoint sums them.
            return SyncResult(classrooms_added=1, students_added=3)

        with patch(
            "routers.teachers.one_campus_ops.OneCampusService.get_user_role",
            new_callable=AsyncMock,
            return_value=get_user_role_payload,
        ), patch(
            "routers.teachers.one_campus_ops.OneCampusClassSyncService.sync_school",
            side_effect=_fake_sync,
        ) as mock_sync:
            resp = test_client.post(
                "/api/teachers/me/sync-1campus-classes",
                headers=_auth_headers(teacher),
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["synced"] is True
        assert sorted(body["schools"]) == ["school.a", "school.b"]
        # Aggregated counts across the 2 teacher schools.
        assert body["classrooms_added"] == 2
        assert body["students_added"] == 6
        assert body["errors"] == []
        assert mock_sync.call_count == 2

    def test_returns_empty_when_no_teacher_role(self, test_client, shared_test_session):
        teacher = _make_teacher(shared_test_session, with_one_campus=True)

        with patch(
            "routers.teachers.one_campus_ops.OneCampusService.get_user_role",
            new_callable=AsyncMock,
            return_value={"school": [{"schoolDsns": "x", "studentRole": {}}]},
        ), patch(
            "routers.teachers.one_campus_ops.OneCampusClassSyncService.sync_school",
        ) as mock_sync:
            resp = test_client.post(
                "/api/teachers/me/sync-1campus-classes",
                headers=_auth_headers(teacher),
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["synced"] is False
        assert body["schools"] == []
        assert body["classrooms_added"] == 0
        assert body["students_added"] == 0
        mock_sync.assert_not_called()

    def test_per_school_errors_surface_in_response(
        self, test_client, shared_test_session
    ):
        teacher = _make_teacher(shared_test_session, with_one_campus=True)

        get_user_role_payload = {
            "school": [
                {"schoolDsns": "school.a", "teacherRole": {"teacherName": "T"}},
                {"schoolDsns": "school.b", "teacherRole": {"teacherName": "T"}},
            ]
        }

        async def _fake_sync(db, school_dsns, teacher_id):
            if school_dsns == "school.b":
                return SyncResult(errors=["upstream timeout"])
            return SyncResult(classrooms_added=1)

        with patch(
            "routers.teachers.one_campus_ops.OneCampusService.get_user_role",
            new_callable=AsyncMock,
            return_value=get_user_role_payload,
        ), patch(
            "routers.teachers.one_campus_ops.OneCampusClassSyncService.sync_school",
            side_effect=_fake_sync,
        ):
            resp = test_client.post(
                "/api/teachers/me/sync-1campus-classes",
                headers=_auth_headers(teacher),
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["synced"] is True
        assert body["classrooms_added"] == 1
        assert any("upstream timeout" in e for e in body["errors"])

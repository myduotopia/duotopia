"""HTTP-level tests for the 1Campus sync endpoints.

Covers:
- POST /api/teachers/me/sync-1campus-classes
    - 403 when teacher has no Identity / no one_campus_account
    - 200 (enqueued=True) when teacher has 1Campus identity
    - empty schools when getUserRole returns no teacherRole
- POST /api/internal/tasks/sync-1campus-class
    - 403 when X-Cloud-Tasks-Secret missing or wrong
    - 200 when secret matches; result body is the SyncResult dict
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from auth import create_access_token
from models.user import Identity, Teacher


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

    def test_enqueues_for_each_teacher_school(self, test_client, shared_test_session):
        teacher = _make_teacher(shared_test_session, with_one_campus=True)

        get_user_role_payload = {
            "school": [
                {"schoolDsns": "school.a", "teacherRole": {"teacherName": "T"}},
                {"schoolDsns": "school.b", "teacherRole": {"teacherName": "T"}},
                {"schoolDsns": "school.c", "studentRole": {"studentID": "X"}},
            ]
        }

        with patch(
            "routers.teachers.one_campus_ops.OneCampusService.get_user_role",
            new_callable=AsyncMock,
            return_value=get_user_role_payload,
        ), patch(
            "routers.teachers.one_campus_ops.enqueue_one_campus_class_sync",
            new_callable=AsyncMock,
            return_value="task-name",
        ) as mock_enqueue:
            resp = test_client.post(
                "/api/teachers/me/sync-1campus-classes",
                headers=_auth_headers(teacher),
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["enqueued"] is True
        assert sorted(body["schools"]) == ["school.a", "school.b"]
        assert mock_enqueue.await_count == 2

    def test_returns_empty_when_no_teacher_role(self, test_client, shared_test_session):
        teacher = _make_teacher(shared_test_session, with_one_campus=True)

        with patch(
            "routers.teachers.one_campus_ops.OneCampusService.get_user_role",
            new_callable=AsyncMock,
            return_value={"school": [{"schoolDsns": "x", "studentRole": {}}]},
        ), patch(
            "routers.teachers.one_campus_ops.enqueue_one_campus_class_sync",
            new_callable=AsyncMock,
        ) as mock_enqueue:
            resp = test_client.post(
                "/api/teachers/me/sync-1campus-classes",
                headers=_auth_headers(teacher),
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["enqueued"] is False
        assert body["schools"] == []
        mock_enqueue.assert_not_called()


# ---------------------------------------------------------------------------
# Internal worker endpoint (Cloud Tasks-facing)
# ---------------------------------------------------------------------------


class TestInternalWorkerEndpoint:
    def test_403_when_secret_missing(self, test_client):
        resp = test_client.post(
            "/api/internal/tasks/sync-1campus-class",
            json={"school_dsns": "x.school", "teacher_id": 1},
        )
        assert resp.status_code == 403

    def test_403_when_secret_wrong(self, test_client):
        with patch(
            "services.cloud_tasks_service.settings.CLOUD_TASKS_INVOKER_SECRET",
            "expected-secret",
        ):
            resp = test_client.post(
                "/api/internal/tasks/sync-1campus-class",
                headers={"X-Cloud-Tasks-Secret": "wrong-secret"},
                json={"school_dsns": "x.school", "teacher_id": 1},
            )
        assert resp.status_code == 403

    def test_200_runs_sync_when_secret_matches(self, test_client, shared_test_session):
        teacher = _make_teacher(shared_test_session, with_one_campus=True)

        from services.one_campus_class_sync_service import SyncResult

        async def _fake_sync(db, school_dsns, teacher_id):
            return SyncResult(classrooms_added=2, students_added=5)

        with patch(
            "services.cloud_tasks_service.settings.CLOUD_TASKS_INVOKER_SECRET",
            "shh",
        ), patch(
            "routers.internal_tasks.OneCampusClassSyncService.sync_school",
            side_effect=_fake_sync,
        ):
            resp = test_client.post(
                "/api/internal/tasks/sync-1campus-class",
                headers={"X-Cloud-Tasks-Secret": "shh"},
                json={"school_dsns": "x.school", "teacher_id": teacher.id},
            )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["classrooms_added"] == 2
        assert body["students_added"] == 5

    def test_test_no_dependency_loop(self):
        # Sanity test: importing the router module shouldn't error.
        from routers import internal_tasks  # noqa: F401

        assert hasattr(internal_tasks, "router")

"""
Unit tests for the demo access window (#989).

The public demo page must honour the schedule the demo teacher set when
dispatching: before `start_date` it is not open yet, after `due_date` it has
expired. Assignments with neither date stay open forever — every demo
assignment in production currently relies on that, so it is covered here as a
regression guard.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from auth import get_password_hash
from models import (
    Assignment,
    AssignmentContent,
    Classroom,
    Content,
    ContentItem,
    ContentType,
    Lesson,
    Program,
    Teacher,
)
from routers.demo import DEMO_TEACHER_EMAIL
from services.demo_access import (
    DEMO_ACCESS_ACTIVE,
    DEMO_ACCESS_EXPIRED,
    DEMO_ACCESS_NOT_STARTED,
    get_demo_access_status,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def demo_teacher(shared_test_session):
    teacher = Teacher(
        email=DEMO_TEACHER_EMAIL,
        password_hash=get_password_hash("pw"),
        name="Duotopia Demo",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(teacher)
    shared_test_session.commit()
    shared_test_session.refresh(teacher)
    return teacher


@pytest.fixture
def other_teacher(shared_test_session):
    teacher = Teacher(
        email="not-demo@test.com",
        password_hash=get_password_hash("pw"),
        name="Regular Teacher",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(teacher)
    shared_test_session.commit()
    shared_test_session.refresh(teacher)
    return teacher


def _make_demo_assignment(session, teacher, **overrides):
    """Create a demo-teacher assignment with one content + items."""
    classroom = Classroom(name="Demo Class", teacher_id=teacher.id)
    session.add(classroom)
    session.flush()

    program = Program(name="Demo Program", teacher_id=teacher.id, is_template=True)
    session.add(program)
    session.flush()

    lesson = Lesson(program_id=program.id, name="L1")
    session.add(lesson)
    session.flush()

    assignment = Assignment(
        title="Demo Assignment",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        practice_mode="reading_assessment",
        **overrides,
    )
    session.add(assignment)
    session.flush()

    content = Content(
        lesson_id=lesson.id,
        program_id=program.id,
        type=ContentType.READING_ASSESSMENT,
        title="Content 1",
        target_wpm=100,
        target_accuracy=80,
    )
    session.add(content)
    session.flush()

    session.add(
        ContentItem(
            content_id=content.id, text="hello", translation="哈囉", order_index=0
        )
    )
    session.add(
        AssignmentContent(
            assignment_id=assignment.id, content_id=content.id, order_index=0
        )
    )
    session.commit()
    session.refresh(assignment)
    return assignment


class _FakeAssignment:
    """Bare carrier for pure status tests (no DB round-trip needed)."""

    def __init__(self, start_date=None, due_date=None):
        self.start_date = start_date
        self.due_date = due_date


# ---------------------------------------------------------------------------
# get_demo_access_status
# ---------------------------------------------------------------------------


class TestGetDemoAccessStatus:
    def test_no_dates_is_active(self):
        assert get_demo_access_status(_FakeAssignment()) == DEMO_ACCESS_ACTIVE

    def test_future_start_is_not_started(self):
        start = datetime.now(timezone.utc) + timedelta(days=1)
        assert (
            get_demo_access_status(_FakeAssignment(start_date=start))
            == DEMO_ACCESS_NOT_STARTED
        )

    def test_past_due_is_expired(self):
        due = datetime.now(timezone.utc) - timedelta(days=1)
        assert (
            get_demo_access_status(_FakeAssignment(due_date=due)) == DEMO_ACCESS_EXPIRED
        )

    def test_within_window_is_active(self):
        now = datetime.now(timezone.utc)
        assignment = _FakeAssignment(
            start_date=now - timedelta(days=1), due_date=now + timedelta(days=1)
        )
        assert get_demo_access_status(assignment) == DEMO_ACCESS_ACTIVE

    def test_just_before_due_is_active(self):
        """A visitor arriving a hair before the deadline is still let in."""
        due = datetime.now(timezone.utc) + timedelta(milliseconds=500)
        assert (
            get_demo_access_status(_FakeAssignment(due_date=due)) == DEMO_ACCESS_ACTIVE
        )

    def test_due_boundary_is_inclusive(self):
        """`now == due_date` is still active — the comparison is `>`, not `>=`.

        Freezing the clock is the only way to hit the equality case; a test that
        merely puts `due` slightly in the future exercises the ordinary
        within-window path instead (that is `test_just_before_due_is_active`).
        """
        frozen = datetime(2026, 8, 12, 12, 0, 0, tzinfo=timezone.utc)

        class _FrozenDatetime(datetime):
            @classmethod
            def now(cls, tz=None):
                return frozen if tz else frozen.replace(tzinfo=None)

        with patch("services.demo_access.datetime", _FrozenDatetime):
            assert (
                get_demo_access_status(_FakeAssignment(due_date=frozen))
                == DEMO_ACCESS_ACTIVE
            )
            # One microsecond past the deadline flips it, proving the boundary
            # above is the inclusive edge rather than a gap in the comparison.
            assert (
                get_demo_access_status(
                    _FakeAssignment(due_date=frozen - timedelta(microseconds=1))
                )
                == DEMO_ACCESS_EXPIRED
            )

    def test_naive_datetimes_do_not_raise(self):
        """SQLite hands back naive datetimes; they must be treated as UTC."""
        naive_past = datetime.utcnow() - timedelta(days=1)
        naive_future = datetime.utcnow() + timedelta(days=1)

        assert (
            get_demo_access_status(_FakeAssignment(due_date=naive_past))
            == DEMO_ACCESS_EXPIRED
        )
        assert (
            get_demo_access_status(_FakeAssignment(start_date=naive_future))
            == DEMO_ACCESS_NOT_STARTED
        )


# ---------------------------------------------------------------------------
# Endpoint behaviour
# ---------------------------------------------------------------------------


class TestDemoPreviewWindow:
    def test_no_dates_serves_activities(
        self, test_client, shared_test_session, demo_teacher
    ):
        """Regression guard: existing demo assignments have no dates set."""
        assignment = _make_demo_assignment(shared_test_session, demo_teacher)

        res = test_client.get(f"/api/demo/assignments/{assignment.id}/preview")

        assert res.status_code == 200
        body = res.json()
        assert body["access_status"] == DEMO_ACCESS_ACTIVE
        assert body["total_activities"] == 1
        assert len(body["activities"]) == 1

    def test_not_started_withholds_activities(
        self, test_client, shared_test_session, demo_teacher
    ):
        assignment = _make_demo_assignment(
            shared_test_session,
            demo_teacher,
            start_date=datetime.now(timezone.utc) + timedelta(days=3),
        )

        res = test_client.get(f"/api/demo/assignments/{assignment.id}/preview")

        assert res.status_code == 200
        body = res.json()
        assert body["access_status"] == DEMO_ACCESS_NOT_STARTED
        assert body["activities"] == []
        assert body["total_activities"] == 0
        assert body["start_date"] is not None

    def test_expired_withholds_activities(
        self, test_client, shared_test_session, demo_teacher
    ):
        assignment = _make_demo_assignment(
            shared_test_session,
            demo_teacher,
            due_date=datetime.now(timezone.utc) - timedelta(days=3),
        )

        res = test_client.get(f"/api/demo/assignments/{assignment.id}/preview")

        assert res.status_code == 200
        body = res.json()
        assert body["access_status"] == DEMO_ACCESS_EXPIRED
        assert body["activities"] == []
        assert body["due_date"] is not None
        # Resolver key must always be present so the frontend can branch on it.
        assert "resource_program_id" in body

    def test_non_demo_assignment_still_404(
        self, test_client, shared_test_session, other_teacher
    ):
        """New logic must not leak the existence of non-demo assignments."""
        assignment = _make_demo_assignment(shared_test_session, other_teacher)

        res = test_client.get(f"/api/demo/assignments/{assignment.id}/preview")

        assert res.status_code == 404


class TestDemoActivityEndpointsBlocked:
    """Every non-preview demo endpoint must refuse outside the window, so the
    material cannot be reached by calling the API directly."""

    def test_expired_blocks_word_selection_start(
        self, test_client, shared_test_session, demo_teacher
    ):
        assignment = _make_demo_assignment(
            shared_test_session,
            demo_teacher,
            due_date=datetime.now(timezone.utc) - timedelta(days=1),
        )

        res = test_client.get(
            f"/api/demo/assignments/{assignment.id}/preview/word-selection-start"
        )

        assert res.status_code == 403
        assert res.json()["detail"]["error"] == "demo_expired"

    def test_not_started_blocks_vocabulary_activities(
        self, test_client, shared_test_session, demo_teacher
    ):
        assignment = _make_demo_assignment(
            shared_test_session,
            demo_teacher,
            start_date=datetime.now(timezone.utc) + timedelta(days=1),
        )

        res = test_client.get(
            f"/api/demo/assignments/{assignment.id}/preview/vocabulary/activities"
        )

        assert res.status_code == 403
        assert res.json()["detail"]["error"] == "demo_not_started"

    def test_active_assignment_not_blocked(
        self, test_client, shared_test_session, demo_teacher
    ):
        """Inside the window the guard must stay out of the way."""
        assignment = _make_demo_assignment(
            shared_test_session,
            demo_teacher,
            start_date=datetime.now(timezone.utc) - timedelta(days=1),
            due_date=datetime.now(timezone.utc) + timedelta(days=1),
        )

        res = test_client.get(
            f"/api/demo/assignments/{assignment.id}/preview/vocabulary/activities"
        )

        assert res.status_code != 403

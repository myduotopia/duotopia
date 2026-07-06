"""Issue #884: item 1 (live-quiz mode whitelist) + item 3 (/quiz/status query).

Item 1: is_live_quiz is restricted to modes that have a student-side gate
(word_selection/spelling/cloze_quiz); speaking_quiz must not be drivable as a
live quiz.
Item 3: GET /quiz/status still returns the correct gate fields after being
optimized to a single joinedload query.
"""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from auth import create_access_token
from routers.assignments.detail import _get_owned_live_quiz_or_404
from routers.assignments.validators import LIVE_QUIZ_MODES
from models import (
    Teacher,
    Classroom,
    Assignment,
    Student,
    StudentAssignment,
    AssignmentStatus,
)


def _live_assignment(db_session, teacher, mode):
    classroom = Classroom(name="C", teacher_id=teacher.id)
    db_session.add(classroom)
    db_session.commit()
    a = Assignment(
        title="A",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        practice_mode=mode,
        is_live_quiz=True,
        is_active=True,
    )
    db_session.add(a)
    db_session.commit()
    return a


class TestLiveQuizWhitelist:
    def test_whitelist_excludes_speaking_quiz(self):
        assert "speaking_quiz" not in LIVE_QUIZ_MODES
        assert {
            "word_selection_quiz",
            "word_spelling_quiz",
            "word_cloze_quiz",
        } <= set(LIVE_QUIZ_MODES)

    def test_gate_rejects_speaking_live_quiz(self, db_session: Session):
        teacher = Teacher(email="sp_t@test.com", name="T", password_hash="x")
        db_session.add(teacher)
        db_session.commit()
        a = _live_assignment(db_session, teacher, "speaking_quiz")

        with pytest.raises(HTTPException) as exc:
            _get_owned_live_quiz_or_404(a.id, db_session, teacher)
        assert exc.value.status_code == 400

    def test_gate_allows_word_selection_live_quiz(self, db_session: Session):
        teacher = Teacher(email="ws_t@test.com", name="T", password_hash="x")
        db_session.add(teacher)
        db_session.commit()
        a = _live_assignment(db_session, teacher, "word_selection_quiz")

        result = _get_owned_live_quiz_or_404(a.id, db_session, teacher)
        assert result.id == a.id


class TestQuizStatusEndpoint:
    def test_status_returns_gate_fields(
        self, test_client: TestClient, db_session: Session
    ):
        teacher = Teacher(email="qt@test.com", name="T", password_hash="x")
        student = Student(email="qs@test.com", name="S")
        db_session.add_all([teacher, student])
        db_session.commit()
        parent = _live_assignment(db_session, teacher, "word_selection_quiz")
        sa = StudentAssignment(
            assignment_id=parent.id,
            student_id=student.id,
            classroom_id=parent.classroom_id,
            title="LQ",
            status=AssignmentStatus.NOT_STARTED,
        )
        db_session.add(sa)
        db_session.commit()

        token = create_access_token({"sub": str(student.id), "type": "student"})
        resp = test_client.get(
            f"/api/students/assignments/{sa.id}/quiz/status",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        body = resp.json()
        # assignment_id is the teacher-side Assignment.id (not the StudentAssignment.id)
        assert body["assignment_id"] == parent.id
        assert body["is_live_quiz"] is True
        assert body["opened_at"] is None
        assert body["closed_at"] is None

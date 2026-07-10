"""Issue #335 item 5: the teacher grading endpoints now validate their request
bodies via Pydantic models instead of accepting a raw dict. This covers the
new score bounds check and the required-field validation.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from auth import create_access_token
from models import (
    Teacher,
    Student,
    Classroom,
    Assignment,
    StudentAssignment,
    AssignmentStatus,
)


def _seed(db_session: Session):
    teacher = Teacher(email="grade_t@test.com", name="Grade T", password_hash="x")
    student = Student(email="grade_s@test.com", name="Grade S")
    db_session.add_all([teacher, student])
    db_session.commit()

    classroom = Classroom(name="Grade Class", teacher_id=teacher.id)
    db_session.add(classroom)
    db_session.commit()

    parent = Assignment(
        title="Grade Assignment",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        is_archived=False,
    )
    db_session.add(parent)
    db_session.commit()

    sa = StudentAssignment(
        assignment_id=parent.id,
        student_id=student.id,
        classroom_id=classroom.id,
        title="SA",
        status=AssignmentStatus.SUBMITTED,
    )
    db_session.add(sa)
    db_session.commit()
    return teacher, student, parent, sa


def _headers(teacher: Teacher) -> dict:
    token = create_access_token({"sub": str(teacher.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


class TestGradingRequestValidation:
    def test_score_above_100_is_rejected(
        self, test_client: TestClient, db_session: Session
    ):
        teacher, student, parent, _ = _seed(db_session)
        resp = test_client.post(
            f"/api/teachers/assignments/{parent.id}/grade",
            headers=_headers(teacher),
            json={"student_id": student.id, "score": 150},
        )
        assert resp.status_code == 422

    def test_negative_score_is_rejected(
        self, test_client: TestClient, db_session: Session
    ):
        teacher, student, parent, _ = _seed(db_session)
        resp = test_client.post(
            f"/api/teachers/assignments/{parent.id}/grade",
            headers=_headers(teacher),
            json={"student_id": student.id, "score": -5},
        )
        assert resp.status_code == 422

    def test_valid_grade_is_accepted_and_persisted(
        self, test_client: TestClient, db_session: Session
    ):
        teacher, student, parent, sa = _seed(db_session)
        resp = test_client.post(
            f"/api/teachers/assignments/{parent.id}/grade",
            headers=_headers(teacher),
            json={
                "student_id": student.id,
                "score": 85,
                "feedback": "good",
                "update_status": True,
            },
        )
        assert resp.status_code == 200
        db_session.refresh(sa)
        assert sa.score == 85
        assert sa.feedback == "good"

    def test_return_for_revision_requires_student_id(
        self, test_client: TestClient, db_session: Session
    ):
        teacher, _, parent, _ = _seed(db_session)
        resp = test_client.post(
            f"/api/teachers/assignments/{parent.id}/return-for-revision",
            headers=_headers(teacher),
            json={},  # missing required student_id
        )
        assert resp.status_code == 422

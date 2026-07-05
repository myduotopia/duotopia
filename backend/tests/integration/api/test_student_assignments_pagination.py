"""Issue #330: server-side pagination + status filtering for the student
assignment list endpoint (GET /api/students/assignments).

Covers:
- backward compatibility (no page_size -> bare list),
- the paginated envelope shape + per-tab stats,
- server-side status-tab filtering with paging.
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


# Status distribution used across the tests below.
#   todo = NOT_STARTED + IN_PROGRESS = 7
#   submitted = 3, returned = 1, resubmitted = 1, graded = 4
#   total = 16
_DISTRIBUTION = (
    [AssignmentStatus.NOT_STARTED] * 5
    + [AssignmentStatus.IN_PROGRESS] * 2
    + [AssignmentStatus.SUBMITTED] * 3
    + [AssignmentStatus.RETURNED] * 1
    + [AssignmentStatus.RESUBMITTED] * 1
    + [AssignmentStatus.GRADED] * 4
)


def _seed(db_session: Session) -> Student:
    teacher = Teacher(email="pg_teacher@test.com", name="PG Teacher", password_hash="x")
    student = Student(email="pg_student@test.com", name="PG Student")
    db_session.add_all([teacher, student])
    db_session.commit()

    classroom = Classroom(name="PG Class", teacher_id=teacher.id)
    db_session.add(classroom)
    db_session.commit()

    parent = Assignment(
        title="PG Assignment",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        is_archived=False,
    )
    db_session.add(parent)
    db_session.commit()

    for i, status in enumerate(_DISTRIBUTION):
        db_session.add(
            StudentAssignment(
                assignment_id=parent.id,
                student_id=student.id,
                classroom_id=classroom.id,
                title=f"SA {i}",
                status=status,
            )
        )
    db_session.commit()
    return student


def _headers(student: Student) -> dict:
    token = create_access_token({"sub": str(student.id), "type": "student"})
    return {"Authorization": f"Bearer {token}"}


class TestStudentAssignmentsPagination:
    def test_no_page_size_returns_bare_list(
        self, test_client: TestClient, db_session: Session
    ):
        """Backward compatible: without page_size the endpoint returns a list."""
        student = _seed(db_session)
        resp = test_client.get("/api/students/assignments", headers=_headers(student))
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)
        assert len(body) == len(_DISTRIBUTION)  # 16

    def test_paginated_envelope_and_stats(
        self, test_client: TestClient, db_session: Session
    ):
        """With page_size the endpoint returns an envelope with total + stats."""
        student = _seed(db_session)
        resp = test_client.get(
            "/api/students/assignments?page=1&page_size=8",
            headers=_headers(student),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, dict)
        assert body["total"] == 16
        assert body["page"] == 1
        assert body["page_size"] == 8
        assert len(body["items"]) == 8
        # stats are independent of the current page / active tab
        assert body["stats"] == {
            "todo": 7,
            "submitted": 3,
            "returned": 1,
            "resubmitted": 1,
            "graded": 4,
        }

        # Page 2 returns the remaining 8 items.
        resp2 = test_client.get(
            "/api/students/assignments?page=2&page_size=8",
            headers=_headers(student),
        )
        assert resp2.status_code == 200
        assert len(resp2.json()["items"]) == 8

    def test_status_tab_filter_with_paging(
        self, test_client: TestClient, db_session: Session
    ):
        """status filter narrows results server-side; total reflects the tab."""
        student = _seed(db_session)
        resp = test_client.get(
            "/api/students/assignments?status=todo&page=1&page_size=5",
            headers=_headers(student),
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 7  # only NOT_STARTED + IN_PROGRESS
        assert len(body["items"]) == 5
        assert all(
            item["status"] in ("NOT_STARTED", "IN_PROGRESS") for item in body["items"]
        )
        # stats stay full-scope even when a tab is active
        assert body["stats"]["graded"] == 4

        # Second page of the todo tab has the remaining 2.
        resp2 = test_client.get(
            "/api/students/assignments?status=todo&page=2&page_size=5",
            headers=_headers(student),
        )
        assert len(resp2.json()["items"]) == 2

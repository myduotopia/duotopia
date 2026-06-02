"""Tests for POST /api/teachers/students/{student_id}/status
(issue #768 Phase 5-2 backend).
"""

import pytest

from auth import create_access_token, get_password_hash
from models import (
    Classroom,
    ClassroomStudent,
    Student,
    StudentStatusHistory,
    Teacher,
)


def _bearer(teacher_id):
    token = create_access_token({"sub": str(teacher_id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def owner_teacher(shared_test_session):
    t = Teacher(
        email="status-owner@duotopia.com",
        password_hash=get_password_hash("x"),
        name="Owner",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def other_teacher(shared_test_session):
    t = Teacher(
        email="status-other@duotopia.com",
        password_hash=get_password_hash("x"),
        name="Other",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def student_in_owner_classroom(shared_test_session, owner_teacher):
    classroom = Classroom(name="Class A", teacher_id=owner_teacher.id, is_active=True)
    shared_test_session.add(classroom)
    shared_test_session.flush()
    s = Student(
        name="Alice",
        email="alice@example.com",
        password_hash=get_password_hash("x"),
        is_active=True,
    )
    shared_test_session.add(s)
    shared_test_session.flush()
    shared_test_session.add(
        ClassroomStudent(student_id=s.id, classroom_id=classroom.id, is_active=True)
    )
    shared_test_session.commit()
    return s


def test_rejects_invalid_status(test_client, owner_teacher, student_in_owner_classroom):
    r = test_client.post(
        f"/api/teachers/students/{student_in_owner_classroom.id}/status",
        json={"status": "deleted"},
        headers=_bearer(owner_teacher.id),
    )
    assert r.status_code == 400
    assert "active" in r.json()["detail"]


def test_404_when_student_does_not_exist(test_client, owner_teacher):
    r = test_client.post(
        "/api/teachers/students/99999/status",
        json={"status": "inactive"},
        headers=_bearer(owner_teacher.id),
    )
    assert r.status_code == 404


def test_other_teacher_cannot_change_status(
    test_client, other_teacher, student_in_owner_classroom
):
    r = test_client.post(
        f"/api/teachers/students/{student_in_owner_classroom.id}/status",
        json={"status": "inactive"},
        headers=_bearer(other_teacher.id),
    )
    assert r.status_code == 403


def test_deactivate_writes_history_and_flips_is_active(
    test_client, owner_teacher, student_in_owner_classroom, shared_test_session
):
    r = test_client.post(
        f"/api/teachers/students/{student_in_owner_classroom.id}/status",
        json={"status": "inactive", "note": "End of semester"},
        headers=_bearer(owner_teacher.id),
    )
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["status"] == "inactive"
    assert body["history_id"] > 0

    shared_test_session.expire_all()
    s = (
        shared_test_session.query(Student)
        .filter(Student.id == student_in_owner_classroom.id)
        .one()
    )
    assert s.is_active is False

    history = (
        shared_test_session.query(StudentStatusHistory)
        .filter(StudentStatusHistory.student_id == s.id)
        .one()
    )
    assert history.status == "inactive"
    assert history.changed_by == owner_teacher.id
    assert history.note == "End of semester"


def test_reactivate_writes_separate_history_row(
    test_client, owner_teacher, student_in_owner_classroom, shared_test_session
):
    # Deactivate first
    test_client.post(
        f"/api/teachers/students/{student_in_owner_classroom.id}/status",
        json={"status": "inactive"},
        headers=_bearer(owner_teacher.id),
    )
    # Then reactivate
    r = test_client.post(
        f"/api/teachers/students/{student_in_owner_classroom.id}/status",
        json={"status": "active"},
        headers=_bearer(owner_teacher.id),
    )
    assert r.status_code == 200

    rows = (
        shared_test_session.query(StudentStatusHistory)
        .filter(StudentStatusHistory.student_id == student_in_owner_classroom.id)
        .order_by(StudentStatusHistory.changed_at.asc())
        .all()
    )
    assert len(rows) == 2
    assert rows[0].status == "inactive"
    assert rows[1].status == "active"


def test_student_with_no_active_classroom_enrollment_gets_403(
    test_client, owner_teacher, shared_test_session
):
    """C1 lock-in: a student with NO active classroom enrollment must not
    be writeable by an arbitrary teacher (previously the auth check was
    skipped entirely when classroom_student was None)."""
    orphan = Student(
        name="Orphan",
        email="orphan@example.com",
        password_hash=get_password_hash("x"),
        is_active=True,
    )
    shared_test_session.add(orphan)
    shared_test_session.commit()

    r = test_client.post(
        f"/api/teachers/students/{orphan.id}/status",
        json={"status": "inactive"},
        headers=_bearer(owner_teacher.id),
    )
    assert r.status_code == 403


def test_stale_inactive_enrollment_does_not_grant_ownership(
    test_client,
    owner_teacher,
    other_teacher,
    student_in_owner_classroom,
    shared_test_session,
):
    """C2 lock-in: an inactive ClassroomStudent row (left over after a
    student transfer) must not satisfy the ownership check for the old
    teacher. Owner teacher's enrollment is set inactive; current owner is
    other_teacher via a new active enrollment."""
    # Deactivate the original enrollment
    cs = (
        shared_test_session.query(ClassroomStudent)
        .filter(ClassroomStudent.student_id == student_in_owner_classroom.id)
        .first()
    )
    cs.is_active = False
    # Create new active enrollment under other_teacher's classroom
    other_classroom = Classroom(
        name="Class B", teacher_id=other_teacher.id, is_active=True
    )
    shared_test_session.add(other_classroom)
    shared_test_session.flush()
    shared_test_session.add(
        ClassroomStudent(
            student_id=student_in_owner_classroom.id,
            classroom_id=other_classroom.id,
            is_active=True,
        )
    )
    shared_test_session.commit()

    # Original owner_teacher must NOT be able to change status anymore
    r = test_client.post(
        f"/api/teachers/students/{student_in_owner_classroom.id}/status",
        json={"status": "inactive"},
        headers=_bearer(owner_teacher.id),
    )
    assert r.status_code == 403


def test_soft_deleted_student_cannot_be_reactivated_via_status(
    test_client, owner_teacher, student_in_owner_classroom, shared_test_session
):
    """M6 lock-in: a student deleted via DELETE /students/{id} (which sets
    is_active=False but writes NO status_history row) must not be silently
    'un-deleted' by POSTing status='active' here."""
    # Simulate the DELETE flow: flip is_active without writing history
    student_in_owner_classroom.is_active = False
    shared_test_session.commit()

    r = test_client.post(
        f"/api/teachers/students/{student_in_owner_classroom.id}/status",
        json={"status": "active"},
        headers=_bearer(owner_teacher.id),
    )
    assert r.status_code == 404


def test_same_status_is_noop_no_new_history_row(
    test_client, owner_teacher, student_in_owner_classroom, shared_test_session
):
    """Posting status='active' on an already-active student must NOT add a
    history row — otherwise the billing roster gets polluted."""
    r = test_client.post(
        f"/api/teachers/students/{student_in_owner_classroom.id}/status",
        json={"status": "active"},
        headers=_bearer(owner_teacher.id),
    )
    assert r.status_code == 200

    count = (
        shared_test_session.query(StudentStatusHistory)
        .filter(StudentStatusHistory.student_id == student_in_owner_classroom.id)
        .count()
    )
    assert count == 0

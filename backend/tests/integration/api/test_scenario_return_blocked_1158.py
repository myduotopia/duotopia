"""Integration tests — #1158 情境對話作業不能退回訂正。

情境對話作業的狀態只有待完成、已提交、已批改：
- 單筆退回（return-for-revision）→ 409 + RETURN_NOT_ALLOWED_FOR_PRACTICE_MODE，
  狀態、returned_at、AI 分析次數都不動。
- 批次退回（batch-return-for-revision）→ 200，學生全部列入 skipped 與 not_allowed。
- 批次批改完成（finalize-batch-grade）→ RETURNED 決定略過（狀態不變），
  return_not_allowed_count 回報人數；GRADED 決定照常。
- AI 批改（batch-grade，批次與單人模式）→ 400 + AI_BATCH_GRADE_NOT_ALLOWED_FOR_PRACTICE_MODE，
  批改維持老師手動評分。
其他作業類型（例：例句朗讀 reading）退回與 AI 批改流程完全不變（迴歸）。
"""

from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from auth import create_access_token, get_password_hash
from models import (
    Assignment,
    AssignmentContent,
    AssignmentStatus,
    Classroom,
    ClassroomStudent,
    Content,
    ContentItem,
    ContentType,
    Lesson,
    Program,
    Student,
    StudentAssignment,
    StudentItemProgress,
    Teacher,
)

BLOCK_CODE = "RETURN_NOT_ALLOWED_FOR_PRACTICE_MODE"


@pytest.fixture
def teacher(shared_test_session: Session):
    t = Teacher(
        email="return-block-1158@test.com",
        name="Return Block Teacher",
        password_hash=get_password_hash("password123"),
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


@pytest.fixture
def teacher_headers(teacher: Teacher):
    token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


def _build(db: Session, teacher: Teacher, practice_mode: str, content_type):
    """建班級＋2 位已提交學生＋1 份作業（每生 2 題、AI 分析次數 2/1）。"""
    classroom = Classroom(name=f"RB-{practice_mode}", teacher_id=teacher.id)
    db.add(classroom)
    db.commit()

    students = []
    for i in range(2):
        s = Student(
            email=f"rb-{practice_mode}-{i}@test.com",
            name=f"RB Student {i}",
            password_hash=get_password_hash("password123"),
            birthdate=date(2010, 1, 1),
            is_active=True,
            email_verified=True,
        )
        db.add(s)
        db.commit()
        db.add(ClassroomStudent(classroom_id=classroom.id, student_id=s.id))
        students.append(s)
    db.commit()

    program = Program(
        name="RB Program", teacher_id=teacher.id, classroom_id=classroom.id
    )
    db.add(program)
    db.commit()
    lesson = Lesson(program_id=program.id, name="RB Lesson")
    db.add(lesson)
    db.commit()
    content = Content(lesson_id=lesson.id, title="RB Content", type=content_type)
    db.add(content)
    db.commit()

    items = []
    for i in range(2):
        item = ContentItem(content_id=content.id, order_index=i, text=f"q {i}")
        db.add(item)
        items.append(item)
    db.commit()

    assignment = Assignment(
        title="RB Assignment",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        due_date=datetime.now(timezone.utc),
        practice_mode=practice_mode,
    )
    db.add(assignment)
    db.commit()
    db.add(AssignmentContent(assignment_id=assignment.id, content_id=content.id))
    db.commit()

    sas = []
    for s in students:
        sa = StudentAssignment(
            assignment_id=assignment.id,
            student_id=s.id,
            classroom_id=classroom.id,
            title=assignment.title,
            due_date=assignment.due_date,
            status=AssignmentStatus.SUBMITTED,
            submitted_at=datetime.now(timezone.utc),
        )
        db.add(sa)
        db.commit()
        db.refresh(sa)
        sas.append(sa)
        for item, count in zip(items, [2, 1]):
            db.add(
                StudentItemProgress(
                    student_assignment_id=sa.id,
                    content_item_id=item.id,
                    status="SUBMITTED",
                    ai_analysis_count=count,
                )
            )
    db.commit()
    return {
        "classroom": classroom,
        "students": students,
        "assignment": assignment,
        "student_assignments": sas,
    }


@pytest.fixture
def scenario_setup(shared_test_session: Session, teacher: Teacher):
    return _build(
        shared_test_session, teacher, "scenario_dialogue", ContentType.SCENARIO_DIALOGUE
    )


@pytest.fixture
def reading_setup(shared_test_session: Session, teacher: Teacher):
    return _build(
        shared_test_session, teacher, "reading", ContentType.EXAMPLE_SENTENCES
    )


def _counts(db: Session, sa_id: int) -> list[int]:
    rows = (
        db.query(StudentItemProgress)
        .filter(StudentItemProgress.student_assignment_id == sa_id)
        .order_by(StudentItemProgress.content_item_id)
        .all()
    )
    return [int(r.ai_analysis_count or 0) for r in rows]


def _sa(db: Session, sa_id: int) -> StudentAssignment:
    db.expire_all()
    return db.query(StudentAssignment).filter(StudentAssignment.id == sa_id).one()


# ---------- 單筆退回 ----------


class TestSingleReturn:
    def test_scenario_dialogue_rejected_with_code(
        self,
        test_client: TestClient,
        shared_test_session,
        scenario_setup,
        teacher_headers,
    ):
        a = scenario_setup["assignment"]
        st = scenario_setup["students"][0]
        sa = scenario_setup["student_assignments"][0]

        resp = test_client.post(
            f"/api/teachers/assignments/{a.id}/return-for-revision",
            json={"student_id": st.id, "message": "redo"},
            headers=teacher_headers,
        )
        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail["code"] == BLOCK_CODE
        assert detail["practice_mode"] == "scenario_dialogue"

        row = _sa(shared_test_session, sa.id)
        assert row.status == AssignmentStatus.SUBMITTED
        assert row.returned_at is None
        assert _counts(shared_test_session, sa.id) == [2, 1]

    def test_other_teacher_gets_403_not_409(
        self, test_client: TestClient, shared_test_session, scenario_setup
    ):
        """驗權在前：別的老師不會從 409 得知作業類型。"""
        other = Teacher(
            email="rb-other-1158@test.com",
            name="Other",
            password_hash=get_password_hash("password123"),
            is_active=True,
            email_verified=True,
        )
        shared_test_session.add(other)
        shared_test_session.commit()
        token = create_access_token(data={"sub": str(other.id), "type": "teacher"})
        resp = test_client.post(
            f"/api/teachers/assignments/{scenario_setup['assignment'].id}"
            "/return-for-revision",
            json={"student_id": scenario_setup["students"][0].id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    def test_reading_still_returns_regression(
        self,
        test_client: TestClient,
        shared_test_session,
        reading_setup,
        teacher_headers,
    ):
        a = reading_setup["assignment"]
        st = reading_setup["students"][0]
        sa = reading_setup["student_assignments"][0]

        resp = test_client.post(
            f"/api/teachers/assignments/{a.id}/return-for-revision",
            json={"student_id": st.id},
            headers=teacher_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["result"] == "returned"
        row = _sa(shared_test_session, sa.id)
        assert row.status == AssignmentStatus.RETURNED
        assert row.returned_at is not None
        assert _counts(shared_test_session, sa.id) == [0, 0]


# ---------- 批次退回 ----------


class TestBatchReturn:
    def test_scenario_dialogue_all_skipped_and_reported(
        self,
        test_client: TestClient,
        shared_test_session,
        scenario_setup,
        teacher_headers,
    ):
        a = scenario_setup["assignment"]
        ids = [s.id for s in scenario_setup["students"]]
        resp = test_client.post(
            f"/api/teachers/assignments/{a.id}/batch-return-for-revision",
            json={"student_ids": ids},
            headers=teacher_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["returned"] == []
        assert body["count"] == 0
        assert sorted(body["skipped"]) == sorted(ids)
        assert sorted(body["not_allowed"]) == sorted(ids)
        assert body["code"] == BLOCK_CODE
        for sa in scenario_setup["student_assignments"]:
            row = _sa(shared_test_session, sa.id)
            assert row.status == AssignmentStatus.SUBMITTED
            assert row.returned_at is None
            assert _counts(shared_test_session, sa.id) == [2, 1]

    def test_reading_still_returns_regression(
        self,
        test_client: TestClient,
        shared_test_session,
        reading_setup,
        teacher_headers,
    ):
        a = reading_setup["assignment"]
        ids = [s.id for s in reading_setup["students"]]
        resp = test_client.post(
            f"/api/teachers/assignments/{a.id}/batch-return-for-revision",
            json={"student_ids": ids},
            headers=teacher_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert sorted(body["returned"]) == sorted(ids)
        assert body["skipped"] == []
        assert "not_allowed" not in body
        assert "code" not in body
        for sa in reading_setup["student_assignments"]:
            assert _sa(shared_test_session, sa.id).status == AssignmentStatus.RETURNED


# ---------- 批次批改完成 ----------


class TestFinalizeBatchGrade:
    def test_scenario_dialogue_returned_decision_skipped(
        self,
        test_client: TestClient,
        shared_test_session,
        scenario_setup,
        teacher_headers,
    ):
        a = scenario_setup["assignment"]
        st = scenario_setup["students"]
        sa_ret, sa_grd = scenario_setup["student_assignments"]
        resp = test_client.post(
            f"/api/teachers/assignments/{a.id}/finalize-batch-grade",
            json={
                "classroom_id": scenario_setup["classroom"].id,
                "teacher_decisions": {
                    str(st[0].id): "RETURNED",
                    str(st[1].id): "GRADED",
                },
            },
            headers=teacher_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["returned_count"] == 0
        assert body["graded_count"] == 1
        assert body["unchanged_count"] == 1
        assert body["return_not_allowed_count"] == 1

        row = _sa(shared_test_session, sa_ret.id)
        assert row.status == AssignmentStatus.SUBMITTED
        assert row.returned_at is None
        assert _counts(shared_test_session, sa_ret.id) == [2, 1]
        assert _sa(shared_test_session, sa_grd.id).status == AssignmentStatus.GRADED

    def test_reading_returned_decision_regression(
        self,
        test_client: TestClient,
        shared_test_session,
        reading_setup,
        teacher_headers,
    ):
        a = reading_setup["assignment"]
        st = reading_setup["students"]
        sa_ret = reading_setup["student_assignments"][0]
        resp = test_client.post(
            f"/api/teachers/assignments/{a.id}/finalize-batch-grade",
            json={
                "classroom_id": reading_setup["classroom"].id,
                "teacher_decisions": {
                    str(st[0].id): "RETURNED",
                    str(st[1].id): "GRADED",
                },
            },
            headers=teacher_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["returned_count"] == 1
        assert body["return_not_allowed_count"] == 0
        assert _sa(shared_test_session, sa_ret.id).status == AssignmentStatus.RETURNED
        assert _counts(shared_test_session, sa_ret.id) == [0, 0]


# ---------- AI 批改（batch-grade）----------

AI_BLOCK_CODE = "AI_BATCH_GRADE_NOT_ALLOWED_FOR_PRACTICE_MODE"


class TestAiBatchGrade:
    """紫色「AI 批改」（Azure 發音評分）不適用情境對話：批改維持老師手動評分。"""

    @pytest.mark.parametrize("single", [False, True])
    def test_scenario_dialogue_rejected_with_code(
        self,
        test_client: TestClient,
        shared_test_session,
        scenario_setup,
        teacher_headers,
        single,
    ):
        a = scenario_setup["assignment"]
        payload = {"classroom_id": scenario_setup["classroom"].id}
        if single:
            payload["student_ids"] = [scenario_setup["students"][0].id]
        resp = test_client.post(
            f"/api/teachers/assignments/{a.id}/batch-grade",
            json=payload,
            headers=teacher_headers,
        )
        assert resp.status_code == 400, resp.text
        detail = resp.json()["detail"]
        assert detail["code"] == AI_BLOCK_CODE
        assert detail["practice_mode"] == "scenario_dialogue"
        for sa in scenario_setup["student_assignments"]:
            row = _sa(shared_test_session, sa.id)
            assert row.status == AssignmentStatus.SUBMITTED
            assert row.score is None

    def test_other_teacher_gets_404_not_400(
        self, test_client: TestClient, shared_test_session, scenario_setup
    ):
        """驗權在前：別的老師不會從 400 得知作業類型。"""
        other = Teacher(
            email="rb-ai-other-1158@test.com",
            name="Other",
            password_hash=get_password_hash("password123"),
            is_active=True,
            email_verified=True,
        )
        shared_test_session.add(other)
        shared_test_session.commit()
        token = create_access_token(data={"sub": str(other.id), "type": "teacher"})
        resp = test_client.post(
            f"/api/teachers/assignments/{scenario_setup['assignment'].id}"
            "/batch-grade",
            json={"classroom_id": scenario_setup["classroom"].id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    def test_reading_still_ai_graded_regression(
        self,
        test_client: TestClient,
        reading_setup,
        teacher_headers,
    ):
        a = reading_setup["assignment"]
        resp = test_client.post(
            f"/api/teachers/assignments/{a.id}/batch-grade",
            json={"classroom_id": reading_setup["classroom"].id},
            headers=teacher_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["total_students"] == 2

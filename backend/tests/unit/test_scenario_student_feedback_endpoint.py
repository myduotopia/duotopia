"""學生端逐題 AI 建議端點 — Issue #1140 Stage 1。

這支端點是學生自己觸發的，所以最不能出錯的是**所有權與配額**：

1. 只能對**自己的**作答要建議。沒有這道檢查，任何學生都能拿別人的 progress_id 去燒
   對方的配額，順便看到對方那題的內容。
2. 每題 3 次上限走既有的 `services/analysis_quota`（與批改頁 Azure 分析同一套、同一個
   `ai_analysis_count` 欄位、RETURNED 時一起歸零），不另寫一套計數。
3. **參考答案與分數不可以出現在回應裡** —— 學生畫面不顯示分數，參考答案更是給他抄。
"""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from auth import create_access_token
from models import (
    Teacher,
    Student,
    Classroom,
    Program,
    Lesson,
    Content,
    ContentItem,
    Assignment,
    AssignmentContent,
    StudentAssignment,
    StudentItemProgress,
)

URL = "/api/students/scenario-dialogue/feedback"

AI_RESULT = {
    "verdict": "improve",
    "comment": "意思有傳達到！試著說成完整的句子。",
    "suggestion": "I went to the park with my family.",
    "usage": {"input_tokens": 3000, "output_tokens": 120},
    "estimated_cost_usd": 0.0011,
}

PATCH_TARGET = (
    "services.scenario_student_feedback_ai." "ScenarioStudentFeedbackService.generate"
)


def _make_world(db: Session, tag: str = "a", content_type: str = "SCENARIO_DIALOGUE"):
    teacher = Teacher(
        email=f"sfb-{tag}@teacher.com",
        name="T",
        password_hash="x",
        email_verified=True,
    )
    db.add(teacher)
    db.commit()

    classroom = Classroom(name="C", teacher_id=teacher.id, grade="Grade 1")
    db.add(classroom)
    db.commit()

    program = Program(
        name="P", description="d", teacher_id=teacher.id, classroom_id=classroom.id
    )
    db.add(program)
    db.commit()

    lesson = Lesson(
        name="L",
        description="d",
        program_id=program.id,
        order_index=1,
        estimated_minutes=30,
    )
    db.add(lesson)
    db.commit()

    content = Content(
        lesson_id=lesson.id,
        title="情境對話",
        type=content_type,
        scenario_settings={
            "scenario_content": "At the park.",
            "question_level": "B1",
            "global_rubric": "請用完整句子回答",
            "global_tense": {"time": "past", "aspect": "simple"},
            "global_voice": "active",
            "translate_language": "chinese",
            "tts_settings": None,
        },
    )
    db.add(content)
    db.commit()

    item = ContentItem(
        content_id=content.id,
        order_index=0,
        text="What did you do last weekend?",
        translation="你上週末做了什麼？",
        item_metadata={
            "scenario_dialogue": {
                "tense_override": None,
                "voice_override": None,
                "keywords": ["went", "park"],
                "reference_answer": "I went to the park with my family.",
                "rubric_note": "要說出地點",
                "image_prompt": "a park",
            }
        },
    )
    db.add(item)
    db.commit()

    student = Student(
        name="S", email=f"sfb-{tag}@student.com", password_hash="x", birthdate=None
    )
    db.add(student)
    db.commit()

    assignment = Assignment(
        title="A",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        practice_mode="scenario_dialogue",
    )
    db.add(assignment)
    db.commit()
    db.add(
        AssignmentContent(
            assignment_id=assignment.id, content_id=content.id, order_index=0
        )
    )
    db.commit()

    sa = StudentAssignment(
        assignment_id=assignment.id,
        student_id=student.id,
        classroom_id=classroom.id,
        title="A",
    )
    db.add(sa)
    db.commit()

    progress = StudentItemProgress(
        student_assignment_id=sa.id,
        content_item_id=item.id,
        recording_url="https://storage.googleapis.com/bucket/recordings/a.webm",
        status="IN_PROGRESS",
    )
    db.add(progress)
    db.commit()

    token = create_access_token(
        data={"sub": str(student.id), "type": "student", "email": student.email}
    )
    return {
        "student": student,
        "progress": progress,
        "item": item,
        "headers": {"Authorization": f"Bearer {token}"},
    }


@pytest.fixture
def world(db_session: Session):
    return _make_world(db_session)


def _post(client: TestClient, world, **body):
    payload = {"item_progress_id": world["progress"].id, **body}
    return client.post(URL, json=payload, headers=world["headers"])


class TestHappyPath:
    def test_returns_the_feedback_and_counts_one_attempt(
        self, test_client: TestClient, db_session: Session, world
    ):
        with patch(PATCH_TARGET, new=AsyncMock(return_value=AI_RESULT)):
            resp = _post(test_client, world)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["verdict"] == "improve"
        assert body["comment"] == AI_RESULT["comment"]
        assert body["suggestion"] == AI_RESULT["suggestion"]
        assert body["ai_analysis_count"] == 1
        assert body["ai_analysis_remaining"] == 2

        db_session.refresh(world["progress"])
        assert world["progress"].ai_analysis_count == 1

    def test_never_leaks_scores_or_the_reference_answer(
        self, test_client: TestClient, world
    ):
        """就算模型回了分數或把參考答案抄回來，學生那一側也看不到。"""
        polluted = {
            **AI_RESULT,
            "score": 92,
            "overall": 88,
            "reference_answer": "I went to the park with my family.",
        }
        with patch(PATCH_TARGET, new=AsyncMock(return_value=polluted)):
            resp = _post(test_client, world)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert "score" not in body
        assert "overall" not in body
        assert "reference_answer" not in body
        assert "usage" not in body
        assert "estimated_cost_usd" not in body

    def test_ui_language_is_passed_through(self, test_client: TestClient, world):
        spy = AsyncMock(return_value=AI_RESULT)
        with patch(PATCH_TARGET, new=spy):
            assert _post(test_client, world, ui_language="en").status_code == 200
        assert spy.await_args.kwargs["ui_language"] == "en"

    def test_criteria_come_from_the_canonical_builder(
        self, test_client: TestClient, world
    ):
        """題目／參考答案／必用字詞一律由 utils.scenario_dialogue 組出，端點不自己拼。"""
        spy = AsyncMock(return_value=AI_RESULT)
        with patch(PATCH_TARGET, new=spy):
            assert _post(test_client, world).status_code == 200
        criteria = spy.await_args.kwargs["criteria"]
        assert criteria["question"] == "What did you do last weekend?"
        assert criteria["reference_answer"] == "I went to the park with my family."
        assert criteria["keywords"] == ["went", "park"]
        assert criteria["global_rubric"] == "請用完整句子回答"
        # 生效時態已經解析好（override 為 None → 沿用整體）
        assert criteria["tense"] == {"time": "past", "aspect": "simple"}


class TestOwnership:
    def test_another_students_progress_is_not_found(
        self, test_client: TestClient, db_session: Session, world
    ):
        """換成別人的 token → 404（不是 403，不要洩漏這個 id 存在）。"""
        other = _make_world(db_session, tag="b")
        resp = test_client.post(
            URL,
            json={"item_progress_id": world["progress"].id},
            headers=other["headers"],
        )
        assert resp.status_code == 404

    def test_teacher_token_is_rejected(self, test_client: TestClient, world):
        teacher_token = create_access_token(
            data={"sub": "999", "type": "teacher", "email": "t@t.com"}
        )
        resp = test_client.post(
            URL,
            json={"item_progress_id": world["progress"].id},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert resp.status_code in (401, 403)

    def test_unknown_progress_id(self, test_client: TestClient, world):
        resp = test_client.post(
            URL, json={"item_progress_id": 99999999}, headers=world["headers"]
        )
        assert resp.status_code == 404

    def test_ai_is_never_called_when_ownership_fails(
        self, test_client: TestClient, db_session: Session, world
    ):
        other = _make_world(db_session, tag="c")
        spy = AsyncMock(return_value=AI_RESULT)
        with patch(PATCH_TARGET, new=spy):
            test_client.post(
                URL,
                json={"item_progress_id": world["progress"].id},
                headers=other["headers"],
            )
        spy.assert_not_awaited()


class TestQuota:
    def test_fourth_attempt_is_refused_and_costs_nothing(
        self, test_client: TestClient, db_session: Session, world
    ):
        world["progress"].ai_analysis_count = 3
        db_session.commit()

        spy = AsyncMock(return_value=AI_RESULT)
        with patch(PATCH_TARGET, new=spy):
            resp = _post(test_client, world)

        assert resp.status_code == 429
        spy.assert_not_awaited()

    def test_teacher_approved_item_cannot_be_retried(
        self, test_client: TestClient, db_session: Session, world
    ):
        world["progress"].teacher_passed = True
        db_session.commit()

        spy = AsyncMock(return_value=AI_RESULT)
        with patch(PATCH_TARGET, new=spy):
            resp = _post(test_client, world)

        assert resp.status_code == 403
        spy.assert_not_awaited()

    def test_a_failed_ai_call_does_not_consume_an_attempt(
        self, test_client: TestClient, db_session: Session, world
    ):
        """AI 爆掉是我們的問題，不該吃掉學生的 3 次機會。"""
        with patch(PATCH_TARGET, new=AsyncMock(side_effect=RuntimeError("boom"))):
            resp = _post(test_client, world)

        assert resp.status_code >= 500
        db_session.refresh(world["progress"])
        assert world["progress"].ai_analysis_count == 0


class TestGuards:
    def test_no_recording_yet(
        self, test_client: TestClient, db_session: Session, world
    ):
        world["progress"].recording_url = None
        db_session.commit()

        spy = AsyncMock(return_value=AI_RESULT)
        with patch(PATCH_TARGET, new=spy):
            resp = _post(test_client, world)

        assert resp.status_code == 400
        spy.assert_not_awaited()

    def test_non_scenario_content_is_refused(
        self, test_client: TestClient, db_session: Session
    ):
        """這支端點只服務情境對話 —— 其他題型的建議流程完全不同。"""
        other = _make_world(db_session, tag="d", content_type="READING_ASSESSMENT")
        spy = AsyncMock(return_value=AI_RESULT)
        with patch(PATCH_TARGET, new=spy):
            resp = test_client.post(
                URL,
                json={"item_progress_id": other["progress"].id},
                headers=other["headers"],
            )
        assert resp.status_code == 400
        spy.assert_not_awaited()

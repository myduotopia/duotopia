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
    StudentContentProgress,
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
        "classroom": classroom,
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

    def test_old_style_result_is_a_feedback_kind(self, test_client: TestClient, world):
        """service 沒給 kind（舊格式）→ 回 kind=feedback、照常算一次（#1158）。"""
        with patch(PATCH_TARGET, new=AsyncMock(return_value=AI_RESULT)):
            body = _post(test_client, world).json()
        assert body["kind"] == "feedback"
        assert body["ai_analysis_count"] == 1

    @pytest.mark.parametrize("kind", ["phrase", "model_answer"])
    def test_help_requests_do_not_consume_an_attempt(
        self, test_client: TestClient, db_session: Session, world, kind
    ):
        """問某個字怎麼說、說不會答都是求助，不算作答次數（#1158）。"""
        help_result = {
            **AI_RESULT,
            "kind": kind,
            "verdict": None,
            "suggestion": "park",
        }
        with patch(PATCH_TARGET, new=AsyncMock(return_value=help_result)):
            resp = _post(test_client, world)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["kind"] == kind
        assert body["verdict"] is None
        assert body["suggestion"] == "park"
        assert body["ai_analysis_count"] == 0
        assert body["ai_analysis_remaining"] == 3

        db_session.refresh(world["progress"])
        assert world["progress"].ai_analysis_count == 0

    def test_help_then_three_answers_still_allowed(
        self, test_client: TestClient, db_session: Session, world
    ):
        """求助過後，三次正式作答一次都沒少；第四次才 429。"""
        help_result = {**AI_RESULT, "kind": "phrase", "verdict": None}
        with patch(PATCH_TARGET, new=AsyncMock(return_value=help_result)):
            assert _post(test_client, world).status_code == 200
        with patch(PATCH_TARGET, new=AsyncMock(return_value=AI_RESULT)):
            for expected in (1, 2, 3):
                assert _post(test_client, world).json()["ai_analysis_count"] == expected
            assert _post(test_client, world).status_code == 429

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


class TestSpendIsActuallyCapped:
    """PR #1141 review：原本「先 gate、成功後才加」擋不住並行。

    那個版本的每個請求都在 count < 3 時通過 gate，各自打一通**付費的** Gemini ——
    存下來的數字仍停在 3，所以從資料完全看不出來花了多少。改成原子地「領號碼牌」
    之後，AI 呼叫數才真的有上限。
    """

    def test_ai_is_called_at_most_three_times_per_item(
        self, test_client: TestClient, db_session: Session, world
    ):
        """依序呼叫版：第 4 次其實是 `check_can_analyze` 擋下的。

        真正的並行保護（`UPDATE ... WHERE count < MAX`）由
        `TestReserveSlotIsTheCapItself` 覆蓋 —— 那一條繞過 gate 直接驗函式。
        """
        spy = AsyncMock(return_value=AI_RESULT)
        with patch(PATCH_TARGET, new=spy):
            codes = [_post(test_client, world).status_code for _ in range(5)]

        assert codes[:3] == [200, 200, 200]
        assert codes[3:] == [429, 429]
        # 真正的重點：第 4、5 次沒有花錢
        assert spy.await_count == 3

    def test_the_slot_is_taken_before_the_ai_call(
        self, test_client: TestClient, db_session: Session, world
    ):
        """AI 還在跑的時候，額度就已經記在資料庫上了。

        這是「有上限」的機制本身：領不到號碼牌的請求根本不會走到 AI。
        """
        seen = {}

        async def slow_generate(**kwargs):
            db_session.expire_all()
            row = db_session.get(StudentItemProgress, world["progress"].id)
            seen["count_during_ai"] = row.ai_analysis_count
            return AI_RESULT

        with patch(PATCH_TARGET, new=AsyncMock(side_effect=slow_generate)):
            assert _post(test_client, world).status_code == 200

        assert seen["count_during_ai"] == 1

    def test_a_refund_puts_the_slot_back(
        self, test_client: TestClient, db_session: Session, world
    ):
        """AI 失敗退還額度之後，學生還是有完整的 3 次。"""
        with patch(PATCH_TARGET, new=AsyncMock(side_effect=RuntimeError("boom"))):
            for _ in range(3):
                assert _post(test_client, world).status_code == 503

        db_session.refresh(world["progress"])
        assert world["progress"].ai_analysis_count == 0

        with patch(PATCH_TARGET, new=AsyncMock(return_value=AI_RESULT)):
            resp = _post(test_client, world)
        assert resp.status_code == 200
        assert resp.json()["ai_analysis_remaining"] == 2

    def test_bad_question_data_also_refunds(
        self, test_client: TestClient, db_session: Session, world
    ):
        from services.scenario_student_feedback_ai import (
            ScenarioStudentFeedbackInputError,
        )

        with patch(
            PATCH_TARGET,
            new=AsyncMock(side_effect=ScenarioStudentFeedbackInputError("沒有題目")),
        ):
            assert _post(test_client, world).status_code == 400

        db_session.refresh(world["progress"])
        assert world["progress"].ai_analysis_count == 0


class TestReserveSlotIsTheCapItself:
    """直接驗 `reserve_analysis_slot`，**繞過 HTTP 層的 gate**。

    端點上的 `check_can_analyze` 在依序呼叫時就會擋下第 4 次，所以從端點測不出
    `UPDATE ... WHERE count < MAX` 有沒有在守 —— 那個 WHERE 才是並行時唯一的保護。
    （mutation 檢查把 WHERE 拿掉時，端點那幾條測試全部照樣通過。）
    """

    def test_only_max_slots_can_ever_be_taken(self, db_session: Session, world):
        from services.analysis_quota import (
            MAX_AI_ANALYSIS_ATTEMPTS,
            reserve_analysis_slot,
        )

        progress = world["progress"]
        taken = [
            reserve_analysis_slot(progress, db_session)
            for _ in range(MAX_AI_ANALYSIS_ATTEMPTS + 2)
        ]
        db_session.commit()

        assert taken[:MAX_AI_ANALYSIS_ATTEMPTS] == list(
            range(1, MAX_AI_ANALYSIS_ATTEMPTS + 1)
        )
        # 超出的一律領不到（None），這是 AI 呼叫數有上限的唯一機制
        assert taken[MAX_AI_ANALYSIS_ATTEMPTS:] == [None, None]

        db_session.refresh(progress)
        assert progress.ai_analysis_count == MAX_AI_ANALYSIS_ATTEMPTS

    def test_refund_never_goes_below_zero(self, db_session: Session, world):
        from services.analysis_quota import refund_analysis_slot

        progress = world["progress"]
        for _ in range(3):
            refund_analysis_slot(progress, db_session)
        db_session.commit()

        db_session.refresh(progress)
        assert progress.ai_analysis_count == 0


class TestClassroomVisibility:
    """#1097：作業所屬班級停用或已刪除就不給。

    這個守衛是端點自己呼叫的（body 帶 item_progress_id，router 層的
    `_assignment_guards` 看不到作業 id），所以得自己測 —— reviewer 指出的缺口。
    """

    def test_inactive_classroom_is_refused_without_paying(
        self, test_client: TestClient, db_session: Session, world
    ):
        world["classroom"].is_active = False
        db_session.commit()

        spy = AsyncMock(return_value=AI_RESULT)
        with patch(PATCH_TARGET, new=spy):
            resp = _post(test_client, world)

        assert resp.status_code == 403
        assert "classroom_inactive" in resp.text
        spy.assert_not_awaited()

        # 也不該吃掉額度
        db_session.refresh(world["progress"])
        assert world["progress"].ai_analysis_count == 0

    def test_deleted_classroom_is_refused(
        self, test_client: TestClient, db_session: Session, world
    ):
        from datetime import datetime, timezone

        world["classroom"].deleted_at = datetime.now(timezone.utc)
        db_session.commit()

        spy = AsyncMock(return_value=AI_RESULT)
        with patch(PATCH_TARGET, new=spy):
            resp = _post(test_client, world)

        assert resp.status_code == 403
        spy.assert_not_awaited()


class TestCancellationRefunds:
    """`finally` 退款就是為了取消而存在的（`CancelledError` 是 BaseException）。

    沒有這條測試，有人把 `finally` 改回 `except Exception` 也不會有任何訊號 ——
    review R3 指出的缺口。
    """

    def test_cancelled_request_gives_the_slot_back(
        self, test_client: TestClient, db_session: Session, world
    ):
        import asyncio

        # `pytest.raises(BaseException)` 範圍很寬（TestClient 會不會原樣往外拋
        # CancelledError 取決於版本），所以真正的斷言是下面那句 count == 0。
        with patch(PATCH_TARGET, new=AsyncMock(side_effect=asyncio.CancelledError())):
            with pytest.raises(BaseException):  # noqa: B017
                _post(test_client, world)

        db_session.refresh(world["progress"])
        assert world["progress"].ai_analysis_count == 0


class TestQuotaExhaustedBodyShape:
    """429 的 body 形狀是前端（Stage 3）要讀的，鎖住它。"""

    def test_429_body(self, test_client: TestClient, db_session: Session, world):
        from services.analysis_quota import MAX_AI_ANALYSIS_ATTEMPTS

        world["progress"].ai_analysis_count = MAX_AI_ANALYSIS_ATTEMPTS
        db_session.commit()

        with patch(PATCH_TARGET, new=AsyncMock(return_value=AI_RESULT)):
            resp = _post(test_client, world)

        assert resp.status_code == 429
        detail = resp.json()["detail"]
        assert detail["code"] == "AI_ANALYSIS_QUOTA_EXCEEDED"
        assert detail["ai_analysis_remaining"] == 0
        assert detail["max_attempts"] == MAX_AI_ANALYSIS_ATTEMPTS


class TestHelpLimit:
    """每題求助最多 3 次（#1158 E2b）；第 4 次起不退額度、當正式作答。

    計數由後端自己記在 StudentItemProgress.retry_count（情境對話不用那一欄，借用免
    migration），前端改不到。
    """

    HELP = {**AI_RESULT, "kind": "phrase", "verdict": None, "suggestion": "park"}

    def test_three_helps_are_free_then_the_fourth_counts(
        self, test_client: TestClient, db_session: Session, world
    ):
        spy = AsyncMock(return_value=self.HELP)
        with patch(PATCH_TARGET, new=spy):
            for _ in range(3):
                body = _post(test_client, world).json()
                assert body["kind"] == "phrase"
                assert body["ai_analysis_count"] == 0
            # 前三次都允許求助
            assert [c.kwargs["allow_help"] for c in spy.await_args_list] == [True] * 3

            body = _post(test_client, world).json()

        # 第 4 次：告訴 service 不准求助；就算模型還是回 phrase，也當正式作答
        assert spy.await_args.kwargs["allow_help"] is False
        assert body["kind"] == "feedback"
        assert body["verdict"] == "improve"
        assert body["ai_analysis_count"] == 1
        assert body["ai_analysis_remaining"] == 2

        db_session.refresh(world["progress"])
        assert world["progress"].ai_analysis_count == 1
        assert world["progress"].retry_count == 3

    def test_formal_answers_do_not_use_up_help(
        self, test_client: TestClient, db_session: Session, world
    ):
        with patch(PATCH_TARGET, new=AsyncMock(return_value=AI_RESULT)):
            _post(test_client, world)
        db_session.refresh(world["progress"])
        assert (world["progress"].retry_count or 0) == 0

    def test_help_slot_is_atomic_and_capped(self, db_session: Session, world):
        from routers.students.scenario_dialogue import take_help_slot

        progress = world["progress"]
        taken = [take_help_slot(progress, db_session) for _ in range(5)]
        db_session.commit()
        assert taken == [True, True, True, False, False]
        db_session.refresh(progress)
        assert progress.retry_count == 3

    def test_lost_race_counts_as_an_answer(
        self, test_client: TestClient, db_session: Session, world
    ):
        """讀計數時還有名額，但 AI 回來前名額被別的請求用完 → 不退額度、當作答。"""
        progress = world["progress"]

        async def fill_up_while_waiting(**kwargs):
            assert kwargs["allow_help"] is True
            db_session.query(StudentItemProgress).filter(
                StudentItemProgress.id == progress.id
            ).update({StudentItemProgress.retry_count: 3})
            db_session.commit()
            return self.HELP

        with patch(PATCH_TARGET, new=AsyncMock(side_effect=fill_up_while_waiting)):
            body = _post(test_client, world).json()

        assert body["kind"] == "feedback"
        assert body["verdict"] == "improve"
        assert body["ai_analysis_count"] == 1


class TestResumePayload:
    """接著上次進度（#1158 E-4）：作業 payload 帶這題的錄音、作答次數與求助次數。

    前端重新進入時靠這三個欄位把上次答過的題目排成紀錄、從第一題沒答的開始，並讓
    剩餘次數與求助上限和後端一致（避免前端以為還有次數、後端回 429）。
    """

    def _activities(self, client: TestClient, db: Session, world):
        # 正式流程裡學生第一次打開作業時就建好了；這裡先建，免得端點自動補建題目進度
        # 而和 fixture 的那一筆撞到唯一鍵
        sa_id = world["progress"].student_assignment_id
        db.add(
            StudentContentProgress(
                student_assignment_id=sa_id,
                content_id=world["item"].content_id,
                order_index=0,
            )
        )
        db.commit()
        resp = client.get(
            f"/api/students/assignments/{sa_id}/activities",
            headers=world["headers"],
        )
        assert resp.status_code == 200, resp.text
        return resp.json()["activities"]

    def test_payload_carries_recording_and_counts(
        self, test_client: TestClient, db_session: Session, world
    ):
        world["progress"].ai_analysis_count = 2
        world["progress"].retry_count = 1
        db_session.commit()

        activities = self._activities(test_client, db_session, world)
        item = activities[0]["items"][0]
        assert item["recording_url"] == world["progress"].recording_url
        assert item["ai_analysis_count"] == 2
        assert item["help_count"] == 1

    def test_help_count_defaults_to_zero(
        self, test_client: TestClient, db_session: Session, world
    ):
        world["progress"].retry_count = None
        db_session.commit()
        item = self._activities(test_client, db_session, world)[0]["items"][0]
        assert item["help_count"] == 0

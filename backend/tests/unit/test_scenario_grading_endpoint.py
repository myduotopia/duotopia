"""情境對話 AI 評分端點 — Issue #1035。

這支端點只產生**建議**。整張單最不能出錯的一件事：AI 不可以幫老師把成績定案。
所以下面每一條 happy path 都會回頭確認 ``teacher_review_score`` / ``teacher_passed``
仍然是 None —— 老師仍是最終判定者。

第二件事：AI 的分數不可以寫進 accuracy_score / fluency_score / pronunciation_score。
那四欄是 Azure 發音評測的語意，作業層報告（services/analysis_service.py）直接讀
accuracy_score，混寫會讓兩邊的數字互相污染。
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


AI_RESULT = {
    "transcript": "I went to the park with my friends.",
    "scores": {"content": 80, "grammar": 70, "vocabulary": 75, "keywords": 100},
    "overall": 78,
    "feedback": "時態正確，可以多描述細節",
    "suggested_pass": True,
    "usage": {"input_tokens": 4000, "output_tokens": 300},
    "estimated_cost_usd": 0.00195,
}


def _make_world(db: Session, practice_mode: str = "scenario_dialogue"):
    """一份最小可批改的作業：老師 → 班級 → 課程 → 內容 → 指派 → 學生作答。"""
    teacher = Teacher(
        email=f"grade-{practice_mode}@teacher.com",
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
        type="SCENARIO_DIALOGUE",
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
        name="S", email=f"s-{practice_mode}@x.com", password_hash="x", birthdate=None
    )
    db.add(student)
    db.commit()

    assignment = Assignment(
        title="A",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        practice_mode=practice_mode,
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
        status="COMPLETED",
    )
    db.add(progress)
    db.commit()

    token = create_access_token(
        data={"sub": str(teacher.id), "type": "teacher", "email": teacher.email}
    )
    return {
        "teacher": teacher,
        "student": student,
        "assignment": assignment,
        "progress": progress,
        "headers": {"Authorization": f"Bearer {token}"},
    }


def _url(world) -> str:
    return (
        f"/api/teachers/assignments/{world['assignment'].id}"
        f"/scenario-ai-grade/{world['progress'].id}"
    )


@pytest.fixture
def graded(db_session: Session):
    return _make_world(db_session)


class TestSuggestionOnly:
    def test_ai_result_is_stored_but_the_grade_stays_the_teachers(
        self, test_client: TestClient, db_session: Session, graded
    ):
        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(return_value=AI_RESULT),
        ):
            resp = test_client.post(_url(graded), headers=graded["headers"])

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["transcript"] == AI_RESULT["transcript"]
        assert body["scores"]["grammar"] == 70
        assert body["suggested_pass"] is True

        db_session.refresh(graded["progress"])
        progress = graded["progress"]
        assert progress.scenario_grading_data["scores"]["content"] == 80
        assert progress.transcription == AI_RESULT["transcript"]

        # 這才是重點：AI 沒有幫老師定案
        assert progress.teacher_review_score is None
        assert progress.teacher_passed is None
        assert progress.teacher_reviewed_at is None

    def test_ai_scores_never_land_in_the_azure_columns(
        self, test_client: TestClient, db_session: Session, graded
    ):
        """混寫會污染作業層報告 —— 它直接讀 accuracy_score。"""
        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(return_value=AI_RESULT),
        ):
            test_client.post(_url(graded), headers=graded["headers"])

        db_session.refresh(graded["progress"])
        progress = graded["progress"]
        assert progress.accuracy_score is None
        assert progress.fluency_score is None
        assert progress.pronunciation_score is None
        assert progress.completeness_score is None


class TestGuards:
    def test_wrong_practice_mode_is_rejected(
        self, test_client: TestClient, db_session: Session
    ):
        """朗讀作業走錯端點時要擋下來，不能拿發音題去跑情境評分。"""
        world = _make_world(db_session, practice_mode="reading")
        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(return_value=AI_RESULT),
        ) as mock:
            resp = test_client.post(_url(world), headers=world["headers"])
        assert resp.status_code == 400
        assert mock.await_count == 0

    def test_missing_recording_is_rejected(
        self, test_client: TestClient, db_session: Session, graded
    ):
        graded["progress"].recording_url = None
        db_session.commit()
        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(return_value=AI_RESULT),
        ) as mock:
            resp = test_client.post(_url(graded), headers=graded["headers"])
        assert resp.status_code == 400
        assert mock.await_count == 0

    def test_other_teacher_cannot_grade(
        self, test_client: TestClient, db_session: Session, graded
    ):
        intruder = Teacher(
            email="intruder@teacher.com",
            name="I",
            password_hash="x",
            email_verified=True,
        )
        db_session.add(intruder)
        db_session.commit()
        token = create_access_token(
            data={"sub": str(intruder.id), "type": "teacher", "email": intruder.email}
        )
        resp = test_client.post(
            _url(graded), headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 403


class TestQuota:
    def test_fourth_attempt_is_refused(
        self, test_client: TestClient, db_session: Session, graded
    ):
        """沿用既有的每題 3 次上限 —— 同一段錄音的 AI 呼叫是同一種資源。"""
        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(return_value=AI_RESULT),
        ) as mock:
            for _ in range(3):
                assert (
                    test_client.post(
                        _url(graded),
                        headers=graded["headers"],
                        params={"force": "true"},
                    ).status_code
                    == 200
                )
            resp = test_client.post(
                _url(graded), headers=graded["headers"], params={"force": "true"}
            )
        assert resp.status_code == 429
        assert mock.await_count == 3

    def test_a_failed_call_does_not_burn_quota(
        self, test_client: TestClient, db_session: Session, graded
    ):
        from services.scenario_grading_ai import ScenarioGradingError

        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(side_effect=ScenarioGradingError("沒有辨識出任何內容")),
        ):
            resp = test_client.post(_url(graded), headers=graded["headers"])
        assert resp.status_code == 502

        db_session.refresh(graded["progress"])
        assert (graded["progress"].ai_analysis_count or 0) == 0


class TestCaching:
    def test_repeat_call_returns_the_stored_suggestion_without_paying_again(
        self, test_client: TestClient, db_session: Session, graded
    ):
        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(return_value=AI_RESULT),
        ) as mock:
            first = test_client.post(_url(graded), headers=graded["headers"])
            second = test_client.post(_url(graded), headers=graded["headers"])

        assert first.status_code == second.status_code == 200
        assert second.json()["scores"] == first.json()["scores"]
        assert second.json()["cached"] is True
        # 老師重整批改頁不該再燒一次 token
        assert mock.await_count == 1

    def test_force_reruns_the_model(
        self, test_client: TestClient, db_session: Session, graded
    ):
        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(return_value=AI_RESULT),
        ) as mock:
            test_client.post(_url(graded), headers=graded["headers"])
            resp = test_client.post(
                _url(graded), headers=graded["headers"], params={"force": "true"}
            )
        assert resp.status_code == 200
        assert resp.json()["cached"] is False
        assert mock.await_count == 2


class TestSuggestionReachesTheGradingPage:
    def test_stored_suggestion_is_in_the_submissions_payload(
        self, test_client: TestClient, db_session: Session, graded
    ):
        """老師重整批改頁要看得到上次的建議，而不是又按一次才出現。"""
        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(return_value=AI_RESULT),
        ):
            test_client.post(_url(graded), headers=graded["headers"])

        resp = test_client.get(
            f"/api/teachers/assignments/{graded['assignment'].id}"
            f"/submissions/{graded['student'].id}",
            headers=graded["headers"],
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()["submissions"]
        assert items, resp.text
        suggestion = items[0]["scenario_grading"]
        assert suggestion["transcript"] == AI_RESULT["transcript"]
        assert suggestion["scores"]["grammar"] == 70

    def test_usage_and_cost_stay_server_side(
        self, test_client: TestClient, db_session: Session, graded
    ):
        """token 用量與成本是我們的觀測資料，不必送到老師的瀏覽器。"""
        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(return_value=AI_RESULT),
        ):
            body = test_client.post(_url(graded), headers=graded["headers"]).json()
        assert "usage" not in body
        assert "estimated_cost_usd" not in body

        resp = test_client.get(
            f"/api/teachers/assignments/{graded['assignment'].id}"
            f"/submissions/{graded['student'].id}",
            headers=graded["headers"],
        )
        suggestion = resp.json()["submissions"][0]["scenario_grading"]
        assert "usage" not in suggestion
        assert "estimated_cost_usd" not in suggestion


class TestErrorKindsAreDistinguished:
    """「模型失敗」與「資料有問題」不能都回 502（PR #1036 review R2）。

    502 在前端顯示成「請稍後再試」。題目本身沒內容的話，重試一百次也不會變好 ——
    那是教材要修，老師需要知道差別。
    """

    def test_model_failure_is_502(self, test_client: TestClient, graded):
        from services.scenario_grading_ai import ScenarioGradingError

        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(side_effect=ScenarioGradingError("沒有辨識出任何內容")),
        ):
            resp = test_client.post(_url(graded), headers=graded["headers"])
        assert resp.status_code == 502

    def test_empty_question_is_422_not_502(
        self, test_client: TestClient, db_session: Session, graded
    ):
        """題目空白 = 教材資料不完整，不是暫時性的 AI 失敗。"""
        from models import ContentItem

        item = (
            db_session.query(ContentItem)
            .filter(ContentItem.id == graded["progress"].content_item_id)
            .first()
        )
        item.text = "   "
        db_session.commit()

        # 這裡刻意不 mock grade() —— 要驗的正是真的 build_prompt 擋下空題目
        resp = test_client.post(_url(graded), headers=graded["headers"])
        assert resp.status_code == 422, resp.text

        # 資料問題不該扣掉老師的 AI 額度
        db_session.refresh(graded["progress"])
        assert (graded["progress"].ai_analysis_count or 0) == 0


class TestDoubleClickOnlyPaysOnce:
    """雙擊只能打一次 AI（Issue #1025 / PR #1036 review）。

    第一版的修法是把額度改成「先扣再打」，但本機 review 證明那只擋得住上限邊界：
    計數還在 0/3 時兩個並發請求都滿足 `count < 3`，兩個都會打 Gemini。
    改用「正在進行中」的鎖之後，從計數 0 開始就擋得住。
    """

    def test_a_second_claim_arriving_mid_ai_is_refused(
        self, test_client: TestClient, db_session: Session, graded
    ):
        """第一個請求還在打 AI 的那一刻，第二個搶鎖必須失敗。

        不用巢狀 HTTP 請求模擬 —— TestClient 重入會共用同一個 session，測到的是
        那個限制而不是我們的鎖。改成在 AI 呼叫中途直接再搶一次鎖，那正是第二個請求
        會做的第一件事。
        """
        from services import scenario_grading_claim as claim_mod

        seen = {}

        async def grade(*args, **kwargs):
            # 此刻第一個請求已經持有鎖
            seen["outcome"], seen["count"], _ = claim_mod.claim(
                db_session, graded["progress"]
            )
            return AI_RESULT

        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(side_effect=grade),
        ):
            first = test_client.post(_url(graded), headers=graded["headers"])

        assert first.status_code == 200, first.text
        # 計數還在 1/3（遠離上限）也要擋住 —— 這是第一版修法漏掉的那一半
        assert seen["outcome"] == claim_mod.CLAIM_IN_PROGRESS
        assert seen["count"] == 1

    def test_in_progress_is_409_not_429(
        self, test_client: TestClient, db_session: Session, graded
    ):
        """額度沒用完時回 429 會誤導老師以為這題不能再按了。"""
        from services import scenario_grading_claim as claim_mod

        claim_mod.claim(db_session, graded["progress"])

        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(return_value=AI_RESULT),
        ) as mock:
            resp = test_client.post(
                _url(graded), headers=graded["headers"], params={"force": "true"}
            )

        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "SCENARIO_GRADING_IN_PROGRESS"
        assert mock.await_count == 0

    def test_the_lock_is_released_after_a_successful_run(
        self, test_client: TestClient, db_session: Session, graded
    ):
        """沒放鎖的話那一題會卡到逾時為止 —— 老師按了也沒反應。"""
        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(return_value=AI_RESULT),
        ):
            test_client.post(_url(graded), headers=graded["headers"])

        db_session.refresh(graded["progress"])
        assert graded["progress"].scenario_grading_started_at is None

    def test_the_lock_is_released_after_a_failure(
        self, test_client: TestClient, db_session: Session, graded
    ):
        from services.scenario_grading_ai import ScenarioGradingError

        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(side_effect=ScenarioGradingError("沒有辨識出任何內容")),
        ):
            test_client.post(_url(graded), headers=graded["headers"])

        db_session.refresh(graded["progress"])
        assert graded["progress"].scenario_grading_started_at is None


class TestQuotaIsReservedBeforeCallingAI:
    """雙擊不該打兩次 AI（Issue #1025 / PR #1036 review 指出的競態）。

    原本是 `check_can_analyze` → 打 AI → `increment_analysis_count`。中間那段 Gemini
    呼叫要好幾秒，老師雙擊（或開兩個分頁）時兩個請求會**雙雙通過閘門**：持久化的計數
    因為 UPDATE 是原子的所以仍正確，但**兩次 AI 都已經打出去了**，等於多付一次錢。

    改成先搶名額再打 AI。這幾條驗的是「額度在 AI 之前就扣掉」這個順序。
    """

    def test_quota_is_already_consumed_when_the_model_is_called(
        self, test_client: TestClient, db_session: Session, graded
    ):
        """AI 被呼叫的那一刻，計數必須已經 +1 —— 這就是「先佔位」的定義。"""
        seen = {}

        async def grade(*args, **kwargs):
            db_session.refresh(graded["progress"])
            seen["count_during_call"] = graded["progress"].ai_analysis_count
            return AI_RESULT

        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(side_effect=grade),
        ):
            resp = test_client.post(_url(graded), headers=graded["headers"])

        assert resp.status_code == 200, resp.text
        assert seen["count_during_call"] == 1

    def test_exhausted_quota_never_reaches_the_model(
        self, test_client: TestClient, db_session: Session, graded
    ):
        """搶不到名額要在打 AI 之前就回 429，一次呼叫都不浪費。"""
        from services.analysis_quota import MAX_AI_ANALYSIS_ATTEMPTS

        graded["progress"].ai_analysis_count = MAX_AI_ANALYSIS_ATTEMPTS
        db_session.commit()

        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(return_value=AI_RESULT),
        ) as mock:
            resp = test_client.post(
                _url(graded), headers=graded["headers"], params={"force": "true"}
            )

        assert resp.status_code == 429
        assert mock.await_count == 0

    def test_a_failed_call_returns_the_slot(
        self, test_client: TestClient, db_session: Session, graded
    ):
        """佔位成功但模型失敗 —— 名額要還回去，老師沒拿到東西。"""
        from services.scenario_grading_ai import ScenarioGradingError

        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(side_effect=ScenarioGradingError("沒有辨識出任何內容")),
        ):
            assert (
                test_client.post(_url(graded), headers=graded["headers"]).status_code
                == 502
            )

        db_session.refresh(graded["progress"])
        assert (graded["progress"].ai_analysis_count or 0) == 0

    def test_successful_call_counts_exactly_once(
        self, test_client: TestClient, db_session: Session, graded
    ):
        """佔位 + 不再 increment —— 搬成「先佔位」時最容易留下重複計數。"""
        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(return_value=AI_RESULT),
        ):
            test_client.post(_url(graded), headers=graded["headers"])

        db_session.refresh(graded["progress"])
        assert graded["progress"].ai_analysis_count == 1


class TestLostClaimDoesNotOverwrite:
    """逾時被接手後，原本那次分析不該把結果落地（PR #1123 review R2 第 1 點）。"""

    def test_result_is_returned_but_not_persisted_when_the_claim_was_lost(
        self, test_client: TestClient, db_session: Session, graded
    ):
        from datetime import datetime, timedelta, timezone

        from services import scenario_grading_claim as claim_mod

        async def grade(*args, **kwargs):
            # 模擬「這次跑太久被接手」：把鎖做舊，再讓另一個請求搶走
            graded["progress"].scenario_grading_started_at = datetime.now(
                timezone.utc
            ) - timedelta(seconds=claim_mod.STALE_AFTER_SECONDS + 10)
            db_session.commit()
            claim_mod.claim(db_session, graded["progress"])
            return AI_RESULT

        with patch(
            "services.scenario_grading_ai.ScenarioGradingService.grade",
            new=AsyncMock(side_effect=grade),
        ):
            resp = test_client.post(_url(graded), headers=graded["headers"])

        # 等了這麼久的這個請求還是拿得到結果
        assert resp.status_code == 200, resp.text
        assert resp.json()["transcript"] == AI_RESULT["transcript"]

        # 但沒有蓋掉新主人的 —— 資料庫裡仍是空的（新主人還在跑）
        db_session.refresh(graded["progress"])
        assert graded["progress"].scenario_grading_data is None

"""情境對話 AI 評分的「正在進行中」鎖 — Issue #1025。

PR #1036 review 指出老師雙擊會打兩次 Gemini。第一版的修法是把額度改成「先扣再打」，
但本機 review 證明那只擋得住**上限邊界**那一下：計數還在 0/3 時兩個並發請求都滿足
``count < 3``，兩個都扣成功、兩個都打了 AI。

所以這裡驗的是真正的那件事：**同一題同時只有一個分析搶得到**，而且是從計數 0 開始
就擋得住 —— 不是只有邊界。
"""
from datetime import datetime, timedelta, timezone

import pytest

from models import (
    Assignment,
    Classroom,
    Content,
    ContentItem,
    Lesson,
    Program,
    Student,
    StudentAssignment,
    StudentItemProgress,
    Teacher,
)
from services import scenario_grading_claim as claim_mod
from services.analysis_quota import MAX_AI_ANALYSIS_ATTEMPTS


@pytest.fixture
def progress(db_session):
    teacher = Teacher(
        email="claim@teacher.com", name="T", password_hash="x", email_verified=True
    )
    db_session.add(teacher)
    db_session.commit()
    classroom = Classroom(name="C", teacher_id=teacher.id, grade="Grade 1")
    db_session.add(classroom)
    db_session.commit()
    program = Program(
        name="P", description="d", teacher_id=teacher.id, classroom_id=classroom.id
    )
    db_session.add(program)
    db_session.commit()
    lesson = Lesson(
        name="L",
        description="d",
        program_id=program.id,
        order_index=1,
        estimated_minutes=30,
    )
    db_session.add(lesson)
    db_session.commit()
    content = Content(lesson_id=lesson.id, title="C", type="SCENARIO_DIALOGUE")
    db_session.add(content)
    db_session.commit()
    item = ContentItem(content_id=content.id, order_index=0, text="Q?")
    db_session.add(item)
    student = Student(
        name="S", email="claim-s@x.com", password_hash="x", birthdate=None
    )
    db_session.add(student)
    db_session.commit()
    assignment = Assignment(
        title="A",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        practice_mode="scenario_dialogue",
    )
    db_session.add(assignment)
    db_session.commit()
    sa = StudentAssignment(
        assignment_id=assignment.id,
        student_id=student.id,
        classroom_id=classroom.id,
        title="A",
    )
    db_session.add(sa)
    db_session.commit()
    row = StudentItemProgress(
        student_assignment_id=sa.id,
        content_item_id=item.id,
        recording_url="https://storage.googleapis.com/b/recordings/a.webm",
        status="COMPLETED",
    )
    db_session.add(row)
    db_session.commit()
    return row


class TestOnlyOneClaimAtATime:
    def test_second_claim_from_zero_is_refused(self, db_session, progress):
        """**從計數 0 開始**就要擋住 —— 這是第一版修法漏掉的那一半。

        光靠 `count < MAX` 的話，0/3 時兩個請求都會通過（0→1、1→2），兩次 AI 都打
        出去。鎖的條件是「沒人在跑」，與計數還剩多少無關。
        """
        assert progress.ai_analysis_count in (0, None)

        first, _ = claim_mod.claim(db_session, progress)
        second, count = claim_mod.claim(db_session, progress)

        assert first == claim_mod.CLAIM_OK
        assert second == claim_mod.CLAIM_IN_PROGRESS
        # 第二次沒搶到就不該扣額度
        assert count == 1

    def test_release_lets_the_next_one_in(self, db_session, progress):
        claim_mod.claim(db_session, progress)
        claim_mod.release(db_session, progress, refund=False)

        again, _ = claim_mod.claim(db_session, progress)
        assert again == claim_mod.CLAIM_OK

    def test_in_progress_is_not_reported_as_quota_exhausted(self, db_session, progress):
        """兩種拒絕對老師的意思完全不同：一個等一下就有，一個這題不用再按了。"""
        claim_mod.claim(db_session, progress)
        outcome, _ = claim_mod.claim(db_session, progress)

        assert outcome != claim_mod.CLAIM_QUOTA_EXHAUSTED


class TestQuotaStillApplies:
    def test_quota_exhausted_is_reported_separately(self, db_session, progress):
        progress.ai_analysis_count = MAX_AI_ANALYSIS_ATTEMPTS
        db_session.commit()

        outcome, count = claim_mod.claim(db_session, progress)

        assert outcome == claim_mod.CLAIM_QUOTA_EXHAUSTED
        assert count == MAX_AI_ANALYSIS_ATTEMPTS

    def test_successful_claim_counts_exactly_once(self, db_session, progress):
        claim_mod.claim(db_session, progress)
        db_session.refresh(progress)
        assert progress.ai_analysis_count == 1

    def test_release_with_refund_returns_the_slot(self, db_session, progress):
        claim_mod.claim(db_session, progress)
        claim_mod.release(db_session, progress, refund=True)

        db_session.refresh(progress)
        assert progress.ai_analysis_count == 0
        assert progress.scenario_grading_started_at is None

    def test_refund_never_goes_negative(self, db_session, progress):
        """例外路徑重入時可能放兩次鎖 —— 不能把計數扣成負的。"""
        claim_mod.claim(db_session, progress)
        claim_mod.release(db_session, progress, refund=True)
        claim_mod.release(db_session, progress, refund=True)

        db_session.refresh(progress)
        assert progress.ai_analysis_count == 0

    def test_release_always_clears_the_lock_even_when_count_is_zero(
        self, db_session, progress
    ):
        """計數已是 0 時，退款那句 UPDATE 匹配不到列 —— 鎖還是得放掉。

        少了這個，那一題會卡到逾時為止。
        """
        claim_mod.claim(db_session, progress)
        claim_mod.release(db_session, progress, refund=True)
        claim_mod.release(db_session, progress, refund=True)

        db_session.refresh(progress)
        assert progress.scenario_grading_started_at is None


class TestStaleLockSelfReleases:
    def test_a_stale_lock_can_be_taken_over(self, db_session, progress):
        """程序被殺掉時不會執行放鎖 —— 沒有逾時的話那一題會永久卡住。"""
        progress.scenario_grading_started_at = datetime.now(timezone.utc) - timedelta(
            seconds=claim_mod.STALE_AFTER_SECONDS + 10
        )
        db_session.commit()

        outcome, _ = claim_mod.claim(db_session, progress)
        assert outcome == claim_mod.CLAIM_OK

    def test_a_fresh_lock_is_not_stolen(self, db_session, progress):
        progress.scenario_grading_started_at = datetime.now(timezone.utc) - timedelta(
            seconds=5
        )
        db_session.commit()

        outcome, _ = claim_mod.claim(db_session, progress)
        assert outcome == claim_mod.CLAIM_IN_PROGRESS

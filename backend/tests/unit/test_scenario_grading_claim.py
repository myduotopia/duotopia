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

        first, _, _token = claim_mod.claim(db_session, progress)
        second, count, _token = claim_mod.claim(db_session, progress)

        assert first == claim_mod.CLAIM_OK
        assert second == claim_mod.CLAIM_IN_PROGRESS
        # 第二次沒搶到就不該扣額度
        assert count == 1

    def test_release_lets_the_next_one_in(self, db_session, progress):
        _, _, token = claim_mod.claim(db_session, progress)
        claim_mod.release(db_session, progress, token, refund=False)

        again, _, _ = claim_mod.claim(db_session, progress)
        assert again == claim_mod.CLAIM_OK

    def test_in_progress_is_not_reported_as_quota_exhausted(self, db_session, progress):
        """兩種拒絕對老師的意思完全不同：一個等一下就有，一個這題不用再按了。"""
        claim_mod.claim(db_session, progress)
        outcome, _, _token = claim_mod.claim(db_session, progress)

        assert outcome != claim_mod.CLAIM_QUOTA_EXHAUSTED


class TestQuotaStillApplies:
    def test_quota_exhausted_is_reported_separately(self, db_session, progress):
        progress.ai_analysis_count = MAX_AI_ANALYSIS_ATTEMPTS
        db_session.commit()

        outcome, count, _token = claim_mod.claim(db_session, progress)

        assert outcome == claim_mod.CLAIM_QUOTA_EXHAUSTED
        assert count == MAX_AI_ANALYSIS_ATTEMPTS

    def test_successful_claim_counts_exactly_once(self, db_session, progress):
        claim_mod.claim(db_session, progress)
        db_session.refresh(progress)
        assert progress.ai_analysis_count == 1

    def test_release_with_refund_returns_the_slot(self, db_session, progress):
        _, _, token = claim_mod.claim(db_session, progress)
        claim_mod.release(db_session, progress, token, refund=True)

        db_session.refresh(progress)
        assert progress.ai_analysis_count == 0
        assert progress.scenario_grading_started_at is None

    def test_releasing_twice_does_not_double_refund(self, db_session, progress):
        """例外路徑重入時可能放兩次 —— 第二次要什麼都不做。

        靠的不是 max(0, …) 而是 token：第一次 release 已經把 started_at 清成 NULL，
        第二次的 UPDATE 就匹配不到列了。比夾 0 更準 —— 夾 0 只是把症狀蓋掉。
        """
        _, _, token = claim_mod.claim(db_session, progress)
        assert claim_mod.release(db_session, progress, token, refund=True) is True
        assert claim_mod.release(db_session, progress, token, refund=True) is False

        db_session.refresh(progress)
        assert progress.ai_analysis_count == 0

    def test_release_without_a_token_does_nothing(self, db_session, progress):
        """沒搶到鎖的人不該放鎖 —— 否則第二個請求會把第一個的鎖清掉。"""
        _, _, token = claim_mod.claim(db_session, progress)
        refused, _, no_token = claim_mod.claim(db_session, progress)
        assert refused == claim_mod.CLAIM_IN_PROGRESS
        assert no_token is None

        assert claim_mod.release(db_session, progress, no_token, refund=True) is False

        db_session.refresh(progress)
        # 第一個的鎖與額度都還在
        assert progress.scenario_grading_started_at is not None
        assert progress.ai_analysis_count == 1
        claim_mod.release(db_session, progress, token, refund=False)


class TestStaleLockSelfReleases:
    def test_a_stale_lock_can_be_taken_over(self, db_session, progress):
        """程序被殺掉時不會執行放鎖 —— 沒有逾時的話那一題會永久卡住。"""
        progress.scenario_grading_started_at = datetime.now(timezone.utc) - timedelta(
            seconds=claim_mod.STALE_AFTER_SECONDS + 10
        )
        db_session.commit()

        outcome, _, _token = claim_mod.claim(db_session, progress)
        assert outcome == claim_mod.CLAIM_OK

    def test_a_fresh_lock_is_not_stolen(self, db_session, progress):
        progress.scenario_grading_started_at = datetime.now(timezone.utc) - timedelta(
            seconds=5
        )
        db_session.commit()

        outcome, _, _token = claim_mod.claim(db_session, progress)
        assert outcome == claim_mod.CLAIM_IN_PROGRESS


class TestTakeoverDoesNotCorruptTheNewOwner:
    """逾時被接手之後，原本那個回來時不能動到新主人的鎖與額度。

    這是 PR #1123 review 2、3 指出的問題：release 若只比對 id 就無條件清掉
    started_at，A 會把 B 的鎖清掉、還把 B 的那一次額度退掉，於是第三個請求在 B 還在
    跑的時候又進來了。
    """

    def test_the_original_runner_cannot_clear_the_new_lock(self, db_session, progress):
        _, _, token_a = claim_mod.claim(db_session, progress)

        # A 跑太久 —— 把它的鎖做舊，讓 B 接手得到
        progress.scenario_grading_started_at = datetime.now(timezone.utc) - timedelta(
            seconds=claim_mod.STALE_AFTER_SECONDS + 10
        )
        db_session.commit()
        outcome_b, _, token_b = claim_mod.claim(db_session, progress)
        assert outcome_b == claim_mod.CLAIM_OK

        # A 這時候才回來
        assert claim_mod.release(db_session, progress, token_a, refund=True) is False

        db_session.refresh(progress)
        # B 的鎖還在，第三個請求進不來
        assert progress.scenario_grading_started_at is not None
        outcome_c, _, _ = claim_mod.claim(db_session, progress)
        assert outcome_c == claim_mod.CLAIM_IN_PROGRESS

        # B 自己放得掉
        assert claim_mod.release(db_session, progress, token_b, refund=False) is True

    def test_the_original_runner_does_not_refund_the_new_owners_slot(
        self, db_session, progress
    ):
        _, _, token_a = claim_mod.claim(db_session, progress)
        progress.scenario_grading_started_at = datetime.now(timezone.utc) - timedelta(
            seconds=claim_mod.STALE_AFTER_SECONDS + 10
        )
        db_session.commit()
        claim_mod.claim(db_session, progress)

        db_session.refresh(progress)
        before = progress.ai_analysis_count

        claim_mod.release(db_session, progress, token_a, refund=True)

        db_session.refresh(progress)
        # A 自己扣掉的那一次不退（單一計數器分不出誰的 +1，退掉就是退 B 的）——
        # A 跑超過 180 秒本來就是異常，算它一次比誤退別人安全
        assert progress.ai_analysis_count == before


class TestReleaseSurvivesAFailedSession:
    def test_release_works_after_a_failed_commit(self, db_session, progress):
        """呼叫端的 commit 失敗後 session 會停在失敗狀態。

        release 不先 rollback 的話，這裡下查詢會丟 PendingRollbackError，把原本的
        錯誤蓋掉，而且鎖要卡到逾時才會放（PR #1123 review 1）。
        """
        from sqlalchemy.exc import IntegrityError

        _, _, token = claim_mod.claim(db_session, progress)

        # 製造一個失敗的 flush，讓 session 進入需要 rollback 的狀態
        try:
            db_session.add(
                StudentItemProgress(student_assignment_id=None, content_item_id=None)
            )
            db_session.flush()
        except (IntegrityError, Exception):
            pass

        # 不應該丟例外，而且鎖要真的放掉
        assert claim_mod.release(db_session, progress, token, refund=True) is True

        db_session.refresh(progress)
        assert progress.scenario_grading_started_at is None
        assert progress.ai_analysis_count == 0


class TestStillHolds:
    """寫入結果之前要先確認鎖還是自己的（PR #1123 review R2 第 1 點）。

    放鎖有 token 保護，但「寫結果」沒有 —— 逾時被接手之後，原本那個算完照樣能把
    結果 commit 進去蓋掉新主人的。
    """

    def test_true_while_we_hold_it(self, db_session, progress):
        _, _, token = claim_mod.claim(db_session, progress)
        assert claim_mod.still_holds(db_session, progress, token) is True

    def test_false_after_being_taken_over(self, db_session, progress):
        _, _, token_a = claim_mod.claim(db_session, progress)
        progress.scenario_grading_started_at = datetime.now(timezone.utc) - timedelta(
            seconds=claim_mod.STALE_AFTER_SECONDS + 10
        )
        db_session.commit()
        claim_mod.claim(db_session, progress)

        assert claim_mod.still_holds(db_session, progress, token_a) is False

    def test_false_after_release(self, db_session, progress):
        _, _, token = claim_mod.claim(db_session, progress)
        claim_mod.release(db_session, progress, token, refund=False)

        assert claim_mod.still_holds(db_session, progress, token) is False

    def test_false_without_a_token(self, db_session, progress):
        claim_mod.claim(db_session, progress)
        assert claim_mod.still_holds(db_session, progress, None) is False

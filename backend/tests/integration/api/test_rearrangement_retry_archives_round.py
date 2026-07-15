"""Integration test — retry 封存「剛結束那一輪」的選字歷程到 attempts[]（#679）。

Bug（staging 回報）：學生強制重來時，前端只送 content_item_id，該輪選字歷程
（在前端本地驗證、不經 answer endpoint）沒送給後端 → retry endpoint 無可封存，
只增加 retry_count。批改頁因此看不到重試/錯誤的歷程。

修正：retry 帶 selections/error_count/expected_score/timeout，後端封存為
force_retry（或 timeout）attempt。

用 in-memory SQLite + 直接呼叫 endpoint 函式，本機無 Postgres 亦可跑。
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import (
    Assignment,
    AssignmentContent,
    Content,
    ContentItem,
    StudentItemProgress,
)
from routers.students.assignments import retry_rearrangement
from routers.students.validators import (
    RearrangementRetryRequest,
    RearrangementSelectionRecord,
)
from tests.factories import TestDataFactory


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _setup(db):
    teacher = TestDataFactory.create_teacher(db)
    classroom = TestDataFactory.create_classroom(db, teacher)
    student = TestDataFactory.create_student(db, classroom=classroom)
    program = TestDataFactory.create_program(db, teacher)
    lesson = TestDataFactory.create_lesson(db, program)

    content = Content(lesson_id=lesson.id, title="例句", type="EXAMPLE_SENTENCES")
    db.add(content)
    db.commit()
    item = ContentItem(
        content_id=content.id, text="A B C D", word_count=4, max_errors=3, order_index=0
    )
    db.add(item)
    db.commit()

    assignment = Assignment(
        title="重組作業",
        description="",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        practice_mode="rearrangement",
    )
    db.add(assignment)
    db.commit()
    db.add(
        AssignmentContent(
            assignment_id=assignment.id, content_id=content.id, order_index=0
        )
    )
    db.commit()
    sa = TestDataFactory.create_student_assignment(db, student, assignment, classroom)

    progress = StudentItemProgress(
        student_assignment_id=sa.id,
        content_item_id=item.id,
        status="IN_PROGRESS",
        error_count=3,
        expected_score=25.0,
        retry_count=0,
        rearrangement_data={"selections": [], "attempts": []},
    )
    db.add(progress)
    db.commit()
    return student, sa, item, progress


def _round_selections(n_wrong):
    """一輪選字：先錯 n_wrong 次（達上限）。"""
    sels = []
    for i in range(n_wrong):
        sels.append(
            RearrangementSelectionRecord(
                position=0,
                selected="X",
                correct="A",
                is_correct=False,
                timestamp="2026-07-10T05:00:0%d+00:00" % i,
            )
        )
    return sels


class TestRetryArchivesRound:
    @pytest.mark.asyncio
    async def test_force_retry_archives_round_selections(self, db_session):
        db = db_session
        student, sa, item, progress = _setup(db)

        req = RearrangementRetryRequest(
            content_item_id=item.id,
            selections=_round_selections(3),
            error_count=3,
            expected_score=25.0,
            timeout=False,
        )
        await retry_rearrangement(
            student_assignment_id=sa.id,
            request=req,
            current_student={"sub": str(student.id)},
            db=db,
        )

        db.refresh(progress)
        rd = progress.rearrangement_data
        assert progress.retry_count == 1
        assert len(rd["attempts"]) == 1
        att = rd["attempts"][0]
        assert att["ended_reason"] == "force_retry"
        assert att["error_count"] == 3
        assert len(att["selections"]) == 3
        # 開新一輪：selections 清空
        assert rd["selections"] == []

    @pytest.mark.asyncio
    async def test_multiple_retries_accumulate(self, db_session):
        db = db_session
        student, sa, item, progress = _setup(db)

        for round_no in range(3):
            req = RearrangementRetryRequest(
                content_item_id=item.id,
                selections=_round_selections(3),
                error_count=3,
                expected_score=0.0,
                timeout=False,
            )
            await retry_rearrangement(
                student_assignment_id=sa.id,
                request=req,
                current_student={"sub": str(student.id)},
                db=db,
            )

        db.refresh(progress)
        rd = progress.rearrangement_data
        assert progress.retry_count == 3
        assert len(rd["attempts"]) == 3
        assert all(a["ended_reason"] == "force_retry" for a in rd["attempts"])

    @pytest.mark.asyncio
    async def test_empty_selections_does_not_add_blank_attempt(self, db_session):
        """完成後再重試：該輪已由 complete 封存，前端送空 selections → 不重複封存。"""
        db = db_session
        student, sa, item, progress = _setup(db)

        req = RearrangementRetryRequest(
            content_item_id=item.id,
            selections=[],  # 完成的那一輪不重送
            error_count=0,
            expected_score=100.0,
            timeout=False,
        )
        await retry_rearrangement(
            student_assignment_id=sa.id,
            request=req,
            current_student={"sub": str(student.id)},
            db=db,
        )

        db.refresh(progress)
        rd = progress.rearrangement_data
        assert progress.retry_count == 1  # 仍記錄重試次數
        assert rd["attempts"] == []  # 但不新增空白 attempt

    @pytest.mark.asyncio
    async def test_timeout_round_archived_with_timeout_reason(self, db_session):
        db = db_session
        student, sa, item, progress = _setup(db)

        req = RearrangementRetryRequest(
            content_item_id=item.id,
            selections=_round_selections(2),
            error_count=2,
            expected_score=50.0,
            timeout=True,
        )
        await retry_rearrangement(
            student_assignment_id=sa.id,
            request=req,
            current_student={"sub": str(student.id)},
            db=db,
        )

        db.refresh(progress)
        att = progress.rearrangement_data["attempts"][0]
        assert att["ended_reason"] == "timeout"

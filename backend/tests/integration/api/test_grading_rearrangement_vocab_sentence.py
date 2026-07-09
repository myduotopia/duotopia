"""Integration test — 單字集派成例句重組時，批改頁題目應顯示例句而非單字。

Bug（#679 staging 回報）：學生端出題用 ``get_sentence_fields`` → 對單字集
（VOCABULARY_SET）用 ``example_sentence`` 當重組句子，但批改頁
``get_student_submission`` 無條件用 ``item.text``（單字本身），導致批改頁顯示
單字而非學生實際重組的例句。

用 in-memory SQLite + 直接呼叫 endpoint 函式（不經 auth / TestClient），可在
本機無 Postgres 環境執行。
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
from routers.assignments import get_student_submission
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


WORD = "table"
SENTENCE = "A table for two, please."
SENTENCE_TRANSLATION = "兩位的桌子，麻煩了。"


def _build_vocab_rearrangement_assignment(db):
    """單字集內容 + 例句重組作業 + 學生作業 + 進度。回傳 (assignment_id, student_id, teacher)."""
    teacher = TestDataFactory.create_teacher(db)
    classroom = TestDataFactory.create_classroom(db, teacher)
    student = TestDataFactory.create_student(db, classroom=classroom)
    program = TestDataFactory.create_program(db, teacher)
    lesson = TestDataFactory.create_lesson(db, program)

    # 單字集：ContentItem.text 是單字，example_sentence 才是要重組的句子
    content = Content(lesson_id=lesson.id, title="單字集", type="VOCABULARY_SET")
    db.add(content)
    db.commit()

    item = ContentItem(
        content_id=content.id,
        text=WORD,
        translation="桌子",
        example_sentence=SENTENCE,
        example_sentence_translation=SENTENCE_TRANSLATION,
        word_count=5,
        max_errors=3,
        order_index=0,
    )
    db.add(item)
    db.commit()

    assignment = Assignment(
        title="例句重組作業",
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

    student_assignment = TestDataFactory.create_student_assignment(
        db, student, assignment, classroom
    )

    db.add(
        StudentItemProgress(
            student_assignment_id=student_assignment.id,
            content_item_id=item.id,
            status="COMPLETED",
            expected_score=100.0,
            error_count=0,
            rearrangement_data={"selections": [], "attempts": []},
        )
    )
    db.commit()

    return assignment.id, student.id, teacher


class TestGradingRearrangementVocabSentence:
    @pytest.mark.asyncio
    async def test_question_text_is_example_sentence_not_word(self, db_session):
        assignment_id, student_id, teacher = _build_vocab_rearrangement_assignment(
            db_session
        )

        response = await get_student_submission(
            assignment_id=assignment_id,
            student_id=student_id,
            current_teacher=teacher,
            db=db_session,
        )

        submissions = response["submissions"]
        assert len(submissions) == 1
        sub = submissions[0]

        # 核心：批改頁題目要顯示例句（學生重組的內容），不是單字本身
        assert sub["question_text"] == SENTENCE
        assert sub["question_text"] != WORD
        # 翻譯也應對應例句翻譯
        assert sub["question_translation"] == SENTENCE_TRANSLATION

    @pytest.mark.asyncio
    async def test_non_vocab_rearrangement_still_uses_item_text(self, db_session):
        """回歸守衛：非單字集（EXAMPLE_SENTENCES）重組仍用 item.text，不受影響。"""
        db = db_session
        teacher = TestDataFactory.create_teacher(db)
        classroom = TestDataFactory.create_classroom(db, teacher)
        student = TestDataFactory.create_student(db, classroom=classroom)
        program = TestDataFactory.create_program(db, teacher)
        lesson = TestDataFactory.create_lesson(db, program)

        # 例句類型：item.text 本身就是要重組的句子
        content = Content(lesson_id=lesson.id, title="例句", type="EXAMPLE_SENTENCES")
        db.add(content)
        db.commit()
        item = ContentItem(
            content_id=content.id,
            text=SENTENCE,
            translation=SENTENCE_TRANSLATION,
            word_count=5,
            max_errors=3,
            order_index=0,
        )
        db.add(item)
        db.commit()

        assignment = Assignment(
            title="例句重組作業",
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
        TestDataFactory.create_student_assignment(db, student, assignment, classroom)

        response = await get_student_submission(
            assignment_id=assignment.id,
            student_id=student.id,
            current_teacher=teacher,
            db=db,
        )
        sub = response["submissions"][0]
        assert sub["question_text"] == SENTENCE

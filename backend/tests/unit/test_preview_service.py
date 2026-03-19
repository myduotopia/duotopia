"""
Unit tests for services.preview_service

Verifies that the shared preview service functions produce the expected
output structure, so that both demo.py and assignment_ops.py stay in sync.
"""

import pytest
from datetime import datetime, timedelta

from models import (
    Teacher,
    Classroom,
    Assignment,
    AssignmentContent,
    Content,
    ContentItem,
    ContentType,
    Lesson,
    Program,
)
from auth import get_password_hash
from services.preview_service import (
    build_assignment_preview,
    get_vocabulary_activities,
    get_word_selection_start,
    check_word_selection_answer,
    get_rearrangement_questions,
    check_rearrangement_answer,
    handle_rearrangement_retry,
    handle_rearrangement_complete,
    _parse_exclude_ids,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def preview_teacher(shared_test_session):
    """Create a teacher for preview tests."""
    teacher = Teacher(
        email="preview-teacher@test.com",
        password_hash=get_password_hash("pw"),
        name="Preview Teacher",
        is_active=True,
        is_demo=False,
        email_verified=True,
    )
    shared_test_session.add(teacher)
    shared_test_session.commit()
    shared_test_session.refresh(teacher)
    return teacher


@pytest.fixture
def preview_classroom(shared_test_session, preview_teacher):
    classroom = Classroom(
        name="Preview Class",
        teacher_id=preview_teacher.id,
    )
    shared_test_session.add(classroom)
    shared_test_session.commit()
    shared_test_session.refresh(classroom)
    return classroom


@pytest.fixture
def _program_and_lesson(shared_test_session, preview_teacher, preview_classroom):
    """Create a program + lesson (internal helper)."""
    program = Program(
        name="P",
        teacher_id=preview_teacher.id,
        classroom_id=preview_classroom.id,
    )
    shared_test_session.add(program)
    shared_test_session.flush()
    lesson = Lesson(program_id=program.id, name="L")
    shared_test_session.add(lesson)
    shared_test_session.commit()
    shared_test_session.refresh(lesson)
    return lesson


def _make_assignment(session, classroom, teacher, lesson, **overrides):
    """Helper to create an Assignment with contents and items."""
    defaults = dict(
        title="Test Assignment",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        due_date=datetime.utcnow() + timedelta(days=7),
        practice_mode="reading_assessment",
    )
    defaults.update(overrides)
    assignment = Assignment(**defaults)
    session.add(assignment)
    session.flush()

    # Create 2 contents with 3 items each
    for ci in range(2):
        content = Content(
            lesson_id=lesson.id,
            type=ContentType.READING_ASSESSMENT,
            title=f"Content {ci + 1}",
            target_wpm=100,
            target_accuracy=80,
        )
        session.add(content)
        session.flush()

        for ii in range(3):
            item = ContentItem(
                content_id=content.id,
                text=f"word{ci}_{ii}",
                translation=f"翻譯{ci}_{ii}",
                order_index=ii,
            )
            session.add(item)
        session.flush()

        ac = AssignmentContent(
            assignment_id=assignment.id,
            content_id=content.id,
            order_index=ci,
        )
        session.add(ac)

    session.commit()
    session.refresh(assignment)
    return assignment


# ---------------------------------------------------------------------------
# Tests: build_assignment_preview
# ---------------------------------------------------------------------------


class TestBuildAssignmentPreview:
    def test_returns_expected_keys(
        self,
        shared_test_session,
        preview_teacher,
        preview_classroom,
        _program_and_lesson,
    ):
        assignment = _make_assignment(
            shared_test_session,
            preview_classroom,
            preview_teacher,
            _program_and_lesson,
        )
        result = build_assignment_preview(assignment, shared_test_session)

        assert result["assignment_id"] == assignment.id
        assert result["status"] == "preview"
        assert result["total_activities"] == 2
        assert len(result["activities"]) == 2

    def test_activity_items_structure(
        self,
        shared_test_session,
        preview_teacher,
        preview_classroom,
        _program_and_lesson,
    ):
        assignment = _make_assignment(
            shared_test_session,
            preview_classroom,
            preview_teacher,
            _program_and_lesson,
        )
        result = build_assignment_preview(assignment, shared_test_session)

        first = result["activities"][0]
        assert first["item_count"] == 3
        assert first["items"][0]["recording_url"] is None
        assert "text" in first["items"][0]
        assert "translation" in first["items"][0]

    def test_reading_assessment_extra_fields(
        self,
        shared_test_session,
        preview_teacher,
        preview_classroom,
        _program_and_lesson,
    ):
        assignment = _make_assignment(
            shared_test_session,
            preview_classroom,
            preview_teacher,
            _program_and_lesson,
        )
        result = build_assignment_preview(assignment, shared_test_session)
        first = result["activities"][0]
        assert "target_wpm" in first
        assert "target_accuracy" in first


# ---------------------------------------------------------------------------
# Tests: get_vocabulary_activities
# ---------------------------------------------------------------------------


class TestGetVocabularyActivities:
    def test_wrong_mode_raises(
        self,
        shared_test_session,
        preview_teacher,
        preview_classroom,
        _program_and_lesson,
    ):
        assignment = _make_assignment(
            shared_test_session,
            preview_classroom,
            preview_teacher,
            _program_and_lesson,
            practice_mode="rearrangement",
        )
        with pytest.raises(Exception) as exc_info:
            get_vocabulary_activities(assignment, shared_test_session)
        assert exc_info.value.status_code == 400

    def test_returns_items(
        self,
        shared_test_session,
        preview_teacher,
        preview_classroom,
        _program_and_lesson,
    ):
        assignment = _make_assignment(
            shared_test_session,
            preview_classroom,
            preview_teacher,
            _program_and_lesson,
            practice_mode="word_reading",
        )
        result = get_vocabulary_activities(assignment, shared_test_session)
        assert result["practice_mode"] == "word_reading"
        assert result["total_items"] == 6  # 2 contents * 3 items
        assert result["items"][0]["recording_url"] is None


# ---------------------------------------------------------------------------
# Tests: get_word_selection_start
# ---------------------------------------------------------------------------


class TestGetWordSelectionStart:
    def test_returns_words_with_options(
        self,
        shared_test_session,
        preview_teacher,
        preview_classroom,
        _program_and_lesson,
    ):
        assignment = _make_assignment(
            shared_test_session,
            preview_classroom,
            preview_teacher,
            _program_and_lesson,
            practice_mode="word_selection",
        )
        result = get_word_selection_start(assignment, shared_test_session)
        assert result["session_id"] is None
        assert len(result["words"]) <= 10
        # Each word has 4 options (1 correct + 3 distractors)
        for w in result["words"]:
            assert len(w["options"]) == 4
            assert w["content_item_id"] is not None

    def test_exclude_ids(
        self,
        shared_test_session,
        preview_teacher,
        preview_classroom,
        _program_and_lesson,
    ):
        assignment = _make_assignment(
            shared_test_session,
            preview_classroom,
            preview_teacher,
            _program_and_lesson,
            practice_mode="word_selection",
        )
        # Get all IDs first
        first = get_word_selection_start(assignment, shared_test_session)
        all_ids = [w["content_item_id"] for w in first["words"]]

        # Exclude first 3 — since total is 6 and remaining (3) < 10, cycle resets
        exclude = ",".join(str(i) for i in all_ids[:3])
        second = get_word_selection_start(
            assignment, shared_test_session, exclude_ids=exclude
        )
        assert len(second["words"]) > 0


# ---------------------------------------------------------------------------
# Tests: _parse_exclude_ids
# ---------------------------------------------------------------------------


class TestParseExcludeIds:
    def test_empty(self):
        assert _parse_exclude_ids("") == set()

    def test_valid(self):
        assert _parse_exclude_ids("1,2,3") == {1, 2, 3}

    def test_with_invalid_tokens(self):
        assert _parse_exclude_ids("1,abc,3") == {1, 3}

    def test_spaces(self):
        assert _parse_exclude_ids(" 1 , 2 , 3 ") == {1, 2, 3}


# ---------------------------------------------------------------------------
# Tests: check_word_selection_answer
# ---------------------------------------------------------------------------


class TestCheckWordSelectionAnswer:
    def test_correct_answer(
        self,
        shared_test_session,
        preview_teacher,
        preview_classroom,
        _program_and_lesson,
    ):
        assignment = _make_assignment(
            shared_test_session,
            preview_classroom,
            preview_teacher,
            _program_and_lesson,
            practice_mode="word_selection",
        )
        # Get an item
        item = shared_test_session.query(ContentItem).first()
        result = check_word_selection_answer(
            item.id, item.translation, assignment, shared_test_session
        )
        assert result["is_correct"] is True

    def test_wrong_answer(
        self,
        shared_test_session,
        preview_teacher,
        preview_classroom,
        _program_and_lesson,
    ):
        assignment = _make_assignment(
            shared_test_session,
            preview_classroom,
            preview_teacher,
            _program_and_lesson,
            practice_mode="word_selection",
        )
        item = shared_test_session.query(ContentItem).first()
        result = check_word_selection_answer(
            item.id, "wrong answer", assignment, shared_test_session
        )
        assert result["is_correct"] is False


# ---------------------------------------------------------------------------
# Tests: get_rearrangement_questions
# ---------------------------------------------------------------------------


class TestGetRearrangementQuestions:
    def test_returns_questions(
        self,
        shared_test_session,
        preview_teacher,
        preview_classroom,
        _program_and_lesson,
    ):
        assignment = _make_assignment(
            shared_test_session,
            preview_classroom,
            preview_teacher,
            _program_and_lesson,
            practice_mode="rearrangement",
        )
        result = get_rearrangement_questions(assignment, shared_test_session)
        assert result["practice_mode"] == "rearrangement"
        assert result["total_questions"] == 6
        q = result["questions"][0]
        assert "shuffled_words" in q
        assert "original_text" in q


# ---------------------------------------------------------------------------
# Tests: check_rearrangement_answer
# ---------------------------------------------------------------------------


class TestCheckRearrangementAnswer:
    def test_correct_word(
        self,
        shared_test_session,
        preview_teacher,
        preview_classroom,
        _program_and_lesson,
    ):
        _make_assignment(
            shared_test_session,
            preview_classroom,
            preview_teacher,
            _program_and_lesson,
            practice_mode="rearrangement",
        )
        item = shared_test_session.query(ContentItem).first()
        correct_first_word = item.text.strip().split()[0]
        result = check_rearrangement_answer(
            item.id, correct_first_word, 0, shared_test_session
        )
        assert result["is_correct"] is True

    def test_wrong_word(
        self,
        shared_test_session,
        preview_teacher,
        preview_classroom,
        _program_and_lesson,
    ):
        _make_assignment(
            shared_test_session,
            preview_classroom,
            preview_teacher,
            _program_and_lesson,
            practice_mode="rearrangement",
        )
        item = shared_test_session.query(ContentItem).first()
        result = check_rearrangement_answer(item.id, "WRONG", 0, shared_test_session)
        assert result["is_correct"] is False
        assert result["correct_word"] is not None


# ---------------------------------------------------------------------------
# Tests: handle_rearrangement_retry / complete
# ---------------------------------------------------------------------------


class TestRearrangementRetryAndComplete:
    def test_retry(self):
        result = handle_rearrangement_retry()
        assert result["success"] is True

    def test_complete_defaults(self):
        result = handle_rearrangement_complete()
        assert result["success"] is True
        assert result["final_score"] == 100.0
        assert result["timeout"] is False

    def test_complete_custom(self):
        result = handle_rearrangement_complete(expected_score=75.0, timeout=True)
        assert result["final_score"] == 75.0
        assert result["timeout"] is True
        assert "completed_at" in result

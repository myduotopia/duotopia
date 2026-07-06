"""Issue #655: analysis_service.generate_analysis_report must handle the
word_reading (單字朗讀) practice mode. It previously fell through to
``raise ValueError("Unsupported practice mode: word_reading")`` (HTTP 500).
"""

import pytest
from sqlalchemy.orm import Session

from services.analysis_service import _build_prompt, generate_analysis_report
from models import (
    Teacher,
    Classroom,
    Assignment,
    Student,
    StudentAssignment,
    AssignmentStatus,
)


def _reading_like_collected(mode: str) -> dict:
    return {
        "practice_mode": mode,
        "assignment_title": "T",
        "total_sentences": 1,
        "students": [
            {
                "name": "A",
                "student_number": "1",
                "overall_score": 90,
                "status": "GRADED",
                "items": [],
            }
        ],
    }


class TestWordReadingPrompt:
    def test_word_reading_prompt_builds(self):
        prompt = _build_prompt(_reading_like_collected("word_reading"))
        assert "單字朗讀" in prompt

    def test_reading_prompt_still_builds(self):
        prompt = _build_prompt(_reading_like_collected("reading"))
        assert "例句朗讀" in prompt


class _FakeVertex:
    async def generate_json(self, **kwargs):
        return {"overall_summary": "ok"}


@pytest.mark.asyncio
async def test_generate_analysis_report_word_reading_completes(
    db_session: Session, monkeypatch
):
    """word_reading assignment reaches the LLM and completes (no 500)."""
    teacher = Teacher(email="wr_t@test.com", name="T", password_hash="x")
    db_session.add(teacher)
    db_session.commit()

    classroom = Classroom(name="C", teacher_id=teacher.id)
    db_session.add(classroom)
    db_session.commit()

    assignment = Assignment(
        title="WR",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        practice_mode="word_reading",
        is_archived=False,
    )
    db_session.add(assignment)
    db_session.commit()

    student = Student(email="wr_s@test.com", name="S")
    db_session.add(student)
    db_session.commit()

    db_session.add(
        StudentAssignment(
            assignment_id=assignment.id,
            student_id=student.id,
            classroom_id=classroom.id,
            title="WR",
            status=AssignmentStatus.GRADED,
        )
    )
    db_session.commit()

    monkeypatch.setattr(
        "services.vertex_ai.get_vertex_ai_service", lambda: _FakeVertex()
    )

    report = await generate_analysis_report(db_session, assignment, teacher.id)
    assert report.status == "completed"
    assert report.practice_mode == "word_reading"

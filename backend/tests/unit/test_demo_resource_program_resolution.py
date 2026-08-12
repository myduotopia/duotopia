"""
Unit tests for resolving a demo assignment's resource-pack program (#989).

The expired demo screen offers to copy the material into the visitor's own
library once they register, which needs the resource-account template program
behind the demo assignment. Resolution has three layers: an explicit
`demo_config` override, auto-derivation from the assignment's contents, and a
walk up `source_metadata` when the linked program is a classroom copy.
"""

import pytest

from auth import get_password_hash
from core.config import settings
from models import (
    Assignment,
    AssignmentContent,
    Classroom,
    Content,
    ContentType,
    DemoConfig,
    Lesson,
    Program,
    Teacher,
)
from services.demo_access import (
    RESOURCE_PROGRAM_KEY_TEMPLATE,
    resolve_demo_resource_program,
)


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def resource_account(shared_test_session):
    teacher = Teacher(
        email=settings.RESOURCE_ACCOUNT_EMAIL,
        password_hash=get_password_hash("pw"),
        name="Resource Account",
        is_active=True,
        email_verified=True,
    )
    shared_test_session.add(teacher)
    shared_test_session.commit()
    shared_test_session.refresh(teacher)
    return teacher


def _make_program(session, teacher, name, *, is_template=True, source_metadata=None):
    program = Program(
        name=name,
        teacher_id=teacher.id,
        is_template=is_template,
        is_active=True,
        source_metadata=source_metadata,
    )
    session.add(program)
    session.flush()
    return program


def _make_assignment_on(session, teacher, program):
    """Create an assignment whose single content points at `program`."""
    classroom = Classroom(name="Demo Class", teacher_id=teacher.id)
    session.add(classroom)
    session.flush()

    lesson = Lesson(program_id=program.id, name="L1")
    session.add(lesson)
    session.flush()

    assignment = Assignment(
        title="Demo Assignment",
        classroom_id=classroom.id,
        teacher_id=teacher.id,
        practice_mode="reading_assessment",
    )
    session.add(assignment)
    session.flush()

    content = Content(
        lesson_id=lesson.id,
        program_id=program.id,
        type=ContentType.READING_ASSESSMENT,
        title="Content 1",
        target_wpm=100,
        target_accuracy=80,
    )
    session.add(content)
    session.flush()

    session.add(
        AssignmentContent(
            assignment_id=assignment.id, content_id=content.id, order_index=0
        )
    )
    session.commit()
    session.refresh(assignment)
    return assignment


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestResolveDemoResourceProgram:
    def test_derives_from_content_program(self, shared_test_session, resource_account):
        """The production shape: content points straight at the resource pack."""
        program = _make_program(shared_test_session, resource_account, "Pack")
        assignment = _make_assignment_on(shared_test_session, resource_account, program)

        resolved = resolve_demo_resource_program(assignment, shared_test_session)

        assert resolved is not None
        assert resolved.id == program.id

    def test_derives_via_lesson_when_content_has_no_program(
        self, shared_test_session, resource_account
    ):
        """Older contents carry only `lesson_id` (pre program-direct)."""
        program = _make_program(shared_test_session, resource_account, "Pack")
        assignment = _make_assignment_on(shared_test_session, resource_account, program)
        content = (
            shared_test_session.query(Content)
            .join(AssignmentContent, AssignmentContent.content_id == Content.id)
            .filter(AssignmentContent.assignment_id == assignment.id)
            .first()
        )
        content.program_id = None
        shared_test_session.commit()

        resolved = resolve_demo_resource_program(assignment, shared_test_session)

        assert resolved is not None
        assert resolved.id == program.id

    def test_explicit_demo_config_mapping_wins(
        self, shared_test_session, resource_account
    ):
        linked = _make_program(shared_test_session, resource_account, "Linked")
        override = _make_program(shared_test_session, resource_account, "Override")
        assignment = _make_assignment_on(shared_test_session, resource_account, linked)

        shared_test_session.add(
            DemoConfig(
                key=RESOURCE_PROGRAM_KEY_TEMPLATE.format(assignment_id=assignment.id),
                value=str(override.id),
            )
        )
        shared_test_session.commit()

        resolved = resolve_demo_resource_program(assignment, shared_test_session)

        assert resolved is not None
        assert resolved.id == override.id

    def test_walks_up_source_metadata_to_template(
        self, shared_test_session, resource_account
    ):
        """A demo built on a copy still resolves to the pack it came from."""
        template = _make_program(shared_test_session, resource_account, "Pack")
        copy = _make_program(
            shared_test_session,
            resource_account,
            "Classroom copy",
            is_template=False,
            source_metadata={"template_id": template.id},
        )
        assignment = _make_assignment_on(shared_test_session, resource_account, copy)

        resolved = resolve_demo_resource_program(assignment, shared_test_session)

        assert resolved is not None
        assert resolved.id == template.id

    def test_returns_none_when_not_owned_by_resource_account(
        self, shared_test_session, resource_account
    ):
        """Someone else's program is not copyable, so promise nothing."""
        other = Teacher(
            email="someone-else@test.com",
            password_hash=get_password_hash("pw"),
            name="Other",
            is_active=True,
            email_verified=True,
        )
        shared_test_session.add(other)
        shared_test_session.commit()

        program = _make_program(shared_test_session, other, "Private")
        assignment = _make_assignment_on(shared_test_session, other, program)

        assert resolve_demo_resource_program(assignment, shared_test_session) is None

    def test_returns_none_without_contents(self, shared_test_session, resource_account):
        classroom = Classroom(name="Empty Class", teacher_id=resource_account.id)
        shared_test_session.add(classroom)
        shared_test_session.flush()
        assignment = Assignment(
            title="No contents",
            classroom_id=classroom.id,
            teacher_id=resource_account.id,
            practice_mode="reading_assessment",
        )
        shared_test_session.add(assignment)
        shared_test_session.commit()
        shared_test_session.refresh(assignment)

        assert resolve_demo_resource_program(assignment, shared_test_session) is None

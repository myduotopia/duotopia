"""
Issue #587: Content can live directly under a Program (without a Lesson).

PR #694 already shipped the schema:
- contents.lesson_id is now nullable
- contents.program_id is a new nullable FK
- CHECK constraint: must belong to lesson OR program

These tests cover the implementation follow-up:
- Program.contents ORM relationship (program-direct only)
- Permission helpers branching on lesson_id IS NULL
- Copy functions including program-direct contents
- Pydantic ContentResponse handling lesson_id IS NULL
- POST /programs/{program_id}/contents (new route)
- Program-level reorder for program-direct contents
"""

import os
import secrets
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from auth import create_access_token, get_password_hash
from main import app
from models import (
    Content,
    ContentItem,
    ContentType,
    Lesson,
    Program,
    Teacher,
    Classroom,
)


TEST_PASSWORD = os.environ.get("TEST_TEACHER_PASSWORD") or secrets.token_urlsafe(24)


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def test_db(shared_test_session: Session):
    return shared_test_session


@pytest.fixture
def teacher(test_db: Session):
    teacher = Teacher(
        email=f"t_{uuid.uuid4().hex[:8]}@test.com",
        password_hash=get_password_hash(TEST_PASSWORD),
        name="Issue 587 Teacher",
        is_active=True,
    )
    test_db.add(teacher)
    test_db.commit()
    test_db.refresh(teacher)
    return teacher


@pytest.fixture
def other_teacher(test_db: Session):
    teacher = Teacher(
        email=f"other_{uuid.uuid4().hex[:8]}@test.com",
        password_hash=get_password_hash(TEST_PASSWORD),
        name="Other Teacher",
        is_active=True,
    )
    test_db.add(teacher)
    test_db.commit()
    test_db.refresh(teacher)
    return teacher


@pytest.fixture
def classroom(test_db: Session, teacher: Teacher):
    c = Classroom(name="Issue 587 Classroom", teacher_id=teacher.id, is_active=True)
    test_db.add(c)
    test_db.commit()
    test_db.refresh(c)
    return c


@pytest.fixture
def teacher_program(test_db: Session, teacher: Teacher):
    p = Program(
        name="Issue 587 Program",
        teacher_id=teacher.id,
        is_template=True,
        is_active=True,
    )
    test_db.add(p)
    test_db.commit()
    test_db.refresh(p)
    return p


@pytest.fixture
def authenticated_client(shared_test_session, teacher: Teacher):
    """Test client authenticated as `teacher`.

    Avoids `with TestClient(app)` so the FastAPI lifespan startup hook
    (which requires PostgreSQL/Casbin) doesn't run — we only need the
    routes here, not full app initialization.
    """
    from routers.programs import get_current_teacher
    from database import get_db

    async def override_get_current_teacher():
        return teacher

    def override_get_db():
        try:
            yield shared_test_session
        finally:
            pass

    app.dependency_overrides[get_current_teacher] = override_get_current_teacher
    app.dependency_overrides[get_db] = override_get_db

    from routers.teachers.dependencies import get_current_teacher as t_get_current

    app.dependency_overrides[t_get_current] = override_get_current_teacher

    client = TestClient(app)
    try:
        yield client
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# 1. Schema-level: Content can be created with lesson_id=NULL + program_id=X
# ============================================================================


class TestSchemaSupportsProgramDirectContent:
    def test_create_content_under_program_only(
        self, test_db: Session, teacher_program: Program
    ):
        """A Content row with lesson_id=None + program_id=N must persist."""
        content = Content(
            lesson_id=None,
            program_id=teacher_program.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title="Program-direct Content",
            order_index=1,
        )
        test_db.add(content)
        test_db.commit()
        test_db.refresh(content)

        assert content.id is not None
        assert content.lesson_id is None
        assert content.program_id == teacher_program.id

    def test_create_content_under_lesson_keeps_working(
        self, test_db: Session, teacher_program: Program
    ):
        """Existing lesson-scoped contents must still work unchanged."""
        lesson = Lesson(
            program_id=teacher_program.id, name="L1", order_index=0, is_active=True
        )
        test_db.add(lesson)
        test_db.commit()

        content = Content(
            lesson_id=lesson.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title="Lesson-scoped",
            order_index=0,
        )
        test_db.add(content)
        test_db.commit()
        test_db.refresh(content)

        assert content.lesson_id == lesson.id


# ============================================================================
# 2. Program.contents relationship (NEW)
# ============================================================================


class TestProgramContentsRelationship:
    def test_program_contents_returns_only_program_direct(
        self, test_db: Session, teacher_program: Program
    ):
        """Program.contents must return ONLY rows with lesson_id IS NULL."""
        # Lesson-scoped content (must NOT appear)
        lesson = Lesson(program_id=teacher_program.id, name="L1", is_active=True)
        test_db.add(lesson)
        test_db.commit()
        lesson_content = Content(
            lesson_id=lesson.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title="In lesson",
            order_index=0,
        )

        # Program-direct content (must appear)
        program_content = Content(
            lesson_id=None,
            program_id=teacher_program.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title="Direct under program",
            order_index=1,
        )
        test_db.add_all([lesson_content, program_content])
        test_db.commit()
        test_db.refresh(teacher_program)

        # The relationship must exist and filter correctly
        program_direct_titles = {c.title for c in teacher_program.contents}
        assert "Direct under program" in program_direct_titles
        assert "In lesson" not in program_direct_titles


# ============================================================================
# 3. Permission helpers handle lesson_id IS NULL
# ============================================================================


class TestPermissionHelpersHandleNullLesson:
    def test_has_content_permission_program_direct_owner(
        self, test_db: Session, teacher: Teacher, teacher_program: Program
    ):
        """Owner of program must have permission on program-direct content."""
        from utils.permissions import has_content_permission

        content = Content(
            lesson_id=None,
            program_id=teacher_program.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title="Direct",
            order_index=0,
        )
        test_db.add(content)
        test_db.commit()
        test_db.refresh(content)

        assert (
            has_content_permission(test_db, content.id, teacher.id, "write") is True
        )

    def test_has_content_permission_program_direct_non_owner(
        self,
        test_db: Session,
        teacher_program: Program,
        other_teacher: Teacher,
    ):
        """Non-owner must NOT have permission on program-direct content."""
        from utils.permissions import has_content_permission

        content = Content(
            lesson_id=None,
            program_id=teacher_program.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title="Direct",
            order_index=0,
        )
        test_db.add(content)
        test_db.commit()
        test_db.refresh(content)

        assert (
            has_content_permission(test_db, content.id, other_teacher.id, "write")
            is False
        )

    def test_check_content_access_program_direct_owner(
        self, test_db: Session, teacher: Teacher, teacher_program: Program
    ):
        """check_content_access must succeed for program-direct content owner."""
        from utils.permissions import check_content_access

        content = Content(
            lesson_id=None,
            program_id=teacher_program.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title="Direct",
            order_index=0,
        )
        test_db.add(content)
        test_db.commit()
        test_db.refresh(content)

        # Should NOT raise
        program, lesson, returned_content = check_content_access(
            test_db, content.id, teacher
        )
        assert returned_content.id == content.id
        assert program.id == teacher_program.id
        assert lesson is None  # No lesson for program-direct content

    def test_check_content_access_program_direct_non_owner_write_raises_403(
        self,
        test_db: Session,
        teacher_program: Program,
        other_teacher: Teacher,
    ):
        """check_content_access(require_owner=True) must raise 403 for non-owner."""
        from fastapi import HTTPException
        from utils.permissions import check_content_access

        content = Content(
            lesson_id=None,
            program_id=teacher_program.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title="Direct",
            order_index=0,
        )
        test_db.add(content)
        test_db.commit()
        test_db.refresh(content)

        # Templates are READ-accessible to all teachers, so use require_owner=True
        # to test write-access denial for non-owner.
        with pytest.raises(HTTPException) as exc_info:
            check_content_access(
                test_db, content.id, other_teacher, require_owner=True
            )

        assert exc_info.value.status_code == 403


# ============================================================================
# 4. Copy functions include program-direct contents
# ============================================================================


class TestCopyFunctionsIncludeProgramDirectContents:
    def test_copy_program_tree_copies_program_direct_contents(
        self,
        test_db: Session,
        teacher: Teacher,
        teacher_program: Program,
        classroom: Classroom,
    ):
        """copy_program_tree must include rows where lesson_id IS NULL."""
        from services.program_service import copy_program_tree

        # Add a lesson with one content
        lesson = Lesson(program_id=teacher_program.id, name="L", is_active=True)
        test_db.add(lesson)
        test_db.commit()
        in_lesson = Content(
            lesson_id=lesson.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title="In lesson",
            order_index=0,
        )
        # Add a program-direct content
        program_direct = Content(
            lesson_id=None,
            program_id=teacher_program.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title="Direct under program",
            order_index=1,
        )
        test_db.add_all([in_lesson, program_direct])
        test_db.commit()

        # Add an item to program-direct content to verify items are copied too
        test_db.add(
            ContentItem(
                content_id=program_direct.id,
                order_index=0,
                text="hello world",
            )
        )
        test_db.commit()
        test_db.refresh(teacher_program)

        new_program = copy_program_tree(
            source_program=teacher_program,
            target_classroom=classroom,
            target_teacher_id=teacher.id,
            db=test_db,
            source_type="template",
            source_metadata={"template_id": teacher_program.id},
        )
        test_db.commit()

        # All copied contents (lesson + program-direct)
        copied_contents = (
            test_db.query(Content)
            .filter(
                (Content.program_id == new_program.id)
                | (
                    Content.lesson_id.in_(
                        [
                            row.id
                            for row in test_db.query(Lesson).filter(
                                Lesson.program_id == new_program.id
                            )
                        ]
                    )
                )
            )
            .all()
        )
        copied_titles = {c.title for c in copied_contents}
        assert "In lesson" in copied_titles, "Lesson-scoped content must still be copied"
        assert (
            "Direct under program" in copied_titles
        ), "Program-direct content must be copied"

        # The program-direct copy must have lesson_id=None and program_id=new_program.id
        copied_direct = next(
            c for c in copied_contents if c.title == "Direct under program"
        )
        assert copied_direct.lesson_id is None
        assert copied_direct.program_id == new_program.id

        # ContentItems must be copied too
        items = (
            test_db.query(ContentItem)
            .filter(ContentItem.content_id == copied_direct.id)
            .all()
        )
        assert len(items) == 1
        assert items[0].text == "hello world"

    def test_copy_program_tree_to_template_copies_program_direct_contents(
        self,
        test_db: Session,
        teacher: Teacher,
        teacher_program: Program,
    ):
        """copy_program_tree_to_template must include program-direct rows too."""
        from services.program_service import copy_program_tree_to_template

        program_direct = Content(
            lesson_id=None,
            program_id=teacher_program.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title="Direct in template source",
            order_index=0,
        )
        test_db.add(program_direct)
        test_db.commit()
        test_db.refresh(teacher_program)

        new_program = copy_program_tree_to_template(
            source_program=teacher_program,
            target_teacher_id=teacher.id,
            db=test_db,
            source_type="template_copy",
            source_metadata={"template_id": teacher_program.id},
        )
        test_db.commit()

        copied = (
            test_db.query(Content)
            .filter(
                Content.program_id == new_program.id, Content.lesson_id.is_(None)
            )
            .all()
        )
        assert len(copied) == 1
        assert copied[0].title == "Direct in template source"


# ============================================================================
# 5. Pydantic ContentResponse handles lesson_id IS NULL
# ============================================================================


class TestPydanticContentResponseAllowsNullLesson:
    def test_content_response_allows_null_lesson_id(self):
        """ContentResponse.lesson_id must be Optional[int]."""
        from schemas import ContentResponse

        # Build a response with lesson_id=None — must not raise
        resp = ContentResponse(
            id=1,
            lesson_id=None,
            type="example_sentences",
            title="Direct",
            order_index=0,
            is_active=True,
            items=[],
        )
        assert resp.lesson_id is None


# ============================================================================
# 6. New API: POST /api/programs/{program_id}/contents
# ============================================================================


class TestCreateProgramDirectContentEndpoint:
    def test_post_programs_id_contents_creates_program_direct_content(
        self,
        authenticated_client: TestClient,
        test_db: Session,
        teacher_program: Program,
    ):
        """POST /api/programs/{program_id}/contents must create lesson_id=None content."""
        response = authenticated_client.post(
            f"/api/programs/{teacher_program.id}/contents",
            json={
                "type": "example_sentences",
                "title": "Direct under program (via API)",
                "order_index": 1,
            },
        )

        assert response.status_code == 201, response.text
        data = response.json()
        assert data["title"] == "Direct under program (via API)"
        assert data["lesson_id"] is None
        assert data["program_id"] == teacher_program.id

        # Verify it was persisted
        rows = (
            test_db.query(Content)
            .filter(
                Content.program_id == teacher_program.id, Content.lesson_id.is_(None)
            )
            .all()
        )
        assert len(rows) == 1

    def test_post_programs_id_contents_denied_for_non_owner(
        self,
        authenticated_client: TestClient,
        test_db: Session,
        other_teacher: Teacher,
    ):
        """Non-owner must get 403 when posting to a program they don't own."""
        # Program owned by other_teacher
        other_program = Program(
            name="Other's program",
            teacher_id=other_teacher.id,
            is_template=True,
            is_active=True,
        )
        test_db.add(other_program)
        test_db.commit()
        test_db.refresh(other_program)

        response = authenticated_client.post(
            f"/api/programs/{other_program.id}/contents",
            json={"type": "example_sentences", "title": "Hacked"},
        )
        assert response.status_code == 403


# ============================================================================
# 7. Reorder program-direct contents
# ============================================================================


class TestReorderProgramDirectContents:
    def test_reorder_program_contents_updates_order(
        self,
        authenticated_client: TestClient,
        test_db: Session,
        teacher_program: Program,
    ):
        """PUT /api/programs/{program_id}/contents/reorder updates order_index."""
        c1 = Content(
            lesson_id=None,
            program_id=teacher_program.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title="A",
            order_index=1,
        )
        c2 = Content(
            lesson_id=None,
            program_id=teacher_program.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title="B",
            order_index=2,
        )
        test_db.add_all([c1, c2])
        test_db.commit()
        test_db.refresh(c1)
        test_db.refresh(c2)

        response = authenticated_client.put(
            f"/api/programs/{teacher_program.id}/contents/reorder",
            json=[
                {"id": c1.id, "order_index": 99},
                {"id": c2.id, "order_index": 1},
            ],
        )
        assert response.status_code == 200, response.text

        test_db.expire_all()
        c1_reloaded = test_db.query(Content).filter(Content.id == c1.id).one()
        c2_reloaded = test_db.query(Content).filter(Content.id == c2.id).one()
        assert c1_reloaded.order_index == 99
        assert c2_reloaded.order_index == 1

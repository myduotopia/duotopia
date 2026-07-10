"""
Global pytest configuration
統一的測試配置，確保所有測試使用相同的資料庫設置
"""
import os

# Boot the app in test mode BEFORE importing database/main below.
# - TESTING=true makes the startup event treat Casbin sync_from_database as
#   best-effort: it no longer retries-then-raises when the DB is unreachable,
#   which used to abort every TestClient-based test at setup (Issue #314).
# - DATABASE_URL defaults the app's engine to the local SQLite test DB, so any
#   code path that bypasses the get_db override fails safe to SQLite instead of
#   a remote Postgres/Supabase host. setdefault() preserves an explicit
#   DATABASE_URL (e.g. a Postgres service in CI).
os.environ.setdefault("TESTING", "true")
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_org.db")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from database import Base, get_db
from main import app
import models  # noqa: F401 - Import models to register them
from models import (
    Teacher,
    Classroom,
    Assignment,
    AssignmentContent,
    Content,
    ContentType,
    Lesson,
    Program,
    Student,
    ClassroomStudent,
    StudentAssignment,
    StudentContentProgress,
    StudentItemProgress,
    AssignmentStatus,
    ContentItem,
)
from auth import get_password_hash, create_access_token


# 全域引擎，確保所有測試使用同一個
_test_engine = None


@compiles(JSONB, "sqlite")
def _compile_jsonb_sqlite(type_, compiler, **kw):
    # Allow JSONB columns to compile on SQLite (used in local/unit tests)
    return "JSON"


def get_test_engine():
    """獲取全域測試引擎

    使用 alembic migrations 確保測試 DB schema 與生產環境一致
    """
    global _test_engine
    if _test_engine is None:
        import subprocess
        import os
        import pathlib

        # 測試資料庫 URL
        TEST_DATABASE_URL = "sqlite:///./test_org.db"
        db_path = pathlib.Path("./test_org.db")

        # 刪除舊的測試數據庫
        if db_path.exists():
            db_path.unlink()

        # 使用 alembic 創建測試數據庫 schema
        env = os.environ.copy()
        env["DATABASE_URL"] = TEST_DATABASE_URL
        env[
            "SKIP_MIGRATION_VALIDATION"
        ] = "true"  # Allow creating all tables in test DB

        result = subprocess.run(
            ["alembic", "upgrade", "head"],
            env=env,
            capture_output=True,
            text=True,
            cwd=os.path.dirname(
                os.path.dirname(__file__)
            ),  # Run from backend directory
        )

        if result.returncode != 0:
            print(
                f"⚠️  Alembic migration failed, falling back to Base.metadata.create_all()"
            )
            print(f"STDERR: {result.stderr}")

        # 創建引擎（StaticPool for single shared connection）
        _test_engine = create_engine(
            TEST_DATABASE_URL,
            echo=False,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

        # Fallback: 如果 alembic 失敗，使用 Base.metadata.create_all
        if result.returncode != 0:
            Base.metadata.create_all(_test_engine, checkfirst=True)

    return _test_engine


@pytest.fixture(scope="session")
def test_engine(request):
    """Create a shared test database engine"""
    # Skip for tests that don't need database
    # This is checked at session level to avoid creating engine at all
    engine = get_test_engine()
    yield engine
    # 🧹 Cleanup: 刪除測試資料庫檔案
    import os

    if os.path.exists("./test.db"):
        os.remove("./test.db")


@pytest.fixture(scope="function", autouse=True)
def ensure_tables(test_engine, request):
    """🔧 Ensure tables exist before EVERY test (autouse)"""
    # Skip database setup for tests marked with no_db
    if "no_db" in request.keywords:
        yield
        return

    # checkfirst=True: 避免平行測試時重複創建表
    Base.metadata.create_all(bind=test_engine, checkfirst=True)
    yield
    # Cleanup happens in shared_test_session


@pytest.fixture(scope="function")
def shared_test_session(test_engine):
    """Create a shared test database session that will be used by both test_session and test_client"""
    # 🔧 確保 tables 存在（每個測試開始前都檢查）
    # checkfirst=True: 避免平行測試時重複創建表
    Base.metadata.create_all(bind=test_engine, checkfirst=True)

    TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    session = TestSessionLocal()

    try:
        yield session
    finally:
        try:
            session.rollback()
        except Exception:
            pass

        # 🔧 清理所有資料（保留 schema）- 移到 cleanup 階段
        try:
            for table in reversed(Base.metadata.sorted_tables):
                session.execute(table.delete())
            session.commit()
        except Exception:
            session.rollback()
        finally:
            session.close()


@pytest.fixture(scope="function")
def test_session(shared_test_session):
    """Create a test database session that shares the same session as test_client"""
    return shared_test_session


@pytest.fixture(scope="function")
def test_client(shared_test_session):
    """Create a test client with database override using shared session"""

    def override_get_db():
        try:
            yield shared_test_session
        finally:
            pass  # Don't close the shared session here

    # 全域覆寫資料庫依賴
    app.dependency_overrides[get_db] = override_get_db

    try:
        with TestClient(app) as client:
            yield client
    finally:
        # 確保清理依賴覆寫
        app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def db_session(test_engine):
    """提供資料庫 session 的別名，支援舊有測試"""
    # 🔧 確保 tables 存在
    Base.metadata.create_all(bind=test_engine)

    TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    session = TestSessionLocal()

    try:
        yield session
    finally:
        try:
            session.rollback()
        except Exception:
            pass

        # 🔧 清理所有資料（保留 schema）- 移到 cleanup 階段
        try:
            for table in reversed(Base.metadata.sorted_tables):
                session.execute(table.delete())
            session.commit()
        except Exception:
            session.rollback()
        finally:
            session.close()


@pytest.fixture(scope="function")
def test_db_session(shared_test_session):
    """Alias for shared_test_session to support integration tests"""
    return shared_test_session


# Auth test fixtures
@pytest.fixture
def demo_teacher(shared_test_session):
    """Create a demo teacher for testing"""
    teacher = Teacher(
        email="test@duotopia.com",
        password_hash=get_password_hash("test123"),
        name="Test Teacher",
        is_active=True,
        is_demo=False,
        email_verified=True,  # Verified email
    )
    shared_test_session.add(teacher)
    shared_test_session.commit()
    shared_test_session.refresh(teacher)
    return teacher


@pytest.fixture
def inactive_teacher(shared_test_session):
    """Create an inactive teacher for testing"""
    teacher = Teacher(
        email="inactive@duotopia.com",
        password_hash=get_password_hash("test123"),
        name="Inactive Teacher",
        is_active=False,  # Inactive account
        is_demo=False,
        email_verified=False,  # Not verified
    )
    shared_test_session.add(teacher)
    shared_test_session.commit()
    shared_test_session.refresh(teacher)
    return teacher


# N+1 Query Test Fixtures
@pytest.fixture
def auth_headers_teacher(test_client, demo_teacher):
    """Create authentication headers for teacher"""
    access_token = create_access_token(
        data={"sub": str(demo_teacher.id), "type": "teacher"}
    )
    return {"Authorization": f"Bearer {access_token}"}


@pytest.fixture
def test_classroom(db_session, demo_teacher):
    """Create a test classroom"""
    classroom = Classroom(
        name="Test Classroom",
        teacher_id=demo_teacher.id,
        description="Test classroom for N+1 query tests",
    )
    db_session.add(classroom)
    db_session.commit()
    db_session.refresh(classroom)
    return {"id": classroom.id, "teacher_id": demo_teacher.id}


@pytest.fixture
def test_assignment(db_session, demo_teacher, test_classroom):
    """Create a test assignment with contents"""
    from datetime import datetime, timedelta

    # Create Program
    program = Program(
        name="Test Program",
        teacher_id=demo_teacher.id,
        classroom_id=test_classroom["id"],
        description="Test program for N+1 tests",
    )
    db_session.add(program)
    db_session.flush()

    # Create Lesson
    lesson = Lesson(
        program_id=program.id,
        name="Test Lesson",
        description="Test lesson for N+1 tests",
    )
    db_session.add(lesson)
    db_session.flush()

    # Create Assignment
    assignment = Assignment(
        title="Test Assignment",
        description="Test assignment for N+1 query tests",
        classroom_id=test_classroom["id"],
        teacher_id=demo_teacher.id,
        due_date=datetime.utcnow() + timedelta(days=7),
    )
    db_session.add(assignment)
    db_session.flush()

    # Create Contents and link to Assignment
    for i in range(3):
        content = Content(
            lesson_id=lesson.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title=f"Test Content {i+1}",
        )
        db_session.add(content)
        db_session.flush()

        assignment_content = AssignmentContent(
            assignment_id=assignment.id,
            content_id=content.id,
            order_index=i,
        )
        db_session.add(assignment_content)

    db_session.commit()
    db_session.refresh(assignment)

    return {
        "id": assignment.id,
        "teacher_id": demo_teacher.id,
        "classroom_id": test_classroom["id"],
    }


# Student Assignment Test Fixtures
@pytest.fixture
def demo_student(shared_test_session):
    """Create a demo student for testing"""
    from datetime import date

    student = Student(
        email="teststudent@duotopia.com",
        password_hash=get_password_hash("test123"),
        name="Test Student",
        birthdate=date(2010, 1, 1),
        email_verified=True,
    )
    shared_test_session.add(student)
    shared_test_session.commit()
    shared_test_session.refresh(student)
    return student


@pytest.fixture
def auth_headers_student(test_client, demo_student):
    """Create authentication headers for student"""
    access_token = create_access_token(
        data={"sub": str(demo_student.id), "type": "student"}
    )
    return {"Authorization": f"Bearer {access_token}"}


@pytest.fixture
def test_student_assignment(db_session, demo_teacher, demo_student, test_classroom):
    """Create a test student assignment with few items"""
    from datetime import datetime, timedelta

    classroom_student = ClassroomStudent(
        classroom_id=test_classroom["id"], student_id=demo_student.id
    )
    db_session.add(classroom_student)
    db_session.flush()

    # Create Assignment
    assignment = Assignment(
        title="Test Student Assignment",
        description="Test assignment for N+1 query tests",
        classroom_id=test_classroom["id"],
        teacher_id=demo_teacher.id,
        due_date=datetime.utcnow() + timedelta(days=7),
    )
    db_session.add(assignment)
    db_session.flush()

    # Create Program and Lesson
    program = Program(
        name="Test Program",
        teacher_id=demo_teacher.id,
        classroom_id=test_classroom["id"],
    )
    db_session.add(program)
    db_session.flush()

    lesson = Lesson(program_id=program.id, name="Test Lesson")
    db_session.add(lesson)
    db_session.flush()

    # Create 5 Contents with items
    for i in range(5):
        content = Content(
            lesson_id=lesson.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title=f"Content {i+1}",
        )
        db_session.add(content)
        db_session.flush()

        # Create 3 ContentItems for each Content
        for j in range(3):
            content_item = ContentItem(
                content_id=content.id,
                text=f"Test text {i+1}-{j+1}",
                translation=f"Translation {i+1}-{j+1}",
                order_index=j,
            )
            db_session.add(content_item)
        db_session.flush()

        assignment_content = AssignmentContent(
            assignment_id=assignment.id, content_id=content.id, order_index=i
        )
        db_session.add(assignment_content)

    db_session.flush()

    # Create StudentAssignment
    student_assignment = StudentAssignment(
        assignment_id=assignment.id,
        student_id=demo_student.id,
        classroom_id=test_classroom["id"],
        title="Test Student Assignment",
        status=AssignmentStatus.IN_PROGRESS,
    )
    db_session.add(student_assignment)
    db_session.flush()

    # Create StudentContentProgress for each content
    assignment_contents = (
        db_session.query(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .all()
    )

    for ac in assignment_contents:
        progress = StudentContentProgress(
            student_assignment_id=student_assignment.id,
            content_id=ac.content_id,
            status=AssignmentStatus.IN_PROGRESS,
            order_index=ac.order_index,
        )
        db_session.add(progress)
        db_session.flush()

        # Create StudentItemProgress for each content item
        content_items = (
            db_session.query(ContentItem)
            .filter(ContentItem.content_id == ac.content_id)
            .all()
        )
        for item in content_items:
            item_progress = StudentItemProgress(
                student_assignment_id=student_assignment.id,
                content_item_id=item.id,
                status="IN_PROGRESS",
            )
            db_session.add(item_progress)

    db_session.commit()

    return {"id": student_assignment.id, "student_id": demo_student.id}


@pytest.fixture
def test_student_assignment_many_items(
    db_session, demo_teacher, demo_student, test_classroom
):
    """Create a test student assignment with many items"""
    from datetime import datetime, timedelta

    classroom_student = ClassroomStudent(
        classroom_id=test_classroom["id"], student_id=demo_student.id
    )
    db_session.add(classroom_student)
    db_session.flush()

    # Create Assignment
    assignment = Assignment(
        title="Test Student Assignment Many Items",
        description="Test assignment with many items",
        classroom_id=test_classroom["id"],
        teacher_id=demo_teacher.id,
        due_date=datetime.utcnow() + timedelta(days=7),
    )
    db_session.add(assignment)
    db_session.flush()

    # Create Program and Lesson
    program = Program(
        name="Test Program Many",
        teacher_id=demo_teacher.id,
        classroom_id=test_classroom["id"],
    )
    db_session.add(program)
    db_session.flush()

    lesson = Lesson(program_id=program.id, name="Test Lesson Many")
    db_session.add(lesson)
    db_session.flush()

    # Create 15 Contents with 5 items each = 75 total items
    for i in range(15):
        content = Content(
            lesson_id=lesson.id,
            type=ContentType.EXAMPLE_SENTENCES,
            title=f"Content {i+1}",
        )
        db_session.add(content)
        db_session.flush()

        # Create 5 ContentItems for each Content
        for j in range(5):
            content_item = ContentItem(
                content_id=content.id,
                text=f"Test text {i+1}-{j+1}",
                translation=f"Translation {i+1}-{j+1}",
                order_index=j,
            )
            db_session.add(content_item)
        db_session.flush()

        assignment_content = AssignmentContent(
            assignment_id=assignment.id, content_id=content.id, order_index=i
        )
        db_session.add(assignment_content)

    db_session.flush()

    # Create StudentAssignment
    student_assignment = StudentAssignment(
        assignment_id=assignment.id,
        student_id=demo_student.id,
        classroom_id=test_classroom["id"],
        title="Test Student Assignment Many Items",
        status=AssignmentStatus.IN_PROGRESS,
    )
    db_session.add(student_assignment)
    db_session.flush()

    # Create StudentContentProgress and StudentItemProgress
    assignment_contents = (
        db_session.query(AssignmentContent)
        .filter(AssignmentContent.assignment_id == assignment.id)
        .all()
    )

    for ac in assignment_contents:
        progress = StudentContentProgress(
            student_assignment_id=student_assignment.id,
            content_id=ac.content_id,
            status=AssignmentStatus.IN_PROGRESS,
            order_index=ac.order_index,
        )
        db_session.add(progress)
        db_session.flush()

        content_items = (
            db_session.query(ContentItem)
            .filter(ContentItem.content_id == ac.content_id)
            .all()
        )
        for item in content_items:
            item_progress = StudentItemProgress(
                student_assignment_id=student_assignment.id,
                content_item_id=item.id,
                status="IN_PROGRESS",
            )
            db_session.add(item_progress)

    db_session.commit()

    return {"id": student_assignment.id, "student_id": demo_student.id}


@pytest.fixture
def test_student_with_linked_accounts(db_session, demo_student, test_classroom):
    """Create a test student with linked accounts"""
    from datetime import date

    verified_email = "linked@duotopia.com"

    # Use demo_student as the main student
    demo_student.email = verified_email
    demo_student.email_verified = True
    db_session.flush()

    # Add demo_student to classroom
    cs1 = ClassroomStudent(
        classroom_id=test_classroom["id"], student_id=demo_student.id
    )
    db_session.add(cs1)

    # Create 5 linked accounts with same verified email
    for i in range(5):
        linked_student = Student(
            email=verified_email,
            password_hash=get_password_hash("test123"),
            name=f"Linked Student {i+1}",
            birthdate=date(2010, 1, 1),
            email_verified=True,
            is_active=True,  # 🔥 Ensure active
        )
        db_session.add(linked_student)
        db_session.flush()

        # Add to classroom
        cs = ClassroomStudent(
            classroom_id=test_classroom["id"],
            student_id=linked_student.id,
            is_active=True,  # 🔥 Ensure active
        )
        db_session.add(cs)

    db_session.commit()

    return {"id": demo_student.id, "linked_count": 5}

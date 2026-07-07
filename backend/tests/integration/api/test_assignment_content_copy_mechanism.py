"""
測試作業內容副本機制 (Assignment Content Copy Mechanism)
驗證派作業時會複製 Content 和 ContentItem，確保模板變動不影響已派發的作業

Related to Issue #56
"""

import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from main import app
from database import Base, get_db
from models import (
    Teacher,
    Student,
    Classroom,
    ClassroomStudent,
    Program,
    Lesson,
    Content,
    ContentItem,
    Assignment,
    AssignmentContent,
    StudentAssignment,
    StudentItemProgress,
    ContentType,
    SubscriptionPeriod,
)
from auth import get_password_hash

# 測試資料庫設置
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_assignment_copy.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    # 啟用 SQLite 外鍵約束（CASCADE 需要）
    pool_pre_ping=True,
)
# 啟用 SQLite 外鍵約束
from sqlalchemy import event


@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    """啟用 SQLite 外鍵約束"""
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


@pytest.fixture(scope="function")
def setup_database():
    """每個測試前重新創建資料庫"""
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def test_data(setup_database):
    """準備測試資料"""
    db = TestingSessionLocal()

    # 創建教師
    teacher = Teacher(
        id=1,
        name="測試教師",
        email="teacher@test.com",
        password_hash=get_password_hash("password123"),
        email_verified=True,
        is_active=True,
    )
    db.add(teacher)
    db.commit()

    # 創建有效的訂閱週期（讓教師可以指派作業）
    now = datetime.now(timezone.utc)
    period = SubscriptionPeriod(
        teacher_id=teacher.id,
        plan_name="Tutor Teachers",
        amount_paid=299,
        quota_total=2000,
        quota_used=0,
        start_date=now,
        end_date=now + timedelta(days=30),
        payment_method="trial",
        payment_status="paid",
        status="active",
    )
    db.add(period)
    db.commit()

    # 創建教室
    classroom = Classroom(id=1, name="測試教室", teacher_id=1, is_active=True)
    db.add(classroom)
    db.commit()

    # 創建學生
    student = Student(
        id=1,
        name="測試學生",
        student_number="S001",
        password_hash=get_password_hash("student123"),
        birthdate=datetime(2010, 1, 1),
    )
    db.add(student)
    db.commit()

    # 將學生加入教室
    cs = ClassroomStudent(classroom_id=1, student_id=1, is_active=True)
    db.add(cs)
    db.commit()

    # 創建課程（模板）
    program = Program(
        id=1,
        name="測試課程",
        teacher_id=1,
        classroom_id=1,
        is_template=False,
        is_active=True,
    )
    db.add(program)
    db.commit()

    # 創建單元
    lesson = Lesson(
        id=1,
        program_id=1,
        name="測試單元",
        order_index=1,
        is_active=True,
    )
    db.add(lesson)
    db.commit()

    # 創建內容（模板）
    content = Content(
        id=1,
        lesson_id=1,
        title="測試內容",
        type=ContentType.EXAMPLE_SENTENCES,
        order_index=1,
        is_active=True,
        is_assignment_copy=False,  # 模板
    )
    db.add(content)
    db.commit()

    # 創建內容項目
    content_item = ContentItem(
        id=1,
        content_id=1,
        order_index=1,
        text="Good morning",
        translation="早安",
        audio_url="https://example.com/audio1.mp3",
    )
    db.add(content_item)
    db.commit()

    db.close()

    return {
        "teacher_id": 1,
        "classroom_id": 1,
        "student_id": 1,
        "program_id": 1,
        "lesson_id": 1,
        "content_id": 1,
        "content_item_id": 1,
    }


def get_auth_token():
    """取得教師認證 token"""
    response = client.post(
        "/api/auth/teacher/login",
        json={"email": "teacher@test.com", "password": "password123"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


class TestAssignmentContentCopy:
    """測試作業副本機制"""

    def test_create_assignment_creates_content_copy(self, test_data):
        """測試：派作業時會複製 Content 和 ContentItem"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        # 派作業
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1],  # 使用模板內容
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )

        assert response.status_code == 200
        result = response.json()
        assert result["success"] is True
        assignment_id = result["assignment_id"]

        # 驗證：原始 Content 仍然是模板
        db = TestingSessionLocal()
        original_content = db.query(Content).filter(Content.id == 1).first()
        assert original_content.is_assignment_copy is False
        assert original_content.source_content_id is None

        # 驗證：創建了副本 Content（透過 AssignmentContent 關聯表查詢）
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_contents = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .all()
        )
        assert len(copy_contents) == 1
        copy_content = copy_contents[0]

        assert copy_content.source_content_id == 1  # 指向原始內容
        assert copy_content.title == "測試內容"
        assert copy_content.lesson_id == 1  # 保留 lesson_id

        # 驗證：創建了副本 ContentItem
        copy_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content.id)
            .all()
        )
        assert len(copy_items) == 1
        copy_item = copy_items[0]

        assert copy_item.text == "Good morning"
        assert copy_item.translation == "早安"
        assert copy_item.audio_url == "https://example.com/audio1.mp3"

        # 驗證：AssignmentContent 指向副本
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        assert len(assignment_contents) == 1
        assert assignment_contents[0].content_id == copy_content.id  # 指向副本

        # 驗證：StudentItemProgress 指向副本的 ContentItem
        student_assignment = (
            db.query(StudentAssignment)
            .filter(StudentAssignment.assignment_id == assignment_id)
            .first()
        )
        item_progresses = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.student_assignment_id == student_assignment.id)
            .all()
        )
        assert len(item_progresses) == 1
        assert item_progresses[0].content_item_id == copy_item.id  # 指向副本的 item

        db.close()

    def test_create_assignment_copies_program_id_for_program_direct_content(
        self, test_data
    ):
        """Issue #917: 直接掛在 program 底下的頂層內容（lesson_id=NULL, program_id 有值）
        建作業時，Content 副本必須帶上 program_id。

        若漏帶 program_id，副本 lesson_id 與 program_id 皆為 NULL，違反 Postgres
        CHECK 約束 ck_contents_lesson_or_program，正式站回 500（前端誤報為 CORS）。
        SQLite 不強制該 CHECK，因此改以「副本是否帶上 program_id」的行為斷言把關。
        """
        db = TestingSessionLocal()

        # 建立「頂層 program 內容」：lesson_id=None、program_id 指向 program
        program_direct = Content(
            id=2,
            lesson_id=None,
            program_id=1,
            title="頂層單字集",
            type=ContentType.EXAMPLE_SENTENCES,
            order_index=1,
            is_active=True,
            is_assignment_copy=False,
        )
        db.add(program_direct)
        db.commit()

        db.add(
            ContentItem(
                id=2,
                content_id=2,
                order_index=1,
                text="apple",
                translation="蘋果",
                audio_url="https://example.com/audio2.mp3",
            )
        )
        db.commit()
        db.close()

        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "頂層內容作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [2],
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )

        assert response.status_code == 200, response.text
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(
                Content.id.in_(content_ids),
                Content.is_assignment_copy.is_(True),
            )
            .first()
        )

        assert copy_content is not None
        assert copy_content.source_content_id == 2
        # 核心斷言：副本帶上 program_id、lesson_id 維持 None
        assert copy_content.program_id == 1
        assert copy_content.lesson_id is None

        db.close()

    def test_template_modification_does_not_affect_assignment(self, test_data):
        """測試：修改模板不會影響已派發的作業"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        # 1. 先派作業
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1],
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )
        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        # 取得副本 ContentItem（透過 AssignmentContent 關聯表查詢）
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .first()
        )
        copy_item = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content.id)
            .first()
        )

        original_text = copy_item.text
        assert original_text == "Good morning"

        # 2. 修改模板 ContentItem
        original_item = db.query(ContentItem).filter(ContentItem.id == 1).first()
        original_item.text = "Hello"  # 修改模板
        db.commit()

        # 3. 驗證：副本沒有被影響
        db.refresh(copy_item)
        assert copy_item.text == "Good morning"  # 副本保持原樣

        # 4. 驗證：模板已經改變
        db.refresh(original_item)
        assert original_item.text == "Hello"  # 模板已改變

        db.close()

    def test_assignment_copy_can_be_updated_independently(self, test_data):
        """測試：可以獨立更新作業副本，不影響模板"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        # 1. 派作業
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1],
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )
        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        # 取得副本 Content（透過 AssignmentContent 關聯表查詢）
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .first()
        )

        # 2. 更新副本 Content
        response = client.put(
            f"/api/teachers/contents/{copy_content.id}",
            headers=headers,
            json={
                "title": "更新的作業內容",
                "items": [
                    {
                        "text": "Updated text",
                        "translation": "更新的文字",
                    }
                ],
            },
        )
        assert response.status_code == 200

        # 3. 驗證：副本已更新
        db.refresh(copy_content)
        assert copy_content.title == "更新的作業內容"

        # 4. 驗證：模板沒有被影響
        original_content = db.query(Content).filter(Content.id == 1).first()
        assert original_content.title == "測試內容"  # 模板保持原樣

        db.close()

    def test_only_template_contents_are_shown_when_creating_assignment(self, test_data):
        """測試：派作業時只顯示模板內容，不顯示作業副本"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        # 1. 先派一個作業（會創建副本）
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "第一個作業",
                "description": "測試",
                "classroom_id": 1,
                "content_ids": [1],
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )
        assert response.status_code == 200

        # 2. 查詢可用的內容（應該只返回模板）
        response = client.get(
            "/api/teachers/lessons/1/contents",
            headers=headers,
        )
        assert response.status_code == 200
        contents = response.json()

        # 應該只有一個內容（模板），不包含副本
        assert len(contents) == 1
        assert contents[0]["id"] == 1  # 模板 ID
        assert contents[0]["title"] == "測試內容"

    def test_multiple_contents_are_copied(self, test_data):
        """測試：一次派作業包含多個 Content 時，所有 Content 都會被複製"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        db = TestingSessionLocal()

        # 創建第二個 Content（模板）
        content2 = Content(
            id=2,
            lesson_id=1,
            title="測試內容2",
            type=ContentType.EXAMPLE_SENTENCES,
            order_index=2,
            is_active=True,
            is_assignment_copy=False,
        )
        db.add(content2)
        db.commit()

        # 創建第二個 ContentItem
        content_item2 = ContentItem(
            id=2,
            content_id=2,
            order_index=1,
            text="Good afternoon",
            translation="午安",
            audio_url="https://example.com/audio2.mp3",
        )
        db.add(content_item2)
        db.commit()
        db.close()

        # 派作業（包含兩個 Content）
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1, 2],  # 兩個內容
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )

        assert response.status_code == 200
        result = response.json()
        assert result["success"] is True
        assignment_id = result["assignment_id"]

        db = TestingSessionLocal()

        # 驗證：創建了兩個副本 Content（透過 AssignmentContent 關聯表查詢）
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_contents = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .order_by(Content.order_index)
            .all()
        )
        assert len(copy_contents) == 2

        # 驗證第一個副本
        copy_content1 = copy_contents[0]
        assert copy_content1.source_content_id == 1
        assert copy_content1.title == "測試內容"

        # 驗證第二個副本
        copy_content2 = copy_contents[1]
        assert copy_content2.source_content_id == 2
        assert copy_content2.title == "測試內容2"

        # 驗證：每個副本都有對應的 ContentItem
        copy_items1 = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content1.id)
            .all()
        )
        assert len(copy_items1) == 1
        assert copy_items1[0].text == "Good morning"

        copy_items2 = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content2.id)
            .all()
        )
        assert len(copy_items2) == 1
        assert copy_items2[0].text == "Good afternoon"

        # 驗證：AssignmentContent 指向兩個副本
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .order_by(AssignmentContent.order_index)
            .all()
        )
        assert len(assignment_contents) == 2
        assert assignment_contents[0].content_id == copy_content1.id
        assert assignment_contents[1].content_id == copy_content2.id

        db.close()

    def test_multiple_content_items_are_copied(self, test_data):
        """測試：Content 包含多個 ContentItem 時，所有 ContentItem 都會被複製"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        db = TestingSessionLocal()

        # 為第一個 Content 添加更多 ContentItem
        content_item2 = ContentItem(
            id=2,
            content_id=1,
            order_index=2,
            text="Good evening",
            translation="晚安",
            audio_url="https://example.com/audio3.mp3",
        )
        content_item3 = ContentItem(
            id=3,
            content_id=1,
            order_index=3,
            text="Good night",
            translation="晚安（睡覺）",
            audio_url="https://example.com/audio4.mp3",
        )
        db.add(content_item2)
        db.add(content_item3)
        db.commit()
        db.close()

        # 派作業
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1],
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )

        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        # 取得副本 Content（透過 AssignmentContent 關聯表查詢）
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .first()
        )

        # 驗證：副本包含所有 3 個 ContentItem
        copy_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content.id)
            .order_by(ContentItem.order_index)
            .all()
        )
        assert len(copy_items) == 3

        # 驗證每個 ContentItem 的內容
        assert copy_items[0].text == "Good morning"
        assert copy_items[0].translation == "早安"
        assert copy_items[0].audio_url == "https://example.com/audio1.mp3"

        assert copy_items[1].text == "Good evening"
        assert copy_items[1].translation == "晚安"
        assert copy_items[1].audio_url == "https://example.com/audio3.mp3"

        assert copy_items[2].text == "Good night"
        assert copy_items[2].translation == "晚安（睡覺）"
        assert copy_items[2].audio_url == "https://example.com/audio4.mp3"

        # 驗證：原始模板仍然有 3 個 ContentItem
        original_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == 1)
            .order_by(ContentItem.order_index)
            .all()
        )
        assert len(original_items) == 3

        db.close()

    def test_template_program_content_copy(self, test_data):
        """測試：從公版課程（模板）派作業時，內容會被正確複製"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        db = TestingSessionLocal()

        # 創建公版課程
        template_program = Program(
            id=2,
            name="公版課程",
            teacher_id=1,
            classroom_id=None,  # 公版課程沒有 classroom_id
            is_template=True,
            is_active=True,
        )
        db.add(template_program)
        db.commit()

        # 創建公版課程的單元
        template_lesson = Lesson(
            id=2,
            program_id=2,
            name="公版單元",
            order_index=1,
            is_active=True,
        )
        db.add(template_lesson)
        db.commit()

        # 創建公版課程的內容
        template_content = Content(
            id=3,
            lesson_id=2,
            title="公版內容",
            type=ContentType.EXAMPLE_SENTENCES,
            order_index=1,
            is_active=True,
            is_assignment_copy=False,
        )
        db.add(template_content)
        db.commit()

        # 創建公版內容的 ContentItem
        template_item = ContentItem(
            id=4,
            content_id=3,
            order_index=1,
            text="Hello world",
            translation="你好世界",
            audio_url="https://example.com/template_audio.mp3",
        )
        db.add(template_item)
        db.commit()
        db.close()

        # 派作業（使用公版內容）
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [3],  # 公版內容
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )

        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        # 驗證：創建了副本（透過 AssignmentContent 關聯表查詢）
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .first()
        )
        assert copy_content is not None
        assert copy_content.source_content_id == 3  # 指向公版內容
        assert copy_content.title == "公版內容"

        # 驗證：公版內容沒有被影響
        original_template = db.query(Content).filter(Content.id == 3).first()
        assert original_template.is_assignment_copy is False
        assert original_template.lesson_id == 2  # 仍然屬於公版課程

        db.close()

    def test_classroom_program_content_copy(self, test_data):
        """測試：從班級課程派作業時，內容會被正確複製"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        # 測試資料中已經有班級課程（program_id=1, classroom_id=1）
        # 使用現有的 content_id=1

        # 派作業（使用班級課程內容）
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1],  # 班級課程內容
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )

        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        # 驗證：創建了副本（透過 AssignmentContent 關聯表查詢）
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .first()
        )
        assert copy_content is not None
        assert copy_content.source_content_id == 1  # 指向班級課程內容
        assert copy_content.title == "測試內容"

        # 驗證：班級課程內容沒有被影響
        original_content = db.query(Content).filter(Content.id == 1).first()
        assert original_content.is_assignment_copy is False
        assert original_content.lesson_id == 1  # 仍然屬於班級課程

        db.close()

    def test_audio_url_is_copied(self, test_data):
        """測試：音檔 URL 正確複製到副本"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        # 派作業
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1],
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )

        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        # 取得副本 ContentItem（透過 AssignmentContent 關聯表查詢）
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .first()
        )
        copy_item = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content.id)
            .first()
        )

        # 驗證：音檔 URL 正確複製
        assert copy_item.audio_url == "https://example.com/audio1.mp3"

        # 驗證：原始模板的音檔 URL 仍然存在
        original_item = db.query(ContentItem).filter(ContentItem.id == 1).first()
        assert original_item.audio_url == "https://example.com/audio1.mp3"

        # 驗證：副本和模板的音檔 URL 相同（共用音檔）
        assert copy_item.audio_url == original_item.audio_url

        db.close()

    def test_modifying_multiple_assignment_copies_does_not_affect_templates(
        self, test_data
    ):
        """測試：修改作業內多個 Content 和 ContentItem 副本時，模板完全不受影響"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        db = TestingSessionLocal()

        # 準備：創建第二個 Content（模板）並包含多個 ContentItem
        content2 = Content(
            id=2,
            lesson_id=1,
            title="模板內容2",
            type=ContentType.EXAMPLE_SENTENCES,
            order_index=2,
            is_active=True,
            is_assignment_copy=False,
        )
        db.add(content2)
        db.commit()

        # 為第一個 Content 添加更多 ContentItem（模板）
        content_item2 = ContentItem(
            id=2,
            content_id=1,
            order_index=2,
            text="Good evening",
            translation="晚安",
            audio_url="https://example.com/audio2.mp3",
        )
        content_item3 = ContentItem(
            id=3,
            content_id=1,
            order_index=3,
            text="Good night",
            translation="晚安（睡覺）",
            audio_url="https://example.com/audio3.mp3",
        )
        db.add(content_item2)
        db.add(content_item3)
        db.commit()

        # 為第二個 Content 創建多個 ContentItem（模板）
        content_item4 = ContentItem(
            id=4,
            content_id=2,
            order_index=1,
            text="Hello",
            translation="你好",
            audio_url="https://example.com/audio4.mp3",
        )
        content_item5 = ContentItem(
            id=5,
            content_id=2,
            order_index=2,
            text="Hi",
            translation="嗨",
            audio_url="https://example.com/audio5.mp3",
        )
        content_item6 = ContentItem(
            id=6,
            content_id=2,
            order_index=3,
            text="How are you",
            translation="你好嗎",
            audio_url="https://example.com/audio6.mp3",
        )
        db.add(content_item4)
        db.add(content_item5)
        db.add(content_item6)
        db.commit()
        db.close()

        # 1. 派作業（包含兩個 Content，每個都有多個 ContentItem）
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1, 2],  # 兩個內容
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )

        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        # 取得兩個副本 Content（透過 AssignmentContent 關聯表查詢）
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_contents = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .order_by(Content.order_index)
            .all()
        )
        assert len(copy_contents) == 2
        copy_content1 = copy_contents[0]  # 對應原始 content_id=1
        copy_content2 = copy_contents[1]  # 對應原始 content_id=2

        # 驗證初始狀態：副本與模板一致
        assert copy_content1.title == "測試內容"
        assert copy_content2.title == "模板內容2"

        # 取得副本的 ContentItem
        copy_items1 = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content1.id)
            .order_by(ContentItem.order_index)
            .all()
        )
        assert len(copy_items1) == 3  # 應該有 3 個

        copy_items2 = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content2.id)
            .order_by(ContentItem.order_index)
            .all()
        )
        assert len(copy_items2) == 3  # 應該有 3 個

        db.close()

        # 2. 修改第一個 Content 副本：修改 title 和多個 ContentItem
        update_response1 = client.put(
            f"/api/teachers/contents/{copy_content1.id}",
            headers=headers,
            json={
                "title": "修改後的副本內容1",
                "items": [
                    {
                        "text": "Modified morning",
                        "translation": "修改後的早安",
                        "audio_url": "https://example.com/modified1.mp3",
                    },
                    {
                        "text": "Modified evening",
                        "translation": "修改後的晚安",
                        "audio_url": "https://example.com/modified2.mp3",
                    },
                    {
                        "text": "Modified night",
                        "translation": "修改後的晚安（睡覺）",
                        "audio_url": "https://example.com/modified3.mp3",
                    },
                ],
            },
        )
        assert update_response1.status_code == 200

        # 3. 修改第二個 Content 副本：修改 title 和多個 ContentItem
        update_response2 = client.put(
            f"/api/teachers/contents/{copy_content2.id}",
            headers=headers,
            json={
                "title": "修改後的副本內容2",
                "items": [
                    {
                        "text": "Modified hello",
                        "translation": "修改後的你好",
                        "audio_url": "https://example.com/modified4.mp3",
                    },
                    {
                        "text": "Modified hi",
                        "translation": "修改後的嗨",
                        "audio_url": "https://example.com/modified5.mp3",
                    },
                    {
                        "text": "Modified how are you",
                        "translation": "修改後的你好嗎",
                        "audio_url": "https://example.com/modified6.mp3",
                    },
                ],
            },
        )
        assert update_response2.status_code == 200

        # 4. 驗證：模板完全不受影響
        db = TestingSessionLocal()

        # 驗證第一個模板 Content
        original_content1 = db.query(Content).filter(Content.id == 1).first()
        assert original_content1.title == "測試內容"  # 模板標題未變
        assert original_content1.is_assignment_copy is False

        original_items1 = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == 1)
            .order_by(ContentItem.order_index)
            .all()
        )
        assert len(original_items1) == 3
        assert original_items1[0].text == "Good morning"  # 模板未變
        assert original_items1[1].text == "Good evening"  # 模板未變
        assert original_items1[2].text == "Good night"  # 模板未變

        # 驗證第二個模板 Content
        original_content2 = db.query(Content).filter(Content.id == 2).first()
        assert original_content2.title == "模板內容2"  # 模板標題未變
        assert original_content2.is_assignment_copy is False

        original_items2 = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == 2)
            .order_by(ContentItem.order_index)
            .all()
        )
        assert len(original_items2) == 3
        assert original_items2[0].text == "Hello"  # 模板未變
        assert original_items2[1].text == "Hi"  # 模板未變
        assert original_items2[2].text == "How are you"  # 模板未變

        # 5. 驗證：副本已經被修改（重新查詢）
        updated_copy_content1 = (
            db.query(Content).filter(Content.id == copy_content1.id).first()
        )
        updated_copy_content2 = (
            db.query(Content).filter(Content.id == copy_content2.id).first()
        )
        assert updated_copy_content1.title == "修改後的副本內容1"
        assert updated_copy_content2.title == "修改後的副本內容2"

        updated_copy_items1 = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content1.id)
            .order_by(ContentItem.order_index)
            .all()
        )
        assert len(updated_copy_items1) == 3
        assert updated_copy_items1[0].text == "Modified morning"
        assert updated_copy_items1[1].text == "Modified evening"
        assert updated_copy_items1[2].text == "Modified night"

        updated_copy_items2 = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content2.id)
            .order_by(ContentItem.order_index)
            .all()
        )
        assert len(updated_copy_items2) == 3
        assert updated_copy_items2[0].text == "Modified hello"
        assert updated_copy_items2[1].text == "Modified hi"
        assert updated_copy_items2[2].text == "Modified how are you"

        # 6. 驗證：副本的 source_content_id 仍然正確指向模板
        assert updated_copy_content1.source_content_id == 1
        assert updated_copy_content2.source_content_id == 2

        db.close()

    def test_updating_assignment_content_with_student_progress_loses_data(
        self, test_data
    ):
        """測試：當學生已有進度時，修改作業 ContentItem 會導致進度丟失（問題驗證）"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        # 1. 派作業
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1],
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )
        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        # 取得副本 Content 和 ContentItem（透過 AssignmentContent 關聯表查詢）
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .first()
        )
        copy_item = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content.id)
            .first()
        )

        # 2. 模擬學生已經有進度（錄音、分數）
        # 派作業時已經自動創建了 StudentItemProgress，只需要更新它
        student_assignment = (
            db.query(StudentAssignment)
            .filter(StudentAssignment.assignment_id == assignment_id)
            .first()
        )

        student_progress = (
            db.query(StudentItemProgress)
            .filter(
                StudentItemProgress.student_assignment_id == student_assignment.id,
                StudentItemProgress.content_item_id == copy_item.id,
            )
            .first()
        )
        assert student_progress is not None  # 應該已經存在

        # 更新進度記錄，模擬學生已經完成
        student_progress.recording_url = "https://example.com/student_recording.mp3"
        student_progress.transcription = "Good morning"
        student_progress.accuracy_score = 90.5
        student_progress.fluency_score = 85.0
        student_progress.pronunciation_score = 88.0
        student_progress.ai_feedback = "Great job!"
        student_progress.status = "COMPLETED"
        student_progress.submitted_at = datetime.now(timezone.utc)
        student_progress.ai_assessed_at = datetime.now(timezone.utc)
        db.commit()
        progress_id = student_progress.id
        copy_content_id = copy_content.id  # 保存 ID
        copy_item_id = copy_item.id  # 保存 ID
        db.close()

        # 3. 驗證進度存在
        db = TestingSessionLocal()
        progress_before = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.id == progress_id)
            .first()
        )
        assert progress_before is not None
        assert (
            progress_before.recording_url == "https://example.com/student_recording.mp3"
        )
        assert progress_before.accuracy_score == 90.5
        db.close()

        # 4. 老師修改作業的 ContentItem（修改文字）
        update_response = client.put(
            f"/api/teachers/contents/{copy_content_id}",
            headers=headers,
            json={
                "title": "修改後的內容",
                "items": [
                    {
                        "text": "Hello world",  # 修改了文字
                        "translation": "你好世界",
                        "audio_url": "https://example.com/new_audio.mp3",
                    },
                ],
            },
        )
        assert update_response.status_code == 200

        # 5. 驗證：學生的進度記錄應該被保留（智能遷移）
        db = TestingSessionLocal()
        progress_after = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.id == progress_id)
            .first()
        )
        assert progress_after is not None  # ✅ 進度記錄應該被保留

        # 驗證：ContentItem 已更新（ID 不變，文字已更新）
        updated_copy_item = (
            db.query(ContentItem).filter(ContentItem.id == copy_item_id).first()
        )
        assert updated_copy_item is not None
        assert updated_copy_item.id == copy_item_id  # ✅ ID 不變
        assert updated_copy_item.text == "Hello world"  # ✅ 文字已更新

        # 驗證：學生的進度記錄仍然有效
        assert progress_after.content_item_id == copy_item_id  # ✅ 仍然指向同一個 ContentItem
        assert (
            progress_after.recording_url == "https://example.com/student_recording.mp3"
        )  # ✅ 錄音保留
        assert progress_after.accuracy_score == 90.5  # ✅ 分數保留

        db.close()

    def test_smart_update_preserves_student_progress_when_modifying_text(
        self, test_data
    ):
        """測試：智能更新 - 修改文字時保留學生進度"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        # 1. 派作業
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1],
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )
        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        # 取得副本 Content 和 ContentItem（透過 AssignmentContent 關聯表查詢）
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .first()
        )
        copy_item = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content.id)
            .first()
        )

        # 2. 模擬學生已經有進度
        student_assignment = (
            db.query(StudentAssignment)
            .filter(StudentAssignment.assignment_id == assignment_id)
            .first()
        )

        student_progress = (
            db.query(StudentItemProgress)
            .filter(
                StudentItemProgress.student_assignment_id == student_assignment.id,
                StudentItemProgress.content_item_id == copy_item.id,
            )
            .first()
        )

        # 更新進度記錄
        student_progress.recording_url = "https://example.com/recording.mp3"
        student_progress.accuracy_score = 95.0
        student_progress.status = "COMPLETED"
        db.commit()
        progress_id = student_progress.id
        copy_content_id = copy_content.id
        copy_item_id = copy_item.id
        db.close()

        # 3. 老師修改文字（修正錯字）
        update_response = client.put(
            f"/api/teachers/contents/{copy_content_id}",
            headers=headers,
            json={
                "title": "測試內容",
                "items": [
                    {
                        "text": "Good morning!",  # 修改了文字（加了感嘆號）
                        "translation": "早安",
                        "audio_url": "https://example.com/audio1.mp3",
                    },
                ],
            },
        )
        assert update_response.status_code == 200

        # 4. 驗證：學生進度保留，ContentItem ID 不變
        db = TestingSessionLocal()
        progress_after = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.id == progress_id)
            .first()
        )
        assert progress_after is not None
        assert progress_after.content_item_id == copy_item_id  # ✅ ID 不變
        assert (
            progress_after.recording_url == "https://example.com/recording.mp3"
        )  # ✅ 錄音保留
        assert progress_after.accuracy_score == 95.0  # ✅ 分數保留

        updated_item = (
            db.query(ContentItem).filter(ContentItem.id == copy_item_id).first()
        )
        assert updated_item.text == "Good morning!"  # ✅ 文字已更新

        db.close()

    def test_smart_update_allows_adding_items_at_end(self, test_data):
        """測試：智能更新 - 允許在最後新增題目"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        # 1. 派作業
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1],
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )
        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .first()
        )
        copy_item = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content.id)
            .first()
        )

        # 2. 模擬學生已經有進度
        student_assignment = (
            db.query(StudentAssignment)
            .filter(StudentAssignment.assignment_id == assignment_id)
            .first()
        )

        student_progress = (
            db.query(StudentItemProgress)
            .filter(
                StudentItemProgress.student_assignment_id == student_assignment.id,
                StudentItemProgress.content_item_id == copy_item.id,
            )
            .first()
        )

        student_progress.recording_url = "https://example.com/recording.mp3"
        student_progress.accuracy_score = 90.0
        db.commit()
        progress_id = student_progress.id
        copy_content_id = copy_content.id
        copy_item_id = copy_item.id
        student_assignment_id = student_assignment.id  # 儲存 ID
        db.close()

        # 3. 老師在最後新增題目
        update_response = client.put(
            f"/api/teachers/contents/{copy_content_id}",
            headers=headers,
            json={
                "title": "測試內容",
                "items": [
                    {
                        "text": "Good morning",
                        "translation": "早安",
                        "audio_url": "https://example.com/audio1.mp3",
                    },
                    {
                        "text": "Good afternoon",  # 新增
                        "translation": "午安",
                        "audio_url": "https://example.com/audio2.mp3",
                    },
                ],
            },
        )
        assert update_response.status_code == 200

        # 4. 驗證：原有進度保留，新增的題目沒有進度
        db = TestingSessionLocal()
        progress_after = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.id == progress_id)
            .first()
        )
        assert progress_after is not None
        assert progress_after.content_item_id == copy_item_id  # ✅ 原有進度保留

        # 驗證新增的題目
        all_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content_id)
            .order_by(ContentItem.order_index)
            .all()
        )
        assert len(all_items) == 2
        assert all_items[0].text == "Good morning"
        assert all_items[1].text == "Good afternoon"

        # 驗證：新增的題目目前沒有進度記錄（會在學生下次獲取作業時自動創建）
        # 這是預期行為：老師新增題目後，學生下次打開作業時會看到新題目
        all_progress = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.student_assignment_id == student_assignment_id)
            .all()
        )
        # 目前只有第一個題目有進度（學生之前做過的）
        assert len(all_progress) == 1
        assert all_progress[0].content_item_id == copy_item_id

        db.close()

    def test_smart_update_allows_deleting_items_without_progress(self, test_data):
        """測試：智能更新 - 允許刪除沒有學生記錄的題目"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        db = TestingSessionLocal()

        # 為模板添加第二個 ContentItem
        content_item2 = ContentItem(
            id=2,
            content_id=1,
            order_index=2,
            text="Good evening",
            translation="晚安",
            audio_url="https://example.com/audio2.mp3",
        )
        db.add(content_item2)
        db.commit()
        db.close()

        # 1. 派作業（包含兩個題目）
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1],
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )
        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .first()
        )

        copy_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content.id)
            .order_by(ContentItem.order_index)
            .all()
        )
        assert len(copy_items) == 2

        # 2. 學生只完成第一個題目
        student_assignment = (
            db.query(StudentAssignment)
            .filter(StudentAssignment.assignment_id == assignment_id)
            .first()
        )

        progress1 = (
            db.query(StudentItemProgress)
            .filter(
                StudentItemProgress.student_assignment_id == student_assignment.id,
                StudentItemProgress.content_item_id == copy_items[0].id,
            )
            .first()
        )
        progress1.recording_url = "https://example.com/recording1.mp3"
        progress1.accuracy_score = 90.0
        progress1.status = "COMPLETED"
        # progress2 保持 NOT_STARTED（沒有進度）

        db.commit()
        progress1_id = progress1.id
        copy_content_id = copy_content.id
        copy_item1_id = copy_items[0].id
        copy_item2_id = copy_items[1].id
        db.close()

        # 3. 老師刪除第二個題目（沒有學生記錄）
        update_response = client.put(
            f"/api/teachers/contents/{copy_content_id}",
            headers=headers,
            json={
                "title": "測試內容",
                "items": [
                    {
                        "text": "Good morning",
                        "translation": "早安",
                        "audio_url": "https://example.com/audio1.mp3",
                    },
                    # 第二個題目被刪除
                ],
            },
        )
        assert update_response.status_code == 200

        # 4. 驗證：第一個題目的進度保留，第二個題目被刪除
        db = TestingSessionLocal()
        progress1_after = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.id == progress1_id)
            .first()
        )
        assert progress1_after is not None
        assert progress1_after.content_item_id == copy_item1_id  # ✅ 進度保留

        # 驗證第二個題目被刪除
        item2_after = (
            db.query(ContentItem).filter(ContentItem.id == copy_item2_id).first()
        )
        assert item2_after is None  # ✅ 已刪除

        db.close()

    def test_smart_update_prevents_deleting_items_with_progress(self, test_data):
        """測試：智能更新 - 阻止刪除有學生記錄的題目"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        db = TestingSessionLocal()

        # 為模板添加第二個 ContentItem
        content_item2 = ContentItem(
            id=2,
            content_id=1,
            order_index=2,
            text="Good evening",
            translation="晚安",
            audio_url="https://example.com/audio2.mp3",
        )
        db.add(content_item2)
        db.commit()
        db.close()

        # 1. 派作業
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1],
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )
        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .first()
        )

        copy_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content.id)
            .order_by(ContentItem.order_index)
            .all()
        )

        # 2. 學生完成第二個題目
        student_assignment = (
            db.query(StudentAssignment)
            .filter(StudentAssignment.assignment_id == assignment_id)
            .first()
        )

        progress2 = (
            db.query(StudentItemProgress)
            .filter(
                StudentItemProgress.student_assignment_id == student_assignment.id,
                StudentItemProgress.content_item_id == copy_items[1].id,
            )
            .first()
        )
        progress2.recording_url = "https://example.com/recording2.mp3"
        progress2.accuracy_score = 85.0
        progress2.status = "COMPLETED"
        db.commit()
        copy_content_id = copy_content.id
        db.close()

        # 3. 老師嘗試刪除第二個題目（有學生記錄）
        update_response = client.put(
            f"/api/teachers/contents/{copy_content_id}",
            headers=headers,
            json={
                "title": "測試內容",
                "items": [
                    {
                        "text": "Good morning",
                        "translation": "早安",
                        "audio_url": "https://example.com/audio1.mp3",
                    },
                    # 嘗試刪除第二個題目
                ],
            },
        )
        assert update_response.status_code == 400
        assert "無法刪除" in update_response.json()["detail"]
        assert "已有進度" in update_response.json()["detail"]

        # 4. 驗證：第二個題目沒有被刪除
        db = TestingSessionLocal()
        all_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content_id)
            .all()
        )
        assert len(all_items) == 2  # ✅ 沒有被刪除

        db.close()

    def test_smart_update_allows_changing_order(self, test_data):
        """測試：智能更新 - 允許改變順序"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        db = TestingSessionLocal()

        # 為模板添加第二個 ContentItem
        content_item2 = ContentItem(
            id=2,
            content_id=1,
            order_index=2,
            text="Good evening",
            translation="晚安",
            audio_url="https://example.com/audio2.mp3",
        )
        db.add(content_item2)
        db.commit()
        db.close()

        # 1. 派作業
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1],
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )
        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .first()
        )

        copy_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content.id)
            .order_by(ContentItem.order_index)
            .all()
        )

        # 2. 學生完成兩個題目
        student_assignment = (
            db.query(StudentAssignment)
            .filter(StudentAssignment.assignment_id == assignment_id)
            .first()
        )

        progress1 = (
            db.query(StudentItemProgress)
            .filter(
                StudentItemProgress.student_assignment_id == student_assignment.id,
                StudentItemProgress.content_item_id == copy_items[0].id,
            )
            .first()
        )
        progress1.recording_url = "https://example.com/recording1.mp3"
        progress1.accuracy_score = 90.0

        progress2 = (
            db.query(StudentItemProgress)
            .filter(
                StudentItemProgress.student_assignment_id == student_assignment.id,
                StudentItemProgress.content_item_id == copy_items[1].id,
            )
            .first()
        )
        progress2.recording_url = "https://example.com/recording2.mp3"
        progress2.accuracy_score = 85.0

        db.commit()
        progress1_id = progress1.id
        progress2_id = progress2.id
        copy_content_id = copy_content.id
        copy_item1_id = copy_items[0].id
        copy_item2_id = copy_items[1].id
        db.close()

        # 3. 老師改變順序（從 [0, 1] 改為 [1, 0]）
        update_response = client.put(
            f"/api/teachers/contents/{copy_content_id}",
            headers=headers,
            json={
                "title": "測試內容",
                "items": [
                    {
                        "text": "Good evening",  # 原本 order_index=1
                        "translation": "晚安",
                        "audio_url": "https://example.com/audio2.mp3",
                    },
                    {
                        "text": "Good morning",  # 原本 order_index=0
                        "translation": "早安",
                        "audio_url": "https://example.com/audio1.mp3",
                    },
                ],
            },
        )
        assert update_response.status_code == 200

        # 4. 驗證：順序改變，但 ID 不變，進度記錄仍然有效
        db = TestingSessionLocal()
        updated_items = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content_id)
            .order_by(ContentItem.order_index)
            .all()
        )
        assert len(updated_items) == 2

        # 驗證順序已改變
        assert updated_items[0].text == "Good evening"
        assert updated_items[0].order_index == 0
        assert updated_items[1].text == "Good morning"
        assert updated_items[1].order_index == 1

        # 驗證 ID 不變（通過內容匹配）
        item_ids = {item.id for item in updated_items}
        assert copy_item1_id in item_ids
        assert copy_item2_id in item_ids

        # 驗證進度記錄仍然有效
        progress1_after = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.id == progress1_id)
            .first()
        )
        progress2_after = (
            db.query(StudentItemProgress)
            .filter(StudentItemProgress.id == progress2_id)
            .first()
        )
        assert progress1_after is not None
        assert progress2_after is not None
        assert progress1_after.recording_url == "https://example.com/recording1.mp3"
        assert progress2_after.recording_url == "https://example.com/recording2.mp3"

        db.close()

    def test_assignment_deletion_hard_deletes_copy(self, test_data):
        """測試：刪除作業時，副本會被硬刪除"""
        token = get_auth_token()
        headers = {"Authorization": f"Bearer {token}"}

        # 1. 派作業
        response = client.post(
            "/api/teachers/assignments/create",
            headers=headers,
            json={
                "title": "測試作業",
                "description": "測試描述",
                "classroom_id": 1,
                "content_ids": [1],
                "student_ids": [1],
                "due_date": (datetime.now(timezone.utc).isoformat()),
            },
        )
        assert response.status_code == 200
        assignment_id = response.json()["assignment_id"]

        db = TestingSessionLocal()

        # 驗證副本存在（透過 AssignmentContent 關聯表查詢）
        assignment_contents = (
            db.query(AssignmentContent)
            .filter(AssignmentContent.assignment_id == assignment_id)
            .all()
        )
        content_ids = [ac.content_id for ac in assignment_contents]
        copy_content = (
            db.query(Content)
            .filter(Content.id.in_(content_ids), Content.is_assignment_copy.is_(True))
            .first()
        )
        assert copy_content is not None
        copy_content_id = copy_content.id

        copy_item = (
            db.query(ContentItem)
            .filter(ContentItem.content_id == copy_content.id)
            .first()
        )
        assert copy_item is not None
        copy_item_id = copy_item.id

        db.close()

        # 2. 透過 API 刪除作業（軟刪除 Assignment，但硬刪除副本）
        response = client.delete(
            f"/api/teachers/assignments/{assignment_id}",
            headers=headers,
        )
        assert response.status_code == 200

        # 3. 驗證：副本已被硬刪除
        db = TestingSessionLocal()
        copy_content_after = (
            db.query(Content).filter(Content.id == copy_content_id).first()
        )
        assert copy_content_after is None  # 副本應該被硬刪除

        copy_item_after = (
            db.query(ContentItem).filter(ContentItem.id == copy_item_id).first()
        )
        assert copy_item_after is None  # ContentItem 也應該被硬刪除

        # 4. 驗證：模板內容沒有被影響
        original_content = db.query(Content).filter(Content.id == 1).first()
        assert original_content is not None  # 模板仍然存在
        assert original_content.is_assignment_copy is False  # 確認是模板

        # 5. 驗證：Assignment 被軟刪除
        assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
        assert assignment is not None
        assert assignment.is_active is False  # 作業被軟刪除

        db.close()

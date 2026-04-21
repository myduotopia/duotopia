"""
Unit Tests for Content CRUD API Endpoints
測試 Content 的 Create, Read, Update, Delete API 端點
"""

import pytest
from fastapi.testclient import TestClient
from main import app
from database import get_db
from models import Teacher, Program, Classroom, Lesson, ProgramLevel
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from passlib.context import CryptContext

# 密碼雜湊
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# 測試資料庫連接
SQLALCHEMY_DATABASE_URL = "sqlite:///./test_content_crud.db"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

client = TestClient(app)


def override_get_db():
    """Override database dependency for testing"""
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="module", autouse=True)
def setup_database():
    """Setup test database before tests"""
    from models import Base

    Base.metadata.create_all(bind=engine)

    # 創建測試老師
    db = TestingSessionLocal()
    teacher = Teacher(
        email="test@teacher.com",
        name="Test Teacher",
        password_hash=pwd_context.hash("test123"),
        email_verified=True,
    )
    db.add(teacher)

    # 創建測試班級
    classroom = Classroom(name="Test Classroom", teacher_id=1, grade="Grade 1")
    db.add(classroom)

    # 創建測試課程
    program = Program(
        name="Test Program",
        description="Test Program Description",
        teacher_id=1,
        classroom_id=1,
    )
    db.add(program)

    # 創建測試單元
    lesson = Lesson(
        name="Test Lesson",
        description="Test Lesson Description",
        program_id=1,
        order_index=1,
        estimated_minutes=30,
    )
    db.add(lesson)

    db.commit()
    db.close()

    yield

    # Cleanup
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def auth_token():
    """Get authentication token for testing"""
    response = client.post(
        "/api/auth/teacher/login",
        json={"email": "test@teacher.com", "password": "test123"},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


class TestContentCRUD:
    """測試 Content CRUD API"""

    def test_create_content(self, auth_token):
        """測試創建 Content (CREATE)"""
        response = client.post(
            "/api/teachers/lessons/1/contents",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "title": "Test Content",
                "items": [
                    {"text": "Hello", "translation": "你好"},
                    {"text": "World", "translation": "世界"},
                ],
                "target_wpm": 100,
                "target_accuracy": 95.0,
                "order_index": 1,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Test Content"
        assert data["target_wpm"] == 100
        assert data["target_accuracy"] == 95.0
        assert len(data["items"]) == 2
        assert "id" in data

    def test_read_content(self, auth_token):
        """測試讀取 Content (READ)"""
        # 先創建一個 content
        create_response = client.post(
            "/api/teachers/lessons/1/contents",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "title": "Read Test Content",
                "items": [{"text": "Test", "translation": "測試"}],
                "target_wpm": 120,
                "target_accuracy": 90.0,
                "order_index": 1,
            },
        )
        content_id = create_response.json()["id"]

        # 讀取 content
        response = client.get(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["id"] == content_id
        assert data["title"] == "Read Test Content"
        assert data["target_wpm"] == 120

    def test_update_content(self, auth_token):
        """測試更新 Content (UPDATE)"""
        # 先創建一個 content
        create_response = client.post(
            "/api/teachers/lessons/1/contents",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "title": "Original Content",
                "items": [{"text": "Original", "translation": "原始"}],
                "target_wpm": 100,
                "target_accuracy": 90.0,
                "order_index": 1,
            },
        )
        content_id = create_response.json()["id"]

        # 更新 content
        response = client.put(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "title": "Updated Content",
                "target_wpm": 150,
                "target_accuracy": 95.0,
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Updated Content"
        assert data["target_wpm"] == 150
        assert data["target_accuracy"] == 95.0

    def test_delete_content(self, auth_token):
        """測試刪除 Content (DELETE) - 軟刪除"""
        # 先創建一個 content
        create_response = client.post(
            "/api/teachers/lessons/1/contents",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "title": "Delete Test",
                "items": [{"text": "Delete", "translation": "刪除"}],
                "target_wpm": 100,
                "target_accuracy": 90.0,
                "order_index": 1,
            },
        )
        content_id = create_response.json()["id"]

        # 刪除 content
        response = client.delete(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )

        assert response.status_code == 200

        # 驗證軟刪除：嘗試讀取應該返回 404
        get_response = client.get(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert get_response.status_code == 404

        # 驗證軟刪除：嘗試更新應該返回 404
        update_response = client.put(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "title": "Should Not Work",
                "target_wpm": 100,
                "target_accuracy": 90.0,
            },
        )
        assert update_response.status_code == 404

    def test_cannot_create_content_in_deleted_lesson(self, auth_token):
        """測試無法在已刪除的 Lesson 中創建 Content"""
        # 創建一個新 lesson
        db = TestingSessionLocal()
        lesson = Lesson(
            name="To Delete Lesson",
            description="Will be deleted",
            program_id=1,
            order_index=2,
            estimated_minutes=30,
        )
        db.add(lesson)
        db.commit()
        lesson_id = lesson.id
        db.close()

        # 刪除 lesson
        client.delete(
            f"/api/teachers/lessons/{lesson_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )

        # 嘗試在已刪除的 lesson 中創建 content
        response = client.post(
            f"/api/teachers/lessons/{lesson_id}/contents",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "title": "Should Not Work",
                "items": [{"text": "Test", "translation": "測試"}],
                "target_wpm": 100,
                "target_accuracy": 90.0,
                "order_index": 1,
            },
        )

        assert response.status_code == 404

    def test_unauthorized_access(self):
        """測試未授權存取"""
        # 沒有 token
        response = client.post(
            "/api/teachers/lessons/1/contents",
            json={
                "title": "Test",
                "items": [{"text": "Test", "translation": "測試"}],
                "target_wpm": 100,
                "target_accuracy": 90.0,
                "order_index": 1,
            },
        )
        assert response.status_code == 401

        # 錯誤的 token
        response = client.get(
            "/api/teachers/contents/1",
            headers={"Authorization": "Bearer invalid_token"},
        )
        assert response.status_code == 401

    def test_content_inherits_program_level(self, auth_token):
        """測試 Content 正確繼承 Program 的 level (#250)

        驗證：
        1. Content 應該自動繼承所屬 Program 的 level
        2. 即使前端沒有傳 level，Content 也應該有正確的 level 值
        3. ProgramLevel Enum 應該正確轉換為字串存入 Content.level
        """
        # 創建一個 B2 級別的 Program
        db = TestingSessionLocal()
        program_b2 = Program(
            name="B2 Test Program",
            description="B2 Level Program",
            teacher_id=1,
            classroom_id=1,
            level=ProgramLevel.B2,  # 設定為 B2
        )
        db.add(program_b2)
        db.commit()
        program_b2_id = program_b2.id

        # 創建一個 Lesson
        lesson_b2 = Lesson(
            name="B2 Test Lesson",
            description="B2 Lesson",
            program_id=program_b2_id,
            order_index=1,
            estimated_minutes=30,
        )
        db.add(lesson_b2)
        db.commit()
        lesson_b2_id = lesson_b2.id
        db.close()

        # 創建 Content（前端沒有傳 level）
        response = client.post(
            f"/api/teachers/lessons/{lesson_b2_id}/contents",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "title": "B2 Test Content",
                "items": [
                    {"text": "Advanced English", "translation": "進階英文"},
                ],
                "target_wpm": 120,
                "target_accuracy": 95.0,
                "order_index": 1,
            },
        )

        assert response.status_code == 200
        data = response.json()

        # 驗證 Content 繼承了 Program 的 level
        assert "level" in data
        assert data["level"] == "B2", f"Expected level 'B2', got '{data['level']}'"

        # 讀取 Content 再次驗證
        content_id = data["id"]
        get_response = client.get(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )

        assert get_response.status_code == 200
        content_data = get_response.json()
        assert content_data["level"] == "B2"

    def test_content_inherits_different_program_levels(self, auth_token):
        """測試不同 Program level 的繼承（PreA, A1, C2）

        驗證所有可能的 ProgramLevel Enum 值都能正確轉換
        """
        db = TestingSessionLocal()

        # 測試案例：(ProgramLevel Enum, 期望的字串值)
        test_cases = [
            (ProgramLevel.PRE_A, "preA"),
            (ProgramLevel.A1, "A1"),
            (ProgramLevel.C2, "C2"),
        ]

        for program_level, expected_string in test_cases:
            # 創建指定 level 的 Program
            program = Program(
                name=f"{expected_string} Program",
                description=f"{expected_string} Level",
                teacher_id=1,
                classroom_id=1,
                level=program_level,
            )
            db.add(program)
            db.commit()

            # 創建 Lesson
            lesson = Lesson(
                name=f"{expected_string} Lesson",
                program_id=program.id,
                order_index=1,
            )
            db.add(lesson)
            db.commit()

            # 創建 Content
            response = client.post(
                f"/api/teachers/lessons/{lesson.id}/contents",
                headers={"Authorization": f"Bearer {auth_token}"},
                json={
                    "title": f"{expected_string} Content",
                    "items": [{"text": "Test", "translation": "測試"}],
                    "target_wpm": 100,
                    "target_accuracy": 90.0,
                },
            )

            assert response.status_code == 200
            data = response.json()
            assert (
                data["level"] == expected_string
            ), f"Program level {program_level} should convert to '{expected_string}', got '{data['level']}'"

        db.close()

    def test_update_content_prefers_vocabulary_translation_over_definition(
        self, auth_token
    ):
        """Issue #600: Preview 卡顯示的 translation 應該是使用者當前選擇語言的翻譯。

        前端 VocabularySetPanel 在英英模式下送出：
          - vocabulary_translation = "Hello" (英文定義)
          - vocabulary_translation_lang = "english"
          - definition = "你好"  (殘留的中文欄位)
        後端應存入 item.translation = "Hello"（vocabulary_translation 優先），
        而非中文的 definition。"""
        create_response = client.post(
            "/api/teachers/lessons/1/contents",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "title": "Lang-aware translation content",
                "items": [
                    {
                        "text": "greet",
                        "vocabulary_translation": "a friendly word of welcome",
                        "vocabulary_translation_lang": "english",
                        "definition": "你好",
                    }
                ],
                "target_wpm": 100,
                "target_accuracy": 90.0,
                "order_index": 1,
            },
        )
        assert create_response.status_code == 200
        content_id = create_response.json()["id"]

        # CREATE 路徑：translation 欄位應存英文（vocabulary_translation）
        detail_response = client.get(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        assert detail_response.status_code == 200
        created_items = detail_response.json()["items"]
        assert len(created_items) == 1
        assert created_items[0]["translation"] == "a friendly word of welcome"

        # UPDATE 路徑：切換語言到日文後，translation 欄位也要同步
        update_response = client.put(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "title": "Lang-aware translation content",
                "items": [
                    {
                        "text": "greet",
                        "vocabulary_translation": "こんにちは",
                        "vocabulary_translation_lang": "japanese",
                        "definition": "你好",
                    }
                ],
            },
        )
        assert update_response.status_code == 200

        detail_response_2 = client.get(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        updated_items = detail_response_2.json()["items"]
        assert updated_items[0]["translation"] == "こんにちは"

    def test_update_content_falls_back_to_definition_when_no_vocab_translation(
        self, auth_token
    ):
        """相容性：若前端未送 vocabulary_translation（舊 ReadingAssessmentPanel 流程），
        應沿用舊行為從 definition → translation fallback。"""
        create_response = client.post(
            "/api/teachers/lessons/1/contents",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "title": "Legacy definition content",
                "items": [{"text": "hello", "definition": "你好"}],
                "target_wpm": 100,
                "target_accuracy": 90.0,
                "order_index": 1,
            },
        )
        assert create_response.status_code == 200
        content_id = create_response.json()["id"]

        detail_response = client.get(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        items = detail_response.json()["items"]
        assert items[0]["translation"] == "你好"

        # UPDATE 路徑：同樣用舊格式（只送 definition，無 vocabulary_translation）
        update_response = client.put(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
            json={
                "title": "Legacy definition content",
                "items": [{"text": "hello", "definition": "謝謝"}],
                "target_wpm": 100,
                "target_accuracy": 90.0,
            },
        )
        assert update_response.status_code == 200

        updated_detail = client.get(
            f"/api/teachers/contents/{content_id}",
            headers={"Authorization": f"Bearer {auth_token}"},
        )
        updated_items = updated_detail.json()["items"]
        assert updated_items[0]["translation"] == "謝謝"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

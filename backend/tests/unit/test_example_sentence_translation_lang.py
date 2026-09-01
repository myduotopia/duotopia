"""Issue #1004: 例句翻譯語言（example_sentence_translation_lang）必須持久化。

前端 VocabularySetPanel 存檔時會送 example_sentence_translation_lang，
重新開啟時靠它決定譯文要落在中/日/韓哪個欄位。過去 content_ops 只保存
vocabulary_translation_lang，例句語言在 round-trip 中整個掉了，導致：
  - 重新編輯時例句翻譯語言永遠變回「中文」
  - 日/韓譯文被當成中文欄位、切語言時被清空

這裡用真實 API round-trip（PUT → GET）驗證，涵蓋新資料、舊資料 fallback、
以及未帶該欄位的次要儲存路徑不可把既有語言洗掉。
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from auth import create_access_token
from models import Teacher, Program, Classroom, Lesson


@pytest.fixture
def auth_token(db_session: Session):
    """Seed teacher + classroom + program + lesson (all id=1) and return a token."""
    teacher = Teacher(
        email="test@teacher.com",
        name="Test Teacher",
        password_hash="x",
        email_verified=True,
    )
    db_session.add(teacher)
    db_session.commit()

    classroom = Classroom(name="Test Classroom", teacher_id=teacher.id, grade="Grade 1")
    db_session.add(classroom)
    db_session.commit()

    program = Program(
        name="Test Program",
        description="Test Program Description",
        teacher_id=teacher.id,
        classroom_id=classroom.id,
    )
    db_session.add(program)
    db_session.commit()

    lesson = Lesson(
        name="Test Lesson",
        description="Test Lesson Description",
        program_id=program.id,
        order_index=1,
        estimated_minutes=30,
    )
    db_session.add(lesson)
    db_session.commit()

    return create_access_token({"sub": str(teacher.id), "type": "teacher"})


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _create_content(test_client: TestClient, token, items):
    response = test_client.post(
        "/api/teachers/lessons/1/contents",
        headers=_auth(token),
        json={
            "title": "Vocabulary Set",
            "items": items,
            "target_wpm": 100,
            "target_accuracy": 90.0,
            "order_index": 1,
        },
    )
    assert response.status_code == 200
    return response.json()["id"]


class TestExampleSentenceTranslationLang:
    """Issue #1004: 例句翻譯語言持久化"""

    def test_create_then_read_keeps_japanese(self, test_client: TestClient, auth_token):
        """建立時帶日文 → 讀回來仍是日文"""
        content_id = _create_content(
            test_client,
            auth_token,
            [
                {
                    "text": "apple",
                    "vocabulary_translation": "りんご",
                    "vocabulary_translation_lang": "japanese",
                    "example_sentence": "I eat an apple.",
                    "example_sentence_translation": "私はりんごを食べます。",
                    "example_sentence_translation_lang": "japanese",
                }
            ],
        )

        response = test_client.get(
            f"/api/teachers/contents/{content_id}", headers=_auth(auth_token)
        )
        assert response.status_code == 200
        item = response.json()["items"][0]
        assert item["example_sentence_translation_lang"] == "japanese"
        assert item["example_sentence_translation"] == "私はりんごを食べます。"

    def test_update_then_read_keeps_korean(self, test_client: TestClient, auth_token):
        """更新成韓文 → 讀回來是韓文（編輯既有單字集的主要情境）"""
        content_id = _create_content(
            test_client,
            auth_token,
            [
                {
                    "text": "apple",
                    "example_sentence": "I eat an apple.",
                    "example_sentence_translation": "我吃一顆蘋果。",
                    "example_sentence_translation_lang": "chinese",
                }
            ],
        )

        update = test_client.put(
            f"/api/teachers/contents/{content_id}",
            headers=_auth(auth_token),
            json={
                "title": "Vocabulary Set",
                "items": [
                    {
                        "text": "apple",
                        "example_sentence": "I eat an apple.",
                        "example_sentence_translation": "나는 사과를 먹습니다.",
                        "example_sentence_translation_lang": "korean",
                    }
                ],
            },
        )
        assert update.status_code == 200
        # PUT 的回應本身就要帶語言，前端存檔後不必再打一次 GET 才正確
        assert (
            update.json()["items"][0]["example_sentence_translation_lang"] == "korean"
        )

        response = test_client.get(
            f"/api/teachers/contents/{content_id}", headers=_auth(auth_token)
        )
        item = response.json()["items"][0]
        assert item["example_sentence_translation_lang"] == "korean"
        assert item["example_sentence_translation"] == "나는 사과를 먹습니다."

    def test_legacy_item_without_lang_falls_back_to_chinese(
        self, test_client: TestClient, auth_token
    ):
        """舊資料沒有這個欄位 → fallback 中文（不可回傳 None 讓前端炸掉）"""
        content_id = _create_content(
            test_client,
            auth_token,
            [
                {
                    "text": "apple",
                    "example_sentence": "I eat an apple.",
                    "example_sentence_translation": "我吃一顆蘋果。",
                }
            ],
        )

        response = test_client.get(
            f"/api/teachers/contents/{content_id}", headers=_auth(auth_token)
        )
        item = response.json()["items"][0]
        assert item["example_sentence_translation_lang"] == "chinese"

    def test_update_without_lang_preserves_existing(
        self, test_client: TestClient, auth_token
    ):
        """次要儲存路徑（例如只改音檔）沒帶語言時，不可把既有語言洗掉"""
        content_id = _create_content(
            test_client,
            auth_token,
            [
                {
                    "text": "apple",
                    "example_sentence": "I eat an apple.",
                    "example_sentence_translation": "私はりんごを食べます。",
                    "example_sentence_translation_lang": "japanese",
                }
            ],
        )

        detail = test_client.get(
            f"/api/teachers/contents/{content_id}", headers=_auth(auth_token)
        ).json()
        item_id = detail["items"][0]["id"]

        update = test_client.put(
            f"/api/teachers/contents/{content_id}",
            headers=_auth(auth_token),
            json={
                "title": "Vocabulary Set",
                "items": [
                    {
                        "id": item_id,
                        "text": "apple",
                        "example_sentence": "I eat an apple.",
                        "example_sentence_translation": "私はりんごを食べます。",
                        "audio_url": "https://example.com/apple.mp3",
                    }
                ],
            },
        )
        assert update.status_code == 200

        response = test_client.get(
            f"/api/teachers/contents/{content_id}", headers=_auth(auth_token)
        )
        item = response.json()["items"][0]
        assert item["example_sentence_translation_lang"] == "japanese"

    def test_lesson_contents_list_includes_lang(
        self, test_client: TestClient, auth_token
    ):
        """單元內容列表也要帶語言，避免不同載入路徑拿到不一致的資料"""
        _create_content(
            test_client,
            auth_token,
            [
                {
                    "text": "apple",
                    "example_sentence": "I eat an apple.",
                    "example_sentence_translation": "私はりんごを食べます。",
                    "example_sentence_translation_lang": "japanese",
                }
            ],
        )

        response = test_client.get(
            "/api/teachers/lessons/1/contents", headers=_auth(auth_token)
        )
        assert response.status_code == 200
        item = response.json()[0]["items"][0]
        assert item["example_sentence_translation_lang"] == "japanese"

    def test_update_with_empty_lang_does_not_wipe_existing(
        self, test_client: TestClient, auth_token
    ):
        """語言送空字串時視為「沒帶」，沿用既有值而不是洗掉（防呆，round-2 review）"""
        content_id = _create_content(
            test_client,
            auth_token,
            [
                {
                    "text": "apple",
                    "example_sentence": "I eat an apple.",
                    "example_sentence_translation": "私はりんごを食べます。",
                    "example_sentence_translation_lang": "japanese",
                }
            ],
        )

        detail = test_client.get(
            f"/api/teachers/contents/{content_id}", headers=_auth(auth_token)
        ).json()
        item_id = detail["items"][0]["id"]

        update = test_client.put(
            f"/api/teachers/contents/{content_id}",
            headers=_auth(auth_token),
            json={
                "title": "Vocabulary Set",
                "items": [
                    {
                        "id": item_id,
                        "text": "apple",
                        "example_sentence": "I eat an apple.",
                        "example_sentence_translation": "私はりんごを食べます。",
                        "example_sentence_translation_lang": "",
                    }
                ],
            },
        )
        assert update.status_code == 200

        response = test_client.get(
            f"/api/teachers/contents/{content_id}", headers=_auth(auth_token)
        )
        assert (
            response.json()["items"][0]["example_sentence_translation_lang"]
            == "japanese"
        )

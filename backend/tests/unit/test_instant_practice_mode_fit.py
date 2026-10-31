"""即刻練習的模式要屬於內容類型可用的模式（#1158 E-4）。

情境對話內容的即刻練習只有 scenario_dialogue 一種模式；create 與 reconfigure 都要擋
「把情境對話切成 reading」這類請求（422），否則學生端會拿情境題目去跑例句朗讀。
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from auth import create_access_token
from models import Assignment, Content, ContentItem, Lesson, Program, Teacher
from utils.practice_mode import practice_mode_fits_content_type

CREATE_URL = "/api/teachers/instant-practice/create"


class TestFitRule:
    @pytest.mark.parametrize(
        "mode,content_type,ok",
        [
            ("scenario_dialogue", "SCENARIO_DIALOGUE", True),
            ("reading", "SCENARIO_DIALOGUE", False),
            ("word_selection", "SCENARIO_DIALOGUE", False),
            ("scenario_dialogue", "EXAMPLE_SENTENCES", False),
            ("reading", "EXAMPLE_SENTENCES", True),
            ("rearrangement", "READING_ASSESSMENT", True),
            ("word_reading", "EXAMPLE_SENTENCES", False),
            ("tug_of_war", "VOCABULARY_SET", True),
            ("word_spelling_quiz", "SENTENCE_MAKING", True),
            ("reading", "VOCABULARY_SET", True),
            ("scenario_dialogue", "VOCABULARY_SET", False),
            # 沒列管的類型不在這裡把關
            ("reading", "MULTIPLE_CHOICE", True),
            # 大小寫皆可
            ("reading", "scenario_dialogue", False),
        ],
    )
    def test_rule(self, mode, content_type, ok):
        assert practice_mode_fits_content_type(mode, content_type) is ok

    def test_accepts_enum(self):
        from models import ContentType

        assert practice_mode_fits_content_type(
            "scenario_dialogue", ContentType.SCENARIO_DIALOGUE
        )
        assert not practice_mode_fits_content_type(
            "reading", ContentType.SCENARIO_DIALOGUE
        )


def _make_world(db: Session, content_type: str = "SCENARIO_DIALOGUE"):
    teacher = Teacher(
        email=f"ipfit-{content_type.lower()}@teacher.com",
        name="T",
        password_hash="x",
        email_verified=True,
    )
    db.add(teacher)
    db.commit()
    program = Program(name="P", description="d", teacher_id=teacher.id)
    db.add(program)
    db.commit()
    lesson = Lesson(
        name="L",
        description="d",
        program_id=program.id,
        order_index=1,
        estimated_minutes=30,
    )
    db.add(lesson)
    db.commit()
    content = Content(
        lesson_id=lesson.id,
        title="C",
        type=content_type,
        scenario_settings=(
            {"scenario_content": "At the park.", "global_rubric": "完整句子"}
            if content_type == "SCENARIO_DIALOGUE"
            else None
        ),
    )
    db.add(content)
    db.commit()
    db.add(
        ContentItem(
            content_id=content.id,
            order_index=0,
            text="What did you do last weekend?",
            translation="你上週末做了什麼？",
        )
    )
    db.commit()
    token = create_access_token(
        data={"sub": str(teacher.id), "type": "teacher", "email": teacher.email}
    )
    return {"content": content, "headers": {"Authorization": f"Bearer {token}"}}


def _create(client: TestClient, world, mode: str):
    return client.post(
        CREATE_URL,
        json={"content_id": world["content"].id, "practice_mode": mode},
        headers=world["headers"],
    )


class TestCreate:
    def test_scenario_content_can_start_scenario_practice(
        self, test_client: TestClient, db_session: Session
    ):
        world = _make_world(db_session)
        resp = _create(test_client, world, "scenario_dialogue")
        assert resp.status_code == 200, resp.text
        assignment = db_session.get(Assignment, resp.json()["assignment_id"])
        assert assignment.practice_mode == "scenario_dialogue"
        assert assignment.is_instant_practice is True

    @pytest.mark.parametrize("mode", ["reading", "word_selection", "tug_of_war"])
    def test_scenario_content_cannot_use_other_modes(
        self, test_client: TestClient, db_session: Session, mode
    ):
        world = _make_world(db_session)
        resp = _create(test_client, world, mode)
        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"]["code"] == "PRACTICE_MODE_NOT_SUPPORTED"

    def test_scenario_mode_on_sentence_content_is_refused(
        self, test_client: TestClient, db_session: Session
    ):
        world = _make_world(db_session, "EXAMPLE_SENTENCES")
        assert _create(test_client, world, "scenario_dialogue").status_code == 422
        assert _create(test_client, world, "reading").status_code == 200

    def test_unknown_mode_is_refused(
        self, test_client: TestClient, db_session: Session
    ):
        world = _make_world(db_session)
        assert _create(test_client, world, "dance").status_code == 422


class TestReconfigure:
    def _reconfigure(self, client: TestClient, world, assignment_id: int, mode):
        return client.patch(
            f"/api/teachers/instant-practice/{assignment_id}/reconfigure",
            json={"practice_mode": mode},
            headers=world["headers"],
        )

    def test_scenario_practice_cannot_switch_to_reading(
        self, test_client: TestClient, db_session: Session
    ):
        world = _make_world(db_session)
        assignment_id = _create(test_client, world, "scenario_dialogue").json()[
            "assignment_id"
        ]
        resp = self._reconfigure(test_client, world, assignment_id, "reading")
        assert resp.status_code == 422, resp.text
        assert resp.json()["detail"]["code"] == "PRACTICE_MODE_NOT_SUPPORTED"
        db_session.expire_all()
        assert (
            db_session.get(Assignment, assignment_id).practice_mode
            == "scenario_dialogue"
        )

    def test_scenario_practice_can_reapply_its_own_mode(
        self, test_client: TestClient, db_session: Session
    ):
        world = _make_world(db_session)
        assignment_id = _create(test_client, world, "scenario_dialogue").json()[
            "assignment_id"
        ]
        resp = self._reconfigure(test_client, world, assignment_id, "scenario_dialogue")
        assert resp.status_code == 200, resp.text

    def test_sentence_practice_cannot_switch_to_scenario(
        self, test_client: TestClient, db_session: Session
    ):
        world = _make_world(db_session, "EXAMPLE_SENTENCES")
        assignment_id = _create(test_client, world, "reading").json()["assignment_id"]
        assert (
            self._reconfigure(
                test_client, world, assignment_id, "rearrangement"
            ).status_code
            == 200
        )
        assert (
            self._reconfigure(
                test_client, world, assignment_id, "scenario_dialogue"
            ).status_code
            == 422
        )

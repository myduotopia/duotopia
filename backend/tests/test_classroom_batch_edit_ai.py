"""
班級批次編輯 AI 助手測試（#1139 第二階段）。AI 全程 mock（monkeypatch service 的 generate）。

- parse_suggestion：id 不在清單、名稱超長／全空白、年級 13／0／bool 被剔除；同一 id 取最後一筆；
  結果依輸入順序；非 JSON 物件 → OutputError
- max_tokens 依班數放大；prompt 帶班級資料、對話紀錄與指示
- 端點：未登入 401；非管理員 403；管理員 200（過濾後）；離題只回覆、changes 空；
  AI 例外（逾時／非 JSON）→ 502；instruction 空白、班級重複、超過 10 輪對話 → 422
"""

import json

import pytest

from auth import create_access_token, get_password_hash
from models import Teacher
from services import classroom_batch_edit_ai as cbai

URL = "/api/classrooms/batch-edit/ai-suggest"


# ---------------------------------------------------------------- fixtures


def _make_teacher(session, email, is_admin=False):
    t = Teacher(
        email=email,
        password_hash=get_password_hash("test123"),
        name="batch-edit-ai",
        is_active=True,
        is_demo=False,
        email_verified=True,
        is_admin=is_admin,
    )
    session.add(t)
    session.commit()
    session.refresh(t)
    return t


def _headers(teacher):
    token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(shared_test_session):
    return _make_teacher(shared_test_session, "cbai_admin@duotopia.com", True)


@pytest.fixture
def teacher(shared_test_session):
    return _make_teacher(shared_test_session, "cbai_teacher@duotopia.com", False)


def _fake_generate(payload, calls=None):
    async def gen(self, prompt, max_tokens):
        if calls is not None:
            calls.append({"prompt": prompt, "max_tokens": max_tokens})
        return payload

    return gen


CLASSROOMS = [
    {"id": 11, "name": "八年12班", "grade": None},
    {"id": 12, "name": "七年3班", "grade": 7},
    {"id": 13, "name": "忠班", "grade": 5},
]


def _body(**overrides):
    body = {
        "classrooms": CLASSROOMS,
        "history": [],
        "instruction": "把名稱裡的年級拿掉",
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------- parse_suggestion


def test_parse_filters_unknown_ids_and_invalid_fields():
    raw = {
        "reply": "  已處理  ",
        "changes": [
            {"id": 99, "name": "不在清單"},
            {"id": 13, "name": "x" * 101, "grade": 13},  # 兩欄都不合格 → 丟掉
            {"id": 12, "name": "   ", "grade": 7},  # 名稱全空白 → 只留年級
            {"id": 11, "name": " 12 ", "grade": 8},
            {"id": "abc", "name": "壞 id"},
            "not a dict",
        ],
    }
    result = cbai.parse_suggestion(raw, [11, 12, 13])
    assert result.reply == "已處理"
    assert [c.as_dict() for c in result.changes] == [
        {"id": 11, "name": "12", "grade": 8},
        {"id": 12, "grade": 7},
    ]


def test_parse_rejects_out_of_range_and_bool_grades():
    raw = {
        "reply": "",
        "changes": [
            {"id": 11, "grade": 0},
            {"id": 12, "grade": True},
            {"id": 13, "grade": None, "name": "忠"},
        ],
    }
    result = cbai.parse_suggestion(raw, [11, 12, 13])
    assert [c.as_dict() for c in result.changes] == [{"id": 13, "name": "忠"}]


def test_parse_duplicate_id_last_wins_and_keeps_input_order():
    raw = {
        "reply": "ok",
        "changes": [
            {"id": 13, "name": "先"},
            {"id": 11, "name": "A"},
            {"id": 13, "name": "後"},
        ],
    }
    result = cbai.parse_suggestion(raw, [11, 12, 13])
    assert [c.as_dict() for c in result.changes] == [
        {"id": 11, "name": "A"},
        {"id": 13, "name": "後"},
    ]


def test_parse_duplicate_id_invalid_last_drops_change():
    raw = {"changes": [{"id": 11, "name": "A"}, {"id": 11, "grade": 20}]}
    result = cbai.parse_suggestion(raw, [11])
    assert result.changes == []


def test_parse_name_at_limit_is_kept():
    raw = {"changes": [{"id": 11, "name": "x" * 100}]}
    result = cbai.parse_suggestion(raw, [11])
    assert result.changes[0].name == "x" * 100


@pytest.mark.parametrize("raw", [[], "text", None, {"changes": "nope"}])
def test_parse_bad_shape_raises(raw):
    with pytest.raises(cbai.ClassroomBatchEditAIOutputError):
        cbai.parse_suggestion(raw, [11])


def test_max_tokens_scales_with_count():
    assert cbai.max_tokens_for(1) == 540
    assert cbai.max_tokens_for(200) == 500 + 40 * 200


def test_build_prompt_includes_data_history_and_instruction():
    prompt = cbai.build_prompt(
        [cbai.ClassroomInput(id=11, name="八年12班", grade=None)],
        [
            cbai.HistoryTurn(role="user", content="先改第一班"),
            cbai.HistoryTurn(role="assistant", content="好的"),
        ],
        "把名稱裡的年級拿掉",
    )
    assert json.dumps(
        [{"id": 11, "name": "八年12班", "grade": None}], ensure_ascii=False
    ) in (prompt)
    assert "先改第一班" in prompt and "好的" in prompt
    assert prompt.rstrip().endswith("把名稱裡的年級拿掉")


# ---------------------------------------------------------------- endpoint


def test_requires_auth(test_client):
    assert test_client.post(URL, json=_body()).status_code == 401


def test_non_admin_forbidden(test_client, teacher, monkeypatch):
    calls = []
    monkeypatch.setattr(
        cbai.ClassroomBatchEditAIService,
        "generate",
        _fake_generate({"reply": "", "changes": []}, calls),
    )
    resp = test_client.post(URL, json=_body(), headers=_headers(teacher))
    assert resp.status_code == 403
    assert calls == []  # 沒打 AI


def test_admin_gets_filtered_changes(test_client, admin, monkeypatch):
    calls = []
    monkeypatch.setattr(
        cbai.ClassroomBatchEditAIService,
        "generate",
        _fake_generate(
            {
                "reply": "已把 2 班名稱裡的年級拿掉",
                "changes": [
                    {"id": 11, "name": "12", "grade": 8},
                    {"id": 12, "name": "3"},
                    {"id": 999, "name": "不在清單"},
                    {"id": 13, "grade": 13},
                ],
            },
            calls,
        ),
    )
    resp = test_client.post(URL, json=_body(), headers=_headers(admin))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "reply": "已把 2 班名稱裡的年級拿掉",
        "changes": [
            {"id": 11, "name": "12", "grade": 8},
            {"id": 12, "name": "3"},
        ],
    }
    assert calls[0]["max_tokens"] == 500 + 40 * 3
    assert "把名稱裡的年級拿掉" in calls[0]["prompt"]


def test_off_topic_reply_without_changes(test_client, admin, monkeypatch):
    monkeypatch.setattr(
        cbai.ClassroomBatchEditAIService,
        "generate",
        _fake_generate({"reply": cbai.OFF_TOPIC_REPLY, "changes": []}),
    )
    resp = test_client.post(
        URL, json=_body(instruction="幫我寫一首詩"), headers=_headers(admin)
    )
    assert resp.status_code == 200
    assert resp.json() == {"reply": cbai.OFF_TOPIC_REPLY, "changes": []}


def test_provider_timeout_is_502(test_client, admin, monkeypatch):
    async def boom(self, prompt, max_tokens):
        raise TimeoutError("slow")

    monkeypatch.setattr(cbai.ClassroomBatchEditAIService, "generate", boom)
    resp = test_client.post(URL, json=_body(), headers=_headers(admin))
    assert resp.status_code == 502


def test_non_json_output_is_502(test_client, admin, monkeypatch):
    async def bad_json(self, prompt, max_tokens):
        raise json.JSONDecodeError("Expecting value", "not json", 0)

    monkeypatch.setattr(cbai.ClassroomBatchEditAIService, "generate", bad_json)
    resp = test_client.post(URL, json=_body(), headers=_headers(admin))
    assert resp.status_code == 502


def test_wrong_shape_output_is_502(test_client, admin, monkeypatch):
    monkeypatch.setattr(
        cbai.ClassroomBatchEditAIService, "generate", _fake_generate(["not", "dict"])
    )
    resp = test_client.post(URL, json=_body(), headers=_headers(admin))
    assert resp.status_code == 502


@pytest.mark.parametrize(
    "overrides",
    [
        {"instruction": "   "},
        {"instruction": "x" * 1001},
        {"classrooms": []},
        {"classrooms": [CLASSROOMS[0], CLASSROOMS[0]]},
        {"classrooms": [{"id": 1, "name": "a", "grade": 13}]},
        {"history": [{"role": "user", "content": "hi"}] * 21},
        {"history": [{"role": "system", "content": "hi"}]},
    ],
)
def test_invalid_request_is_422(test_client, admin, overrides):
    resp = test_client.post(URL, json=_body(**overrides), headers=_headers(admin))
    assert resp.status_code == 422

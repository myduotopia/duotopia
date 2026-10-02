"""
克漏字題組 API 測試（Issue #1085）。

驗證：
- cloze 題組可建立，且 ``blank_index`` 端到端寫入／回傳
- layout 的 ``{{n}}`` 與小題 ``blank_index`` 不一致 → 422（缺、多、重複、沒填）
- reading 題組的文章含 ``{{n}}`` → 422（請改用克漏字題組）
- PATCH 同步更新空格與小題；只改 layout 刪掉空格也會被擋
"""

import pytest

from auth import create_access_token, get_password_hash
from models import Teacher


@pytest.fixture
def teacher_c(shared_test_session):
    t = Teacher(
        email="qb_cloze@duotopia.com",
        password_hash=get_password_hash("test123"),
        name="cloze",
        is_active=True,
        is_demo=False,
        email_verified=True,
    )
    shared_test_session.add(t)
    shared_test_session.commit()
    shared_test_session.refresh(t)
    return t


def _headers(teacher: Teacher) -> dict:
    token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


def _layout(text: str) -> dict:
    return {
        "version": 1,
        "rows": [
            {"columns": [{"span": 1, "blocks": [{"type": "paragraph", "text": text}]}]}
        ],
    }


PASSAGE = "Lapland is snowy, but this year is {{1}}. Santa {{2}} the reindeer."


def _question(blank_index, **overrides):
    q = {
        "stem": "",
        "image_url": "https://example.com/blank.png",
        "blank_index": blank_index,
        "options": [
            {"text": "different", "is_correct": True},
            {"text": "the same"},
        ],
    }
    q.update(overrides)
    return q


def _payload(**overrides):
    payload = {
        "question_type": "cloze",
        "stimulus_type": "passage",
        "title": "Lapland",
        "layout": _layout(PASSAGE),
        "questions": [_question(1), _question(2)],
    }
    payload.update(overrides)
    return payload


def _post(test_client, teacher, **overrides):
    return test_client.post(
        "/api/question-bank/question-groups",
        json=_payload(**overrides),
        headers=_headers(teacher),
    )


def test_create_cloze_group_round_trips_blank_index(test_client, teacher_c):
    resp = _post(test_client, teacher_c)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["question_type"] == "cloze"
    assert [q["blank_index"] for q in data["questions"]] == [1, 2]
    # 重新讀取也要一致（確認真的寫進 DB，不只是回填 payload）
    again = test_client.get(
        f"/api/question-bank/question-groups/{data['id']}",
        headers=_headers(teacher_c),
    )
    assert again.status_code == 200
    assert [q["blank_index"] for q in again.json()["questions"]] == [1, 2]
    # passage_text 仍是去編號的純文字副本（搜尋用）
    assert "____" in again.json()["passage_text"]


def test_create_cloze_rejects_blank_without_question(test_client, teacher_c):
    """文章有 {{1}} {{2}}，但只給一個小題。"""
    resp = _post(test_client, teacher_c, questions=[_question(1)])
    assert resp.status_code == 422
    assert "2" in resp.text


def test_create_cloze_rejects_question_without_blank(test_client, teacher_c):
    """小題指向文章裡不存在的空格 9。"""
    resp = _post(
        test_client, teacher_c, questions=[_question(1), _question(2), _question(9)]
    )
    assert resp.status_code == 422
    assert "9" in resp.text


def test_create_cloze_rejects_duplicate_blank_index(test_client, teacher_c):
    resp = _post(test_client, teacher_c, questions=[_question(1), _question(1)])
    assert resp.status_code == 422


def test_create_cloze_rejects_missing_blank_index(test_client, teacher_c):
    resp = _post(test_client, teacher_c, questions=[_question(1), _question(None)])
    assert resp.status_code == 422


def test_create_cloze_requires_a_blank_in_layout(test_client, teacher_c):
    resp = _post(
        test_client,
        teacher_c,
        layout=_layout("No blanks here."),
        questions=[_question(None)],
    )
    assert resp.status_code == 422


def test_create_reading_rejects_blank_tokens(test_client, teacher_c):
    """reading 題組的文章不准有 {{n}} —— 要改用克漏字題組。"""
    resp = _post(
        test_client,
        teacher_c,
        question_type="reading",
        questions=[_question(None)],
    )
    assert resp.status_code == 422
    assert "克漏字" in resp.text


def test_patch_cloze_adds_blank_and_question(test_client, teacher_c):
    created = _post(test_client, teacher_c).json()
    qs = created["questions"]
    url = f"/api/question-bank/question-groups/{created['id']}"

    # 新增第三個空格 + 第三張小題
    resp = test_client.patch(
        url,
        json={
            "layout": _layout(PASSAGE + " It is {{3}} now."),
            "questions": [
                {**_question(1), "id": qs[0]["id"]},
                {**_question(2), "id": qs[1]["id"]},
                _question(3),
            ],
        },
        headers=_headers(teacher_c),
    )
    assert resp.status_code == 200, resp.text
    assert sorted(q["blank_index"] for q in resp.json()["questions"]) == [1, 2, 3]


def test_patch_cloze_renumbers_blanks(test_client, teacher_c):
    """「依閱讀順序重新編號」：layout 與小題 blank_index 一起換。"""
    created = _post(test_client, teacher_c).json()
    qs = created["questions"]
    resp = test_client.patch(
        f"/api/question-bank/question-groups/{created['id']}",
        json={
            "layout": _layout(
                "Lapland is snowy, but this year is {{5}}. Santa {{6}} the reindeer."
            ),
            "questions": [
                {**_question(5), "id": qs[0]["id"]},
                {**_question(6), "id": qs[1]["id"]},
            ],
        },
        headers=_headers(teacher_c),
    )
    assert resp.status_code == 200, resp.text
    assert sorted(q["blank_index"] for q in resp.json()["questions"]) == [5, 6]


def test_patch_layout_only_cannot_orphan_a_question(test_client, teacher_c):
    """只改 layout 把 {{2}} 刪掉 → 小題 2 變孤兒，必須被擋下。"""
    created = _post(test_client, teacher_c).json()
    resp = test_client.patch(
        f"/api/question-bank/question-groups/{created['id']}",
        json={"layout": _layout("Lapland is snowy, but this year is {{1}}.")},
        headers=_headers(teacher_c),
    )
    assert resp.status_code == 422
    assert "2" in resp.text

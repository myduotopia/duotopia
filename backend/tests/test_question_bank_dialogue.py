"""
圖片題組的對話文稿（Issue #1083，2026-10-06）。

決策：以圖為準的題組（漫畫、對話圖）由 AI 擷取為逐句「說話者: 台詞」，存
``question_group_segments``；之後題組對話音檔由它產生，所以老師不可修改，
``passage_text`` 一律由 segments 推導（開頭可保留非對話文字：標題、旁白）。

驗證：
- 擷取整理 ``_normalize_dialogue``：欄位去空白、空值丟棄、the 去掉、長度／句數上限、
  kind=text 清空、prompt 有命名規則
- 建立題組寫入 segments（順序）、passage_text 由 segments 推導（前端送的對話文字不採用）
- PATCH：帶 segments 整組替換、[] 清掉；只改排版不會洗掉對話文字版
- 沒有 segments 的題組行為不變（文字版照老師給的）
"""

import pytest

from auth import create_access_token, get_password_hash
from models import Teacher
from services.magic_paste_service import (
    DIALOGUE_MAX_LINES,
    DIALOGUE_SPEAKER_MAX_CHARS,
    DIALOGUE_TEXT_MAX_CHARS,
    EXTRACT_MODE_READING_GROUP,
    MagicPasteService,
)

# ============ 擷取整理（不呼叫 AI） ============


def test_reading_group_prompt_has_dialogue_naming_rules():
    prompt = MagicPasteService._build_prompt("A1", EXTRACT_MODE_READING_GROUP)
    assert '"dialogue": [{"speaker": "...", "text": "..."}]' in prompt
    assert "`stimulus.dialogue`" in prompt
    # 一律不加 the、同性別加代號、職稱、人名
    assert 'WITHOUT "the"' in prompt
    assert '"Girl A", "Girl B"' in prompt
    assert '"Boy and girl" / "Boys and girls"' in prompt
    assert '"Teacher"' in prompt
    assert "Hank, David, Mary" in prompt
    # 有對話時 text 只放非對話文字
    assert "holds ONLY the words that are not" in prompt


def _image_stim(dialogue, **extra):
    stim = {"kind": "image", "text": "Hank's Day", "box_2d": [0, 0, 500, 1000]}
    stim["dialogue"] = dialogue
    stim.update(extra)
    return {"title": "Comic", "stimulus": stim, "questions": []}


def test_normalize_dialogue_keeps_named_lines_in_order():
    raw = _image_stim(
        [
            {"speaker": " Mary ", "text": "  Where are\n you going? "},
            {"speaker": "Boy A", "text": "To the park."},
            {"speaker": "Girl B", "text": "Me too!"},
        ]
    )
    g = MagicPasteService._normalize_reading_group(raw)[0]
    assert g["stimulus"]["dialogue"] == [
        {"speaker": "Mary", "text": "Where are you going?"},
        {"speaker": "Boy A", "text": "To the park."},
        {"speaker": "Girl B", "text": "Me too!"},
    ]
    # 非對話文字留在 text
    assert g["stimulus"]["text"] == "Hank's Day"


def test_normalize_dialogue_drops_empty_and_bad_entries():
    raw = _image_stim(
        [
            {"speaker": "", "text": "No speaker"},
            {"speaker": "Man", "text": "   "},
            "not a dict",
            None,
            {"speaker": "Woman", "text": "Hello."},
        ]
    )
    g = MagicPasteService._normalize_reading_group(raw)[0]
    assert g["stimulus"]["dialogue"] == [{"speaker": "Woman", "text": "Hello."}]


@pytest.mark.parametrize("value", [None, "Girl: hi", {"speaker": "Girl"}, 3])
def test_normalize_dialogue_non_list_is_empty(value):
    g = MagicPasteService._normalize_reading_group(_image_stim(value))[0]
    assert g["stimulus"]["dialogue"] == []


def test_normalize_dialogue_strips_leading_the():
    raw = _image_stim(
        [
            {"speaker": "the teacher", "text": "Sit down."},
            {"speaker": "The Girl", "text": "OK."},
            {"speaker": "Theo", "text": "Hi."},
        ]
    )
    speakers = [
        d["speaker"]
        for d in MagicPasteService._normalize_reading_group(raw)[0]["stimulus"][
            "dialogue"
        ]
    ]
    assert speakers == ["Teacher", "Girl", "Theo"]


def test_normalize_dialogue_limits():
    lines = [{"speaker": "S" * 80, "text": "x" * (DIALOGUE_TEXT_MAX_CHARS + 50)}] + [
        {"speaker": "Boy", "text": f"line {i}"} for i in range(DIALOGUE_MAX_LINES + 20)
    ]
    d = MagicPasteService._normalize_reading_group(_image_stim(lines))[0]["stimulus"][
        "dialogue"
    ]
    assert len(d) == DIALOGUE_MAX_LINES
    assert len(d[0]["speaker"]) == DIALOGUE_SPEAKER_MAX_CHARS
    assert len(d[0]["text"]) == DIALOGUE_TEXT_MAX_CHARS


def test_normalize_dialogue_cleared_for_text_kind():
    raw = {
        "stimulus": {
            "kind": "text",
            "paragraphs": ["Mary: Hi. Hank: Hello."],
            "dialogue": [{"speaker": "Mary", "text": "Hi."}],
        }
    }
    g = MagicPasteService._normalize_reading_group(raw)[0]
    assert g["stimulus"]["dialogue"] == []


# ============ API：建立／更新題組的 segments ============


@pytest.fixture
def teacher_d(shared_test_session):
    t = Teacher(
        email="qb_dialogue@duotopia.com",
        password_hash=get_password_hash("test123"),
        name="dialogue",
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


IMAGE_LAYOUT = {
    "version": 1,
    "rows": [
        {
            "columns": [
                {
                    "span": 1,
                    "blocks": [
                        {"type": "image", "url": "https://x/comic.png", "alt": "c"}
                    ],
                }
            ]
        }
    ],
}

SEGMENTS = [
    {"speaker_label": "Mary", "transcript": "Where are you going?"},
    {"speaker_label": "Hank", "transcript": "To the park."},
]
LINES = "Mary: Where are you going?\nHank: To the park."


def _payload(**overrides):
    payload = {
        "question_type": "reading",
        "stimulus_type": "image",
        "title": "Hank's Day",
        "layout": IMAGE_LAYOUT,
        "questions": [
            {
                "stem": "Where is Hank going?",
                "options": [
                    {"text": "The park", "is_correct": True},
                    {"text": "School"},
                ],
            }
        ],
    }
    payload.update(overrides)
    return payload


def _create(client, teacher, **overrides):
    resp = client.post(
        "/api/question-bank/question-groups",
        json=_payload(**overrides),
        headers=_headers(teacher),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _patch(client, teacher, gid, body):
    return client.patch(
        f"/api/question-bank/question-groups/{gid}",
        json=body,
        headers=_headers(teacher),
    )


def test_create_group_with_segments_derives_passage_text(test_client, teacher_d):
    g = _create(
        test_client,
        teacher_d,
        segments=SEGMENTS,
        # 前端送的文字版：開頭的旁白保留，對話部分一律由 segments 重組
        passage_text="A comic about Hank\n\n" + LINES,
    )
    assert [
        (s["order_index"], s["speaker_label"], s["transcript"]) for s in g["segments"]
    ] == [
        (0, "Mary", "Where are you going?"),
        (1, "Hank", "To the park."),
    ]
    assert g["passage_text"] == "A comic about Hank\n\n" + LINES

    # GET 也帶 segments
    resp = test_client.get(
        f"/api/question-bank/question-groups/{g['id']}", headers=_headers(teacher_d)
    )
    assert resp.status_code == 200
    assert [s["speaker_label"] for s in resp.json()["segments"]] == ["Mary", "Hank"]


def test_create_group_ignores_mismatched_passage_text(test_client, teacher_d):
    # 前端送的文字跟 segments 對不上（例如被改過）→ 不採用，只留 segments 組成的對話
    g = _create(
        test_client,
        teacher_d,
        segments=SEGMENTS,
        passage_text="Mary: Something else entirely.",
    )
    assert g["passage_text"] == LINES


def test_create_group_segments_count_as_content(test_client, teacher_d):
    g = _create(test_client, teacher_d, layout=None, segments=SEGMENTS)
    assert g["passage_text"] == LINES


@pytest.mark.parametrize(
    "bad",
    [
        [{"speaker_label": "", "transcript": "Hi."}],
        [{"speaker_label": "Girl", "transcript": "   "}],
        [{"speaker_label": "G" * 51, "transcript": "Hi."}],
        [{"speaker_label": "Girl", "transcript": "x" * 2001}],
        [{"speaker_label": "Girl", "transcript": "Hi."}] * 101,
    ],
)
def test_create_group_rejects_bad_segments(test_client, teacher_d, bad):
    resp = test_client.post(
        "/api/question-bank/question-groups",
        json=_payload(segments=bad),
        headers=_headers(teacher_d),
    )
    assert resp.status_code == 422, resp.text


def test_group_without_segments_unchanged(test_client, teacher_d):
    g = _create(test_client, teacher_d, passage_text="SALE 50% OFF")
    assert g["segments"] == []
    assert g["passage_text"] == "SALE 50% OFF"
    resp = _patch(test_client, teacher_d, g["id"], {"passage_text": "Teacher edit"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["passage_text"] == "Teacher edit"
    assert resp.json()["segments"] == []


def test_patch_replaces_segments(test_client, teacher_d):
    g = _create(test_client, teacher_d, segments=SEGMENTS)
    new = [
        {"speaker_label": "Girl A", "transcript": "Look!"},
        {"speaker_label": "Girl B", "transcript": "Wow."},
        {"speaker_label": "Teacher", "transcript": "Quiet, please."},
    ]
    new_lines = "Girl A: Look!\nGirl B: Wow.\nTeacher: Quiet, please."
    resp = _patch(
        test_client,
        teacher_d,
        g["id"],
        {"segments": new, "passage_text": "Title\n\n" + new_lines},
    )
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert [(s["order_index"], s["speaker_label"]) for s in out["segments"]] == [
        (0, "Girl A"),
        (1, "Girl B"),
        (2, "Teacher"),
    ]
    assert out["passage_text"] == "Title\n\n" + new_lines


def test_patch_text_cannot_override_dialogue(test_client, teacher_d):
    g = _create(test_client, teacher_d, segments=SEGMENTS)
    resp = _patch(test_client, teacher_d, g["id"], {"passage_text": "hacked"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["passage_text"] == LINES


def test_patch_layout_only_keeps_dialogue_text(test_client, teacher_d):
    g = _create(
        test_client,
        teacher_d,
        segments=SEGMENTS,
        passage_text="Narration\n\n" + LINES,
    )
    resp = _patch(test_client, teacher_d, g["id"], {"layout": IMAGE_LAYOUT})
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["passage_text"] == "Narration\n\n" + LINES
    assert len(out["segments"]) == 2


def test_patch_empty_segments_clears_dialogue(test_client, teacher_d):
    g = _create(test_client, teacher_d, segments=SEGMENTS)
    resp = _patch(
        test_client,
        teacher_d,
        g["id"],
        {"segments": [], "passage_text": "Plain poster text"},
    )
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["segments"] == []
    assert out["passage_text"] == "Plain poster text"

"""
上傳題本存入題庫（Issue #1112 C4a）。AI 呼叫與 GCS 一律 mock。

涵蓋：
- 全部儲存：整份設定（年段、公開、教材、來源）逐題寫入、原卷題號寫進來源關聯、考點來源 ai、
  題組（段落 → 排版）、卡片記下題庫 id、全部存完 → saved
- 不存的原因：處理失敗、缺答案、與題庫重複、題目文字相同（A4）、同一份題本重複、克漏字對不上
- 同一批前面剛存的也納入比對（B10）；只剩題庫已有 → 完成並回略過數（A2）；缺答案留著 → ready
- 設定不完整、教材不屬於這個題庫 → 422 不存任何卡
- 略過核對：已處理好的頁立即存、之後每頁做完自動存；可能還有下一頁內容的題組先不存
- 答案頁晚到：更新已存入、答案未被老師改過的題（B3）
- 放棄部分已存入的匯入：已存的題目保留（B7）
- 機構題庫：題目帶 organization_id；不是成員 403
- 已存的卡不能改、刪、重試
- 裁圖：寫入頁結果時從頁圖裁題幹圖（B1）；存入時補裁舊草稿
"""

from __future__ import annotations

import io
import uuid

import pytest

from models import (
    ExamImport,
    ExamPoint,
    Organization,
    Program,
    Question,
    QuestionExamPoint,
    QuestionGroup,
    QuestionSource,
    QuestionSourceLink,
    TeacherOrganization,
)
from services import exam_import_storage
from tests.test_exam_import_api import (  # noqa: F401  (fixtures)
    BASE,
    _bank_single,
    _group_unit,
    _hash,
    _headers,
    _make_teacher,
    _page,
    _png,
    _q,
    _send,
    _single,
    fake_ai,
    fake_storage,
    other_teacher,
    teacher,
)


# ---------------------------------------------------------------- helpers


@pytest.fixture
def source(shared_test_session, teacher):
    s = QuestionSource(source_type="exam", name="113 段考", teacher_id=teacher.id)
    shared_test_session.add(s)
    shared_test_session.commit()
    return s


@pytest.fixture
def program(shared_test_session, teacher):
    p = Program(name="My Program", teacher_id=teacher.id, is_template=True)
    shared_test_session.add(p)
    shared_test_session.commit()
    return p


@pytest.fixture
def points(shared_test_session):
    s = shared_test_session
    s.add(ExamPoint(code="grammar", names={"zh-TW": "文法"}))
    s.commit()
    return {ep.code: ep.id for ep in s.query(ExamPoint).all()}


def create_import(client, teacher, source_id, pages=1, tag="paper", **settings):
    body = {
        "file_name": f"{tag}.pdf",
        "file_hash": _hash(tag),
        "page_count": pages,
        "tts_accents": ["American English"],
        "settings": {
            "grade_min": 7,
            "grade_max": 9,
            "visibility": "private",
            "source_id": source_id,
            **settings,
        },
    }
    resp = client.post(BASE, json=body, headers=_headers(teacher))
    assert resp.status_code == 201, resp.text
    return resp.json()


def save(client, teacher, import_id, card_ids=None):
    return client.post(
        f"{BASE}/{import_id}/save",
        json={"card_ids": card_ids} if card_ids is not None else {},
        headers=_headers(teacher),
    )


def get(client, teacher, import_id):
    return client.get(f"{BASE}/{import_id}", headers=_headers(teacher)).json()


def cards_of(data):
    return [c for p in data["pages"] for c in p["cards"]]


def patch_card(client, teacher, import_id, card_id, body):
    return client.patch(
        f"{BASE}/{import_id}/cards/{card_id}", json=body, headers=_headers(teacher)
    )


# ---------------------------------------------------------------- 全部儲存


def test_save_all_writes_bank_rows(
    test_client,
    shared_test_session,
    teacher,
    source,
    program,
    points,
    fake_ai,
    fake_storage,
):
    imp = create_import(
        test_client,
        teacher,
        source.id,
        program_links=[{"program_id": program.id}],
    )
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "Pick one.", ["x", "y"], ai=[1], codes=["grammar"]),
            _group_unit(
                ["Tom likes apples.", "He eats one a day."],
                [
                    _q("2", "Who is Tom?", ["a boy", "a dog"], printed=[0]),
                    _q("3", "What does he eat?", ["apples", "pears"], printed=[0]),
                ],
            ),
        ),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))

    resp = save(test_client, teacher, imp["id"])
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["failed"] == []
    assert len(body["saved"]) == 2
    assert body["completed"] is True and body["status"] == "saved"
    assert body["import"]["saved_question_count"] == 3

    s = shared_test_session
    s.expire_all()
    single = s.query(Question).filter_by(group_id=None).one()
    assert single.stem == "Pick one."
    assert (single.grade_min, single.grade_max, single.visibility) == (7, 9, "private")
    assert [o.is_correct for o in single.options] == [False, True]
    link = s.query(QuestionSourceLink).filter_by(question_id=single.id).one()
    assert link.source_id == source.id and link.source_question_no == "1"
    ep = s.query(QuestionExamPoint).filter_by(question_id=single.id).one()
    assert ep.exam_point_id == points["grammar"] and ep.source == "ai"
    assert [pl.program_id for pl in single.program_links] == [program.id]

    group = s.query(QuestionGroup).one()
    assert group.title == "A Story"
    texts = [r["columns"][0]["blocks"][0]["text"] for r in group.layout["rows"]]
    assert texts == ["Tom likes apples.", "He eats one a day."]
    subs = sorted(group.questions, key=lambda q: q.group_order)
    assert [q.stem for q in subs] == ["Who is Tom?", "What does he eat?"]
    nos = [
        s.query(QuestionSourceLink).filter_by(question_id=q.id).one().source_question_no
        for q in subs
    ]
    assert nos == ["2", "3"]

    data = get(test_client, teacher, imp["id"])
    single_card, group_card = cards_of(data)
    assert single_card["question"]["saved_question_id"] == single.id
    assert group_card["saved_group_id"] == group.id
    assert [q["saved_question_id"] for q in group_card["group"]["questions"]] == [
        q.id for q in subs
    ]
    # 存完就不在未完成列表
    assert test_client.get(BASE, headers=_headers(teacher)).json()["items"] == []


def test_save_reports_readable_reasons(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    s = shared_test_session
    _bank_single(s, teacher, "Already here?", ["a", "b"])
    _bank_single(s, teacher, "Same words?", ["old 1", "old 2"])
    cloze = {
        "kind": "group",
        "group_type": "cloze",
        "box_2d": [500, 50, 990, 950],
        "title": "Cloze",
        "stimulus": {"kind": "text", "paragraphs": ["I {{1}} a cat."]},
        "questions": [
            _q("8", "", ["have", "has"], ai=[0], blank=1),
            _q("9", "", ["walk", "walks"], ai=[0], blank=2),
        ],
    }
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "Good one?", ["a", "b"], ai=[0]),
            _single("2", "No answer?", ["a", "b"]),
            {"kind": "single", "question": {"no": "3", "box_2d": [1, 1, 50, 50]}},
            _single("4", "Already here?", ["a", "b"], ai=[0]),
            _single("5", "Same words?", ["new 1", "new 2"], ai=[0]),
            _single("6", "Twice?", ["a", "b"], ai=[0]),
            _single("7", "twice", ["A", "B"], ai=[1]),
            cloze,
        ),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    cards = cards_of(get(test_client, teacher, imp["id"]))
    # 卡片上的重複標記：題目文字相同另帶 reason
    assert cards[4]["duplicate_of"]["reason"] == "same_stem"

    body = save(test_client, teacher, imp["id"]).json()
    reasons = {f["card_id"]: f["reason"] for f in body["failed"]}
    ids = [c["card_id"] for c in cards]
    assert [s["card_id"] for s in body["saved"]] == [ids[0], ids[5]]
    assert reasons == {
        ids[1]: "missing_answer",
        ids[2]: "failed",
        ids[3]: "duplicate",
        ids[4]: "same_stem",
        # 第 6 題剛存進題庫 → 第 7 題即時比對成題庫重複（B10）
        ids[6]: "duplicate",
        ids[7]: "cloze_blanks",
    }
    msg = {f["card_id"]: f["message"] for f in body["failed"]}
    assert msg[ids[4]] == "題目文字與我的題庫某題相同，請修改題目文字"
    assert msg[ids[3]] == "你的題庫（個人或機構）已有這題"
    assert body["completed"] is False and body["status"] == "ready"


def test_same_stem_within_one_batch_is_not_an_integrity_error(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "Same stem?", ["a", "b"], ai=[0]),
            _single("2", "Same stem?", ["c", "d"], ai=[0]),
        ),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    body = save(test_client, teacher, imp["id"]).json()
    assert len(body["saved"]) == 1
    assert [f["reason"] for f in body["failed"]] == ["same_stem"]
    # 只剩題庫已有（題目文字相同也算）→ 完成（A2）
    assert body["completed"] is True
    assert body["skipped_duplicate_cards"] == 1
    assert body["skipped_duplicate_questions"] == 1


def test_only_duplicates_left_completes_but_missing_answer_keeps_ready(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    _bank_single(shared_test_session, teacher, "Old one?", ["a", "b"])
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "Old one?", ["a", "b"], ai=[0]),
            _single("2", "Needs answer?", ["a", "b"]),
        ),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    body = save(test_client, teacher, imp["id"]).json()
    assert body["saved"] == [] and body["status"] == "ready"
    assert body["skipped_duplicate_cards"] == 1

    card_id = cards_of(get(test_client, teacher, imp["id"]))[1]["card_id"]
    resp = patch_card(
        test_client, teacher, imp["id"], card_id, {"question": {"correct_indexes": [1]}}
    )
    assert resp.status_code == 200, resp.text
    body = save(test_client, teacher, imp["id"]).json()
    assert len(body["saved"]) == 1
    assert body["completed"] is True and body["status"] == "saved"
    q = shared_test_session.query(Question).filter_by(stem="Needs answer?").one()
    assert [o.is_correct for o in q.options] == [False, True]


def test_save_only_selected_cards(test_client, teacher, source, fake_ai, fake_storage):
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "One?", ["a", "b"], ai=[0]),
            _single("2", "Two?", ["a", "b"], ai=[0]),
        ),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    first = cards_of(get(test_client, teacher, imp["id"]))[0]["card_id"]
    body = save(test_client, teacher, imp["id"], [first]).json()
    assert [s["card_id"] for s in body["saved"]] == [first]
    assert body["status"] == "ready"
    # 再存一次全部：已存的略過，不重複寫入
    body = save(test_client, teacher, imp["id"]).json()
    assert len(body["saved"]) == 1 and body["status"] == "saved"


@pytest.mark.parametrize(
    "settings, code",
    [
        ({"grade_min": None}, "EXAM_IMPORT_SETTINGS_INCOMPLETE"),
        ({"visibility": None}, "EXAM_IMPORT_SETTINGS_INCOMPLETE"),
    ],
)
def test_incomplete_settings_block_save(
    test_client, teacher, source, fake_ai, fake_storage, settings, code
):
    imp = create_import(test_client, teacher, source.id, **settings)
    fake_ai.on(_png("p1"), _page(_single("1", "One?", ["a", "b"], ai=[0])))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    resp = save(test_client, teacher, imp["id"])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == code


def test_program_of_other_teacher_rejected(
    test_client, shared_test_session, teacher, other_teacher, source
):
    theirs = Program(name="Theirs", teacher_id=other_teacher.id, is_template=True)
    shared_test_session.add(theirs)
    shared_test_session.commit()
    resp = test_client.post(
        BASE,
        json={
            "file_name": "x.pdf",
            "file_hash": _hash("x"),
            "page_count": 1,
            "tts_accents": ["American English"],
            "settings": {"program_links": [{"program_id": theirs.id}]},
        },
        headers=_headers(teacher),
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_PROGRAM_LINK_INVALID"


# ---------------------------------------------------------------- 略過核對


def test_skip_review_saves_done_pages_then_each_new_page(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id, pages=2)
    fake_ai.on(_png("p1"), _page(_single("1", "First?", ["a", "b"], ai=[0])))
    fake_ai.on(
        _png("p2"),
        _page(
            _single("2", "Second?", ["a", "b"], ai=[0]),
            _single("3", "No answer?", ["a", "b"]),
        ),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    resp = test_client.post(
        f"{BASE}/{imp['id']}/skip-review", headers=_headers(teacher)
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()["saved"]) == 1
    assert resp.json()["import"]["auto_save"] is True

    # 下一頁做完自動存（缺答案的不存，匯入維持 ready）
    _send(test_client, teacher, imp["id"], 2, _png("p2"))
    shared_test_session.expire_all()
    stems = {q.stem for q in shared_test_session.query(Question).all()}
    assert stems == {"First?", "Second?"}
    data = get(test_client, teacher, imp["id"])
    assert data["status"] == "ready" and data["saved_question_count"] == 2


def test_skip_review_waits_for_group_continuation(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id, pages=2)
    first = _group_unit(["Part one."], [_q("1", "Q one?", ["a", "b"], ai=[0])])
    cont = {
        **_group_unit(["Part two."], [_q("2", "Q two?", ["a", "b"], ai=[0])]),
        "continues_previous": True,
    }
    fake_ai.on(_png("p1"), _page(first))
    fake_ai.on(_png("p2"), _page(cont))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    body = test_client.post(
        f"{BASE}/{imp['id']}/skip-review", headers=_headers(teacher)
    ).json()
    assert body["saved"] == []  # 題組可能還有下一頁內容

    _send(test_client, teacher, imp["id"], 2, _png("p2"))
    shared_test_session.expire_all()
    group = shared_test_session.query(QuestionGroup).one()
    assert sorted(q.stem for q in group.questions) == ["Q one?", "Q two?"]
    assert get(test_client, teacher, imp["id"])["status"] == "saved"


# ---------------------------------------------------------------- 答案頁晚到、放棄


def test_late_answer_page_updates_saved_ai_answers_only(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id, pages=2)
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "AI answered?", ["a", "b", "c"], ai=[0]),
            _single("2", "Teacher fixed?", ["a", "b", "c"], ai=[0]),
        ),
    )
    fake_ai.on(
        _png("key"),
        _page(
            answer_key=[{"no": "1", "answer": "C"}, {"no": "2", "answer": "C"}],
            is_answer_page=True,
        ),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    fixed = cards_of(get(test_client, teacher, imp["id"]))[1]["card_id"]
    patch_card(
        test_client, teacher, imp["id"], fixed, {"question": {"correct_indexes": [1]}}
    )
    assert len(save(test_client, teacher, imp["id"]).json()["saved"]) == 2

    _send(test_client, teacher, imp["id"], 2, _png("key"))
    s = shared_test_session
    s.expire_all()
    ai_q = s.query(Question).filter_by(stem="AI answered?").one()
    teacher_q = s.query(Question).filter_by(stem="Teacher fixed?").one()
    assert [o.is_correct for o in ai_q.options] == [False, False, True]
    assert [o.is_correct for o in teacher_q.options] == [False, True, False]


def test_abandon_partially_saved_keeps_saved_questions(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "Keep me?", ["a", "b"], ai=[0]),
            _single("2", "No answer?", ["a", "b"]),
        ),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    save(test_client, teacher, imp["id"])
    resp = test_client.delete(f"{BASE}/{imp['id']}", headers=_headers(teacher))
    assert resp.status_code == 200
    shared_test_session.expire_all()
    q = shared_test_session.query(Question).filter_by(stem="Keep me?").one()
    assert q.is_active is True and q.deleted_at is None


def test_saved_card_cannot_be_edited_deleted_or_retried(
    test_client, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "Saved?", ["a", "b"], ai=[0]),
            _single("2", "Not yet?", ["a", "b"]),
        ),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    card_id = cards_of(get(test_client, teacher, imp["id"]))[0]["card_id"]
    save(test_client, teacher, imp["id"])
    h = _headers(teacher)
    resp = patch_card(test_client, teacher, imp["id"], card_id, {"question": {}})
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_CARD_SAVED"
    resp = test_client.delete(f"{BASE}/{imp['id']}/cards/{card_id}", headers=h)
    assert resp.status_code == 409
    resp = test_client.post(
        f"{BASE}/{imp['id']}/pages/1/retry",
        files={"file": ("page.png", _png("p1"), "image/png")},
        data={"card_id": card_id},
        headers=h,
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_CARD_SAVED"


# ---------------------------------------------------------------- 機構題庫


def test_org_bank_save_and_membership(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    s = shared_test_session
    org = Organization(id=uuid.uuid4(), name="Exam Org")
    s.add(org)
    s.flush()
    membership = TeacherOrganization(
        teacher_id=teacher.id, organization_id=org.id, role="teacher"
    )
    s.add(membership)
    s.commit()
    imp = create_import(
        test_client,
        teacher,
        source.id,
        organization_id=str(org.id),
        visibility="organization_only",
    )
    fake_ai.on(_png("p1"), _page(_single("1", "Org question?", ["a", "b"], ai=[0])))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))

    # 列表依題庫範圍：我的題庫看不到、機構題庫看得到
    assert test_client.get(BASE, headers=_headers(teacher)).json()["items"] == []
    items = test_client.get(
        BASE, params={"organization_id": str(org.id)}, headers=_headers(teacher)
    ).json()["items"]
    assert [i["id"] for i in items] == [imp["id"]]

    membership.is_active = False
    s.commit()
    assert save(test_client, teacher, imp["id"]).status_code == 403

    membership.is_active = True
    s.commit()
    body = save(test_client, teacher, imp["id"]).json()
    assert len(body["saved"]) == 1
    s.expire_all()
    q = s.query(Question).filter_by(stem="Org question?").one()
    assert str(q.organization_id) == str(org.id)
    assert q.visibility == "organization_only"


def test_duplicate_file_reports_bank_of_existing_import(
    test_client, shared_test_session, source
):
    s = shared_test_session
    admin = _make_teacher(s, "ei_dup_admin@duotopia.com", is_admin=True)
    org = Organization(id=uuid.uuid4(), name="Dup Org")
    s.add(org)
    s.flush()
    s.add(
        TeacherOrganization(teacher_id=admin.id, organization_id=org.id, role="teacher")
    )
    s.commit()
    body = {
        "file_name": "same.pdf",
        "file_hash": _hash("same"),
        "page_count": 1,
        "tts_accents": ["American English"],
        "settings": {"organization_id": str(org.id)},
    }
    first = test_client.post(BASE, json=body, headers=_headers(admin)).json()
    # 換成我的題庫再上傳同一份：以老師計、不分題庫 → 擋下並告訴前端在哪個題庫
    body["settings"] = {}
    resp = test_client.post(BASE, json=body, headers=_headers(admin))
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["existing_import_id"] == first["id"]
    assert detail["existing_organization_id"] == str(org.id)
    assert detail["existing_school_id"] is None
    assert detail["existing_status"] == "processing"


# ---------------------------------------------------------------- 裁圖


def _real_png(width=200, height=100) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", (width, height), (255, 255, 255)).save(out, format="PNG")
    return out.getvalue()


def test_crops_stem_image_when_page_is_written_and_on_save(
    test_client,
    shared_test_session,
    teacher,
    source,
    fake_ai,
    fake_storage,
    monkeypatch,
):
    crops = []

    def store_crop(content, content_type):
        from PIL import Image

        crops.append(Image.open(io.BytesIO(content)).size)
        return f"https://storage.example/crop_{len(crops)}.png"

    monkeypatch.setattr(exam_import_storage, "store_crop_image", store_crop)
    page = _real_png()
    unit = _single("1", "Look at the picture.", ["a", "b"], ai=[0])
    unit["question"]["stem_box_2d"] = [0, 0, 500, 500]  # 左上 1/4
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(page, _page(unit))
    _send(test_client, teacher, imp["id"], 1, page)
    card = cards_of(get(test_client, teacher, imp["id"]))[0]
    assert card["question"]["image_url"] == "https://storage.example/crop_1.png"
    assert crops == [(100, 50)]

    save(test_client, teacher, imp["id"])
    shared_test_session.expire_all()
    q = shared_test_session.query(Question).one()
    assert q.image_url == "https://storage.example/crop_1.png"


def test_save_crops_legacy_cards_from_stored_page_image(
    test_client,
    shared_test_session,
    teacher,
    source,
    fake_ai,
    fake_storage,
    monkeypatch,
):
    """寫入時沒裁到（舊草稿／失敗）→ 存入時讀回頁圖補裁。"""
    page = _real_png()
    unit = _single("1", "Picture?", ["a", "b"], ai=[0])
    unit["question"]["stem_box_2d"] = [0, 0, 1000, 1000]
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(page, _page(unit))
    monkeypatch.setattr(
        exam_import_storage, "store_crop_image", lambda c, t: None
    )  # 寫入時上傳失敗
    _send(test_client, teacher, imp["id"], 1, page)
    assert (
        "image_url" not in cards_of(get(test_client, teacher, imp["id"]))[0]["question"]
    )

    monkeypatch.setattr(
        exam_import_storage, "store_crop_image", lambda c, t: "https://x/crop.png"
    )
    monkeypatch.setattr(
        exam_import_storage, "read_page_image", lambda iid, url: (page, "image/png")
    )
    save(test_client, teacher, imp["id"])
    shared_test_session.expire_all()
    assert shared_test_session.query(Question).one().image_url == "https://x/crop.png"
    row = shared_test_session.get(ExamImport, imp["id"])
    assert row.status == "saved"


def test_unique_index_collision_rolls_back_only_that_card(
    test_client,
    shared_test_session,
    teacher,
    source,
    fake_ai,
    fake_storage,
    monkeypatch,
):
    """事先比對漏掉（例如並發）而撞到唯一索引：只退回那一張（SAVEPOINT），其他照存。"""
    from sqlalchemy import text

    from services import exam_import_dedup

    monkeypatch.setattr(exam_import_dedup, "_same_stem_duplicates", lambda *a: {})
    s = shared_test_session
    s.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_test_teacher_stem ON questions "
            "(teacher_id, normalized_stem) WHERE is_active AND group_id IS NULL "
            "AND normalized_stem <> ''"
        )
    )
    s.commit()
    try:
        _bank_single(s, teacher, "Clash?", ["old", "older"])
        imp = create_import(test_client, teacher, source.id)
        fake_ai.on(
            _png("p1"),
            _page(
                _single("1", "Clash?", ["new", "newer"], ai=[0]),
                _single("2", "Fine?", ["a", "b"], ai=[0]),
            ),
        )
        _send(test_client, teacher, imp["id"], 1, _png("p1"))
        body = save(test_client, teacher, imp["id"]).json()
        assert [f["reason"] for f in body["failed"]] == ["same_stem"]
        assert len(body["saved"]) == 1
        s.expire_all()
        assert {q.stem for q in s.query(Question).all()} == {"Clash?", "Fine?"}
    finally:
        s.rollback()
        s.execute(text("DROP INDEX IF EXISTS uq_test_teacher_stem"))
        s.commit()

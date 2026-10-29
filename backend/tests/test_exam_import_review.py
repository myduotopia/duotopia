"""
上傳題本核對畫面：題目卡編輯、刪除、手動補題、整份設定（Issue #1112 C4a）。AI 與 GCS 一律 mock。

涵蓋：
- PATCH 卡片：只記有變的欄位（teacher_edited）、改答案 → answer_source = teacher（B8／B9）、
  失敗題補好改回 ok、改完重算重複、輸出剝除合併紀錄但草稿保留（不寫回剝除結果）
- 題組 PATCH：小題依原卷題號對回、老師編輯的排版存入時原樣採用
- 答案頁晚到不蓋掉老師改的答案
- DELETE 卡片；POST 手動補題（題型、原卷題號、插入位置、失敗頁改成已處理、處理中的頁 409）
- PATCH 設定：套用、教材擁有權（別人的、機構的）、來源、年段範圍；機構／學校不能改
"""

from __future__ import annotations

import uuid

from models import (
    ExamImportPage,
    Organization,
    Program,
    Lesson,
    Question,
    QuestionGroup,
    TeacherOrganization,
)
from services.exam_paper_cards import MERGE_PARTS_KEY, MERGE_PRE_KEY
from tests.test_exam_import_api import (  # noqa: F401  (fixtures)
    BASE,
    _bank_single,
    _group_unit,
    _headers,
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
from tests.test_exam_import_save import (  # noqa: F401  (fixtures)
    cards_of,
    create_import,
    get,
    patch_card,
    program,
    save,
    source,
)


def _page_row(session, import_id, page_no=1):
    session.expire_all()
    return (
        session.query(ExamImportPage)
        .filter_by(import_id=import_id, page_no=page_no)
        .one()
    )


# ---------------------------------------------------------------- PATCH 卡片


def test_patch_single_records_only_changed_fields(
    test_client, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(_png("p1"), _page(_single("1", "Pick one.", ["x", "y"], ai=[0])))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    card = cards_of(get(test_client, teacher, imp["id"]))[0]

    resp = patch_card(
        test_client,
        teacher,
        imp["id"],
        card["card_id"],
        {
            "question": {
                "stem": "Pick one.",  # 沒變 → 不記
                "options": ["x", "y"],
                "correct_indexes": [1],
                "explanation": "Because.",
            },
            "status": "ok",  # 非內容欄位：忽略
            "saved_question_id": 999,
        },
    )
    assert resp.status_code == 200, resp.text
    q = resp.json()["card"]["question"]
    assert q["teacher_edited"] == ["correct_indexes", "explanation"]
    assert q["answer_source"] == "teacher" and q["correct_indexes"] == [1]
    assert "saved_question_id" not in q
    assert resp.json()["import"]["id"] == imp["id"]


def test_patch_fixes_failed_question_and_refreshes_duplicates(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    mine = _bank_single(shared_test_session, teacher, "Known?", ["a", "b"])
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(
        _png("p1"),
        _page({"kind": "single", "question": {"no": "1", "box_2d": [1, 1, 50, 50]}}),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    card = cards_of(get(test_client, teacher, imp["id"]))[0]
    assert card["status"] == "failed"

    body = patch_card(
        test_client,
        teacher,
        imp["id"],
        card["card_id"],
        {"question": {"stem": "Known?", "options": ["a", "b"], "correct_indexes": [0]}},
    ).json()["card"]
    assert body["status"] == "ok" and body["question"]["status"] == "ok"
    assert body["duplicate_of"] == {"type": "bank", "kind": "single", "id": mine.id}


def test_late_answer_page_keeps_teacher_answer(
    test_client, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id, pages=2)
    fake_ai.on(_png("p1"), _page(_single("1", "Q?", ["a", "b", "c"], ai=[0])))
    fake_ai.on(
        _png("key"),
        _page(answer_key=[{"no": "1", "answer": "C"}], is_answer_page=True),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    card_id = cards_of(get(test_client, teacher, imp["id"]))[0]["card_id"]
    patch_card(
        test_client,
        teacher,
        imp["id"],
        card_id,
        {"question": {"correct_indexes": [1]}},
    )
    _send(test_client, teacher, imp["id"], 2, _png("key"))
    q = cards_of(get(test_client, teacher, imp["id"]))[0]["question"]
    assert q["correct_indexes"] == [1] and q["answer_source"] == "teacher"


def test_patch_merged_group_keeps_merge_records_in_draft_only(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id, pages=2)
    first = _group_unit(
        ["Part one."],
        [_q("1", "Q one?", ["a", "b"], ai=[0]), _q("2", "Q two?", ["a", "b"], ai=[0])],
    )
    cont = {
        **_group_unit(["Part two."], [_q("3", "Q three?", ["a", "b"], ai=[0])]),
        "continues_previous": True,
    }
    fake_ai.on(_png("p1"), _page(first))
    fake_ai.on(_png("p2"), _page(cont))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    _send(test_client, teacher, imp["id"], 2, _png("p2"))
    card = cards_of(get(test_client, teacher, imp["id"]))[0]
    assert card["pages"] == [1, 2]

    # 刪掉第 2 題、改第 3 題（依原卷題號對回）
    resp = patch_card(
        test_client,
        teacher,
        imp["id"],
        card["card_id"],
        {
            "group": {
                "title": "Edited",
                "questions": [
                    {"source_question_no": "1", "stem": "Q one?"},
                    {"source_question_no": "3", "stem": "Q three, edited?"},
                ],
            }
        },
    )
    out = resp.json()["card"]
    assert MERGE_PRE_KEY not in out and MERGE_PARTS_KEY not in out
    assert out["teacher_edited"] == ["title", "questions"]
    qs = out["group"]["questions"]
    assert [q["source_question_no"] for q in qs] == ["1", "3"]
    assert qs[0]["teacher_edited"] == [] and qs[1]["teacher_edited"] == ["stem"]
    assert qs[1]["page_no"] == 2  # 後端欄位沿用原本的小題
    # 草稿裡的合併紀錄沒被剝掉
    stored = _page_row(shared_test_session, imp["id"]).cards[0]
    assert MERGE_PRE_KEY in stored and MERGE_PARTS_KEY in stored


def test_teacher_layout_is_saved_as_is(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(
        _png("p1"),
        _page(_group_unit(["Old text."], [_q("1", "Q?", ["a", "b"], ai=[0])])),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    card_id = cards_of(get(test_client, teacher, imp["id"]))[0]["card_id"]
    layout = {
        "version": 1,
        "rows": [
            {
                "columns": [
                    {
                        "span": 1,
                        "blocks": [{"type": "heading", "level": 2, "text": "Hi"}],
                    },
                    {"span": 1, "blocks": [{"type": "paragraph", "text": "New text."}]},
                ]
            }
        ],
    }
    patch_card(test_client, teacher, imp["id"], card_id, {"group": {"layout": layout}})
    assert save(test_client, teacher, imp["id"]).json()["status"] == "saved"
    shared_test_session.expire_all()
    group = shared_test_session.query(QuestionGroup).one()
    assert group.layout == layout
    assert group.stimulus_type == "passage"
    assert "New text." in (group.passage_text or "")


# ---------------------------------------------------------------- 刪除、手動補題


def test_delete_card(test_client, teacher, source, fake_ai, fake_storage):
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(
        _png("p1"),
        _page(_single("1", "A?", ["a", "b"], ai=[0]), _single("2", "B?", ["a", "b"])),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    first, second = cards_of(get(test_client, teacher, imp["id"]))
    h = _headers(teacher)
    resp = test_client.delete(
        f"{BASE}/{imp['id']}/cards/{second['card_id']}", headers=h
    )
    assert resp.status_code == 200
    assert resp.json()["import"]["question_count"] == 1
    assert [c["card_id"] for c in cards_of(get(test_client, teacher, imp["id"]))] == [
        first["card_id"]
    ]
    resp = test_client.delete(f"{BASE}/{imp['id']}/cards/nope", headers=h)
    assert resp.status_code == 404


def test_add_manual_card_after_given_card(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "A?", ["a", "b"], ai=[0]),
            _single("3", "C?", ["a", "b"], ai=[0]),
        ),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    first = cards_of(get(test_client, teacher, imp["id"]))[0]
    resp = test_client.post(
        f"{BASE}/{imp['id']}/cards",
        json={
            "kind": "single",
            "page_no": 1,
            "after_card_id": first["card_id"],
            "source_question_no": "(2)",
            "question": {"stem": "B?", "options": ["a", "b"], "correct_indexes": [1]},
        },
        headers=_headers(teacher),
    )
    assert resp.status_code == 201, resp.text
    card = resp.json()["card"]
    assert card["manual"] is True and card["tts_accent"] == "American English"
    assert card["question"]["source_question_no"] == "2"
    assert card["question"]["answer_source"] == "teacher"
    nos = [
        c["question"]["source_question_no"]
        for c in cards_of(get(test_client, teacher, imp["id"]))
    ]
    assert nos == ["1", "2", "3"]
    assert len(save(test_client, teacher, imp["id"]).json()["saved"]) == 3


def test_add_group_card_to_failed_page_marks_page_done(
    test_client, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id, pages=2)
    fake_ai.on(_png("p1"), "not json at all")
    assert _send(test_client, teacher, imp["id"], 1, _png("p1")).status_code == 502
    h = _headers(teacher)
    # 第 2 頁還沒處理 → 409
    resp = test_client.post(
        f"{BASE}/{imp['id']}/cards", json={"kind": "single", "page_no": 2}, headers=h
    )
    assert resp.status_code == 409
    resp = test_client.post(
        f"{BASE}/{imp['id']}/cards", json={"kind": "group", "page_no": 1}, headers=h
    )
    assert resp.status_code == 201, resp.text
    card = resp.json()["card"]
    assert card["kind"] == "group" and len(card["group"]["questions"]) == 1
    page = get(test_client, teacher, imp["id"])["pages"][0]
    assert page["status"] == "done" and page["error"] is None


# ---------------------------------------------------------------- 整份設定


def test_patch_settings(test_client, shared_test_session, teacher, source, program):
    imp = create_import(test_client, teacher, source.id)
    h = _headers(teacher)
    lesson = Lesson(program_id=program.id, name="U1")
    shared_test_session.add(lesson)
    shared_test_session.commit()
    resp = test_client.patch(
        f"{BASE}/{imp['id']}/settings",
        json={
            "grade_min": 3,
            "grade_max": 4,
            "program_links": [{"program_id": program.id, "lesson_id": lesson.id}],
            "visibility": "public",
            "organization_id": str(uuid.uuid4()),  # 不能改：忽略
        },
        headers=h,
    )
    assert resp.status_code == 200, resp.text
    settings = resp.json()["settings"]
    assert (settings["grade_min"], settings["grade_max"]) == (3, 4)
    assert settings["visibility"] == "public"
    assert settings["organization_id"] is None
    assert settings["source_id"] == source.id

    bad = test_client.patch(
        f"{BASE}/{imp['id']}/settings", json={"grade_min": 9}, headers=h
    )
    assert bad.json()["detail"]["error"] == "EXAM_IMPORT_SETTINGS_INVALID"
    bad = test_client.patch(
        f"{BASE}/{imp['id']}/settings", json={"source_id": 999999}, headers=h
    )
    assert bad.status_code == 400


def test_program_link_ownership(
    test_client, shared_test_session, teacher, other_teacher, source, program
):
    s = shared_test_session
    org = Organization(id=uuid.uuid4(), name="P Org")
    s.add(org)
    s.flush()
    s.add(
        TeacherOrganization(
            teacher_id=teacher.id, organization_id=org.id, role="teacher"
        )
    )
    org_program = Program(
        name="Org Program", teacher_id=other_teacher.id, organization_id=org.id
    )
    other_lesson_program = Program(name="Other", teacher_id=teacher.id)
    s.add_all([org_program, other_lesson_program])
    s.flush()
    foreign_lesson = Lesson(program_id=other_lesson_program.id, name="X")
    s.add(foreign_lesson)
    s.commit()
    imp = create_import(test_client, teacher, source.id)
    h = _headers(teacher)

    def patch_links(links):
        return test_client.patch(
            f"{BASE}/{imp['id']}/settings", json={"program_links": links}, headers=h
        )

    # 個人題庫不能掛機構教材
    resp = patch_links([{"program_id": org_program.id}])
    assert resp.status_code == 422
    assert resp.json()["detail"]["program_ids"] == [org_program.id]
    # 單元不屬於這個教材
    resp = patch_links([{"program_id": program.id, "lesson_id": foreign_lesson.id}])
    assert resp.status_code == 422
    assert patch_links([{"program_id": program.id}]).status_code == 200

    # 機構題庫：只能掛該機構的教材
    org_imp = test_client.post(
        BASE,
        json={
            "file_name": "org.pdf",
            "file_hash": "b" * 64,
            "page_count": 1,
            "tts_accents": ["American English"],
            "settings": {
                "organization_id": str(org.id),
                "program_links": [{"program_id": program.id}],
            },
        },
        headers=h,
    )
    assert org_imp.status_code == 422


def test_review_endpoints_are_owner_only(
    test_client, teacher, other_teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id)
    h = _headers(other_teacher)
    assert (
        test_client.post(f"{BASE}/{imp['id']}/save", json={}, headers=h).status_code
        == 404
    )
    assert (
        test_client.patch(
            f"{BASE}/{imp['id']}/settings", json={}, headers=h
        ).status_code
        == 404
    )
    assert (
        test_client.patch(f"{BASE}/{imp['id']}/cards/x", json={}, headers=h).status_code
        == 404
    )


def test_saved_import_is_closed_for_edits(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(_png("p1"), _page(_single("1", "Only?", ["a", "b"], ai=[0])))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert save(test_client, teacher, imp["id"]).json()["status"] == "saved"
    h = _headers(teacher)
    resp = test_client.post(
        f"{BASE}/{imp['id']}/cards", json={"kind": "single", "page_no": 1}, headers=h
    )
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_CLOSED"
    resp = test_client.post(f"{BASE}/{imp['id']}/save", json={}, headers=h)
    assert resp.status_code == 409
    assert shared_test_session.query(Question).count() == 1

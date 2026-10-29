"""
上傳題本 C4a 審查修正與追加項目的 API 測試（Issue #1112）。AI 與 GCS 一律 mock。

- 手動存入不存還沒定的跨頁題組（``pending_continuation``，審查 5）
- IntegrityError 不是題目文字唯一索引 → ``invalid``（審查 6）
- 老師改過排版的題組不併入延續卡，兩張都照存、文字不少（審查 4）
- 自動存入時老師已不是機構成員 → 不存（缺測試）
- PATCH 整份設定檢查題庫成員資格（審查 9）
- 題目文字相同（same_stem）算進略過數、卡上保留 reason（使用者決定 1）
- 重試單一題可不附頁圖，用存好的頁圖（追加 A）
- 匯入摘要帶考題來源名稱 ``source``（追加 B）
- 卡片版本 ``rev``：開啟後被合併／答案頁更新 → PATCH 409 ``EXAM_IMPORT_CARD_CHANGED``（追加 C）
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from models import (
    ExamImport,
    Organization,
    Question,
    QuestionGroup,
    QuestionSource,
    TeacherOrganization,
)
from services import exam_import_save, exam_import_storage
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
    save,
    source,
)


def _cont(paragraphs, questions):
    return {**_group_unit(paragraphs, questions), "continues_previous": True}


@pytest.fixture
def org_member(shared_test_session, teacher):
    s = shared_test_session
    org = Organization(id=uuid.uuid4(), name="Fix Org")
    s.add(org)
    s.flush()
    membership = TeacherOrganization(
        teacher_id=teacher.id, organization_id=org.id, role="teacher"
    )
    s.add(membership)
    s.commit()
    return org, membership


# ---------------------------------------------------------------- 審查 5


def test_manual_save_skips_unsettled_group_with_reason(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id, pages=2)
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "Single?", ["a", "b"], ai=[0]),
            _group_unit(["Part one."], [_q("2", "Q two?", ["a", "b"], ai=[0])]),
        ),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    body = save(test_client, teacher, imp["id"]).json()
    assert len(body["saved"]) == 1
    assert [f["reason"] for f in body["failed"]] == ["pending_continuation"]
    assert "下一頁" in body["failed"][0]["message"]
    shared_test_session.expire_all()
    assert shared_test_session.query(QuestionGroup).count() == 0

    # 下一頁處理完（延續卡併進來）才存，內容完整
    fake_ai.on(
        _png("p2"),
        _page(_cont(["Part two."], [_q("3", "Q three?", ["a", "b"], ai=[0])])),
    )
    _send(test_client, teacher, imp["id"], 2, _png("p2"))
    body = save(test_client, teacher, imp["id"]).json()
    assert len(body["saved"]) == 1 and body["status"] == "saved"
    shared_test_session.expire_all()
    group = shared_test_session.query(QuestionGroup).one()
    assert len(group.questions) == 2


# ---------------------------------------------------------------- 審查 6


def test_other_integrity_error_is_invalid_not_same_stem(
    test_client, teacher, source, fake_ai, fake_storage, monkeypatch
):
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(_png("p1"), _page(_single("1", "Boom?", ["a", "b"], ai=[0])))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))

    def boom(*a, **k):
        raise IntegrityError("INSERT", {}, Exception("FOREIGN KEY constraint failed"))

    monkeypatch.setattr(exam_import_save, "_create_single", boom)
    body = save(test_client, teacher, imp["id"]).json()
    assert [f["reason"] for f in body["failed"]] == ["invalid"]


# ---------------------------------------------------------------- 審查 4


def test_teacher_edited_layout_keeps_continuation_as_own_card(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id, pages=2)
    fake_ai.on(
        _png("p1"),
        _page(_group_unit(["Part one."], [_q("1", "Q one?", ["a", "b"], ai=[0])])),
    )
    fake_ai.on(
        _png("p2"), _page(_cont(["Part two."], [_q("2", "Q two?", ["a", "b"], ai=[0])]))
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    group_id = cards_of(get(test_client, teacher, imp["id"]))[0]["card_id"]
    layout = {
        "version": 1,
        "rows": [
            {
                "columns": [
                    {
                        "span": 1,
                        "blocks": [{"type": "paragraph", "text": "Part one edited."}],
                    }
                ]
            }
        ],
    }
    resp = patch_card(
        test_client, teacher, imp["id"], group_id, {"group": {"layout": layout}}
    )
    assert resp.status_code == 200, resp.text

    _send(test_client, teacher, imp["id"], 2, _png("p2"))
    data = get(test_client, teacher, imp["id"])
    assert [len(p["cards"]) for p in data["pages"]] == [1, 1]  # 沒有併入

    body = save(test_client, teacher, imp["id"]).json()
    assert body["failed"] == [] and len(body["saved"]) == 2
    shared_test_session.expire_all()
    texts = sorted(
        g.passage_text or "" for g in shared_test_session.query(QuestionGroup)
    )
    assert any("Part one edited." in t for t in texts)
    assert any("Part two." in t for t in texts)


# ---------------------------------------------------------------- 機構成員


def test_auto_save_stops_when_teacher_left_org(
    test_client,
    shared_test_session,
    teacher,
    source,
    org_member,
    fake_ai,
    fake_storage,
):
    org, membership = org_member
    imp = create_import(
        test_client,
        teacher,
        source.id,
        pages=2,
        organization_id=str(org.id),
        visibility="organization_only",
    )
    fake_ai.on(_png("p1"), _page(_single("1", "First?", ["a", "b"], ai=[0])))
    fake_ai.on(_png("p2"), _page(_single("2", "Second?", ["a", "b"], ai=[0])))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    resp = test_client.post(
        f"{BASE}/{imp['id']}/skip-review", headers=_headers(teacher)
    )
    assert len(resp.json()["saved"]) == 1

    membership.is_active = False
    shared_test_session.commit()
    resp = _send(test_client, teacher, imp["id"], 2, _png("p2"))
    assert resp.status_code == 200, resp.text  # 這一頁照常寫入
    shared_test_session.expire_all()
    assert {q.stem for q in shared_test_session.query(Question).all()} == {"First?"}


def test_patch_settings_requires_bank_membership(
    test_client, shared_test_session, teacher, source, org_member
):
    org, membership = org_member
    imp = create_import(
        test_client,
        teacher,
        source.id,
        organization_id=str(org.id),
        visibility="organization_only",
    )
    url = f"{BASE}/{imp['id']}/settings"
    membership.is_active = False
    shared_test_session.commit()
    resp = test_client.patch(url, json={"grade_min": 8}, headers=_headers(teacher))
    assert resp.status_code == 403
    membership.is_active = True
    shared_test_session.commit()
    resp = test_client.patch(url, json={"grade_min": 8}, headers=_headers(teacher))
    assert resp.status_code == 200 and resp.json()["settings"]["grade_min"] == 8


# ---------------------------------------------------------------- 使用者決定 1：same_stem


def test_same_stem_counts_as_skipped_and_card_keeps_reason(
    test_client, shared_test_session, teacher, source, fake_ai, fake_storage
):
    _bank_single(shared_test_session, teacher, "Same words?", ["old 1", "old 2"])
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "Same words?", ["new 1", "new 2"], ai=[0]),
            _single("2", "Fresh?", ["a", "b"], ai=[0]),
        ),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    body = save(test_client, teacher, imp["id"]).json()
    assert len(body["saved"]) == 1
    assert [f["reason"] for f in body["failed"]] == ["same_stem"]
    assert body["completed"] is True and body["status"] == "saved"
    assert body["skipped_duplicate_cards"] == 1
    assert body["skipped_duplicate_questions"] == 1
    card = cards_of(get(test_client, teacher, imp["id"]))[0]
    assert card["duplicate_of"]["reason"] == "same_stem"
    assert card["duplicate_of"]["type"] == "bank"
    assert "saved_question_id" not in card["question"]


# ---------------------------------------------------------------- 追加 A：重試不附頁圖


def _failed_second(fake_ai, tag):
    fake_ai.on(
        _png(tag),
        _page(
            _single("1", "Fine?", ["a", "b"], ai=[0]),
            {
                "kind": "single",
                "question": {
                    "no": "2",
                    "box_2d": [300, 50, 400, 950],
                    "unreadable": True,
                },
            },
        ),
    )


def test_retry_without_file_uses_stored_page_image(
    test_client, teacher, source, fake_ai, fake_storage, monkeypatch
):
    imp = create_import(test_client, teacher, source.id)
    _failed_second(fake_ai, "p1")
    cards = _send(test_client, teacher, imp["id"], 1, _png("p1")).json()["page"][
        "cards"
    ]
    failed_id = cards[1]["card_id"]
    stored = _png("stored-p1")
    fake_ai.on(stored, _page(_single("2", "Now readable?", ["yes", "no"], ai=[1])))
    reads = []

    def read(import_id, url):
        reads.append((import_id, url))
        return stored, "image/png"

    monkeypatch.setattr(exam_import_storage, "read_page_image", read)
    resp = test_client.post(
        f"{BASE}/{imp['id']}/pages/1/retry",
        data={"card_id": failed_id},
        headers=_headers(teacher),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["card"]["question"]["stem"] == "Now readable?"
    assert reads == [
        (imp["id"], f"https://storage.example/exam_imports/{imp['id']}/page_1.png")
    ]


def test_retry_with_file_still_works_and_missing_stored_image_409(
    test_client, teacher, source, fake_ai, fake_storage, monkeypatch
):
    imp = create_import(test_client, teacher, source.id)
    _failed_second(fake_ai, "p1")
    cards = _send(test_client, teacher, imp["id"], 1, _png("p1")).json()["page"][
        "cards"
    ]
    failed_id = cards[1]["card_id"]
    monkeypatch.setattr(exam_import_storage, "read_page_image", lambda i, u: None)
    resp = test_client.post(
        f"{BASE}/{imp['id']}/pages/1/retry",
        data={"card_id": failed_id},
        headers=_headers(teacher),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_PAGE_IMAGE_MISSING"

    upload = _png("p1-upload")
    fake_ai.on(upload, _page(_single("2", "From file?", ["yes", "no"], ai=[0])))
    resp = test_client.post(
        f"{BASE}/{imp['id']}/pages/1/retry",
        files={"file": ("page.png", upload, "image/png")},
        data={"card_id": failed_id},
        headers=_headers(teacher),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["card"]["question"]["stem"] == "From file?"


# ---------------------------------------------------------------- 追加 B：來源名稱


def test_summary_includes_visible_source_name(
    test_client, shared_test_session, teacher, other_teacher, source
):
    imp = create_import(test_client, teacher, source.id)
    assert imp["source"] == {"id": source.id, "name": "113 段考"}
    assert get(test_client, teacher, imp["id"])["source"] == {
        "id": source.id,
        "name": "113 段考",
    }
    items = test_client.get(BASE, headers=_headers(teacher)).json()["items"]
    assert items[0]["source"]["name"] == "113 段考"

    # 沒設 → null
    resp = test_client.patch(
        f"{BASE}/{imp['id']}/settings",
        json={"source_id": None},
        headers=_headers(teacher),
    )
    assert resp.status_code == 200 and resp.json()["source"] is None

    # 老師看不到的來源（別人建的）→ null
    theirs = QuestionSource(source_type="exam", name="別人的", teacher_id=other_teacher.id)
    s = shared_test_session
    s.add(theirs)
    s.commit()
    row = s.get(ExamImport, imp["id"])
    row.settings = {**(row.settings or {}), "source_id": theirs.id}
    s.commit()
    assert get(test_client, teacher, imp["id"])["source"] is None


# ---------------------------------------------------------------- 追加 C：卡片版本


def test_patch_rejects_card_changed_by_merge_after_open(
    test_client, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id, pages=2)
    fake_ai.on(
        _png("p1"),
        _page(_group_unit(["Part one."], [_q("1", "Q one?", ["a", "b"], ai=[0])])),
    )
    fake_ai.on(
        _png("p2"), _page(_cont(["Part two."], [_q("2", "Q two?", ["a", "b"], ai=[0])]))
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    opened = cards_of(get(test_client, teacher, imp["id"]))[0]
    assert opened["rev"] >= 1 and "_rev_sig" not in opened

    _send(test_client, teacher, imp["id"], 2, _png("p2"))  # 延續卡併進這張
    resp = patch_card(
        test_client,
        teacher,
        imp["id"],
        opened["card_id"],
        {"rev": opened["rev"], "group": {"title": "Mine"}},
    )
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error"] == "EXAM_IMPORT_CARD_CHANGED"
    assert detail["card"]["rev"] == opened["rev"] + 1
    now = cards_of(get(test_client, teacher, imp["id"]))[0]
    assert now["group"]["title"] != "Mine"
    assert len(now["group"]["questions"]) == 2


def test_patch_rejects_card_changed_by_answer_key_after_open(
    test_client, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id, pages=2)
    fake_ai.on(_png("p1"), _page(_single("1", "Needs key?", ["a", "b", "c"])))
    fake_ai.on(
        _png("key"),
        _page(answer_key=[{"no": "1", "answer": "C"}], is_answer_page=True),
    )
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    opened = cards_of(get(test_client, teacher, imp["id"]))[0]
    _send(test_client, teacher, imp["id"], 2, _png("key"))
    resp = patch_card(
        test_client,
        teacher,
        imp["id"],
        opened["card_id"],
        {"rev": opened["rev"], "question": {"correct_indexes": [0]}},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_CARD_CHANGED"
    now = cards_of(get(test_client, teacher, imp["id"]))[0]
    assert now["question"]["correct_indexes"] == [2]


def test_patch_with_current_rev_succeeds_and_bumps_rev(
    test_client, teacher, source, fake_ai, fake_storage
):
    imp = create_import(test_client, teacher, source.id)
    fake_ai.on(_png("p1"), _page(_single("1", "Edit me?", ["a", "b"], ai=[0])))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    opened = cards_of(get(test_client, teacher, imp["id"]))[0]
    resp = patch_card(
        test_client,
        teacher,
        imp["id"],
        opened["card_id"],
        {"rev": opened["rev"], "question": {"stem": "Edited?"}},
    )
    assert resp.status_code == 200, resp.text
    card = resp.json()["card"]
    assert card["rev"] == opened["rev"] + 1
    assert card["question"]["stem"] == "Edited?"
    # 沒帶 rev：不檢查（舊前端相容）
    resp = patch_card(
        test_client,
        teacher,
        imp["id"],
        opened["card_id"],
        {"question": {"stem": "Again?"}},
    )
    assert resp.status_code == 200 and resp.json()["card"]["rev"] == opened["rev"] + 2

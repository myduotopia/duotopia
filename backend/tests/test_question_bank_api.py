"""
題庫 API 測試（Issue #1061 / #1062）。

驗證項目對應 #1062 驗收條件：
- 平台帳號建的題目 visibility 強制 public
- 老師 A 私有題目不出現在老師 B 的列表與相似題結果；public 的看得到
- 機構題庫只有 active 成員看得到
- 完全重複的題幹 → 409；相似題 API 回傳 exact_duplicate
- 「現完式」alias 能命中「現在完成式」
- merged 考點自動 redirect 到正式考點
- 表單驗證：選項 < 2、沒勾正確答案、單選勾兩個 → 422
- PATCH / DELETE（軟刪除）與權限
- filter：考點 OR、年級交集、關鍵字
"""

import uuid

import pytest

from auth import create_access_token, get_password_hash
from models import (
    ExamPoint,
    ExamPointAlias,
    Organization,
    Question,
    Teacher,
    TeacherOrganization,
)
from services import question_bank_service as qbs


# ---------------------------------------------------------------- fixtures


def _make_teacher(session, email: str) -> Teacher:
    t = Teacher(
        email=email,
        password_hash=get_password_hash("test123"),
        name=email.split("@")[0],
        is_active=True,
        is_demo=False,
        email_verified=True,
    )
    session.add(t)
    session.commit()
    session.refresh(t)
    return t


def _headers(teacher: Teacher) -> dict:
    token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def teacher_a(shared_test_session):
    return _make_teacher(shared_test_session, "qb_a@duotopia.com")


@pytest.fixture
def teacher_b(shared_test_session):
    return _make_teacher(shared_test_session, "qb_b@duotopia.com")


@pytest.fixture
def platform_teacher(shared_test_session):
    return _make_teacher(shared_test_session, qbs.PLATFORM_TEACHER_EMAIL)


@pytest.fixture
def exam_points(shared_test_session):
    """考點樹：文法 > 時態 > 現在完成式（alias 現完式）；另一個 merged 舊考點。"""
    s = shared_test_session
    grammar = ExamPoint(code="grammar", names={"zh-TW": "文法", "en": "Grammar"})
    s.add(grammar)
    s.flush()
    tense = ExamPoint(
        code="grammar.tense",
        parent_id=grammar.id,
        names={"zh-TW": "時態", "en": "Tense"},
    )
    s.add(tense)
    s.flush()
    present_perfect = ExamPoint(
        code="grammar.tense.present_perfect",
        parent_id=tense.id,
        names={"zh-TW": "現在完成式", "en": "Present Perfect"},
    )
    s.add(present_perfect)
    s.flush()
    s.add(ExamPointAlias(exam_point_id=present_perfect.id, alias="現完式", lang="zh-TW"))
    s.add(
        ExamPointAlias(
            exam_point_id=present_perfect.id, alias="present perfect tense", lang="en"
        )
    )
    # 被合併掉的舊考點 → 指向 present_perfect
    legacy = ExamPoint(
        code="legacy.pp",
        names={"zh-TW": "現在完成時態"},
        status="merged",
        merged_into_id=present_perfect.id,
    )
    s.add(legacy)
    vocab = ExamPoint(code="vocab", names={"zh-TW": "字彙", "en": "Vocabulary"})
    s.add(vocab)
    s.commit()
    return {
        "grammar": grammar,
        "tense": tense,
        "present_perfect": present_perfect,
        "legacy": legacy,
        "vocab": vocab,
    }


def _mc_payload(stem="I ___ never been to Japan.", **overrides):
    payload = {
        "question_type": "multiple_choice",
        "stem": stem,
        "options": [
            {"text": "have", "is_correct": True},
            {"text": "has"},
            {"text": "had"},
        ],
    }
    payload.update(overrides)
    return payload


def _create(client, teacher, **kw):
    resp = client.post(
        "/api/question-bank/questions",
        json=_mc_payload(**kw),
        headers=_headers(teacher),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------- normalize


def test_normalize_stem_case_punct_fullwidth():
    assert qbs.normalize_stem("  Ｉ  have,  NEVER been!! ") == "i have never been"
    assert qbs.normalize_stem("") == ""


# ---------------------------------------------------------------- auth


def test_requires_auth(test_client):
    assert test_client.get("/api/question-bank/questions").status_code == 401


# ---------------------------------------------------------------- create / validate


def test_create_multiple_choice(test_client, teacher_a, exam_points):
    data = _create(
        test_client,
        teacher_a,
        grade_min=7,
        grade_max=9,
        exam_point_ids=[exam_points["present_perfect"].id],
        explanation="現在完成式用 have + p.p.",
    )
    assert data["question_type"] == "multiple_choice"
    assert data["visibility"] == "private"
    assert data["is_platform"] is False
    assert data["is_owner"] is True
    assert [o["order_index"] for o in data["options"]] == [0, 1, 2]
    assert data["options"][0]["is_correct"] is True
    assert [ep["code"] for ep in data["exam_points"]] == [
        "grammar.tense.present_perfect"
    ]
    assert data["exam_points"][0]["source"] == "manual"


@pytest.mark.parametrize(
    "options, allow_multiple",
    [
        ([{"text": "only one", "is_correct": True}], False),  # < 2 選項
        ([{"text": "a"}, {"text": "b"}], False),  # 沒勾正確答案
        (
            [{"text": "a", "is_correct": True}, {"text": "b", "is_correct": True}],
            False,
        ),  # 單選勾兩個
        ([{"text": " ", "is_correct": True}, {"text": "b"}], False),  # 空白選項
    ],
)
def test_create_rejects_invalid_options(
    test_client, teacher_a, options, allow_multiple
):
    resp = test_client.post(
        "/api/question-bank/questions",
        json=_mc_payload(options=options, allow_multiple_answers=allow_multiple),
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422, resp.text


def test_create_allows_multiple_correct_when_enabled(test_client, teacher_a):
    data = _create(
        test_client,
        teacher_a,
        allow_multiple_answers=True,
        options=[
            {"text": "a", "is_correct": True},
            {"text": "b", "is_correct": True},
            {"text": "c"},
        ],
    )
    assert sum(o["is_correct"] for o in data["options"]) == 2


def test_create_rejects_bad_grade_range(test_client, teacher_a):
    resp = test_client.post(
        "/api/question-bank/questions",
        json=_mc_payload(grade_min=9, grade_max=7),
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422


def test_create_rejects_unopened_type(test_client, teacher_a):
    resp = test_client.post(
        "/api/question-bank/questions",
        json=_mc_payload(question_type="cloze"),
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422  # Literal 擋在 schema 層


# ---------------------------------------------------------------- platform


def test_platform_teacher_forced_public(test_client, platform_teacher):
    data = _create(test_client, platform_teacher, visibility="private")
    assert data["is_platform"] is True
    assert data["visibility"] == "public"


def test_platform_flag_cannot_be_spoofed_via_patch(test_client, teacher_a):
    data = _create(test_client, teacher_a)
    resp = test_client.patch(
        f"/api/question-bank/questions/{data['id']}",
        json={"visibility": "public"},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 200
    assert resp.json()["is_platform"] is False
    assert resp.json()["visibility"] == "public"


# ---------------------------------------------------------------- visibility


def test_private_not_visible_to_other_teacher(test_client, teacher_a, teacher_b):
    q = _create(test_client, teacher_a, stem="Private stem only A sees")
    listing = test_client.get(
        "/api/question-bank/questions", headers=_headers(teacher_b)
    ).json()
    assert all(item["id"] != q["id"] for item in listing["items"])
    assert (
        test_client.get(
            f"/api/question-bank/questions/{q['id']}", headers=_headers(teacher_b)
        ).status_code
        == 404
    )
    # 相似題也看不到
    sim = test_client.get(
        "/api/question-bank/questions/similar",
        params={"stem": "Private stem only A sees"},
        headers=_headers(teacher_b),
    ).json()
    assert sim["exact_duplicate"] is None
    assert sim["similar"] == []


def test_public_visible_to_other_teacher_and_dedup(test_client, teacher_a, teacher_b):
    q = _create(
        test_client, teacher_a, stem="Public stem everyone sees", visibility="public"
    )
    listing = test_client.get(
        "/api/question-bank/questions", headers=_headers(teacher_b)
    ).json()
    ids = [item["id"] for item in listing["items"]]
    assert q["id"] in ids
    got = next(i for i in listing["items"] if i["id"] == q["id"])
    assert got["is_owner"] is False

    # B 想建同一題 → 409，回傳重複題資訊
    resp = test_client.post(
        "/api/question-bank/questions",
        json=_mc_payload(stem="public stem EVERYONE sees!"),
        headers=_headers(teacher_b),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["duplicate"]["id"] == q["id"]

    # B 不能改 A 的公開題
    resp = test_client.patch(
        f"/api/question-bank/questions/{q['id']}",
        json={"explanation": "hack"},
        headers=_headers(teacher_b),
    )
    assert resp.status_code == 403
    assert (
        test_client.delete(
            f"/api/question-bank/questions/{q['id']}", headers=_headers(teacher_b)
        ).status_code
        == 403
    )


def test_organization_bank_visible_to_members_only(
    test_client, shared_test_session, teacher_a, teacher_b
):
    s = shared_test_session
    org = Organization(id=uuid.uuid4(), name="QB Org")
    s.add(org)
    s.flush()
    s.add(
        TeacherOrganization(
            teacher_id=teacher_a.id, organization_id=org.id, role="org_owner"
        )
    )
    s.commit()

    q = _create(
        test_client,
        teacher_a,
        stem="Org internal question",
        organization_id=str(org.id),
    )
    assert q["organization_id"] == str(org.id)

    # A（成員）看得到、可用 organization scope 查
    listing = test_client.get(
        "/api/question-bank/questions",
        params={"scope": "organization", "organization_id": str(org.id)},
        headers=_headers(teacher_a),
    ).json()
    assert [i["id"] for i in listing["items"]] == [q["id"]]
    # 不在 mine scope
    mine = test_client.get(
        "/api/question-bank/questions",
        params={"scope": "mine"},
        headers=_headers(teacher_a),
    ).json()
    assert all(i["id"] != q["id"] for i in mine["items"])

    # B（非成員）看不到；也不能建到這個機構
    listing_b = test_client.get(
        "/api/question-bank/questions", headers=_headers(teacher_b)
    ).json()
    assert all(i["id"] != q["id"] for i in listing_b["items"])
    resp = test_client.post(
        "/api/question-bank/questions",
        json=_mc_payload(stem="B tries org", organization_id=str(org.id)),
        headers=_headers(teacher_b),
    )
    assert resp.status_code == 403

    # B 加入為一般成員：可以新增到機構題庫，但不能編輯／刪除（需擁有人或管理權限）
    s.add(
        TeacherOrganization(
            teacher_id=teacher_b.id, organization_id=org.id, role="teacher"
        )
    )
    s.commit()
    q_b = _create(
        test_client,
        teacher_b,
        stem="Member adds org question",
        organization_id=str(org.id),
    )
    assert q_b["organization_id"] == str(org.id)
    assert (
        test_client.patch(
            f"/api/question-bank/questions/{q_b['id']}",
            json={"explanation": "member edit"},
            headers=_headers(teacher_b),
        ).status_code
        == 403
    )
    assert (
        test_client.delete(
            f"/api/question-bank/questions/{q_b['id']}", headers=_headers(teacher_b)
        ).status_code
        == 403
    )
    # A 是 org_owner：可以編輯成員建的題
    assert (
        test_client.patch(
            f"/api/question-bank/questions/{q_b['id']}",
            json={"explanation": "owner edit"},
            headers=_headers(teacher_a),
        ).status_code
        == 200
    )


def test_individual_only_and_organization_only(
    test_client, shared_test_session, teacher_a, teacher_b, platform_teacher
):
    """organization_only 只給有機構的老師；individual_only 只給沒機構的老師。"""
    s = shared_test_session
    org = Organization(id=uuid.uuid4(), name="Vis Org")
    s.add(org)
    s.flush()
    s.add(
        TeacherOrganization(
            teacher_id=teacher_b.id, organization_id=org.id, role="teacher"
        )
    )
    s.commit()

    org_only = _create(
        test_client, teacher_a, stem="Org only audience", visibility="organization_only"
    )
    indiv_only = _create(
        test_client,
        teacher_a,
        stem="Individual only audience",
        visibility="individual_only",
    )

    b_ids = {
        i["id"]
        for i in test_client.get(
            "/api/question-bank/questions", headers=_headers(teacher_b)
        ).json()["items"]
    }
    p_ids = {
        i["id"]
        for i in test_client.get(
            "/api/question-bank/questions", headers=_headers(platform_teacher)
        ).json()["items"]
    }
    assert org_only["id"] in b_ids and indiv_only["id"] not in b_ids
    assert indiv_only["id"] in p_ids and org_only["id"] not in p_ids


# ---------------------------------------------------------------- similar / dedup


def test_similar_returns_exact_and_similar(test_client, teacher_a):
    q = _create(test_client, teacher_a, stem="She has lived here since 2010.")
    resp = test_client.get(
        "/api/question-bank/questions/similar",
        params={"stem": "she HAS lived here since 2010"},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["exact_duplicate"]["id"] == q["id"]
    assert any(item["id"] == q["id"] for item in body["similar"])

    # exclude_id：編輯自己這題時不會把自己當重複
    body = test_client.get(
        "/api/question-bank/questions/similar",
        params={"stem": "She has lived here since 2010.", "exclude_id": q["id"]},
        headers=_headers(teacher_a),
    ).json()
    assert body["exact_duplicate"] is None


def test_patch_stem_to_duplicate_rejected(test_client, teacher_a):
    q1 = _create(test_client, teacher_a, stem="First unique stem")
    q2 = _create(test_client, teacher_a, stem="Second unique stem")
    resp = test_client.patch(
        f"/api/question-bank/questions/{q2['id']}",
        json={"stem": "first UNIQUE stem"},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["duplicate"]["id"] == q1["id"]


# ---------------------------------------------------------------- exam points


def test_exam_points_alias_search(test_client, teacher_a, exam_points):
    resp = test_client.get(
        "/api/question-bank/exam-points",
        params={"q": "現完式"},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert [i["code"] for i in items] == ["grammar.tense.present_perfect"]
    assert "現完式" in items[0]["aliases"]
    assert items[0]["names"]["en"] == "Present Perfect"

    # 英文 alias、正式名稱、code 都能命中；merged 的不回
    for needle in ("present perfect tense", "Present Perfect", "grammar.tense.present"):
        codes = [
            i["code"]
            for i in test_client.get(
                "/api/question-bank/exam-points",
                params={"q": needle},
                headers=_headers(teacher_a),
            ).json()["items"]
        ]
        assert "grammar.tense.present_perfect" in codes
        assert "legacy.pp" not in codes

    # 不帶 q 回整棵 active 樹（含 parent_id）
    all_items = test_client.get(
        "/api/question-bank/exam-points", headers=_headers(teacher_a)
    ).json()["items"]
    by_code = {i["code"]: i for i in all_items}
    assert "legacy.pp" not in by_code
    assert by_code["grammar.tense"]["parent_id"] == by_code["grammar"]["id"]


def test_merged_exam_point_redirects(test_client, teacher_a, exam_points):
    data = _create(
        test_client,
        teacher_a,
        exam_point_ids=[exam_points["legacy"].id, exam_points["present_perfect"].id],
    )
    # 舊考點被 redirect 到正式考點，且不重複
    assert [ep["code"] for ep in data["exam_points"]] == [
        "grammar.tense.present_perfect"
    ]


def test_find_exam_point_by_alias_service(shared_test_session, exam_points):
    ep = qbs.find_exam_point_by_alias(shared_test_session, "  現完式 ")
    assert ep is not None and ep.code == "grammar.tense.present_perfect"
    assert qbs.find_exam_point_by_alias(shared_test_session, "nope") is None


# ---------------------------------------------------------------- update / delete


def test_patch_and_soft_delete(
    test_client, shared_test_session, teacher_a, exam_points
):
    q = _create(test_client, teacher_a, stem="Patch me", grade_min=3, grade_max=5)
    resp = test_client.patch(
        f"/api/question-bank/questions/{q['id']}",
        json={
            "stem": "Patched stem",
            "grade_max": 8,
            "options": [
                {"text": "x"},
                {"text": "y", "is_correct": True},
            ],
            "exam_point_ids": [exam_points["vocab"].id],
            "program_links": [],
        },
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["stem"] == "Patched stem"
    assert body["grade_min"] == 3 and body["grade_max"] == 8
    assert [o["text"] for o in body["options"]] == ["x", "y"]
    assert body["options"][1]["is_correct"] is True
    assert [ep["code"] for ep in body["exam_points"]] == ["vocab"]

    # 關閉複選但有兩個正確答案 → 擋
    multi = _create(
        test_client,
        teacher_a,
        stem="Multi answers",
        allow_multiple_answers=True,
        options=[{"text": "a", "is_correct": True}, {"text": "b", "is_correct": True}],
    )
    resp = test_client.patch(
        f"/api/question-bank/questions/{multi['id']}",
        json={"allow_multiple_answers": False},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422

    # 軟刪除：列表消失、DB 仍在
    resp = test_client.delete(
        f"/api/question-bank/questions/{q['id']}", headers=_headers(teacher_a)
    )
    assert resp.status_code == 204
    listing = test_client.get(
        "/api/question-bank/questions", headers=_headers(teacher_a)
    ).json()
    assert all(i["id"] != q["id"] for i in listing["items"])
    row = shared_test_session.query(Question).filter(Question.id == q["id"]).first()
    assert row is not None and row.is_active is False and row.deleted_at is not None


def test_program_links_replace_dedups(test_client, shared_test_session, teacher_a):
    from tests.factories import TestDataFactory

    program = TestDataFactory.create_program(shared_test_session, teacher_a)
    q = _create(test_client, teacher_a, stem="Link me")
    resp = test_client.put(
        f"/api/question-bank/questions/{q['id']}/program-links",
        json={
            "program_links": [
                {"program_id": program.id},
                {"program_id": program.id},  # 重複 → 去重
            ]
        },
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["program_links"] == [
        {"program_id": program.id, "lesson_id": None}
    ]


# ---------------------------------------------------------------- filters


def test_list_filters(test_client, teacher_a, exam_points):
    pp = exam_points["present_perfect"].id
    vocab = exam_points["vocab"].id
    q_pp = _create(
        test_client,
        teacher_a,
        stem="Have you ever seen it",
        grade_min=7,
        grade_max=9,
        exam_point_ids=[pp],
    )
    q_vocab = _create(
        test_client,
        teacher_a,
        stem="Apple is a fruit",
        grade_min=1,
        grade_max=3,
        exam_point_ids=[vocab],
    )
    q_none = _create(test_client, teacher_a, stem="No grade no point")

    def ids(**params):
        return {
            i["id"]
            for i in test_client.get(
                "/api/question-bank/questions",
                params=params,
                headers=_headers(teacher_a),
            ).json()["items"]
        }

    # 考點 OR
    assert ids(exam_point_ids=[pp]) == {q_pp["id"]}
    assert ids(exam_point_ids=[pp, vocab]) == {q_pp["id"], q_vocab["id"]}
    # merged 舊考點 id 也能查到（redirect）
    assert ids(exam_point_ids=[exam_points["legacy"].id]) == {q_pp["id"]}
    # 年級交集；沒設年級的題不被排除
    assert ids(grade_min=8, grade_max=12) == {q_pp["id"], q_none["id"]}
    assert ids(grade_min=1, grade_max=2) == {q_vocab["id"], q_none["id"]}
    # 關鍵字（正規化後子字串）
    assert ids(q="EVER seen") == {q_pp["id"]}
    # 疊加
    assert ids(exam_point_ids=[pp, vocab], grade_min=7) == {q_pp["id"]}
    # 分頁
    page = test_client.get(
        "/api/question-bank/questions",
        params={"page": 1, "page_size": 2},
        headers=_headers(teacher_a),
    ).json()
    assert page["total"] == 3 and len(page["items"]) == 2

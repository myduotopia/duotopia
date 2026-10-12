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
- 題組（#1082）：整組一個交易建立、失敗 rollback、可見範圍與機構成員、列表單題＋題組列混合
"""

import uuid

import pytest

from auth import create_access_token, get_password_hash
from models import (
    ExamPoint,
    ExamPointAlias,
    Organization,
    Question,
    QuestionGroup,
    QuestionSource,
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
        # cloze 已開放（但只能經題組端點建）→ 改用仍未開放的題型
        json=_mc_payload(question_type="listening"),
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422  # Literal 擋在 schema 層


def test_image_only_question_and_option(test_client, teacher_a):
    """純圖題／純圖選項：文字可空，但文字／圖片至少一個。"""
    data = _create(
        test_client,
        teacher_a,
        stem="",
        image_url="https://example.com/q.png",
        options=[
            {"text": "", "image_url": "https://example.com/a.png", "is_correct": True},
            {"text": "b"},
        ],
    )
    assert data["stem"] == "" and data["image_url"].endswith("q.png")
    assert data["options"][0]["text"] == ""

    # 兩題純圖題不會互相被當重複（空題幹不去重）
    _create(
        test_client,
        teacher_a,
        stem="",
        image_url="https://example.com/q2.png",
        options=[{"text": "x", "is_correct": True}, {"text": "y"}],
    )

    # 沒文字也沒圖 → 422（題目／選項各測一次）
    resp = test_client.post(
        "/api/question-bank/questions",
        json=_mc_payload(stem=""),
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422
    resp = test_client.post(
        "/api/question-bank/questions",
        json=_mc_payload(options=[{"text": "", "is_correct": True}, {"text": "b"}]),
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422

    # PATCH 把題幹清空但沒圖 → 422
    q = _create(test_client, teacher_a, stem="Has text")
    resp = test_client.patch(
        f"/api/question-bank/questions/{q['id']}",
        json={"stem": ""},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422


def test_sources_create_list_and_link(test_client, teacher_a, teacher_b):
    """來源：個人新增 → 自己看得到、別人看不到；同名回既有；題目可掛來源。"""
    resp = test_client.post(
        "/api/question-bank/sources",
        json={"source_type": "exam", "name": "113 學年度會考", "year": 2024},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 201, resp.text
    src = resp.json()
    assert src["teacher_id"] == teacher_a.id and src["organization_id"] is None

    # 同名同型別 → 回既有那筆
    again = test_client.post(
        "/api/question-bank/sources",
        json={"source_type": "exam", "name": "113 學年度會考"},
        headers=_headers(teacher_a),
    )
    assert again.status_code == 201 and again.json()["id"] == src["id"]

    # 搜尋
    items = test_client.get(
        "/api/question-bank/sources", params={"q": "113"}, headers=_headers(teacher_a)
    ).json()["items"]
    assert [i["id"] for i in items] == [src["id"]]
    # B 看不到 A 的個人來源
    items_b = test_client.get(
        "/api/question-bank/sources", headers=_headers(teacher_b)
    ).json()["items"]
    assert all(i["id"] != src["id"] for i in items_b)

    # 掛到題目；B 傳 A 的來源 id 會被忽略
    q = _create(test_client, teacher_a, stem="With source", source_ids=[src["id"]])
    assert [x["id"] for x in q["sources"]] == [src["id"]]
    q_b = _create(test_client, teacher_b, stem="B question", source_ids=[src["id"]])
    assert q_b["sources"] == []

    # PATCH 清空
    resp = test_client.patch(
        f"/api/question-bank/questions/{q['id']}",
        json={"source_ids": []},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 200 and resp.json()["sources"] == []


def test_sources_create_dedup_respects_requested_scope(
    test_client, shared_test_session, teacher_a
):
    """同名來源只在「平台公用 + 要建立的那個 scope」內去重，不會回到別的機構或個人。"""
    s = shared_test_session
    org_a = Organization(id=uuid.uuid4(), name="Src Org A")
    org_b = Organization(id=uuid.uuid4(), name="Src Org B")
    s.add_all([org_a, org_b])
    s.flush()
    for org in (org_a, org_b):
        s.add(
            TeacherOrganization(
                teacher_id=teacher_a.id, organization_id=org.id, role="org_owner"
            )
        )
    s.commit()
    h = _headers(teacher_a)

    def post(name, org=None):
        body = {"source_type": "exam", "name": name}
        if org is not None:
            body["organization_id"] = str(org.id)
        resp = test_client.post("/api/question-bank/sources", json=body, headers=h)
        assert resp.status_code == 201, resp.text
        return resp.json()

    in_a = post("114 學年度會考", org_a)
    assert in_a["organization_id"] == str(org_a.id)
    # 同名但指定 Org B → 建一筆 Org B 的，不能回 Org A 那筆
    in_b = post("114 學年度會考", org_b)
    assert in_b["id"] != in_a["id"]
    assert in_b["organization_id"] == str(org_b.id)
    # 同名但不帶機構（個人）→ 建個人的
    personal = post("114 學年度會考")
    assert personal["id"] not in (in_a["id"], in_b["id"])
    assert personal["teacher_id"] == teacher_a.id
    assert personal["organization_id"] is None
    # 各 scope 內重送仍 idempotent
    assert post("114 學年度會考", org_b)["id"] == in_b["id"]
    assert post("114 學年度會考")["id"] == personal["id"]

    # 平台公用來源同名 → 任何 scope 都沿用平台那筆，不重複建立
    platform_src = QuestionSource(source_type="exam", name="平台共用來源")
    s.add(platform_src)
    s.commit()
    assert post("平台共用來源", org_a)["id"] == platform_src.id
    assert post("平台共用來源")["id"] == platform_src.id


def test_sources_search_escapes_like_wildcards(test_client, teacher_a):
    """#1077：來源名稱含 %／_ 的搜尋與建立，% 與 _ 不能被當 ILIKE 萬用字元。"""
    h = _headers(teacher_a)
    pct = test_client.post(
        "/api/question-bank/sources",
        json={"source_type": "exam", "name": "100%_會考"},
        headers=h,
    ).json()
    other = test_client.post(
        "/api/question-bank/sources",
        json={"source_type": "exam", "name": "100X會考"},
        headers=h,
    ).json()
    assert pct["id"] != other["id"]

    # GET /sources?q=%_ 只命中字面含 "%_" 的那筆（未轉義時 "%_" 會配到全部）
    items = test_client.get(
        "/api/question-bank/sources", params={"q": "%_"}, headers=h
    ).json()["items"]
    assert [i["id"] for i in items] == [pct["id"]]

    # 題目列表用 q=%_ 搜來源，也只回掛在 "100%_會考" 的題
    q_pct = _create(test_client, teacher_a, stem="Pct source q", source_ids=[pct["id"]])
    _create(test_client, teacher_a, stem="Other source q", source_ids=[other["id"]])
    listing = test_client.get(
        "/api/question-bank/questions",
        params={"q": "%_", "only_own": "true"},
        headers=h,
    ).json()["items"]
    assert [x["id"] for x in listing] == [q_pct["id"]]

    # POST /sources 的「已存在」判斷是精確比對：底線不同就是新來源，不會回 100X會考
    underscore = test_client.post(
        "/api/question-bank/sources",
        json={"source_type": "exam", "name": "100_會考"},
        headers=h,
    ).json()
    assert underscore["id"] not in (pct["id"], other["id"])
    # 大小寫不同仍視為同一筆（不分大小寫精確比對）
    same = test_client.post(
        "/api/question-bank/sources",
        json={"source_type": "exam", "name": "100x會考"},
        headers=h,
    ).json()
    assert same["id"] == other["id"]


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
    # 不在 mine scope（機構題不是公開的）
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

    # B 加入為一般成員：可以新增到機構題庫，可刪改自己建的；別人建的不能改（需擁有人或管理權限）
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
    assert q_b["can_edit"] is True
    # B 改自己建的機構題：可以
    assert (
        test_client.patch(
            f"/api/question-bank/questions/{q_b['id']}",
            json={"explanation": "member edit"},
            headers=_headers(teacher_b),
        ).status_code
        == 200
    )
    # B 改／刪 A（擁有人）建的機構題：不行；列表 can_edit 也要對應
    assert (
        test_client.patch(
            f"/api/question-bank/questions/{q['id']}",
            json={"explanation": "member edits owner question"},
            headers=_headers(teacher_b),
        ).status_code
        == 403
    )
    assert (
        test_client.delete(
            f"/api/question-bank/questions/{q['id']}", headers=_headers(teacher_b)
        ).status_code
        == 403
    )
    org_list_b = {
        i["id"]: i
        for i in test_client.get(
            "/api/question-bank/questions",
            params={"scope": "organization", "organization_id": str(org.id)},
            headers=_headers(teacher_b),
        ).json()["items"]
    }
    assert org_list_b[q_b["id"]]["can_edit"] is True
    assert org_list_b[q["id"]]["can_edit"] is False
    # A 是 org_owner：可以編輯成員建的題，列表 can_edit 全 True
    assert (
        test_client.patch(
            f"/api/question-bank/questions/{q_b['id']}",
            json={"explanation": "owner edit"},
            headers=_headers(teacher_a),
        ).status_code
        == 200
    )
    org_list_a = test_client.get(
        "/api/question-bank/questions",
        params={"scope": "organization", "organization_id": str(org.id)},
        headers=_headers(teacher_a),
    ).json()["items"]
    assert all(i["can_edit"] for i in org_list_a if i["id"] in (q["id"], q_b["id"]))
    # B 刪自己建的機構題：可以
    assert (
        test_client.delete(
            f"/api/question-bank/questions/{q_b['id']}", headers=_headers(teacher_b)
        ).status_code
        == 204
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


def test_list_scope_includes_public_unless_only_own(
    test_client, shared_test_session, teacher_a, teacher_b
):
    """mine / organization 預設含所有公開題（只讀）；only_own=true 只留自己的／機構的。"""
    mine = _create(test_client, teacher_a, stem="A private")
    other_public = _create(test_client, teacher_b, stem="B public", visibility="public")
    _create(test_client, teacher_b, stem="B private")

    def ids(**params):
        return {
            i["id"]: i["is_owner"]
            for i in test_client.get(
                "/api/question-bank/questions",
                params={"scope": "mine", **params},
                headers=_headers(teacher_a),
            ).json()["items"]
        }

    got = ids()
    assert got[mine["id"]] is True and got[other_public["id"]] is False
    assert len(got) == 2
    assert set(ids(only_own="true")) == {mine["id"]}

    # organization scope 同理
    org = Organization(id=uuid.uuid4(), name="Scope Org")
    shared_test_session.add(org)
    shared_test_session.flush()
    shared_test_session.add(
        TeacherOrganization(
            teacher_id=teacher_a.id, organization_id=org.id, role="org_owner"
        )
    )
    shared_test_session.commit()
    org_q = _create(
        test_client, teacher_a, stem="Org question", organization_id=str(org.id)
    )
    org_ids = {
        i["id"]
        for i in test_client.get(
            "/api/question-bank/questions",
            params={"scope": "organization", "organization_id": str(org.id)},
            headers=_headers(teacher_a),
        ).json()["items"]
    }
    assert org_ids == {org_q["id"], other_public["id"]}
    org_only = {
        i["id"]
        for i in test_client.get(
            "/api/question-bank/questions",
            params={
                "scope": "organization",
                "organization_id": str(org.id),
                "only_own": "true",
            },
            headers=_headers(teacher_a),
        ).json()["items"]
    }
    assert org_only == {org_q["id"]}


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
        {
            "program_id": program.id,
            "lesson_id": None,
            "program_name": program.name,
            "lesson_name": None,
        }
    ]


def test_program_links_carry_names(test_client, shared_test_session, teacher_a):
    """單題列表的 program_links 帶教材包／單元名稱（列表「教材」欄用）。"""
    from tests.factories import TestDataFactory

    program = TestDataFactory.create_program(
        shared_test_session, teacher_a, name="國中會考總複習"
    )
    lesson = TestDataFactory.create_lesson(
        shared_test_session, program, name="Unit 3 時態"
    )
    q = _create(test_client, teacher_a, stem="Named links")
    resp = test_client.put(
        f"/api/question-bank/questions/{q['id']}/program-links",
        json={"program_links": [{"program_id": program.id, "lesson_id": lesson.id}]},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 200, resp.text

    listing = test_client.get(
        "/api/question-bank/questions", headers=_headers(teacher_a)
    ).json()
    (row,) = [i for i in listing["items"] if i["id"] == q["id"]]
    assert row["program_links"] == [
        {
            "program_id": program.id,
            "lesson_id": lesson.id,
            "program_name": "國中會考總複習",
            "lesson_name": "Unit 3 時態",
        }
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
    # 同時掛兩個考點的題：雙選只出現一次、total 不重複計數（IN 子查詢不 join）
    q_both = _create(
        test_client, teacher_a, stem="Both points", exam_point_ids=[pp, vocab]
    )
    both = test_client.get(
        "/api/question-bank/questions",
        params={"exam_point_ids": [pp, vocab]},
        headers=_headers(teacher_a),
    ).json()
    assert [i["id"] for i in both["items"]].count(q_both["id"]) == 1
    assert both["total"] == 3

    # 分頁
    page = test_client.get(
        "/api/question-bank/questions",
        params={"page": 1, "page_size": 2},
        headers=_headers(teacher_a),
    ).json()
    assert page["total"] == 4 and len(page["items"]) == 2


# ---------------------------------------------------------------- 題組（#1082 骨架）


def _group_payload(**overrides):
    payload = {
        "question_type": "reading",
        "stimulus_type": "passage",
        "title": "Vivaldi",
        "passage_text": "Antonio Vivaldi was a violin player with red hair.",
        "layout": {
            "version": 1,
            "rows": [
                {
                    "columns": [
                        {
                            "span": 1,
                            "blocks": [
                                {
                                    "type": "paragraph",
                                    "text": "Antonio Vivaldi was a violin player.",
                                }
                            ],
                        }
                    ]
                }
            ],
        },
        "glossary": [{"word": "timeline", "zh": "時間軸"}],
        "grade_min": 7,
        "grade_max": 9,
        "visibility": "private",
        "questions": [
            {
                "stem": "Which is the best title for the reading?",
                "options": [
                    {"text": "Vivaldi Life Story", "is_correct": True},
                    {"text": "Vivaldi and His Students"},
                ],
            },
            {
                "stem": "According to the reading, which is WRONG?",
                "options": [
                    {"text": "He had red hair."},
                    {"text": "He never played the violin.", "is_correct": True},
                ],
            },
        ],
    }
    payload.update(overrides)
    return payload


def _create_group(client, teacher, **kw):
    resp = client.post(
        "/api/question-bank/question-groups",
        json=_group_payload(**kw),
        headers=_headers(teacher),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_create_question_group_one_transaction(test_client, teacher_a, exam_points):
    pp = exam_points["present_perfect"].id
    payload = _group_payload()
    payload["questions"][0]["exam_point_ids"] = [pp]
    resp = test_client.post(
        "/api/question-bank/question-groups",
        json=payload,
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 201, resp.text
    g = resp.json()
    assert g["question_type"] == "reading"
    assert g["stimulus_type"] == "passage"
    assert g["layout"]["rows"][0]["columns"][0]["blocks"][0]["type"] == "paragraph"
    assert g["glossary"] == [{"word": "timeline", "zh": "時間軸"}]
    assert g["is_owner"] is True and g["can_edit"] is True
    assert [q["group_order"] for q in g["questions"]] == [0, 1]
    # 小題跟隨題組：題型、公開、年段、group_id
    for q in g["questions"]:
        assert q["question_type"] == "reading"
        assert q["visibility"] == "private"
        assert q["group_id"] == g["id"]
        assert (q["grade_min"], q["grade_max"]) == (7, 9)
    assert [ep["id"] for ep in g["questions"][0]["exam_points"]] == [pp]

    # GET 回同一份
    got = test_client.get(
        f"/api/question-bank/question-groups/{g['id']}", headers=_headers(teacher_a)
    )
    assert got.status_code == 200
    assert [q["id"] for q in got.json()["questions"]] == [
        q["id"] for q in g["questions"]
    ]

    # 小題不出現在單題列表；題組以 kind=group 一列出現
    listing = test_client.get(
        "/api/question-bank/questions", headers=_headers(teacher_a)
    ).json()
    assert listing["total"] == 1
    (row,) = listing["items"]
    assert row["kind"] == "group"
    assert row["id"] == g["id"]
    assert row["question_count"] == 2
    assert row["question_type"] == "reading"
    assert row["title"] == "Vivaldi"


def test_group_row_program_links_union(test_client, shared_test_session, teacher_a):
    """題組列的 program_links＝小題關聯的聯集（去重、帶名稱）。"""
    from tests.factories import TestDataFactory

    program = TestDataFactory.create_program(
        shared_test_session, teacher_a, name="閱讀教材"
    )
    lesson = TestDataFactory.create_lesson(
        shared_test_session, program, name="Unit 1 音樂家"
    )
    g = _create_group(test_client, teacher_a)
    q1, q2 = g["questions"]
    for qid, links in (
        (q1["id"], [{"program_id": program.id, "lesson_id": lesson.id}]),
        (
            q2["id"],
            [
                {"program_id": program.id, "lesson_id": lesson.id},  # 與 q1 重複
                {"program_id": program.id},  # 只掛教材包
            ],
        ),
    ):
        resp = test_client.put(
            f"/api/question-bank/questions/{qid}/program-links",
            json={"program_links": links},
            headers=_headers(teacher_a),
        )
        assert resp.status_code == 200, resp.text

    listing = test_client.get(
        "/api/question-bank/questions", headers=_headers(teacher_a)
    ).json()
    (row,) = [
        i for i in listing["items"] if i["kind"] == "group" and i["id"] == g["id"]
    ]
    assert row["program_links"] == [
        {
            "program_id": program.id,
            "lesson_id": lesson.id,
            "program_name": "閱讀教材",
            "lesson_name": "Unit 1 音樂家",
        },
        {
            "program_id": program.id,
            "lesson_id": None,
            "program_name": "閱讀教材",
            "lesson_name": None,
        },
    ]


def _count_queries(engine):
    """SQLAlchemy 查詢計數 context manager（專案沒有 assertNumQueries 等工具）。"""
    import contextlib

    from sqlalchemy import event

    @contextlib.contextmanager
    def _ctx():
        counter = {"n": 0}

        def _on_exec(conn, cursor, statement, parameters, context, executemany):
            counter["n"] += 1

        event.listen(engine, "before_cursor_execute", _on_exec)
        try:
            yield counter
        finally:
            event.remove(engine, "before_cursor_execute", _on_exec)

    return _ctx()


def _group_with_program_links(client, session, teacher, n_questions: int):
    """建一個 n 小題的題組，每個小題各掛一組教材關聯，回傳題組 id。"""
    from tests.factories import TestDataFactory

    program = TestDataFactory.create_program(session, teacher, name=f"教材{n_questions}")
    questions = [
        {
            "stem": f"Question {i}?",
            "options": [
                {"text": "right", "is_correct": True},
                {"text": "wrong"},
            ],
        }
        for i in range(n_questions)
    ]
    g = _create_group(client, teacher, questions=questions)
    for q in g["questions"]:
        lesson = TestDataFactory.create_lesson(session, program, name=f"Unit {q['id']}")
        resp = client.put(
            f"/api/question-bank/questions/{q['id']}/program-links",
            json={
                "program_links": [
                    {"program_id": program.id, "lesson_id": lesson.id},
                    {"program_id": program.id},
                ]
            },
            headers=_headers(teacher),
        )
        assert resp.status_code == 200, resp.text
    return g["id"]


def test_group_detail_query_count_is_constant(
    test_client, shared_test_session, test_engine, teacher_a
):
    """題組詳情的查詢數不隨小題數增加（program/lesson 名稱已 selectinload 預載）。"""
    small_id = _group_with_program_links(test_client, shared_test_session, teacher_a, 2)
    large_id = _group_with_program_links(test_client, shared_test_session, teacher_a, 8)

    counts = {}
    for label, gid in (("small", small_id), ("large", large_id)):
        with _count_queries(test_engine) as counter:
            resp = test_client.get(
                f"/api/question-bank/question-groups/{gid}",
                headers=_headers(teacher_a),
            )
            assert resp.status_code == 200, resp.text
            assert len(resp.json()["questions"]) == (2 if label == "small" else 8)
        counts[label] = counter["n"]

    assert counts["small"] == counts["large"], counts


def test_create_question_group_validation(test_client, teacher_a):
    # 沒有小題
    resp = test_client.post(
        "/api/question-bank/question-groups",
        json=_group_payload(questions=[]),
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422
    # 沒有文章／圖片／排版
    resp = test_client.post(
        "/api/question-bank/question-groups",
        json=_group_payload(passage_text=None, layout=None, image_url=None),
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422
    # layout.rows 不是陣列
    resp = test_client.post(
        "/api/question-bank/question-groups",
        json=_group_payload(layout={"version": 1, "rows": "x"}),
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422
    # 小題沒勾正確答案
    bad = _group_payload()
    bad["questions"][1]["options"] = [{"text": "a"}, {"text": "b"}]
    resp = test_client.post(
        "/api/question-bank/question-groups", json=bad, headers=_headers(teacher_a)
    )
    assert resp.status_code == 422
    # 單題端點不收 reading
    resp = test_client.post(
        "/api/question-bank/questions",
        json=_mc_payload(question_type="reading"),
        headers=_headers(teacher_a),
    )
    assert resp.status_code in (400, 422)


def test_create_question_group_rollback_on_failure(
    test_client, shared_test_session, teacher_a, monkeypatch
):
    """第二個小題處理時炸掉 → 整組（group + 第一個小題）都不能留下。"""
    import routers.question_bank as router_module

    calls = {"n": 0}
    original = router_module.qbs.replace_sources

    def boom(db, question, teacher, source_ids):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("boom")
        return original(db, question, teacher, source_ids)

    monkeypatch.setattr(router_module.qbs, "replace_sources", boom)
    with pytest.raises(RuntimeError):
        test_client.post(
            "/api/question-bank/question-groups",
            json=_group_payload(),
            headers=_headers(teacher_a),
        )
    s = shared_test_session
    assert s.query(QuestionGroup).count() == 0
    assert s.query(Question).count() == 0


def test_question_group_visibility_and_membership(
    test_client, shared_test_session, teacher_a, teacher_b
):
    s = shared_test_session
    org = Organization(id=uuid.uuid4(), name="QB Org G")
    s.add(org)
    s.flush()
    s.add(
        TeacherOrganization(
            teacher_id=teacher_a.id, organization_id=org.id, role="org_owner"
        )
    )
    s.commit()

    private_g = _create_group(test_client, teacher_a, title="A private")
    public_g = _create_group(
        test_client, teacher_a, title="A public", visibility="public"
    )
    org_g = _create_group(
        test_client, teacher_a, title="Org group", organization_id=str(org.id)
    )
    assert org_g["organization_id"] == str(org.id)

    # B 看得到 public，看不到 private／機構
    assert (
        test_client.get(
            f"/api/question-bank/question-groups/{public_g['id']}",
            headers=_headers(teacher_b),
        ).status_code
        == 200
    )
    for gid in (private_g["id"], org_g["id"]):
        assert (
            test_client.get(
                f"/api/question-bank/question-groups/{gid}",
                headers=_headers(teacher_b),
            ).status_code
            == 404
        )
    listing_b = test_client.get(
        "/api/question-bank/questions", headers=_headers(teacher_b)
    ).json()
    assert {i["id"] for i in listing_b["items"]} == {public_g["id"]}
    assert listing_b["items"][0]["is_owner"] is False
    assert listing_b["items"][0]["can_edit"] is False

    # B 不是機構成員：不能建到機構題庫
    resp = test_client.post(
        "/api/question-bank/question-groups",
        json=_group_payload(organization_id=str(org.id)),
        headers=_headers(teacher_b),
    )
    assert resp.status_code == 403

    # organization scope 只列機構的（only_own）
    org_list = test_client.get(
        "/api/question-bank/questions",
        params={
            "scope": "organization",
            "organization_id": str(org.id),
            "only_own": True,
        },
        headers=_headers(teacher_a),
    ).json()
    assert {i["id"] for i in org_list["items"]} == {org_g["id"]}


def test_list_mixed_singles_and_groups(test_client, teacher_a, exam_points):
    pp = exam_points["present_perfect"].id
    single = _create(
        test_client, teacher_a, stem="Single question here", grade_min=3, grade_max=5
    )
    g = _group_payload(title="Group with point", grade_min=10, grade_max=12)
    g["questions"][0]["exam_point_ids"] = [pp]
    g["questions"][0]["stem"] = "Group stem about Vivaldi music"
    group = _create_group(test_client, teacher_a, **g)

    def rows(**params):
        res = test_client.get(
            "/api/question-bank/questions", params=params, headers=_headers(teacher_a)
        ).json()
        return res["total"], [(i.get("kind", "single"), i["id"]) for i in res["items"]]

    total, items = rows()
    assert total == 2
    assert set(items) == {("single", single["id"]), ("group", group["id"])}
    # 題型 filter
    assert rows(question_type="reading")[1] == [("group", group["id"])]
    assert rows(question_type="multiple_choice")[1] == [("single", single["id"])]
    # 考點 filter 看小題
    assert rows(exam_point_ids=[pp])[1] == [("group", group["id"])]
    # 年級看題組
    assert rows(grade_min=11)[1] == [("group", group["id"])]
    assert rows(grade_max=5)[1] == [("single", single["id"])]
    # 關鍵字：題組標題／文章／小題題幹都算
    assert rows(q="Group with point")[1] == [("group", group["id"])]
    assert rows(q="vivaldi music")[1] == [("group", group["id"])]
    assert rows(q="single question")[1] == [("single", single["id"])]
    # 分頁：page_size=1 兩頁各一列、不重複
    t1, p1 = rows(page=1, page_size=1)
    t2, p2 = rows(page=2, page_size=1)
    assert t1 == t2 == 2
    assert len(p1) == len(p2) == 1 and p1 != p2


def test_list_merged_pagination_deep_page(test_client, teacher_a):
    """SQL 層合併分頁：5 單題 + 2 題組，page_size=3 → 三頁 3/3/1，不重複不遺漏，順序穩定。"""
    for i in range(5):
        _create(test_client, teacher_a, stem=f"Deep page single {i}")
    for i in range(2):
        _create_group(test_client, teacher_a, **_group_payload(title=f"Deep group {i}"))

    def rows(page):
        res = test_client.get(
            "/api/question-bank/questions",
            params={"page": page, "page_size": 3},
            headers=_headers(teacher_a),
        ).json()
        assert res["total"] == 7
        return [(i.get("kind", "single"), i["id"]) for i in res["items"]]

    p1, p2, p3, p4 = rows(1), rows(2), rows(3), rows(4)
    assert len(p1) == 3 and len(p2) == 3 and len(p3) == 1 and p4 == []
    all_rows = p1 + p2 + p3
    assert len(set(all_rows)) == 7
    assert {k for k, _ in all_rows} == {"single", "group"}
    # 同一頁重打結果一致（排序穩定）
    assert rows(3) == p3


# ---------------------------------------------------------------- 題組 PATCH / DELETE（#1082）


def test_create_group_derives_passage_text_and_validates_layout(test_client, teacher_a):
    # 沒給 passage_text → 由 layout 文字區塊拼出純文字副本
    g = _create_group(test_client, teacher_a, passage_text=None)
    assert g["passage_text"] == "Antonio Vivaldi was a violin player."
    # layout 深度驗證：壞的區塊要回 422 並指出路徑
    bad = _group_payload(
        layout={
            "version": 1,
            "rows": [{"columns": [{"span": 1, "blocks": [{"type": "video"}]}]}],
        }
    )
    resp = test_client.post(
        "/api/question-bank/question-groups", json=bad, headers=_headers(teacher_a)
    )
    assert resp.status_code == 422
    assert "layout.rows[0].columns[0].blocks[0].type" in resp.text
    bad = _group_payload(glossary=[{"word": "x"}])
    resp = test_client.post(
        "/api/question-bank/question-groups", json=bad, headers=_headers(teacher_a)
    )
    assert resp.status_code == 422
    assert "glossary[0].zh" in resp.text


def test_patch_group_upserts_questions_in_one_transaction(
    test_client, shared_test_session, teacher_a, teacher_b, exam_points
):
    g = _create_group(test_client, teacher_a)
    q1, q2 = g["questions"]
    pp = exam_points["present_perfect"].id

    # 更新 q2、刪 q1、新增 q3；改標題與 layout（passage_text 重拼）；公開改 public
    payload = {
        "title": "Vivaldi v2",
        "visibility": "public",
        "layout": {
            "version": 1,
            "rows": [
                {
                    "columns": [
                        {
                            "span": 1,
                            "blocks": [
                                {"type": "heading", "level": 2, "text": "Vivaldi"},
                                {
                                    "type": "paragraph",
                                    "text": "He wrote **500** pieces.",
                                },
                            ],
                        }
                    ]
                }
            ],
        },
        "questions": [
            {
                "id": q2["id"],
                "stem": "Updated second question?",
                "options": [
                    {"text": "yes", "is_correct": True},
                    {"text": "no"},
                ],
                "exam_point_ids": [pp],
            },
            {
                "stem": "Brand new third question?",
                "options": [{"text": "a", "is_correct": True}, {"text": "b"}],
            },
        ],
    }
    resp = test_client.patch(
        f"/api/question-bank/question-groups/{g['id']}",
        json=payload,
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["title"] == "Vivaldi v2"
    assert out["passage_text"] == "Vivaldi\n\nHe wrote 500 pieces."
    assert [q["stem"] for q in out["questions"]] == [
        "Updated second question?",
        "Brand new third question?",
    ]
    assert [q["group_order"] for q in out["questions"]] == [0, 1]
    assert out["questions"][0]["id"] == q2["id"]
    assert [ep["id"] for ep in out["questions"][0]["exam_points"]] == [pp]
    # 小題公開跟隨題組
    assert all(q["visibility"] == "public" for q in out["questions"])
    # q1 軟刪除
    s = shared_test_session
    s.expire_all()
    old = s.query(Question).filter(Question.id == q1["id"]).one()
    assert old.is_active is False and old.deleted_at is not None
    # 老師 B 現在看得到（public）但不能改
    assert (
        test_client.patch(
            f"/api/question-bank/question-groups/{g['id']}",
            json={"title": "hack"},
            headers=_headers(teacher_b),
        ).status_code
        == 403
    )
    # 別組的小題 id → 422
    other = _create_group(test_client, teacher_a, title="Other")
    resp = test_client.patch(
        f"/api/question-bank/question-groups/{g['id']}",
        json={
            "questions": [
                {
                    "id": other["questions"][0]["id"],
                    "stem": "x",
                    "options": [{"text": "a", "is_correct": True}, {"text": "b"}],
                }
            ]
        },
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422
    # 壞 layout → 422 且不留下半套改動
    resp = test_client.patch(
        f"/api/question-bank/question-groups/{g['id']}",
        json={"title": "should not persist", "layout": {"version": 1, "rows": "x"}},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422
    assert (
        test_client.get(
            f"/api/question-bank/question-groups/{g['id']}",
            headers=_headers(teacher_a),
        ).json()["title"]
        == "Vivaldi v2"
    )


def test_delete_group_soft_deletes_questions(
    test_client, shared_test_session, teacher_a, teacher_b
):
    g = _create_group(test_client, teacher_a)
    assert (
        test_client.delete(
            f"/api/question-bank/question-groups/{g['id']}",
            headers=_headers(teacher_b),
        ).status_code
        == 404
    )
    resp = test_client.delete(
        f"/api/question-bank/question-groups/{g['id']}", headers=_headers(teacher_a)
    )
    assert resp.status_code == 204
    assert (
        test_client.get(
            f"/api/question-bank/question-groups/{g['id']}",
            headers=_headers(teacher_a),
        ).status_code
        == 404
    )
    listing = test_client.get(
        "/api/question-bank/questions", headers=_headers(teacher_a)
    ).json()
    assert listing["total"] == 0
    s = shared_test_session
    s.expire_all()
    assert all(
        q.is_active is False
        for q in s.query(Question).filter(Question.group_id == g["id"]).all()
    )


# ---------------------------------------------------------------- 以圖為準（#1083）


def _image_layout(url="http://x/poster.png"):
    return {
        "version": 1,
        "rows": [
            {
                "columns": [
                    {
                        "span": 1,
                        "blocks": [{"type": "image", "url": url, "align": "center"}],
                    }
                ]
            }
        ],
    }


def test_create_image_only_group_stores_image_stimulus(test_client, teacher_a):
    # 海報／漫畫：layout 只有一張圖；推導不出文字 → passage_text 為空
    g = _create_group(
        test_client,
        teacher_a,
        stimulus_type="image",
        passage_text=None,
        layout=_image_layout(),
    )
    assert g["stimulus_type"] == "image"
    assert g["passage_text"] is None
    assert g["layout"]["rows"][0]["columns"][0]["blocks"][0]["type"] == "image"


def test_teacher_passage_text_wins_over_layout_derivation(test_client, teacher_a):
    # 文字版：有送 passage_text 就存老師的（搜尋與 AI 用），不被 layout 推導覆蓋
    g = _create_group(
        test_client,
        teacher_a,
        stimulus_type="image",
        passage_text="Happy Town Lantern Festival 2026\nDate: February 28",
        layout=_image_layout(),
    )
    assert g["passage_text"] == "Happy Town Lantern Festival 2026\nDate: February 28"
    # 列表關鍵字搜尋能命中文字版
    page = test_client.get(
        "/api/question-bank/questions",
        params={"q": "Lantern Festival"},
        headers=_headers(teacher_a),
    ).json()
    assert any(
        row.get("kind") == "group" and row["id"] == g["id"] for row in page["items"]
    )
    # PATCH 只送 layout（不送 passage_text）→ 依現行規則重推導（前端一律兩者都送，鎖住行為）
    resp = test_client.patch(
        f"/api/question-bank/question-groups/{g['id']}",
        json={"layout": _group_payload()["layout"]},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["passage_text"] == "Antonio Vivaldi was a violin player."
    # PATCH 兩者都送 → 老師的
    resp = test_client.patch(
        f"/api/question-bank/question-groups/{g['id']}",
        json={"layout": _group_payload()["layout"], "passage_text": "teacher copy"},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["passage_text"] == "teacher copy"


def test_sub_question_with_image_and_empty_stem(test_client, teacher_a):
    # 題本 33 題：題幹是一張文氏圖，文字可空
    questions = [
        {
            "stem": "",
            "image_url": "http://x/venn.png",
            "options": [
                {"text": "A new soccer player", "is_correct": True},
                {"text": "Very confident in himself"},
            ],
        }
    ]
    g = _create_group(test_client, teacher_a, questions=questions)
    q = g["questions"][0]
    assert q["stem"] == ""
    assert q["image_url"] == "http://x/venn.png"
    # 題組小題沒題幹也沒圖同樣放行（#1085）：題幹在題組的文章裡，
    # 克漏字小題更是只有選項。單題端點才要求素材（見下一個測試）。
    plain = _group_payload(
        questions=[
            {
                "stem": "",
                "options": [{"text": "a", "is_correct": True}, {"text": "b"}],
            }
        ]
    )
    resp = test_client.post(
        "/api/question-bank/question-groups", json=plain, headers=_headers(teacher_a)
    )
    assert resp.status_code == 201, resp.text


def test_single_question_still_requires_stem_or_image(test_client, teacher_a):
    """單題端點維持原規則：題幹／圖片／語音至少一個。"""
    resp = test_client.post(
        "/api/question-bank/questions",
        json={
            "stem": "",
            "options": [{"text": "a", "is_correct": True}, {"text": "b"}],
        },
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------- PR #1109 本機補審修正


def test_list_new_group_sorts_before_older_unedited_singles(
    test_client, teacher_a, shared_test_session
):
    """新建的列 updated_at 是 NULL：排序要 fallback 到 created_at，新題組才不會沉到最後一頁。"""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import text

    singles = [
        _create(test_client, teacher_a, stem=f"Old single {i}") for i in range(3)
    ]
    g = _create_group(test_client, teacher_a, **_group_payload(title="Fresh group"))
    # 用原生 SQL：ORM bulk update 會觸發 onupdate 把 updated_at 也填上
    old = datetime.now(timezone.utc) - timedelta(days=1)
    for s in singles:
        shared_test_session.execute(
            text(
                "UPDATE questions SET created_at = :t, updated_at = NULL WHERE id = :i"
            ),
            {"t": old, "i": s["id"]},
        )
    shared_test_session.execute(
        text("UPDATE question_groups SET updated_at = NULL WHERE id = :i"),
        {"i": g["id"]},
    )
    shared_test_session.commit()

    first = test_client.get(
        "/api/question-bank/questions",
        params={"page": 1, "page_size": 1},
        headers=_headers(teacher_a),
    ).json()["items"][0]
    assert (first.get("kind"), first["id"]) == ("group", g["id"])


def test_single_endpoints_reject_group_subquestion(test_client, teacher_a):
    """小題的公開／年段／歸屬跟隨題組：單題 PATCH／DELETE 不可直接改。"""
    g = _create_group(test_client, teacher_a)
    qid = g["questions"][0]["id"]
    resp = test_client.patch(
        f"/api/question-bank/questions/{qid}",
        json={"visibility": "public"},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422
    assert "題組內編輯" in resp.text
    resp = test_client.delete(
        f"/api/question-bank/questions/{qid}", headers=_headers(teacher_a)
    )
    assert resp.status_code == 422
    assert "題組內刪除" in resp.text


def test_group_subquestion_grade_conflict_is_422_not_500(test_client, teacher_a):
    """小題只自訂一邊年段、另一邊繼承題組，合起來 min > max → 422（不是 DB CHECK 的 500）。"""
    payload = _group_payload()  # 題組 7～9
    payload["questions"][0]["grade_max"] = 5
    resp = test_client.post(
        "/api/question-bank/question-groups",
        json=payload,
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422, resp.text

    g = _create_group(test_client, teacher_a)
    questions = [
        {
            "id": q["id"],
            "stem": q["stem"],
            "grade_max": 5,
            "options": [
                {"text": o["text"], "is_correct": o["is_correct"]} for o in q["options"]
            ],
        }
        for q in g["questions"]
    ]
    resp = test_client.patch(
        f"/api/question-bank/question-groups/{g['id']}",
        json={"questions": questions},
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422, resp.text


def test_group_inverted_grade_with_segments_is_422(test_client, teacher_a):
    """題組年段反轉要在 segments flush 之前擋下。"""
    g = _create_group(test_client, teacher_a)
    resp = test_client.patch(
        f"/api/question-bank/question-groups/{g['id']}",
        json={
            "grade_min": 9,
            "grade_max": 7,
            "segments": [{"speaker_label": "A", "transcript": "Hi."}],
        },
        headers=_headers(teacher_a),
    )
    assert resp.status_code == 422, resp.text

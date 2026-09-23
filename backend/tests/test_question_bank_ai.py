"""
題庫 AI 工具測試（Issue #1065）。AI 全程 mock（monkeypatch service 的 generate）。

- 輸入整理：>20 題、缺題幹、選項不足、key 重複 → 400
- AI 作答：index 越界／空／key 對不上 → 該題 skipped；正常題回 correct_indexes + explanation
- AI 考點分析：code 不在清單被丟；proposed 新考點建成 pending 且不重複建、不回前端；年段夾在 1–12
- #1077：同批兩題提議同一新考點只建一筆；純中文 slug 用 md5 穩定
- 端點：未登入 401；AI 例外 → 502；魔術貼上 multiple_choice 正規化
"""

import hashlib

import pytest

from auth import create_access_token, get_password_hash
from models import ExamPoint, ExamPointAlias, Teacher
from services import question_bank_ai as qbai
from services.magic_paste_service import MagicPasteService


# ---------------------------------------------------------------- fixtures


def _make_teacher(session, email):
    t = Teacher(
        email=email,
        password_hash=get_password_hash("test123"),
        name="ai",
        is_active=True,
        is_demo=False,
        email_verified=True,
    )
    session.add(t)
    session.commit()
    session.refresh(t)
    return t


def _headers(teacher):
    token = create_access_token(data={"sub": str(teacher.id), "type": "teacher"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def teacher(shared_test_session):
    return _make_teacher(shared_test_session, "qb_ai@duotopia.com")


@pytest.fixture
def exam_points(shared_test_session):
    s = shared_test_session
    pp = ExamPoint(
        code="grammar.tense.present_perfect",
        names={"zh-TW": "現在完成式", "en": "Present Perfect"},
    )
    vocab = ExamPoint(code="vocab.meaning", names={"zh-TW": "字義", "en": "Word Meaning"})
    s.add_all([pp, vocab])
    s.flush()
    s.add(ExamPointAlias(exam_point_id=pp.id, alias="現完式", lang="zh-TW"))
    s.commit()
    return {"pp": pp, "vocab": vocab}


def _q(key="q1", stem="I ___ never been to Japan.", options=("have", "has", "had")):
    return {"key": key, "stem": stem, "options": list(options)}


def _fake_generate(payload):
    async def gen(self, prompt, max_tokens):
        return payload

    return gen


# ---------------------------------------------------------------- normalize_inputs


def test_normalize_inputs_rules():
    with pytest.raises(qbai.QuestionBankAIError):
        qbai.normalize_inputs([])
    with pytest.raises(qbai.QuestionBankAIError):
        qbai.normalize_inputs([_q(key=f"k{i}") for i in range(21)])
    with pytest.raises(qbai.QuestionBankAIError):
        qbai.normalize_inputs([_q(stem="   ")])
    with pytest.raises(qbai.QuestionBankAIError):
        qbai.normalize_inputs([_q(options=("only",))])
    with pytest.raises(qbai.QuestionBankAIError):
        qbai.normalize_inputs([_q(key="a"), _q(key="a")])
    items = qbai.normalize_inputs([_q(options=("a", "", "b"))])
    assert items[0].options == ["a", "b"]


# ---------------------------------------------------------------- answer


@pytest.mark.asyncio
async def test_answer_validates_each_result(monkeypatch):
    monkeypatch.setattr(
        qbai.QuestionBankAIService,
        "generate",
        _fake_generate(
            {
                "results": [
                    {
                        "key": "q1",
                        "correct_indexes": [0, 0],
                        "explanation": "have + p.p.",
                    },
                    {"key": "q2", "correct_indexes": [5], "explanation": "越界"},
                    {"key": "q3", "correct_indexes": [], "explanation": "空"},
                    {"key": "nope", "correct_indexes": [0]},
                ]
            }
        ),
    )
    items = qbai.normalize_inputs([_q("q1"), _q("q2"), _q("q3"), _q("q4")])
    results, skipped = await qbai.QuestionBankAIService().answer(items)
    assert [(r.key, r.correct_indexes, r.explanation) for r in results] == [
        ("q1", [0], "have + p.p.")
    ]
    assert skipped == ["q2", "q3", "q4"]


@pytest.mark.asyncio
async def test_answer_bad_shape_raises(monkeypatch):
    monkeypatch.setattr(
        qbai.QuestionBankAIService, "generate", _fake_generate({"oops": 1})
    )
    with pytest.raises(qbai.QuestionBankAIOutputError):
        await qbai.QuestionBankAIService().answer(qbai.normalize_inputs([_q()]))


# ---------------------------------------------------------------- analyze


@pytest.mark.asyncio
async def test_analyze_only_catalog_codes_and_pending_proposals(
    shared_test_session, exam_points, monkeypatch
):
    monkeypatch.setattr(
        qbai.QuestionBankAIService,
        "generate",
        _fake_generate(
            {
                "results": [
                    {
                        "key": "q1",
                        "exam_point_codes": [
                            "grammar.tense.present_perfect",
                            "made.up.code",
                            "grammar.tense.present_perfect",
                        ],
                        "grade_min": 9,
                        "grade_max": 7,
                        "proposed": [
                            {"zh_tw": "現完式", "en": "Present Perfect"},  # alias 命中 → 不建
                            {"zh_tw": "倒裝句", "en": "Inversion"},  # 新 → pending
                            {"zh_tw": "倒裝句", "en": "Inversion"},  # 重複 → 不再建
                        ],
                    },
                    {
                        "key": "q2",
                        "exam_point_codes": [],
                        "grade_min": 0,
                        "grade_max": 99,
                    },
                ]
            }
        ),
    )
    items = qbai.normalize_inputs([_q("q1"), _q("q2")])
    results, skipped = await qbai.QuestionBankAIService().analyze(
        shared_test_session, items
    )
    assert len(results) == 1 and results[0].key == "q1"
    # 清單裡的 + alias 比對到的既有 + 本次新建的 pending，都可掛
    pending_id = (
        shared_test_session.query(ExamPoint)
        .filter(ExamPoint.code == "pending.inversion")
        .one()
        .id
    )
    assert results[0].exam_point_ids == [exam_points["pp"].id, pending_id]
    assert (results[0].grade_min, results[0].grade_max) == (7, 9)  # 交換
    assert [p["code"] for p in results[0].proposed] == ["pending.inversion"]
    assert skipped == ["q2"]  # 沒 code、沒提議、年段無效

    pending = (
        shared_test_session.query(ExamPoint).filter(ExamPoint.status == "pending").all()
    )
    assert [p.code for p in pending] == ["pending.inversion"]
    assert pending[0].names == {"zh-TW": "倒裝句", "en": "Inversion"}


@pytest.mark.asyncio
async def test_analyze_same_new_proposal_across_questions_creates_once(
    shared_test_session, exam_points, monkeypatch
):
    """#1077：兩題提議同一個純中文新考點 → 只建一筆 pending，兩題掛同一 id。"""
    proposal = {"zh_tw": "假設語氣", "en": ""}
    monkeypatch.setattr(
        qbai.QuestionBankAIService,
        "generate",
        _fake_generate(
            {
                "results": [
                    {"key": "q1", "exam_point_codes": [], "proposed": [proposal]},
                    {"key": "q2", "exam_point_codes": [], "proposed": [proposal]},
                ]
            }
        ),
    )
    items = qbai.normalize_inputs([_q("q1"), _q("q2")])
    results, skipped = await qbai.QuestionBankAIService().analyze(
        shared_test_session, items
    )
    assert skipped == []
    expected_code = "pending." + qbai._slugify("假設語氣")
    pending = (
        shared_test_session.query(ExamPoint)
        .filter(ExamPoint.code == expected_code)
        .all()
    )
    assert len(pending) == 1
    assert [r.exam_point_ids for r in results] == [[pending[0].id], [pending[0].id]]
    # 只有第一題真的新建；第二題比對到同批剛建的 pending，不再建
    assert [p["code"] for p in results[0].proposed] == [expected_code]
    assert results[1].proposed == []


def test_slugify_chinese_is_stable():
    """#1077：純中文 slug 用 md5，跨呼叫／跨 process 一致。"""
    expected = "x" + hashlib.md5("現在完成式".encode("utf-8")).hexdigest()[:7]
    assert qbai._slugify("現在完成式") == expected
    assert qbai._slugify("現在完成式") == qbai._slugify("現在完成式")
    assert qbai._slugify("Present Perfect!") == "present_perfect"


@pytest.mark.asyncio
async def test_analyze_without_catalog_raises(shared_test_session, monkeypatch):
    monkeypatch.setattr(
        qbai.QuestionBankAIService, "generate", _fake_generate({"results": []})
    )
    with pytest.raises(qbai.QuestionBankAIError):
        await qbai.QuestionBankAIService().analyze(
            shared_test_session, qbai.normalize_inputs([_q()])
        )


# ---------------------------------------------------------------- endpoints


def test_ai_endpoints_require_auth(test_client):
    assert (
        test_client.post(
            "/api/question-bank/ai/answer", json={"questions": [_q()]}
        ).status_code
        == 401
    )


def test_ai_answer_endpoint(test_client, teacher, monkeypatch):
    monkeypatch.setattr(
        qbai.QuestionBankAIService,
        "generate",
        _fake_generate(
            {"results": [{"key": "q1", "correct_indexes": [0], "explanation": "ok"}]}
        ),
    )
    resp = test_client.post(
        "/api/question-bank/ai/answer",
        json={"questions": [_q("q1"), _q("q2")]},
        headers=_headers(teacher),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["results"] == [
        {"key": "q1", "correct_indexes": [0], "explanation": "ok"}
    ]
    assert body["skipped"] == ["q2"]

    # 超過 20 題 → 422（schema 擋）
    resp = test_client.post(
        "/api/question-bank/ai/answer",
        json={"questions": [_q(f"k{i}") for i in range(21)]},
        headers=_headers(teacher),
    )
    assert resp.status_code == 422


def test_ai_analyze_endpoint_serializes_points(
    test_client, teacher, exam_points, monkeypatch
):
    monkeypatch.setattr(
        qbai.QuestionBankAIService,
        "generate",
        _fake_generate(
            {
                "results": [
                    {
                        "key": "q1",
                        "exam_point_codes": ["vocab.meaning"],
                        "grade_min": 3,
                        "grade_max": 4,
                        "proposed": [{"zh_tw": "新東西", "en": "Something New"}],
                    }
                ]
            }
        ),
    )
    resp = test_client.post(
        "/api/question-bank/ai/analyze",
        json={"questions": [_q("q1")]},
        headers=_headers(teacher),
    )
    assert resp.status_code == 200, resp.text
    r = resp.json()["results"][0]
    assert r["grade_min"] == 3 and r["grade_max"] == 4
    assert "proposed" not in r  # 不另外標示待審
    # 提議建出的 pending 考點直接掛上，且出現在 picker 清單（外觀與正式相同）
    assert [ep["code"] for ep in r["exam_points"]] == [
        "vocab.meaning",
        "pending.something_new",
    ]
    listing = test_client.get(
        "/api/question-bank/exam-points", headers=_headers(teacher)
    ).json()["items"]
    assert any(i["code"] == "pending.something_new" for i in listing)


def test_ai_provider_failure_is_502(test_client, teacher, monkeypatch):
    async def boom(self, prompt, max_tokens):
        raise TimeoutError("slow")

    monkeypatch.setattr(qbai.QuestionBankAIService, "generate", boom)
    resp = test_client.post(
        "/api/question-bank/ai/answer",
        json={"questions": [_q()]},
        headers=_headers(teacher),
    )
    assert resp.status_code == 502


# ---------------------------------------------------------------- magic paste MC


def test_magic_paste_normalize_mc_items():
    raw = {
        "items": [
            {
                "stem": "1. I ___ never been to Japan.",
                "options": ["have", "has", "", "had"],
                "correct_indexes": [0, 7, "x", True],
                "explanation": "  have + p.p. ",
            },
            {"stem": "", "options": ["a", "b"]},
            {"stem": "only one option", "options": ["a"]},
            {
                "stem": "no answer printed",
                "options": ["a", "b"],
                "correct_indexes": None,
            },
            "junk",
        ]
    }
    items = MagicPasteService._normalize_mc_items(raw)
    assert items == [
        {
            "stem": "1. I ___ never been to Japan.",
            "options": ["have", "has", "had"],
            "correct_indexes": [0],
            "explanation": "have + p.p.",
        },
        {
            "stem": "no answer printed",
            "options": ["a", "b"],
            "correct_indexes": [],
            "explanation": "",
        },
    ]

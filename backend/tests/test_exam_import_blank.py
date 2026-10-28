"""
上傳題本匯入：C3 後端的測試（Issue #1112）。AI 呼叫與 GCS 一律 mock。

1. 標為空白頁：存頁圖、done、0 張卡、``blank_skipped``、不呼叫 AI、不記用量；只接受 pending；冪等；
   跨老師 404；空白頁算進已完成（整份可變 ready）；跨頁題組可以越過空白頁合併
2. 「仍要送出這一頁」：用存好的頁圖送 AI、不算重送次數；不是空白頁 409 ``EXAM_IMPORT_NOT_BLANK``；
   頁圖不見 409 ``EXAM_IMPORT_PAGE_IMAGE_MISSING``；送出後失敗就是一般失敗頁（再送才算重送）；
   跨過空白頁合併過的題組，空白頁送出後拆回重算、依頁碼順序（C3 review 4），合併紀錄不輸出
3. C2 剩下的低度修正：重試結果被丟掉時用量記失敗、換進卡片才記成功；報告腳本單頁克漏字重編 1..k
"""

from __future__ import annotations

import asyncio
import json

import pytest

from models import ExamImportPage, ExamImportUsage
from services import exam_import_storage
from services.exam_paper_service import CallUsage, ExamPaperService, PageExtraction
from tests.test_exam_import_api import (  # noqa: F401  (fixtures)
    BASE,
    _create,
    _hash,
    _headers,
    _page,
    _png,
    _q,
    _send,
    _single,
    fake_ai,
    other_teacher,
    teacher,
)


@pytest.fixture
def storage(monkeypatch):
    """存頁圖時把內容留下來，``read_page_image`` 讀得回來。"""
    files, deleted = {}, []

    def store(import_id, page_no, content, content_type):
        url = f"https://storage.example/exam_imports/{import_id}/page_{page_no}_{len(files)}.png"
        files[url] = (content, content_type)
        return url

    def read(import_id, image_url):
        return files.get(image_url)

    def delete(import_id):
        deleted.append(import_id)
        return 1

    monkeypatch.setattr(exam_import_storage, "store_page_image", store)
    monkeypatch.setattr(exam_import_storage, "read_page_image", read)
    monkeypatch.setattr(exam_import_storage, "delete_import_images", delete)
    return files


def _blank(client, teacher, import_id, page_no, image):
    return client.post(
        f"{BASE}/{import_id}/pages/{page_no}/blank",
        files={"file": ("page.png", image, "image/png")},
        headers=_headers(teacher),
    )


def _send_blank(client, teacher, import_id, page_no):
    return client.post(
        f"{BASE}/{import_id}/pages/{page_no}/send-blank", headers=_headers(teacher)
    )


def _get(client, teacher, import_id):
    return client.get(f"{BASE}/{import_id}", headers=_headers(teacher)).json()


def _usage(session):
    session.expire_all()
    return session.query(ExamImportUsage).order_by(ExamImportUsage.id).all()


def _page_row(session, import_id, page_no):
    session.expire_all()
    return (
        session.query(ExamImportPage)
        .filter_by(import_id=import_id, page_no=page_no)
        .one()
    )


# ---------------------------------------------------------------- 1. 標為空白頁


def test_mark_blank_page_skips_ai_and_usage(
    test_client, shared_test_session, teacher, fake_ai, storage
):
    imp = _create(test_client, teacher, pages=2).json()
    resp = _blank(test_client, teacher, imp["id"], 2, _png("blank"))
    assert resp.status_code == 200, resp.text
    page = resp.json()["page"]
    assert page["status"] == "done"
    assert page["blank_skipped"] is True
    assert page["cards"] == []
    assert page["image_url"] in storage
    assert page["resend_count"] == 0
    assert fake_ai.prompts == []
    assert _usage(shared_test_session) == []

    summary = resp.json()["import"]
    assert summary["pages_done"] == 1 and summary["pages_blank"] == 1
    # 繼續匯入時前端比對雜湊用
    assert summary["file_hash"] == _hash("paper")
    assert summary["status"] == "processing"

    # 另一頁處理完 → 整份 ready（空白頁算已完成）
    fake_ai.on(_png("p1"), _page(_single("1", "Q?", ["a", "b"], ai=[0])))
    assert _send(test_client, teacher, imp["id"], 1, _png("p1")).status_code == 200
    data = _get(test_client, teacher, imp["id"])
    assert data["status"] == "ready"
    assert data["pages_done"] == 2 and data["pages_blank"] == 1
    assert [p["blank_skipped"] for p in data["pages"]] == [False, True]
    assert data["question_count"] == 1


def test_mark_blank_only_pending_and_idempotent(test_client, teacher, fake_ai, storage):
    imp = _create(test_client, teacher, pages=2).json()
    fake_ai.on(_png("p1"), _page(_single("1", "Q?", ["a", "b"], ai=[0])))
    assert _send(test_client, teacher, imp["id"], 1, _png("p1")).status_code == 200
    resp = _blank(test_client, teacher, imp["id"], 1, _png("p1"))
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_PAGE_BUSY"

    assert _blank(test_client, teacher, imp["id"], 2, _png("b")).status_code == 200
    again = _blank(test_client, teacher, imp["id"], 2, _png("b"))
    assert again.status_code == 200
    assert again.json()["page"]["blank_skipped"] is True
    assert len(storage) == 2  # 第二次沒有再存一份頁圖（第 1 頁＋空白頁各一）


def test_blank_endpoints_other_teacher_404(
    test_client, teacher, other_teacher, fake_ai, storage
):
    imp = _create(test_client, teacher, pages=1).json()
    resp = _blank(test_client, other_teacher, imp["id"], 1, _png("b"))
    assert resp.status_code == 404
    assert _blank(test_client, teacher, imp["id"], 1, _png("b")).status_code == 200
    resp = _send_blank(test_client, other_teacher, imp["id"], 1)
    assert resp.status_code == 404
    assert fake_ai.prompts == []


def test_blank_page_rejects_non_image(test_client, teacher, storage):
    imp = _create(test_client, teacher, pages=1).json()
    resp = test_client.post(
        f"{BASE}/{imp['id']}/pages/1/blank",
        files={"file": ("page.pdf", b"%PDF-1.4 hello", "application/pdf")},
        headers=_headers(teacher),
    )
    assert resp.status_code == 400
    assert storage == {}


def test_cross_page_group_merges_across_blank_page(
    test_client, teacher, fake_ai, storage
):
    """題組在第 1 頁開始、第 2 頁空白略過、第 3 頁延續：空白頁標完後就接得上。"""
    imp = _create(test_client, teacher, pages=3).json()
    group = {
        "kind": "group",
        "group_type": "reading",
        "box_2d": [500, 50, 990, 950],
        "title": "Story",
        "stimulus": {"kind": "text", "paragraphs": ["Once upon a time."]},
        "questions": [_q("1", "Who?", ["a", "b"], ai=[0])],
    }
    cont = {
        "kind": "group",
        "group_type": "reading",
        "continues_previous": True,
        "box_2d": [0, 50, 300, 950],
        "stimulus": {"kind": "text", "paragraphs": ["The end."]},
        "questions": [_q("2", "Where?", ["c", "d"], ai=[1])],
    }
    fake_ai.on(_png("p1"), _page(group))
    fake_ai.on(_png("p3"), _page(cont))
    _send(test_client, teacher, imp["id"], 3, _png("p3"))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    # 第 2 頁還沒處理：先留著不併
    data = _get(test_client, teacher, imp["id"])
    assert len(data["pages"][2]["cards"]) == 1

    assert _blank(test_client, teacher, imp["id"], 2, _png("b")).status_code == 200
    data = _get(test_client, teacher, imp["id"])
    merged = data["pages"][0]["cards"][-1]
    assert merged["pages"] == [1, 3]
    assert [q["source_question_no"] for q in merged["group"]["questions"]] == [
        "1",
        "2",
    ]
    assert data["pages"][2]["cards"] == []
    assert data["status"] == "ready"


# ---------------------------------------------------------------- 2. 仍要送出這一頁


def test_send_blank_uses_stored_image_and_does_not_count_resend(
    test_client, shared_test_session, teacher, fake_ai, storage
):
    imp = _create(test_client, teacher, pages=1).json()
    image = _png("faint-page")
    assert _blank(test_client, teacher, imp["id"], 1, image).status_code == 200
    assert _get(test_client, teacher, imp["id"])["status"] == "ready"

    # AI 收到的是存好的頁圖（FakeAI 依頁圖內容回應；不是這張圖會 KeyError）
    fake_ai.on(image, _page(_single("1", "Faint?", ["a", "b"], ai=[1])))
    resp = _send_blank(test_client, teacher, imp["id"], 1)
    assert resp.status_code == 200, resp.text
    page = resp.json()["page"]
    assert page["status"] == "done"
    assert page["blank_skipped"] is False
    assert page["error"] is None
    assert page["resend_count"] == 0
    assert [c["question"]["source_question_no"] for c in page["cards"]] == ["1"]
    assert len(storage) == 1  # 沒有再存一份頁圖
    assert [(u.call_type, u.succeeded) for u in _usage(shared_test_session)] == [
        ("extract_page", True)
    ]
    data = _get(test_client, teacher, imp["id"])
    assert data["status"] == "ready" and data["pages_blank"] == 0
    assert data["question_count"] == 1

    # 已經不是空白頁：再按一次 → 409
    resp = _send_blank(test_client, teacher, imp["id"], 1)
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_NOT_BLANK"


def _reading_group(no, stem, *, cont=False, text="Text."):
    card = {
        "kind": "group",
        "group_type": "reading",
        "box_2d": [0, 50, 990, 950],
        "stimulus": {"kind": "text", "paragraphs": [text]},
        "questions": [_q(no, stem, ["a", "b"], ai=[0])],
    }
    if cont:
        card["continues_previous"] = True
    else:
        card["title"] = "Story"
    return card


def test_send_blank_remerges_cross_page_group_in_page_order(
    test_client, teacher, fake_ai, storage
):
    """第 2 頁誤判空白、第 3 頁已越過它併到第 1 頁；第 2 頁「仍要送出」後整組依 1→2→3 重新合併，
    之後才到的答案頁答案也要留著。"""
    imp = _create(test_client, teacher, pages=4).json()
    blank_image = _png("faint-2")
    fake_ai.on(_png("p1"), _page(_reading_group("1", "Who?", text="Part one.")))
    fake_ai.on(
        _png("p3"), _page(_reading_group("3", "When?", cont=True, text="Part three."))
    )
    fake_ai.on(
        _png("p4"),
        _page(answer_key=[{"no": "1", "answer": "B"}], is_answer_page=True),
    )
    fake_ai.on(
        blank_image,
        _page(_reading_group("2", "Where?", cont=True, text="Part two.")),
    )
    _send(test_client, teacher, imp["id"], 3, _png("p3"))
    _send(test_client, teacher, imp["id"], 1, _png("p1"))
    assert _blank(test_client, teacher, imp["id"], 2, blank_image).status_code == 200
    _send(test_client, teacher, imp["id"], 4, _png("p4"))
    merged = _get(test_client, teacher, imp["id"])["pages"][0]["cards"][-1]
    assert merged["pages"] == [1, 3]

    resp = _send_blank(test_client, teacher, imp["id"], 2)
    assert resp.status_code == 200, resp.text
    data = _get(test_client, teacher, imp["id"])
    cards = [c for p in data["pages"] for c in p["cards"]]
    assert len(cards) == 1
    group = data["pages"][0]["cards"][0]
    assert group["pages"] == [1, 2, 3]
    assert [q["source_question_no"] for q in group["group"]["questions"]] == [
        "1",
        "2",
        "3",
    ]
    assert group["group"]["stimulus"]["paragraphs"] == [
        "Part one.",
        "Part two.",
        "Part three.",
    ]
    first = group["group"]["questions"][0]
    assert first["correct_indexes"] == [1]
    assert first["answer_source"] == "answer_page"
    assert data["question_count"] == 3
    # 合併紀錄只在後端
    assert all(not k.startswith("_merge") for c in cards for k in c)


def test_send_blank_on_normal_pending_page_is_rejected(
    test_client, teacher, fake_ai, storage
):
    imp = _create(test_client, teacher, pages=1).json()
    resp = _send_blank(test_client, teacher, imp["id"], 1)
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_NOT_BLANK"
    assert fake_ai.prompts == []


def test_send_blank_missing_image(
    test_client, shared_test_session, teacher, fake_ai, storage
):
    imp = _create(test_client, teacher, pages=1).json()
    assert _blank(test_client, teacher, imp["id"], 1, _png("b")).status_code == 200
    storage.clear()
    resp = _send_blank(test_client, teacher, imp["id"], 1)
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_PAGE_IMAGE_MISSING"
    assert fake_ai.prompts == []
    assert _page_row(shared_test_session, imp["id"], 1).blank_skipped


def test_send_blank_failure_then_resend_counts(
    test_client, shared_test_session, teacher, fake_ai, storage, monkeypatch
):
    imp = _create(test_client, teacher, pages=1).json()
    image = _png("b")
    assert _blank(test_client, teacher, imp["id"], 1, image).status_code == 200

    async def broken(self, image_bytes, mime_type, prompt):
        return "not json", CallUsage(model="gemini-3.5-flash", input_tokens=10)

    monkeypatch.setattr(ExamPaperService, "_call_model", broken)
    resp = _send_blank(test_client, teacher, imp["id"], 1)
    assert resp.status_code == 502
    page = _page_row(shared_test_session, imp["id"], 1)
    assert page.status == "failed" and page.resend_count == 0
    assert not page.blank_skipped
    assert [(u.call_type, u.succeeded) for u in _usage(shared_test_session)] == [
        ("extract_page", False)
    ]
    # 失敗頁之後走一般重送（要附頁圖），這次才算一次重送
    payload = json.dumps(_page(_single("1", "Q?", ["a", "b"], ai=[0])))

    async def ok(self, image_bytes, mime_type, prompt):
        return payload, CallUsage(model="gemini-3.5-flash")

    monkeypatch.setattr(ExamPaperService, "_call_model", ok)
    resp = _send(test_client, teacher, imp["id"], 1, image)
    assert resp.status_code == 200, resp.text
    assert resp.json()["page"]["resend_count"] == 1


# ---------------------------------------------------------------- 3. C2 低度修正


def test_retry_usage_marked_failed_when_result_discarded(
    test_client, shared_test_session, teacher, fake_ai, storage
):
    imp = _create(test_client, teacher, pages=1).json()
    fake_ai.on(
        _png("p1"),
        _page(
            _single("1", "Fine?", ["a", "b"], ai=[0]),
            _single("2", "Second?", ["a", "b"], ai=[0]),
        ),
    )
    cards = _send(test_client, teacher, imp["id"], 1, _png("p1")).json()["page"][
        "cards"
    ]

    def retry(image):
        return test_client.post(
            f"{BASE}/{imp['id']}/pages/1/retry",
            files={"file": ("page.png", image, "image/png")},
            data={"card_id": cards[1]["card_id"]},
            headers=_headers(teacher),
        )

    # AI 讀到的是別題 → 結果丟掉，用量記失敗
    wrong = _png("wrong")
    fake_ai.on(wrong, _page(_single("9", "Other?", ["a", "b"], ai=[0])))
    resp = retry(wrong)
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "EXAM_IMPORT_RETRY_EMPTY"
    # 換進卡片 → 記成功
    ok = _png("ok")
    fake_ai.on(ok, _page(_single("2", "Second!", ["a", "b"], ai=[1])))
    assert retry(ok).status_code == 200
    assert [(u.call_type, u.succeeded) for u in _usage(shared_test_session)] == [
        ("extract_page", True),
        ("retry_question", False),
        ("retry_question", True),
    ]


def test_report_script_renumbers_single_page_cloze(tmp_path, monkeypatch):
    from scripts import exam_import_report as report
    from services.exam_paper_service import normalize_page

    (tmp_path / "page_1.png").write_bytes(_png("r1"))
    unit = {
        "kind": "group",
        "group_type": "cloze",
        "title": "Cloze",
        "stimulus": {"kind": "text", "paragraphs": ["I {{41}} a cat, {{42}} a dog."]},
        "questions": [
            _q("41", "", ["have", "has"], ai=[0], blank=41),
            _q("42", "", ["walk", "walks"], ai=[0], blank=42),
        ],
    }

    class FakeService:
        async def extract_page(self, image_bytes, mime, *, page_no, **kw):
            _, _, cards = normalize_page({"units": [unit]}, page_no=page_no)
            return PageExtraction(page_no, False, {}, cards, CallUsage(model="m"))

    monkeypatch.setattr(report, "get_exam_paper_service", lambda: FakeService())
    monkeypatch.setattr(report, "load_catalog", lambda: [])
    data = asyncio.run(report.run(tmp_path))
    group = data["results"][1].cards[0]["group"]
    assert group["stimulus"]["paragraphs"] == ["I {{1}} a cat, {{2}} a dog."]
    assert [q["blank"] for q in group["questions"]] == [1, 2]


def test_read_page_image_local_only_within_import(tmp_path, monkeypatch):
    """本機模式：讀得回同一份匯入存的頁圖；別份匯入的網址、非頁圖檔名讀不到。"""
    from types import SimpleNamespace

    real = exam_import_storage
    svc = SimpleNamespace(
        use_gcs=False, local_image_dir=str(tmp_path), backend_url="http://x"
    )
    monkeypatch.setattr(real, "get_image_upload_service", lambda: svc)
    url = real.store_page_image(7, 1, _png("p"), "image/png")
    assert real.read_page_image(7, url) == (_png("p"), "image/png")
    assert real.read_page_image(8, url) is None
    assert real.read_page_image(7, "http://x/static/images/../../secret.png") is None

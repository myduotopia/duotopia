"""
上傳題本擷取驗證報告（Issue #1112 C2）。

輸入一個資料夾的頁圖（PNG／JPEG／WebP，檔名含頁碼，取檔名裡**最後一組數字**當頁碼，
例如 ``page-01.png``、``9英語閱讀科試題本_16.png``），照前端的處理順序直接呼叫擷取服務：

1. 先送最後一頁；若是答案頁，再往前一頁，直到遇到非答案頁（那一頁的結果也保留）
2. 再從第 1 頁依序處理其餘頁；每頁都把已知答案帶進 prompt，答案頁晚到會回填 AI 作答的題

**不經 API、不連 DB、不比對重複、不存 GCS**。考點清單取自 ``scripts/seed_exam_points.py`` 的
``EXAM_POINTS``（用 ast 讀，不 import、不連線）。會實際呼叫 Vertex AI（花錢），需要本機有
Vertex 認證（見 project_local_dev_setup）。

輸出一份 HTML：每頁題目卡（題號、題型、題目、選項、答案與來源、考點、角色）、答案頁判定、
每次呼叫的 token（input／output／thinking）與估算美元、總計。

用法（在 backend/ 下）::

    PYTHONUTF8=1 venv/Scripts/python.exe scripts/exam_import_report.py <頁圖資料夾> \\
        [--out exam_import_report.html]

PDF 要先轉成每頁一張 PNG（例如 ``pdftoppm -png -r 150 試題本.pdf 頁圖資料夾/page``）。
"""

from __future__ import annotations

import argparse
import ast
import asyncio
import html
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.exam_paper_cards import (  # noqa: E402
    CARD_KIND_GROUP,
    apply_answer_key,
    iter_card_questions,
    merge_continuations,
)
from services.exam_paper_service import (  # noqa: E402
    PageExtraction,
    get_exam_paper_service,
)

MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}
SOURCE_LABEL = {"answer_page": "答案頁", "ai": "AI 作答", "teacher": "老師", None: "缺答案"}
GROUP_LABEL = {"reading": "閱讀題組", "cloze": "克漏字題組"}


def load_catalog() -> List[Dict[str, str]]:
    """讀 seed_exam_points.EXAM_POINTS（不 import 那支腳本，避免 load_dotenv／models）。"""
    src = (Path(__file__).resolve().parent / "seed_exam_points.py").read_text(
        encoding="utf-8"
    )
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "EXAM_POINTS" for t in node.targets
        ):
            return [
                {"code": c, "name": zh}
                for c, zh, _en, _aliases in ast.literal_eval(node.value)
            ]
    return []


def find_pages(folder: Path) -> Dict[int, Path]:
    pages: Dict[int, Path] = {}
    for p in sorted(folder.iterdir()):
        if p.suffix.lower() not in MIME:
            continue
        nums = re.findall(r"\d+", p.stem)
        if not nums:
            print(f"略過（檔名沒有頁碼）：{p.name}")
            continue
        n = int(nums[-1])
        if n in pages:
            raise SystemExit(f"頁碼重複：{pages[n].name} 與 {p.name}")
        pages[n] = p
    if not pages:
        raise SystemExit(f"{folder} 裡沒有頁圖")
    return pages


async def run(folder: Path) -> Dict[str, Any]:
    pages = find_pages(folder)
    numbers = sorted(pages)
    catalog = load_catalog()
    service = get_exam_paper_service()
    known: Dict[str, List[int]] = {}
    results: Dict[int, PageExtraction] = {}
    errors: Dict[int, str] = {}
    order: List[int] = []

    async def process(n: int) -> None:
        order.append(n)
        path = pages[n]
        t0 = time.monotonic()
        try:
            result = await service.extract_page(
                path.read_bytes(),
                MIME[path.suffix.lower()],
                page_no=n,
                known_answers=known,
                exam_point_catalog=catalog,
            )
        except Exception as e:  # 報告照樣產出，標出失敗頁
            errors[n] = f"{type(e).__name__}: {e}"
            usage = getattr(e, "usage", None)
            if usage is not None:
                results[n] = PageExtraction(n, False, {}, [], usage)
            print(f"第 {n} 頁失敗：{errors[n]}")
            return
        results[n] = result
        if result.answer_key:
            known.update(result.answer_key)
            for done in results.values():
                apply_answer_key(done.cards, known)
        print(
            f"第 {n} 頁：{len(result.cards)} 張卡、答案頁={result.is_answer_page}、"
            f"答案 {len(result.answer_key)} 題、{time.monotonic() - t0:.1f}s"
        )

    # 1) 最後一頁往前找答案頁
    n = numbers[-1]
    while True:
        await process(n)
        prev = [x for x in numbers if x < n]
        if not (n in results and results[n].is_answer_page) or not prev:
            break
        n = prev[-1]
    # 2) 從第 1 頁依序處理其餘頁
    for n in numbers:
        if n not in order:
            await process(n)

    merge_cross_page(results, numbers, errors)
    return {
        "pages": pages,
        "order": order,
        "results": results,
        "errors": errors,
        "known": known,
    }


def merge_cross_page(
    results: Dict[int, PageExtraction], numbers: List[int], errors: Dict[int, str]
) -> None:
    """跨頁題組合併：與匯入流程共用 ``exam_paper_cards.merge_continuations``（失敗的頁當作
    還沒處理完，不跨過它合併）。"""
    pages: Dict[int, Optional[List[Dict[str, Any]]]] = {
        n: (None if n in errors or n not in results else results[n].cards)
        for n in numbers
    }
    for n in merge_continuations(pages):
        results[n].cards = pages[n] or []


# --------------------------------------------------------------------------- #
# HTML
# --------------------------------------------------------------------------- #
def e(text: Any) -> str:
    return html.escape(str(text if text is not None else ""))


def render_question(
    q: Dict[str, Any], kind_label: str, catalog_names: Dict[str, str]
) -> str:
    opts = []
    for i, o in enumerate(q.get("options") or []):
        mark = " ✓" if i in (q.get("correct_indexes") or []) else ""
        cls = ' class="ok"' if mark else ""
        opts.append(f"<li{cls}>({chr(65 + i)}) {e(o) or '(圖片)'}{mark}</li>")
    answer = ", ".join(chr(65 + i) for i in q.get("correct_indexes") or []) or "—"
    points = ", ".join(
        f"{e(catalog_names.get(c, c))} <code>{e(c)}</code>"
        for c in q.get("exam_point_codes") or []
    )
    status = "" if q.get("status") == "ok" else ' <span class="bad">處理失敗</span>'
    blank = f"（空格 {q['blank']}）" if q.get("blank") else ""
    return (
        "<tr>"
        f"<td>{e(q.get('source_question_no') or '—')}{status}</td>"
        f"<td>{e(kind_label)}{e(blank)}</td>"
        f"<td>{e(q.get('stem'))}<ol class='opts'>{''.join(opts)}</ol>"
        f"<div class='expl'>{e(q.get('explanation'))}</div></td>"
        f"<td><b>{answer}</b><br><span class='src src-{e(q.get('answer_source'))}'>"
        f"{e(SOURCE_LABEL.get(q.get('answer_source'), q.get('answer_source')))}</span></td>"
        f"<td>{points or '—'}</td>"
        "</tr>"
    )


def render_card(card: Dict[str, Any], catalog_names: Dict[str, str]) -> str:
    if card["kind"] == CARD_KIND_GROUP:
        g = card["group"]
        stim = g["stimulus"]
        body = "".join(f"<p>{e(p)}</p>" for p in stim.get("paragraphs") or [])
        if stim.get("text"):
            body += f"<p class='muted'>（圖片文字）{e(stim['text'])}</p>"
        if stim.get("dialogue"):
            body += "".join(
                f"<p><b>{e(d['speaker'])}:</b> {e(d['text'])}</p>"
                for d in stim["dialogue"]
            )
        roles = ", ".join(
            f"{e(s['speaker'])}（{'女' if s['gender'] == 'female' else '男'}／"
            f"{'年輕' if s['age'] == 'young' else '成人'}{'，預設' if s['inferred'] else ''}）"
            for s in g.get("speakers") or []
        )
        label = GROUP_LABEL.get(g["group_type"], g["group_type"])
        rows = "".join(render_question(q, "小題", catalog_names) for q in g["questions"])
        return (
            f"<div class='group'><h4>{e(label)}：{e(g.get('title'))}"
            f"{'（跨頁：' + ', '.join(map(str, card.get('pages') or [])) + '）' if len(card.get('pages') or []) > 1 else ''}"
            f"{' <span class=bad>延續上一頁（未合併）</span>' if card.get('continues_previous') else ''}"
            f"</h4><div class='passage'>{body}</div>"
            f"{'<div>角色：' + roles + '</div>' if roles else ''}"
            f"<table>{rows}</table></div>"
        )
    return f"<table>{render_question(card['question'], '單題', catalog_names)}</table>"


def render(data: Dict[str, Any], folder: Path) -> str:
    catalog_names = {c["code"]: c["name"] for c in load_catalog()}
    results: Dict[int, PageExtraction] = data["results"]
    total = {"in": 0, "out": 0, "think": 0, "usd": 0.0, "questions": 0}
    sections, usage_rows = [], []
    for n in data["order"]:
        r = results.get(n)
        if r is not None:
            u = r.usage
            total["in"] += u.input_tokens
            total["out"] += u.output_tokens
            total["think"] += u.thinking_tokens
            total["usd"] += u.estimated_cost_usd
            usage_rows.append(
                f"<tr><td>{n}</td><td>{e(u.model)}</td><td>{u.input_tokens}</td>"
                f"<td>{u.output_tokens}</td><td>{u.thinking_tokens}</td>"
                f"<td>${u.estimated_cost_usd:.5f}</td></tr>"
            )
    for n in sorted(data["pages"]):
        r = results.get(n)
        img = data["pages"][n]
        head = f"<h2>第 {n} 頁 <small>{e(img.name)}</small></h2>"
        if n in data["errors"]:
            sections.append(
                f"<section>{head}<p class='bad'>{e(data['errors'][n])}</p></section>"
            )
            continue
        if r is None:
            continue
        cards_html = "".join(render_card(c, catalog_names) for c in r.cards)
        total["questions"] += sum(1 for c in r.cards for _ in iter_card_questions(c))
        key = ", ".join(
            f"{k}→{'/'.join(chr(65 + i) for i in v)}"
            for k, v in sorted(r.answer_key.items())
        )
        sections.append(
            f"<section>{head}"
            f"<p>答案頁：<b>{'是' if r.is_answer_page else '否'}</b>"
            f"{'　本頁答案：' + e(key) if key else ''}</p>"
            f"<details><summary>頁圖</summary><img src='{e(img.resolve().as_uri())}'></details>"
            f"{cards_html or '<p class=muted>（沒有題目）</p>'}</section>"
        )
    pages = len(data["pages"])
    summary = (
        f"<p>頁數 {pages}；處理順序 {', '.join(map(str, data['order']))}；題數 {total['questions']}；"
        f"AI 呼叫 {len(usage_rows)} 次；token input {total['in']}／output {total['out']}"
        f"／thinking {total['think']}；估算 <b>${total['usd']:.4f}</b>"
        f"（每頁平均 ${total['usd'] / max(pages, 1):.4f}）</p>"
    )
    return f"""<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<title>上傳題本擷取報告</title><style>
body{{font-family:system-ui,sans-serif;margin:24px;color:#222;max-width:1100px}}
table{{border-collapse:collapse;width:100%;margin:6px 0}}td,th{{border:1px solid #ddd;padding:6px;vertical-align:top}}
.opts{{margin:4px 0 0 18px;padding:0}}.ok{{color:#15803d;font-weight:600}}.bad{{color:#b91c1c}}
.muted{{color:#888}}.expl{{color:#555;font-size:13px;margin-top:4px}}
.group{{border-top:2px solid #999;border-bottom:2px solid #999;margin:12px 0;padding:6px 0}}
.passage{{background:#f7f7f7;padding:8px;font-size:14px}}
.src{{font-size:12px;padding:1px 6px;border-radius:8px;background:#eee}}
.src-ai{{background:#ede9fe}}.src-None{{background:#fef3c7}}img{{max-width:100%}}section{{margin-bottom:32px}}
</style></head><body><h1>上傳題本擷取報告</h1><p>來源資料夾：{e(folder)}</p>{summary}
<h3>每次 AI 呼叫</h3><table><tr><th>頁</th><th>模型</th><th>input</th><th>output</th>
<th>thinking</th><th>估算美元</th></tr>{''.join(usage_rows)}</table>
<h3>已知答案（答案頁）</h3><p>{e(data['known']) or '—'}</p>{''.join(sections)}</body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("folder", type=Path, help="頁圖資料夾（檔名含頁碼）")
    parser.add_argument("--out", type=Path, default=Path("exam_import_report.html"))
    args = parser.parse_args()
    data = asyncio.run(run(args.folder))
    args.out.write_text(render(data, args.folder), encoding="utf-8")
    print(f"報告：{args.out.resolve()}")


if __name__ == "__main__":
    main()

"""
題組主圖文排版（question_groups.layout）與單字註解（glossary）的驗證（Issue #1079 / #1082）。

格式定義與驗收樣本：docs/design/question-bank-layout-samples/README.md
（前端型別在 frontend/src/types/questionBank.ts 的 LayoutDoc）。

結構：
    layout = {"version": 1, "rows": [node, ...]}
    node   = {"type": "row"?, "columns": [column, ...]}
           | {"type": "section", "frame"?: bool, "rows": [row, ...]}   # section 內只能放 row
    column = {"span": int >= 1, "blocks": [block, ...]}
    block  = {"type": "heading", "level": 2|3, "text": str}
           | {"type": "paragraph", "text": str}          # 可含 **粗體** __底線__ {{n}}
           | {"type": "image", "url": str, "alt"?, "caption"?, "align"?, "maxWidth"?, "frame"?}
           | {"type": "dialogue", "frame"?: bool, "lines": [{"speaker": str, "text": str}, ...]}

純函式、不碰 DB；錯誤以 LayoutError(path, message) 拋出，router 轉成 422 並帶路徑，
讓前端能指出是哪一個區塊有問題。
"""

from __future__ import annotations

import re
from typing import Any

MAX_ROWS = 100
MAX_COLUMNS_PER_ROW = 3
MAX_BLOCKS_TOTAL = 200
MAX_BLOCKS_PER_COLUMN = 50
MAX_SPAN = 3
MAX_TEXT_CHARS = 5000
MAX_SHORT_TEXT_CHARS = 300
MAX_URL_CHARS = 2000
MAX_DIALOGUE_LINES = 100
MAX_IMAGE_WIDTH = 2000
MAX_GLOSSARY_ENTRIES = 50
MAX_GLOSSARY_CHARS = 100

BLOCK_TYPES = ("heading", "paragraph", "image", "dialogue")
IMAGE_ALIGNS = ("left", "center", "right")
HEADING_LEVELS = (2, 3)

BLANK_RE = re.compile(r"\{\{(\d+)\}\}")


class LayoutError(ValueError):
    """layout / glossary 不合格。``path`` 指向出錯的節點（如 rows[0].columns[1].blocks[2].text）。"""

    def __init__(self, path: str, message: str):
        self.path = path
        self.message = message
        super().__init__(f"{path}: {message}" if path else message)


def _require_dict(value: Any, path: str) -> dict:
    if not isinstance(value, dict):
        raise LayoutError(path, "必須是物件")
    return value


def _require_list(value: Any, path: str, max_len: int, what: str) -> list:
    if not isinstance(value, list):
        raise LayoutError(path, f"{what}必須是陣列")
    if len(value) > max_len:
        raise LayoutError(path, f"{what}最多 {max_len} 個")
    return value


def _require_str(
    value: Any, path: str, max_len: int, *, required: bool = True
) -> str | None:
    if value is None:
        if required:
            raise LayoutError(path, "必填")
        return None
    if not isinstance(value, str):
        raise LayoutError(path, "必須是文字")
    if len(value) > max_len:
        raise LayoutError(path, f"最多 {max_len} 字")
    if required and not value.strip():
        raise LayoutError(path, "不可空白")
    return value


class _Counter:
    blocks = 0


def _validate_block(block: Any, path: str, counter: _Counter) -> None:
    b = _require_dict(block, path)
    counter.blocks += 1
    if counter.blocks > MAX_BLOCKS_TOTAL:
        raise LayoutError(path, f"區塊總數最多 {MAX_BLOCKS_TOTAL} 個")
    btype = b.get("type")
    if btype not in BLOCK_TYPES:
        raise LayoutError(f"{path}.type", f"區塊類型需為 {', '.join(BLOCK_TYPES)} 之一")

    if btype == "heading":
        if b.get("level") not in HEADING_LEVELS:
            raise LayoutError(f"{path}.level", "標題層級需為 2 或 3")
        _require_str(b.get("text"), f"{path}.text", MAX_SHORT_TEXT_CHARS)
    elif btype == "paragraph":
        _require_str(b.get("text"), f"{path}.text", MAX_TEXT_CHARS)
    elif btype == "image":
        _require_str(b.get("url"), f"{path}.url", MAX_URL_CHARS)
        _require_str(b.get("alt"), f"{path}.alt", MAX_SHORT_TEXT_CHARS, required=False)
        _require_str(
            b.get("caption"), f"{path}.caption", MAX_SHORT_TEXT_CHARS, required=False
        )
        align = b.get("align")
        if align is not None and align not in IMAGE_ALIGNS:
            raise LayoutError(f"{path}.align", "對齊需為 left / center / right")
        width = b.get("maxWidth")
        if width is not None and (
            not isinstance(width, int)
            or isinstance(width, bool)
            or width <= 0
            or width > MAX_IMAGE_WIDTH
        ):
            raise LayoutError(f"{path}.maxWidth", f"需為 1–{MAX_IMAGE_WIDTH} 的整數")
        if "frame" in b and not isinstance(b["frame"], bool):
            raise LayoutError(f"{path}.frame", "需為布林值")
    elif btype == "dialogue":
        if "frame" in b and not isinstance(b["frame"], bool):
            raise LayoutError(f"{path}.frame", "需為布林值")
        lines = _require_list(
            b.get("lines"), f"{path}.lines", MAX_DIALOGUE_LINES, "對話行"
        )
        if not lines:
            raise LayoutError(f"{path}.lines", "對話至少要有一行")
        for i, line in enumerate(lines):
            lp = f"{path}.lines[{i}]"
            ln = _require_dict(line, lp)
            _require_str(ln.get("speaker"), f"{lp}.speaker", MAX_SHORT_TEXT_CHARS)
            _require_str(ln.get("text"), f"{lp}.text", MAX_TEXT_CHARS)


def _validate_row(row: Any, path: str, counter: _Counter) -> None:
    r = _require_dict(row, path)
    rtype = r.get("type", "row")
    if rtype != "row":
        raise LayoutError(f"{path}.type", "section 內只能放 row")
    columns = _require_list(
        r.get("columns"), f"{path}.columns", MAX_COLUMNS_PER_ROW, "欄"
    )
    if not columns:
        raise LayoutError(f"{path}.columns", "列至少要有一欄")
    for ci, col in enumerate(columns):
        cp = f"{path}.columns[{ci}]"
        c = _require_dict(col, cp)
        span = c.get("span")
        if (
            not isinstance(span, int)
            or isinstance(span, bool)
            or span < 1
            or span > MAX_SPAN
        ):
            raise LayoutError(f"{cp}.span", f"欄寬比例需為 1–{MAX_SPAN} 的整數")
        blocks = _require_list(
            c.get("blocks"), f"{cp}.blocks", MAX_BLOCKS_PER_COLUMN, "區塊"
        )
        for bi, block in enumerate(blocks):
            _validate_block(block, f"{cp}.blocks[{bi}]", counter)


def validate_layout(layout: Any) -> None:
    """驗證整份 layout；不合格拋 LayoutError。``None`` 視為沒有排版（合法）。"""
    if layout is None:
        return
    doc = _require_dict(layout, "layout")
    version = doc.get("version", 1)
    if version != 1:
        raise LayoutError("layout.version", "只支援 version 1")
    rows = _require_list(doc.get("rows"), "layout.rows", MAX_ROWS, "列")
    counter = _Counter()
    for ri, node in enumerate(rows):
        path = f"layout.rows[{ri}]"
        n = _require_dict(node, path)
        if n.get("type") == "section":
            if "frame" in n and not isinstance(n["frame"], bool):
                raise LayoutError(f"{path}.frame", "需為布林值")
            inner = _require_list(n.get("rows"), f"{path}.rows", MAX_ROWS, "列")
            if not inner:
                raise LayoutError(f"{path}.rows", "section 至少要有一列")
            for ii, row in enumerate(inner):
                _validate_row(row, f"{path}.rows[{ii}]", counter)
        else:
            _validate_row(n, path, counter)


def validate_glossary(glossary: Any) -> None:
    """單字註解：[{"word": str, "zh": str}, ...]。``None`` 合法。"""
    if glossary is None:
        return
    entries = _require_list(glossary, "glossary", MAX_GLOSSARY_ENTRIES, "單字註解")
    for i, entry in enumerate(entries):
        p = f"glossary[{i}]"
        e = _require_dict(entry, p)
        _require_str(e.get("word"), f"{p}.word", MAX_GLOSSARY_CHARS)
        _require_str(e.get("zh"), f"{p}.zh", MAX_GLOSSARY_CHARS)


def strip_inline_markup(text: str) -> str:
    """去掉 **粗體**、__底線__ 標記；克漏字 {{n}} 換成 ____（保留位置感）。"""
    text = text.replace("**", "").replace("__", "")
    return BLANK_RE.sub("____", text)


def layout_blank_indexes(layout: Any) -> list[int]:
    """layout 內出現的克漏字空格編號（依出現順序、去重）；克漏字題組驗證 blank_index 用。"""
    found: list[int] = []
    for text in _iter_texts(layout):
        for m in BLANK_RE.finditer(text):
            n = int(m.group(1))
            if n not in found:
                found.append(n)
    return found


def layout_blank_occurrences(layout: Any) -> list[int]:
    """layout 內所有克漏字空格編號（依出現順序，**不去重**）。

    `layout_blank_indexes` 會去重，所以同一個 ``{{3}}`` 在文章裡貼了兩次看不出來，
    但兩個空格卻只能對一個小題 —— 重複偵測要用這個版本（#1085）。
    """
    found: list[int] = []
    for text in _iter_texts(layout):
        for m in BLANK_RE.finditer(text):
            found.append(int(m.group(1)))
    return found


def _iter_texts(layout: Any):
    if not isinstance(layout, dict):
        return
    for node in layout.get("rows") or []:
        if not isinstance(node, dict):
            continue
        rows = node.get("rows") if node.get("type") == "section" else [node]
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            for col in row.get("columns") or []:
                if not isinstance(col, dict):
                    continue
                for block in col.get("blocks") or []:
                    if not isinstance(block, dict):
                        continue
                    if block.get("type") in ("heading", "paragraph"):
                        yield str(block.get("text") or "")
                    elif block.get("type") == "dialogue":
                        for line in block.get("lines") or []:
                            if isinstance(line, dict):
                                yield f"{line.get('speaker') or ''}: {line.get('text') or ''}"


def layout_to_plain_text(layout: Any) -> str:
    """layout 所有文字區塊拼成純文字副本（passage_text 用；與前端 layoutToPlainText 對齊）。"""
    parts = [strip_inline_markup(t).strip() for t in _iter_texts(layout)]
    return "\n\n".join(p for p in parts if p)


def _fmt(nums) -> str:
    return "、".join(str(n) for n in nums)


def validate_cloze_blanks(layout: Any, blank_indexes: list) -> None:
    """克漏字題組（#1085）：layout 的 ``{{n}}`` 與小題 ``blank_index`` 必須一一對應。

    ``blank_indexes`` 依小題順序給（可含 ``None`` 代表沒填）。空格編號就是權威：
    文章有空格卻沒小題、小題指向不存在的空格、或編號重複，都不准儲存。
    """
    occurrences = layout_blank_occurrences(layout)
    blanks = layout_blank_indexes(layout)
    if not blanks:
        raise LayoutError("layout", "克漏字題組的文章需要至少一個 {{1}} 空格")
    layout_counts: dict[int, int] = {}
    for n in occurrences:
        layout_counts[n] = layout_counts.get(n, 0) + 1
    layout_dup = sorted(n for n, c in layout_counts.items() if c > 1)
    if layout_dup:
        raise LayoutError("layout", f"文章裡的空格出現了兩次：{_fmt(layout_dup)}")
    if any(b is None for b in blank_indexes):
        raise LayoutError("questions", "每個克漏字小題都要對應一個空格編號")
    counts: dict[int, int] = {}
    for b in blank_indexes:
        counts[b] = counts.get(b, 0) + 1
    dup = sorted(n for n, c in counts.items() if c > 1)
    if dup:
        raise LayoutError("questions", f"有多個小題對應同一個空格：{_fmt(dup)}")
    missing = sorted(set(blanks) - set(counts))
    if missing:
        raise LayoutError("questions", f"文章的空格沒有對應小題：{_fmt(missing)}")
    extra = sorted(set(counts) - set(blanks))
    if extra:
        raise LayoutError("questions", f"小題對應的空格不在文章裡：{_fmt(extra)}")


def assert_no_cloze_blanks(layout: Any) -> None:
    """非克漏字題組不允許文章含 ``{{n}}``（會被 renderer 當空格渲染卻沒有小題）。"""
    blanks = layout_blank_indexes(layout)
    if blanks:
        raise LayoutError("layout", f"文章含空格 {_fmt(blanks)}，請改用克漏字題組")

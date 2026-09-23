"""
題庫 AI 工具（Issue #1061 / #1065）：AI 作答、AI 考點分析。

兩者都走 Vertex Gemini flash（`services/vertex_ai.py` `generate_json`），文字進文字出，
先不扣點、不記用量（只 log token 成本，同情境對話文字生成的先例）。

設計重點：
- 一次最多 MAX_QUESTIONS_PER_CALL 題；輸入以 `key` 對應，回傳也帶 key，前端才知道套到哪張卡。
- 模型回傳逐題驗證：key 對不上、選項 index 越界、沒有正確答案 → 整題丟掉並列入 skipped，
  絕不把半壞的結果套回老師的題目。
- AI 考點分析**只能從平台正式考點清單挑 code**（餵給模型的就是這份清單）；模型認為缺的
  考點放 `proposed`，後端比對既有（含 alias、含 pending）後沒有才新增 `status='pending'`，
  不掛到題目、不回前端（平台審核後才會出現在清單）。
- 比對既有考點用 `analyze()` 開頭建一次的 `ExamPointLookup`（名稱／alias → 考點），
  同一批新建的 pending 考點也即時加進去，後面的題目直接重用（#1077，不再逐題全表掃描）。
- pending 考點 code 的純中文 slug 用 md5 前 7 碼，跨 process 穩定（#1077）。
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from sqlalchemy.orm import Session, selectinload

from models import ExamPoint
from models.question_bank import (
    EXAM_POINT_STATUS_ACTIVE,
    EXAM_POINT_STATUS_PENDING,
    GRADE_MAX,
    GRADE_MIN,
)
from services.vertex_ai import get_vertex_ai_service

logger = logging.getLogger(__name__)

MAX_QUESTIONS_PER_CALL = 20
MAX_STEM_CHARS = 2000
MAX_OPTION_CHARS = 500
MAX_OPTIONS = 6
MIN_OPTIONS = 2
MAX_EXPLANATION_CHARS = 400


class QuestionBankAIError(ValueError):
    """輸入不合法（endpoint 轉 400）。"""


class QuestionBankAIOutputError(Exception):
    """模型回傳無法解析／不是預期形狀（endpoint 轉 502）。"""


@dataclass
class QuestionInput:
    key: str
    stem: str
    options: list[str]


@dataclass
class AnswerResult:
    key: str
    correct_indexes: list[int]
    explanation: str


@dataclass
class AnalyzeResult:
    key: str
    exam_point_ids: list[int]
    grade_min: Optional[int]
    grade_max: Optional[int]
    proposed: list[dict] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# 輸入整理
# --------------------------------------------------------------------------- #
def normalize_inputs(raw_items: list[dict]) -> list[QuestionInput]:
    """驗證並整理輸入；不合格（沒題幹／選項不足）的直接丟 QuestionBankAIError。"""
    if not raw_items:
        raise QuestionBankAIError("沒有題目")
    if len(raw_items) > MAX_QUESTIONS_PER_CALL:
        raise QuestionBankAIError(f"一次最多 {MAX_QUESTIONS_PER_CALL} 題")
    out: list[QuestionInput] = []
    seen: set[str] = set()
    for entry in raw_items:
        key = str(entry.get("key") or "").strip()
        stem = str(entry.get("stem") or "").strip()[:MAX_STEM_CHARS]
        options = [
            str(o or "").strip()[:MAX_OPTION_CHARS]
            for o in (entry.get("options") or [])
        ]
        options = [o for o in options if o][:MAX_OPTIONS]
        if not key or key in seen:
            raise QuestionBankAIError("題目 key 缺少或重複")
        if not stem:
            raise QuestionBankAIError(f"題目 {key} 沒有題幹")
        if len(options) < MIN_OPTIONS:
            raise QuestionBankAIError(f"題目 {key} 選項不足")
        seen.add(key)
        out.append(QuestionInput(key=key, stem=stem, options=options))
    return out


def _questions_block(items: list[QuestionInput]) -> str:
    return json.dumps(
        [{"key": q.key, "stem": q.stem, "options": q.options} for q in items],
        ensure_ascii=False,
    )


# --------------------------------------------------------------------------- #
# Prompts
# --------------------------------------------------------------------------- #
SYSTEM_INSTRUCTION = (
    "You are an English teaching assistant for a K-12 language-learning app in "
    "Taiwan. Always respond with a valid JSON object only, no markdown, no prose. "
    "When writing Chinese you MUST use Traditional Chinese (繁體中文)."
)


def build_answer_prompt(items: list[QuestionInput]) -> str:
    return (
        "For each multiple-choice question below, decide which option(s) are "
        "correct and write a short explanation for the teacher.\n"
        'Return JSON of the exact shape: {"results": [{"key": "...", '
        '"correct_indexes": [0], "explanation": "..."}]}\n'
        "Rules:\n"
        "- `key`: copy the question's key exactly.\n"
        "- `correct_indexes`: 0-based indexes into that question's `options`. "
        "Usually one index; give several only when more than one option is "
        "genuinely correct. Never return an empty list — if the question is "
        "unanswerable, omit that question entirely.\n"
        f"- `explanation`: Traditional Chinese, at most {MAX_EXPLANATION_CHARS} "
        "characters, explain why the answer is correct (and briefly why the "
        "main distractor is wrong). Do not restate the question.\n"
        "- Do not add, remove or reorder options.\n"
        f"Questions:\n{_questions_block(items)}"
    )


def build_analyze_prompt(items: list[QuestionInput], exam_points: list[dict]) -> str:
    catalog = json.dumps(exam_points, ensure_ascii=False)
    return (
        "For each multiple-choice question below, tag it with exam points "
        "(考點) from the catalog and suggest the suitable K-12 grade range.\n"
        'Return JSON of the exact shape: {"results": [{"key": "...", '
        '"exam_point_codes": ["grammar.tense.present_perfect"], '
        '"grade_min": 7, "grade_max": 9, '
        '"proposed": [{"zh_tw": "...", "en": "..."}]}]}\n'
        "Rules:\n"
        "- `key`: copy the question's key exactly.\n"
        "- `exam_point_codes`: 1 to 3 codes chosen ONLY from the catalog below. "
        "Never invent a code. Prefer the most specific (deepest) code that fits.\n"
        "- `proposed`: ONLY if the question clearly tests something the catalog "
        "does not cover at all, propose a new exam point with a Traditional "
        "Chinese name (`zh_tw`) and an English name (`en`). Usually an empty list.\n"
        "- Return an entry for EVERY question key. A question must end up with at "
        "least one exam point: either codes from the catalog or a proposal.\n"
        f"- `grade_min` / `grade_max`: integers {GRADE_MIN}–{GRADE_MAX} "
        "(Taiwan K-12: 1–6 elementary, 7–9 junior high, 10–12 senior high), "
        "grade_min <= grade_max.\n"
        f"Catalog (code, names):\n{catalog}\n"
        f"Questions:\n{_questions_block(items)}"
    )


# --------------------------------------------------------------------------- #
# Service
# --------------------------------------------------------------------------- #
class QuestionBankAIService:
    """薄薄一層包住 generate_json，方便測試 monkeypatch `generate`。"""

    async def generate(self, prompt: str, max_tokens: int) -> Any:
        return await get_vertex_ai_service().generate_json(
            prompt,
            model_type="flash",
            max_tokens=max_tokens,
            temperature=0.2,
            system_instruction=SYSTEM_INSTRUCTION,
            disable_thinking=True,
        )

    @staticmethod
    def _results_list(raw: Any) -> list[dict]:
        if isinstance(raw, dict):
            results = raw.get("results")
        elif isinstance(raw, list):
            results = raw
        else:
            results = None
        if not isinstance(results, list):
            raise QuestionBankAIOutputError("AI 回傳不是預期的 results 陣列")
        return [r for r in results if isinstance(r, dict)]

    # ---- AI 作答 ----
    async def answer(
        self, items: list[QuestionInput]
    ) -> tuple[list[AnswerResult], list[str]]:
        by_key = {q.key: q for q in items}
        raw = await self.generate(build_answer_prompt(items), max_tokens=4000)
        results: list[AnswerResult] = []
        done: set[str] = set()
        for r in self._results_list(raw):
            key = str(r.get("key") or "")
            q = by_key.get(key)
            if q is None or key in done:
                continue
            idx_raw = r.get("correct_indexes")
            if not isinstance(idx_raw, list):
                continue
            indexes = sorted(
                {
                    int(i)
                    for i in idx_raw
                    if isinstance(i, (int, float))
                    and not isinstance(i, bool)
                    and 0 <= int(i) < len(q.options)
                }
            )
            if not indexes:
                continue
            explanation = str(r.get("explanation") or "").strip()[
                :MAX_EXPLANATION_CHARS
            ]
            results.append(
                AnswerResult(key=key, correct_indexes=indexes, explanation=explanation)
            )
            done.add(key)
        skipped = [q.key for q in items if q.key not in done]
        logger.info(
            "[qb-ai] answer: %d in, %d applied, %d skipped",
            len(items),
            len(results),
            len(skipped),
        )
        return results, skipped

    # ---- AI 考點分析 ----
    async def analyze(
        self, db: Session, items: list[QuestionInput]
    ) -> tuple[list[AnalyzeResult], list[str]]:
        active = (
            db.query(ExamPoint)
            .filter(ExamPoint.status == EXAM_POINT_STATUS_ACTIVE)
            .order_by(ExamPoint.parent_id.nullsfirst(), ExamPoint.order_index)
            .all()
        )
        if not active:
            raise QuestionBankAIError("平台尚未建立考點清單")
        code_to_id = {ep.code: ep.id for ep in active}
        lookup = ExamPointLookup.load(db)
        catalog = [{"code": ep.code, "names": ep.names or {}} for ep in active]
        by_key = {q.key: q for q in items}

        raw = await self.generate(build_analyze_prompt(items, catalog), max_tokens=4000)
        results: list[AnalyzeResult] = []
        done: set[str] = set()
        for r in self._results_list(raw):
            key = str(r.get("key") or "")
            if key not in by_key or key in done:
                continue
            codes_raw = r.get("exam_point_codes")
            codes = (
                [str(c) for c in codes_raw if isinstance(c, str)]
                if isinstance(codes_raw, list)
                else []
            )
            # 只認清單裡的 code；去重保序
            ids: list[int] = []
            for c in codes:
                i = code_to_id.get(c)
                if i is not None and i not in ids:
                    ids.append(i)
            gmin, gmax = _clamp_grade(r.get("grade_min"), r.get("grade_max"))
            # 清單不夠時：提議的新考點（建成 pending）或比對到的既有考點，直接掛上
            proposed, proposed_ids = self._store_proposed(db, r.get("proposed"), lookup)
            for pid in proposed_ids:
                if pid not in ids:
                    ids.append(pid)
            if not ids and gmin is None and gmax is None:
                continue
            results.append(
                AnalyzeResult(
                    key=key,
                    exam_point_ids=ids,
                    grade_min=gmin,
                    grade_max=gmax,
                    proposed=proposed,
                )
            )
            done.add(key)
        if any(r.proposed for r in results):
            db.commit()
        skipped = [q.key for q in items if q.key not in done]
        logger.info(
            "[qb-ai] analyze: %d in, %d applied, %d skipped, %d proposed",
            len(items),
            len(results),
            len(skipped),
            sum(len(r.proposed) for r in results),
        )
        return results, skipped

    @staticmethod
    def _store_proposed(
        db: Session, raw: Any, lookup: ExamPointLookup
    ) -> tuple[list[dict], list[int]]:
        """模型提議的新考點 → 比對既有（名稱／alias，含 pending），沒有才建 pending。

        回傳 (本次實際新建的 [{code, names}], 可掛到題目的考點 id 清單)。
        id 清單含「比對到的既有考點」與「本次新建的 pending 考點」，讓清單不夠時
        題目仍有考點可掛（使用者定案：待審考點可直接使用、不顯示標記）。
        """
        if not isinstance(raw, list):
            return [], []
        created: list[dict] = []
        ids: list[int] = []
        for entry in raw[:5]:
            if not isinstance(entry, dict):
                continue
            zh = str(entry.get("zh_tw") or "").strip()[:100]
            en = str(entry.get("en") or "").strip()[:100]
            if not zh and not en:
                continue
            existing = _find_exam_point_by_names(db, zh, en, lookup)
            if existing is not None:
                if existing.id not in ids:
                    ids.append(existing.id)
                continue
            slug = _slugify(en or zh)
            code = f"pending.{slug}"
            same_code = lookup.by_code.get(code)
            if same_code is not None:
                if same_code.id not in ids:
                    ids.append(same_code.id)
                continue
            ep = ExamPoint(
                code=code,
                names={"zh-TW": zh or en, "en": en or zh},
                status=EXAM_POINT_STATUS_PENDING,
                order_index=0,
            )
            db.add(ep)
            db.flush()
            lookup.add(ep)
            created.append({"code": code, "names": ep.names})
            ids.append(ep.id)
        return created, ids


def _clamp_grade(gmin: Any, gmax: Any) -> tuple[Optional[int], Optional[int]]:
    def to_int(v: Any) -> Optional[int]:
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            return None
        n = int(v)
        return n if GRADE_MIN <= n <= GRADE_MAX else None

    a, b = to_int(gmin), to_int(gmax)
    if a is not None and b is not None and a > b:
        a, b = b, a
    return a, b


@dataclass
class ExamPointLookup:
    """一次載入全部考點（含 pending／merged）＋ alias 的對照表，analyze() 內重用。

    - ``by_name``：names 各語言值（strip + lower）→ ExamPoint
    - ``by_alias``：alias 原文（strip + lower）→ ExamPoint
    - ``by_code``：code → ExamPoint（含同批剛建的 pending）
    """

    by_name: dict[str, ExamPoint] = field(default_factory=dict)
    by_alias: dict[str, ExamPoint] = field(default_factory=dict)
    by_code: dict[str, ExamPoint] = field(default_factory=dict)

    @classmethod
    def load(cls, db: Session) -> "ExamPointLookup":
        lookup = cls()
        points = (
            db.query(ExamPoint)
            .options(selectinload(ExamPoint.aliases))
            .order_by(ExamPoint.id)
            .all()
        )
        for ep in points:
            lookup.add(ep)
            for a in ep.aliases or []:
                key = (a.alias or "").strip().lower()
                if key:
                    lookup.by_alias.setdefault(key, ep)
        return lookup

    def add(self, ep: ExamPoint) -> None:
        """登記一筆考點（新建 pending 也走這裡，讓同批後面的題目重用）。"""
        self.by_code.setdefault(ep.code, ep)
        names = ep.names or {}
        if isinstance(names, dict):
            for v in names.values():
                key = str(v).strip().lower()
                if key:
                    self.by_name.setdefault(key, ep)


def _find_exam_point_by_names(
    db: Session, zh: str, en: str, lookup: ExamPointLookup
) -> Optional[ExamPoint]:
    """用中／英名稱或 alias 比對既有考點（含 pending）；merged 者 redirect 到正式考點。"""
    needles = [n.strip().lower() for n in (zh, en) if n]
    if not needles:
        return None
    for needle in needles:
        ep = lookup.by_name.get(needle)
        if ep is not None:
            return _redirect_merged(db, ep)
    for needle in needles:
        ep = lookup.by_alias.get(needle)
        if ep is not None:
            return _redirect_merged(db, ep)
    return None


def _redirect_merged(db: Session, ep: ExamPoint) -> Optional[ExamPoint]:
    hops = 0
    while ep is not None and ep.status == "merged" and hops < 10:
        if ep.merged_into_id is None:
            return None
        ep = db.query(ExamPoint).filter(ExamPoint.id == ep.merged_into_id).first()
        hops += 1
    return ep


def _slugify(text: str) -> str:
    """考點 code 用的 slug：英數轉小寫底線；純中文名稱用 md5 前 7 碼（``x`` 開頭）。

    內建 ``hash()`` 每個 process 的 seed 不同，同名會重複建 pending 考點；
    改用 md5 才跨 process／重啟穩定（#1077）。
    """
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    if not s:
        s = "x" + hashlib.md5(text.encode("utf-8")).hexdigest()[:7]
    return s[:60]


_service: Optional[QuestionBankAIService] = None


def get_question_bank_ai_service() -> QuestionBankAIService:
    global _service
    if _service is None:
        _service = QuestionBankAIService()
    return _service

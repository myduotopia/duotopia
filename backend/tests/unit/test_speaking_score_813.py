"""
Issue #813 — 例句朗讀（reading）AI 批次批改後 Progress & Grade 便利貼成績顯示 0。

Root cause（已用 PROD 資料證實，assignment 433）：
- 學生 item 層級 AI 分數齊全（ai_assessed_at + pronunciation/accuracy/fluency/
  completeness 都有值），status=GRADED，但 student_assignment.score 沒被 roll-up，
  停留在 NULL。
- 顯示端 _compute_interim_score 對 speaking 模式（reading / word_reading）沒有
  fallback，sa.score=None 直接回 None → 前端 score ?? 0 → 顯示 0.0。
  （與 #807 的 mastery 模式同類，#807 只補了 mastery，沒補 speaking。）

Fix（比照 #807 顯示端 fallback）：sa.score 為 None 時，用 item 分數即時重算，
公式與 batch_grade_assignment 完全一致（每題取 >0 的 4 項平均、缺題 0、全題平均）。
"""

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from models import ContentItem, StudentItemProgress
from routers.assignments.detail import (
    _SPEAKING_SCORE_MODES,
    _compute_interim_score,
    _is_interim_score,
)
from routers.assignments.utils import compute_speaking_total_score


def _item(
    cid,
    *,
    rec="https://gcs/a.wav",
    ai=True,
    feedback=None,
    pron=None,
    acc=None,
    flu=None,
    comp=None
):
    return SimpleNamespace(
        content_item_id=cid,
        recording_url=rec,
        has_ai_assessment=ai,
        ai_feedback=feedback,
        pronunciation_score=pron,
        accuracy_score=acc,
        fluency_score=flu,
        completeness_score=comp,
    )


def _canonical(*cids):
    return [SimpleNamespace(id=c) for c in cids]


def _mock_db_speaking(canonical_items, progress_list):
    """db where query(ContentItem)->canonical, query(StudentItemProgress)->progress."""
    db = MagicMock()

    def query_side_effect(model):
        q = MagicMock()
        q.join.return_value = q
        q.filter.return_value = q
        if model is ContentItem:
            q.all.return_value = canonical_items
        elif model is StudentItemProgress:
            q.all.return_value = progress_list
        else:
            q.all.return_value = []
        return q

    db.query.side_effect = query_side_effect
    return db


def _sa(status_value, score=None, sa_id=1):
    return SimpleNamespace(
        id=sa_id, score=score, status=SimpleNamespace(value=status_value)
    )


def _assignment(practice_mode, assignment_id=1):
    return SimpleNamespace(id=assignment_id, practice_mode=practice_mode)


# ---------------------------------------------------------------------------
# 純函式：compute_speaking_total_score（與 batch-grade 公式對齊）
# ---------------------------------------------------------------------------


class TestComputeSpeakingTotalScore:
    def test_real_433_sa4534_case(self):
        """PROD assignment 433, sa_id 4534 的真實三題分數 → 應算出 71.3（非 0）。"""
        canonical = _canonical(41620, 41621, 41622)
        progress = {
            41620: _item(
                41620,
                pron=Decimal("64.60"),
                acc=Decimal("79"),
                flu=Decimal("52"),
                comp=Decimal("88"),
            ),
            41621: _item(
                41621,
                pron=Decimal("61.20"),
                acc=Decimal("72"),
                flu=Decimal("51"),
                comp=Decimal("81"),
            ),
            41622: _item(
                41622,
                pron=Decimal("73.40"),
                acc=Decimal("83"),
                flu=Decimal("67"),
                comp=Decimal("83"),
            ),
        }
        # 每題平均: 70.9 / 66.3 / 76.6 → 總平均 71.2667 → 71.3
        assert compute_speaking_total_score(canonical, progress) == pytest.approx(71.3)

    def test_missing_progress_row_counts_as_zero(self):
        """缺 progress row 的題目算 0 分（缺題），仍計入分母。"""
        canonical = _canonical(1, 2)
        progress = {
            1: _item(
                1,
                pron=Decimal("90"),
                acc=Decimal("90"),
                flu=Decimal("90"),
                comp=Decimal("90"),
            ),
        }
        # 題1=90, 題2=0 → (90+0)/2 = 45.0
        assert compute_speaking_total_score(canonical, progress) == pytest.approx(45.0)

    def test_recorded_but_not_assessed_counts_as_zero(self):
        """有錄音但沒 AI 評分（has_ai_assessment=False）算缺題 0 分。"""
        canonical = _canonical(1, 2)
        progress = {
            1: _item(
                1,
                pron=Decimal("80"),
                acc=Decimal("80"),
                flu=Decimal("80"),
                comp=Decimal("80"),
            ),
            2: _item(2, ai=False, pron=None, acc=None, flu=None, comp=None),
        }
        assert compute_speaking_total_score(canonical, progress) == pytest.approx(40.0)

    def test_zero_components_excluded_from_average(self):
        """單題內只平均 >0 的項目（對齊 batch-grade）。"""
        canonical = _canonical(1)
        progress = {
            1: _item(
                1,
                pron=Decimal("80"),
                acc=Decimal("0"),
                flu=Decimal("0"),
                comp=Decimal("40"),
            ),
        }
        # 只取 80 與 40 → (80+40)/2 = 60.0
        assert compute_speaking_total_score(canonical, progress) == pytest.approx(60.0)

    def test_no_assessed_work_returns_none(self):
        """完全沒有任何題目被評分 → 回 None（讓未作答的列維持空白，不顯示 0）。"""
        canonical = _canonical(1, 2)
        progress = {}
        assert compute_speaking_total_score(canonical, progress) is None

    def test_reads_from_ai_feedback_json_when_column_null(self):
        """欄位為 NULL 但 ai_feedback JSON 有值時，read-only 取 JSON（不回填）。"""
        canonical = _canonical(1)
        feedback = (
            '{"pronunciation_score": 90, "accuracy_score": 90, '
            '"fluency_score": 90, "completeness_score": 90}'
        )
        item = _item(1, feedback=feedback, pron=None, acc=None, flu=None, comp=None)
        progress = {1: item}
        assert compute_speaking_total_score(canonical, progress) == pytest.approx(90.0)
        # 確認 read-only：沒有寫回欄位
        assert item.pronunciation_score is None

    def test_empty_canonical_returns_none(self):
        assert compute_speaking_total_score([], {}) is None

    def test_uses_real_model_has_ai_assessment_property(self):
        """Anchor against a real StudentItemProgress so the _item() helper's plain
        has_ai_assessment attribute can't hide a regression in the model @property
        (it is backed by `ai_assessed_at is not None`). Review feedback on PR #815.
        """
        from datetime import datetime, timezone

        assessed = StudentItemProgress(
            content_item_id=1,
            recording_url="https://gcs/a.wav",
            ai_assessed_at=datetime(2026, 4, 23, tzinfo=timezone.utc),
            pronunciation_score=Decimal("80"),
            accuracy_score=Decimal("80"),
            fluency_score=Decimal("80"),
            completeness_score=Decimal("80"),
        )
        not_assessed = StudentItemProgress(
            content_item_id=2,
            recording_url="https://gcs/b.wav",
            ai_assessed_at=None,
        )
        # Property contract: driven purely by ai_assessed_at.
        assert assessed.has_ai_assessment is True
        assert not_assessed.has_ai_assessment is False

        canonical = _canonical(1, 2)
        progress = {1: assessed, 2: not_assessed}
        # item 2 recorded but un-assessed → missing (0); (80 + 0) / 2 = 40.0
        assert compute_speaking_total_score(canonical, progress) == pytest.approx(40.0)

    def test_corrupt_item_assessed_flag_but_all_null_returns_none(self):
        """ai_assessed_at 有值但 4 個分數欄全 NULL、無 ai_feedback（半寫入/壞資料）
        → 不算 assessed，整份回 None（不顯示 0）。#813 PR review finding 3。"""
        canonical = _canonical(1)
        corrupt = _item(
            1, ai=True, feedback=None, pron=None, acc=None, flu=None, comp=None
        )
        assert compute_speaking_total_score(canonical, {1: corrupt}) is None

    def test_legit_zero_scored_item_counts_as_assessed(self):
        """欄位為實際 0（非 NULL）代表「有評分但得 0」→ 算 assessed，回 0.0（非 None）。"""
        canonical = _canonical(1)
        zeroed = _item(
            1, pron=Decimal("0"), acc=Decimal("0"), flu=Decimal("0"), comp=Decimal("0")
        )
        assert compute_speaking_total_score(canonical, {1: zeroed}) == pytest.approx(
            0.0
        )


# ---------------------------------------------------------------------------
# 顯示端：_compute_interim_score 的 speaking fallback 分支
# ---------------------------------------------------------------------------


class TestComputeInterimScoreSpeakingFallback:
    def test_speaking_modes_set(self):
        assert "reading" in _SPEAKING_SCORE_MODES
        assert "word_reading" in _SPEAKING_SCORE_MODES

    def test_speaking_modes_use_score_category_single_source(self):
        """detail._SPEAKING_SCORE_MODES 直接 import 自 score_category（同一物件），
        不再維護第二份常數，避免新增 speaking 模式漂移、對新模式重演 #813。
        #813 PR review finding 4。"""
        from utils.score_category import _SPEAKING_MODES

        assert _SPEAKING_SCORE_MODES is _SPEAKING_MODES

    @pytest.mark.parametrize("mode", ["reading", "word_reading"])
    def test_in_progress_returns_none_not_partial_score(self, mode):
        """IN_PROGRESS 學生即便有部分 item 評分，也不回部分分數（會被當成最終分顯示）。
        #813 PR review finding 2。"""
        sa = _sa("IN_PROGRESS", score=None)
        assignment = _assignment(mode)
        canonical = _canonical(1, 2)
        progress = [
            _item(
                1,
                pron=Decimal("80"),
                acc=Decimal("80"),
                flu=Decimal("80"),
                comp=Decimal("80"),
            ),
            _item(2, rec=None, ai=False, pron=None, acc=None, flu=None, comp=None),
        ]
        db = _mock_db_speaking(canonical, progress)
        assert _compute_interim_score(sa, assignment, db) is None

    @pytest.mark.parametrize("mode", ["reading", "word_reading"])
    def test_graded_null_score_recomputes_from_items(self, mode):
        """核心 case：GRADED 但 sa.score=None → 從 item 分數現算（非 0）。"""
        sa = _sa("GRADED", score=None)
        assignment = _assignment(mode)
        canonical = _canonical(1, 2)
        progress = [
            _item(
                1,
                pron=Decimal("80"),
                acc=Decimal("80"),
                flu=Decimal("80"),
                comp=Decimal("80"),
            ),
            _item(
                2,
                pron=Decimal("90"),
                acc=Decimal("90"),
                flu=Decimal("90"),
                comp=Decimal("90"),
            ),
        ]
        db = _mock_db_speaking(canonical, progress)
        # (80+90)/2 = 85.0
        assert _compute_interim_score(sa, assignment, db) == pytest.approx(85.0)

    def test_fast_path_existing_score_returned_without_query(self):
        """sa.score 有值就直接回傳，不去 query item（即使是 0）。"""
        sa = _sa("GRADED", score=66.3)
        assignment = _assignment("reading")
        db = _mock_db_speaking(_canonical(1), [])
        assert _compute_interim_score(sa, assignment, db) == 66.3
        db.query.assert_not_called()

    def test_no_canonical_items_returns_none(self):
        """作業內容關聯查不到題目（如 PROD assignment 415）→ 回 None，不 crash。"""
        sa = _sa("GRADED", score=None)
        assignment = _assignment("reading")
        db = _mock_db_speaking([], [])
        assert _compute_interim_score(sa, assignment, db) is None

    def test_not_started_no_recordings_returns_none(self):
        """未作答（item 無錄音/無評分）→ 回 None（不顯示 0）。"""
        sa = _sa("NOT_STARTED", score=None)
        assignment = _assignment("reading")
        canonical = _canonical(1, 2)
        progress = [
            _item(1, rec=None, ai=False, pron=None, acc=None, flu=None, comp=None),
            _item(2, rec=None, ai=False, pron=None, acc=None, flu=None, comp=None),
        ]
        db = _mock_db_speaking(canonical, progress)
        assert _compute_interim_score(sa, assignment, db) is None

    def test_is_interim_score_false_for_graded_speaking(self):
        """GRADED speaking 即便現算，也不是 interim（不帶 ~ 前綴）。"""
        sa = _sa("GRADED", score=None)
        assignment = _assignment("reading")
        assert _is_interim_score(sa, assignment) is False

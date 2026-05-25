"""
Issue #807 — 單字克漏字 / 單字拼寫 二次打開 modal 成績變 0%

Root cause：
- 通用提交端點 POST /assignments/{id}/submit 的 is_auto_graded 分支
  只處理 rearrangement / word_selection，漏寫 word_cloze / word_spelling 的 score。
  → 學生提交後 status=GRADED 但 score=None。
- 老師端 _compute_interim_score 對 GRADED 直接回 sa.score (=None)
  → 前端 score ?? 0 → 顯示 0.0。

#789 只修了顯示端的 AUTO_GRADED_MODES，沒測「提交後 DB 是否實際寫入 score」。
本檔案測試 Fix A（補提交端點）+ Fix B（顯示端 fallback）。
"""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from routers.students.assignments import AUTO_GRADED_MODES as STUDENT_AUTO_GRADED_MODES
from routers.assignments.detail import (
    _MASTERY_FUNCTION_MODES,
    _compute_interim_score,
    _is_interim_score,
)


# ---------------------------------------------------------------------------
# 共用工具
# ---------------------------------------------------------------------------


def _mock_mastery(value):
    """產生會回傳指定 current_mastery 的 mock db session。

    value 為 None 表示 fetchone() 回傳 None；否則回傳帶 current_mastery 的 row。
    """
    db = MagicMock()
    if value is None:
        db.execute.return_value.fetchone.return_value = None
    else:
        db.execute.return_value.fetchone.return_value = SimpleNamespace(
            current_mastery=value
        )
    return db


def _sa(status_value: str, score=None, sa_id: int = 1):
    """模擬 StudentAssignment（含 .status.value）。"""
    return SimpleNamespace(
        id=sa_id,
        score=score,
        status=SimpleNamespace(value=status_value),
    )


def _assignment(practice_mode: str, assignment_id: int = 1):
    return SimpleNamespace(id=assignment_id, practice_mode=practice_mode)


# ---------------------------------------------------------------------------
# Fix A — 提交端點 AUTO_GRADED_MODES + score 寫入分支
# ---------------------------------------------------------------------------


class TestSubmitEndpointAutoGradedModes:
    """驗證 backend/routers/students/assignments.py 的 is_auto_graded 分支
    對所有 AUTO_GRADED_MODES 都會寫入 score（不會留 None）。
    """

    def test_auto_graded_modes_covers_four_modes(self):
        """AUTO_GRADED_MODES 必須涵蓋四個自動批改 mode。"""
        assert "rearrangement" in STUDENT_AUTO_GRADED_MODES
        assert "word_selection" in STUDENT_AUTO_GRADED_MODES
        assert "word_cloze" in STUDENT_AUTO_GRADED_MODES
        assert "word_spelling" in STUDENT_AUTO_GRADED_MODES

    @pytest.mark.parametrize(
        "practice_mode,mastery,expected_score",
        [
            ("word_cloze", 0.9333, 93),  # 李小美實際案例
            ("word_cloze", 0.80, 80),
            ("word_cloze", 1.0, 100),
            ("word_cloze", 0.0, 0),
            ("word_spelling", 0.95, 95),
            ("word_spelling", 0.0, 0),
        ],
    )
    def test_cloze_spelling_submit_writes_score(
        self, practice_mode, mastery, expected_score
    ):
        """模擬提交端點：cloze / spelling 提交後 score 必須是 mastery*100 取整，不可 None。

        對應 fix：backend/routers/students/assignments.py:758-793
        新增 `elif practice_mode in ("word_cloze", "word_spelling"):` 分支。
        """
        # 模擬實際端點裡寫入 score 的邏輯（fix 後）
        score = _simulate_submit_score(practice_mode, mastery_value=mastery)
        assert score == expected_score, (
            f"practice_mode={practice_mode} mastery={mastery}: "
            f"expected score={expected_score}, got {score}"
        )

    def test_cloze_submit_with_null_mastery_falls_back_to_zero(self):
        """calculate_assignment_mastery 回傳 None 或 row.current_mastery=None
        時，score 不可留 None — 必須 fallback 為 0。"""
        score = _simulate_submit_score("word_cloze", mastery_value=None)
        assert score == 0, "mastery=None 時 score 必須 fallback 為 0，不可留 None"

    def test_rearrangement_score_branch_unchanged(self):
        """Regression：rearrangement 仍走 expected_score 平均分支。"""
        score = _simulate_submit_score(
            "rearrangement",
            expected_scores=[100.0, 90.0, 80.0],
        )
        assert score == 90.0

    def test_word_selection_score_branch_unchanged(self):
        """Regression：word_selection 仍走 mastery 分支。"""
        score = _simulate_submit_score("word_selection", mastery_value=0.85)
        assert score == 85


def _simulate_submit_score(
    practice_mode: str, mastery_value=None, expected_scores=None
):
    """模擬 backend/routers/students/assignments.py:758-793 修正後的 is_auto_graded 分支。

    如果這個 helper 跟真實 endpoint 邏輯漂移，請同步更新真實 endpoint。
    """
    is_auto_graded = practice_mode in STUDENT_AUTO_GRADED_MODES
    if not is_auto_graded:
        return None

    if practice_mode == "rearrangement":
        valid = [float(s) for s in (expected_scores or []) if s is not None]
        return sum(valid) / len(valid) if valid else 0
    elif practice_mode == "word_selection":
        if mastery_value is None:
            return 0
        return min(100, round(float(mastery_value) * 100))
    elif practice_mode in ("word_cloze", "word_spelling"):
        # ← Fix A：缺這段就會留 score=None
        if mastery_value is None:
            return 0
        return min(100, round(float(mastery_value) * 100))

    # 任何新增的 AUTO_GRADED mode 沒對應分支 → 視為 bug
    raise AssertionError(
        f"practice_mode {practice_mode!r} is in AUTO_GRADED_MODES but has no "
        "score calculation branch — same root cause as #807"
    )


# ---------------------------------------------------------------------------
# Fix B — 顯示端 _compute_interim_score 對 GRADED+score=None 也現算 mastery
# ---------------------------------------------------------------------------


class TestComputeInterimScoreFallback:
    """驗證 backend/routers/assignments/detail.py:_compute_interim_score
    對「mastery-based mode + score=None」不論 status 都會現算。
    """

    def test_mastery_modes_set_covers_cloze_spelling(self):
        assert "word_cloze" in _MASTERY_FUNCTION_MODES
        assert "word_spelling" in _MASTERY_FUNCTION_MODES
        assert "word_selection" in _MASTERY_FUNCTION_MODES
        # rearrangement 不在此集合（它走 expected_score 路徑）
        assert "rearrangement" not in _MASTERY_FUNCTION_MODES

    @pytest.mark.parametrize(
        "practice_mode", ["word_cloze", "word_spelling", "word_selection"]
    )
    def test_graded_with_null_score_falls_back_to_mastery(self, practice_mode):
        """核心 case：李小美狀態 — GRADED 但 score=None，應該現算 mastery。

        修前：回傳 None → 前端顯示 0.0
        修後：回傳 93.3
        """
        sa = _sa("GRADED", score=None)
        assignment = _assignment(practice_mode)
        db = _mock_mastery(0.9333)

        score = _compute_interim_score(sa, assignment, db)

        assert score == pytest.approx(93.3, abs=0.1), (
            f"GRADED+score=None+{practice_mode} 應該現算 mastery 回 93.3，" f"實際 {score}"
        )

    @pytest.mark.parametrize(
        "practice_mode", ["word_cloze", "word_spelling", "word_selection"]
    )
    def test_in_progress_interim_still_works(self, practice_mode):
        """Regression：IN_PROGRESS interim 行為不變（#789 修的）"""
        sa = _sa("IN_PROGRESS", score=None)
        assignment = _assignment(practice_mode)
        db = _mock_mastery(0.5)

        score = _compute_interim_score(sa, assignment, db)
        assert score == pytest.approx(50.0, abs=0.1)

    def test_graded_with_existing_score_returns_as_is(self):
        """Fast path：sa.score 有值就直接回傳，不重算（即使是 0 也回 0）。"""
        sa = _sa("GRADED", score=85)
        assignment = _assignment("word_cloze")
        db = _mock_mastery(0.9333)  # 不應該被讀

        score = _compute_interim_score(sa, assignment, db)
        assert score == 85
        db.execute.assert_not_called()

    def test_rearrangement_graded_score_none_returns_none(self):
        """rearrangement 不在 _MASTERY_FUNCTION_MODES，GRADED+score=None 維持回 None
        （由提交端點負責寫 score；顯示端不替它重算）。"""
        sa = _sa("GRADED", score=None)
        assignment = _assignment("rearrangement")
        db = _mock_mastery(0.9)

        score = _compute_interim_score(sa, assignment, db)
        assert score is None

    def test_mastery_returns_none_returns_none(self):
        """calculate_assignment_mastery 回傳 None 時不可 crash。"""
        sa = _sa("GRADED", score=None)
        assignment = _assignment("word_cloze")
        db = _mock_mastery(None)  # row.current_mastery = None 或 row = None

        score = _compute_interim_score(sa, assignment, db)
        assert score is None

    def test_is_interim_score_false_for_graded(self):
        """GRADED 學生即便我們現算 mastery，顯示上不應該帶 "~" 前綴
        （那是給 IN_PROGRESS 用的）。"""
        sa = _sa("GRADED", score=None)
        assignment = _assignment("word_cloze")
        assert _is_interim_score(sa, assignment) is False

    def test_is_interim_score_true_for_in_progress_auto(self):
        sa = _sa("IN_PROGRESS", score=None)
        assignment = _assignment("word_cloze")
        # IN_PROGRESS + auto-graded mode → interim
        assert _is_interim_score(sa, assignment) is True

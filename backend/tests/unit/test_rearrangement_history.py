"""單元測試：例句重組作答歷程封存（#679）。

純函式，不需 DB，可在本機直接跑。
"""

from utils.rearrangement_history import archive_current_attempt


SEL_A = [
    {"position": 0, "selected": "A", "correct": "A", "is_correct": True},
    {"position": 1, "selected": "for", "correct": "table", "is_correct": False},
]
SEL_B = [
    {"position": 0, "selected": "two,", "correct": "A", "is_correct": False},
]


class TestArchiveCurrentAttempt:
    def test_archives_from_data_selections_by_default(self):
        data = {"selections": SEL_A, "retries": 1}
        attempts = archive_current_attempt(
            data,
            error_count=1,
            expected_score=80,
            ended_reason="force_retry",
            ended_at="2026-04-24T15:28:00+00:00",
        )
        assert len(attempts) == 1
        assert attempts[0]["selections"] == SEL_A
        assert attempts[0]["error_count"] == 1
        assert attempts[0]["expected_score"] == 80.0
        assert attempts[0]["ended_reason"] == "force_retry"
        assert attempts[0]["ended_at"] == "2026-04-24T15:28:00+00:00"

    def test_preserves_existing_attempts(self):
        prior = {
            "selections": SEL_A,
            "error_count": 1,
            "expected_score": 80.0,
            "ended_reason": "force_retry",
            "ended_at": "2026-04-24T15:28:00+00:00",
        }
        data = {"attempts": [prior], "selections": SEL_B, "retries": 2}
        attempts = archive_current_attempt(
            data,
            error_count=1,
            expected_score=90,
            ended_reason="completed",
            ended_at="2026-04-24T15:32:00+00:00",
        )
        assert len(attempts) == 2
        assert attempts[0] == prior  # 舊的原封不動
        assert attempts[1]["selections"] == SEL_B
        assert attempts[1]["ended_reason"] == "completed"

    def test_does_not_mutate_input_attempts(self):
        original_attempts = [{"selections": SEL_A, "ended_reason": "timeout"}]
        data = {"attempts": original_attempts, "selections": SEL_B}
        archive_current_attempt(
            data,
            error_count=0,
            expected_score=100,
            ended_reason="completed",
            ended_at="2026-04-24T15:32:00+00:00",
        )
        # 原 list 不應被就地修改
        assert len(original_attempts) == 1

    def test_skips_when_no_selections(self):
        data = {"attempts": [], "selections": []}
        attempts = archive_current_attempt(
            data,
            error_count=0,
            expected_score=100,
            ended_reason="completed",
            ended_at="2026-04-24T15:32:00+00:00",
        )
        assert attempts == []

    def test_skips_when_selections_missing(self):
        data = {"retries": 3}
        attempts = archive_current_attempt(
            data,
            error_count=0,
            expected_score=100,
            ended_reason="completed",
            ended_at="2026-04-24T15:32:00+00:00",
        )
        assert attempts == []

    def test_none_data_returns_empty(self):
        attempts = archive_current_attempt(
            None,
            error_count=0,
            expected_score=100,
            ended_reason="completed",
            ended_at="2026-04-24T15:32:00+00:00",
            selections=SEL_A,
        )
        assert len(attempts) == 1
        assert attempts[0]["selections"] == SEL_A

    def test_explicit_selections_override_data(self):
        data = {"selections": SEL_A}
        attempts = archive_current_attempt(
            data,
            error_count=1,
            expected_score=50,
            ended_reason="timeout",
            ended_at="2026-04-24T15:42:00+00:00",
            selections=SEL_B,
        )
        assert attempts[0]["selections"] == SEL_B

    def test_expected_score_coerced_to_float(self):
        data = {"selections": SEL_A}
        attempts = archive_current_attempt(
            data,
            error_count=2,
            expected_score=None,
            ended_reason="force_retry",
            ended_at="2026-04-24T15:20:00+00:00",
        )
        assert attempts[0]["expected_score"] == 0.0
        assert isinstance(attempts[0]["expected_score"], float)

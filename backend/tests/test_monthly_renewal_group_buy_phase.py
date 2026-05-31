"""Integration test for cron Phase 3 (group-buy monthly grant), issue #768.

The detailed grant logic is unit-tested in test_group_buy_service.py. This
test verifies the cron endpoint actually invokes the Phase 3 helper and
surfaces the counters into its JSON response.

We patch `datetime.now` inside cron.py to land on day 1 (so the cron's
"not the 1st" early-return doesn't fire) and we patch the helper itself
to verify the integration without needing real DB setup.
"""

from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo


TAIPEI = ZoneInfo("Asia/Taipei")


class _FakeDatetime(datetime):
    """A datetime subclass whose `now()` returns a fixed instant."""

    _fixed = datetime(2026, 6, 1, 2, 0, 0)

    @classmethod
    def now(cls, tz=None):
        return cls._fixed.replace(tzinfo=tz) if tz else cls._fixed


def _post_cron(test_client):
    return test_client.post(
        "/api/cron/monthly-renewal", headers={"x-cron-secret": "test-secret"}
    )


def test_cron_phase3_invokes_group_buy_helper_and_surfaces_counters(
    test_client,
):
    with patch("routers.cron.CRON_SECRET", "test-secret"), patch(
        "routers.cron.datetime", _FakeDatetime
    ), patch(
        "services.group_buy.grant_monthly_for_group_buy",
        return_value={"grants_created": 7, "grants_skipped_duplicate": 2},
    ) as mock_grant:
        r = _post_cron(test_client)

    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["status"] == "completed"
    assert body["group_buy_grants_created"] == 7
    assert body["group_buy_grants_skipped_duplicate"] == 2
    mock_grant.assert_called_once()


def test_cron_skips_phase3_when_not_first_of_month(test_client):
    class _MidMonth(datetime):
        @classmethod
        def now(cls, tz=None):
            d = datetime(2026, 6, 15, 2, 0, 0)
            return d.replace(tzinfo=tz) if tz else d

    with patch("routers.cron.CRON_SECRET", "test-secret"), patch(
        "routers.cron.datetime", _MidMonth
    ), patch("services.group_buy.grant_monthly_for_group_buy") as mock_grant:
        r = _post_cron(test_client)

    body = r.json()
    assert body["status"] == "skipped"
    # Day != 1 → cron early-returns BEFORE Phase 3 helper is called
    mock_grant.assert_not_called()


def test_cron_force_true_bypasses_day_1_guard_and_runs_phase3(test_client):
    """R3-F2 — Ops recovery: ?force=true (cron-secret–gated) lets the cron
    run on a non-day-1 date and still invokes the Phase 3 group-buy grant.
    Use case: Phase 3 failed on day 1, retry on day 2."""

    class _MidMonth(datetime):
        @classmethod
        def now(cls, tz=None):
            d = datetime(2026, 6, 15, 2, 0, 0)
            return d.replace(tzinfo=tz) if tz else d

    with patch("routers.cron.CRON_SECRET", "test-secret"), patch(
        "routers.cron.datetime", _MidMonth
    ), patch(
        "services.group_buy.grant_monthly_for_group_buy",
        return_value={"grants_created": 4, "grants_skipped_duplicate": 1},
    ) as mock_grant:
        r = test_client.post(
            "/api/cron/monthly-renewal?force=true",
            headers={"x-cron-secret": "test-secret"},
        )

    assert r.status_code == 200, r.json()
    body = r.json()
    # Cron actually ran (not skipped) even though day != 1
    assert body["status"] == "completed"
    # Phase 3 was invoked and counters surfaced
    assert body["group_buy_grants_created"] == 4
    assert body["group_buy_grants_skipped_duplicate"] == 1
    mock_grant.assert_called_once()

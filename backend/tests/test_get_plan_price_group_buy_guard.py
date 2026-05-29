"""Tests for the group-buy guard on get_plan_price / get_plan_quota
(issue #768 Phase 2, finding F1).

Group-buy plans seed with `price = NULL` and use `annual_fee × teacher_seats`
for billing. Before this guard, get_plan_price('團購-30席') silently returned
DEFAULT_PRICE = 299 because the plan name was not in PLAN_PRICES — a real
billing-correctness risk that would invoice NT$299/month instead of the
group-buy annual structure.

The guard fires when the loaded Plan row has teacher_seats set (= group-buy),
not on plan name pattern, so it stays correct if seed names change.
"""

from decimal import Decimal

import pytest

from config.plans import (
    PLAN_TUTOR,
    get_plan_price,
    get_plan_quota,
)
from models import Plan


@pytest.fixture
def group_buy_plan(shared_test_session):
    p = Plan(
        name="團購-30席",
        price=None,
        quota=1000,
        teacher_seats=30,
        annual_fee=1300,
        topup_discount=Decimal("0.90"),
        is_active=True,
    )
    shared_test_session.add(p)
    shared_test_session.commit()
    return p


@pytest.fixture
def individual_plan(shared_test_session):
    p = Plan(
        name=PLAN_TUTOR,
        price=299,
        quota=2000,
        teacher_seats=None,
        annual_fee=None,
        topup_discount=None,
        is_active=True,
    )
    shared_test_session.add(p)
    shared_test_session.commit()
    return p


def test_get_plan_price_raises_for_group_buy_plan(shared_test_session, group_buy_plan):
    with pytest.raises(ValueError, match="group-buy"):
        get_plan_price("團購-30席", db=shared_test_session)


def test_get_plan_quota_raises_for_group_buy_plan(shared_test_session, group_buy_plan):
    with pytest.raises(ValueError, match="group-buy"):
        get_plan_quota("團購-30席", db=shared_test_session)


def test_get_plan_price_still_works_for_individual_plan(
    shared_test_session, individual_plan
):
    assert get_plan_price(PLAN_TUTOR, db=shared_test_session) == 299


def test_get_plan_quota_still_works_for_individual_plan(
    shared_test_session, individual_plan
):
    assert get_plan_quota(PLAN_TUTOR, db=shared_test_session) == 2000


def test_get_plan_price_falls_back_to_config_when_no_db_row(
    shared_test_session,
):
    # No DB row for this name -> falls back to PLAN_PRICES, no guard fires
    assert get_plan_price(PLAN_TUTOR, db=shared_test_session) == 299

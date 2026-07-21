"""Validate show_image / show_option_images mutex (Issue #631)."""

import pytest
from pydantic import ValidationError
from routers.assignments.validators import (
    CreateAssignmentRequest,
    UpdateAssignmentRequest,
)
from routers.teachers.instant_practice import InstantPracticeRequest


_BASE_CREATE = {
    "title": "T",
    "classroom_id": 1,
    "content_ids": [1],
    "practice_mode": "word_selection",
}


def test_create_allows_only_show_image():
    req = CreateAssignmentRequest(
        **_BASE_CREATE, show_image=True, show_option_images=False
    )
    assert req.show_image is True
    assert req.show_option_images is False


def test_create_allows_only_show_option_images():
    req = CreateAssignmentRequest(
        **_BASE_CREATE, show_image=False, show_option_images=True
    )
    assert req.show_option_images is True


def test_create_allows_both_unset():
    req = CreateAssignmentRequest(**_BASE_CREATE)
    assert req.show_image is None
    assert req.show_option_images is None


def test_create_rejects_both_true():
    with pytest.raises(ValidationError) as exc:
        CreateAssignmentRequest(
            **_BASE_CREATE, show_image=True, show_option_images=True
        )
    assert "mutually exclusive" in str(exc.value)


def test_update_rejects_both_true():
    with pytest.raises(ValidationError) as exc:
        UpdateAssignmentRequest(show_image=True, show_option_images=True)
    assert "mutually exclusive" in str(exc.value)


def test_update_allows_only_one_field_set():
    # Partial updates: only show_option_images provided, show_image left as None
    req = UpdateAssignmentRequest(show_option_images=True)
    assert req.show_option_images is True
    assert req.show_image is None


def test_instant_practice_rejects_both_true():
    with pytest.raises(ValidationError) as exc:
        InstantPracticeRequest(
            content_id=1,
            practice_mode="word_selection",
            show_image=True,
            show_option_images=True,
        )
    assert "mutually exclusive" in str(exc.value)


def test_instant_practice_default_only_show_image():
    # Default show_image=True, show_option_images=False (defaults are non-conflicting)
    req = InstantPracticeRequest(content_id=1, practice_mode="word_selection")
    assert req.show_image is True
    assert req.show_option_images is False

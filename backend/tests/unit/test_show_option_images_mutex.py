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


# --- Issue #860: show_example_sentence 與 play_audio 互斥 --------------------
# 播放音檔放的是「該單字本身」的發音 → 等於把挖空的答案唸出來。
# UI 的三選一已互斥，這裡是 API 邊界的第二道防線（與 show_option_images 同一慣例）。


def test_create_rejects_example_sentence_with_play_audio():
    with pytest.raises(ValidationError):
        CreateAssignmentRequest(
            title="t",
            classroom_id=1,
            content_ids=[1],
            practice_mode="word_selection_quiz",
            show_example_sentence=True,
            play_audio=True,
        )


def test_create_allows_example_sentence_without_play_audio():
    req = CreateAssignmentRequest(
        title="t",
        classroom_id=1,
        content_ids=[1],
        practice_mode="word_selection_quiz",
        show_example_sentence=True,
        play_audio=False,
    )
    assert req.show_example_sentence is True
    assert req.play_audio is False


def test_update_rejects_example_sentence_with_play_audio():
    with pytest.raises(ValidationError):
        UpdateAssignmentRequest(show_example_sentence=True, play_audio=True)


def test_update_allows_example_sentence_alone():
    req = UpdateAssignmentRequest(show_example_sentence=True)
    assert req.show_example_sentence is True


def test_instant_practice_rejects_example_sentence_with_play_audio():
    with pytest.raises(ValidationError):
        InstantPracticeRequest(
            content_id=1,
            practice_mode="word_selection",
            show_example_sentence=True,
            play_audio=True,
        )

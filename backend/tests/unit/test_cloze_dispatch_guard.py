"""Unit tests for the word_cloze dispatch guard (Issue #632).

Verifies that an assignment cannot be dispatched as word_cloze when any item
lacks a usable cloze answer (neither persisted nor auto-extractable).
"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from models import ContentType
from routers.assignments.crud import (
    _collect_contents_missing_cloze_answer,
    _raise_if_missing_examples,
)


def _item(text, example_sentence=None, cloze_answer=None):
    # Include the fields the upstream example/audio checks read so the full
    # _raise_if_missing_examples chain works on these fakes.
    return SimpleNamespace(
        text=text,
        example_sentence=example_sentence,
        example_sentence_translation="翻譯" if example_sentence else None,
        example_sentence_audio_url="http://audio" if example_sentence else None,
        audio_url="http://audio",
        cloze_answer=cloze_answer,
    )


def _content(title, items, ctype=ContentType.VOCABULARY_SET):
    return SimpleNamespace(title=title, type=ctype, content_items=items)


class TestCollectMissingClozeAnswer:
    def test_only_runs_for_word_cloze(self):
        content = _content("Set A", [_item("swim", "He swam.")])
        # swim→swam not auto-extractable, but mode is not word_cloze → no guard
        assert _collect_contents_missing_cloze_answer([content], "reading") == []

    def test_flags_item_with_unusable_answer(self):
        content = _content("Irregulars", [_item("swim", "He swam across.")])
        result = _collect_contents_missing_cloze_answer([content], "word_cloze")
        assert result == ["Irregulars"]

    def test_persisted_answer_satisfies_guard(self):
        content = _content(
            "Fixed",
            [_item("swim", "He swam across.", cloze_answer="swam")],
        )
        assert _collect_contents_missing_cloze_answer([content], "word_cloze") == []

    def test_autoextractable_answer_satisfies_guard(self):
        content = _content("Regulars", [_item("cup", "Two cups please.")])
        assert _collect_contents_missing_cloze_answer([content], "word_cloze") == []

    def test_item_without_example_skipped(self):
        # No example sentence → owned by EXAMPLE_SENTENCE_REQUIRED, not this guard
        content = _content("NoExample", [_item("cup", example_sentence="")])
        assert _collect_contents_missing_cloze_answer([content], "word_cloze") == []


class TestRaiseIfMissingExamples:
    def test_raises_cloze_answer_required(self):
        content = _content("Irregulars", [_item("swim", "He swam across.")])
        with pytest.raises(HTTPException) as exc:
            _raise_if_missing_examples([content], "word_cloze", play_audio=False)
        assert exc.value.status_code == 422
        assert exc.value.detail["code"] == "CLOZE_ANSWER_REQUIRED"
        assert exc.value.detail["content_titles"] == ["Irregulars"]

    def test_no_raise_when_all_answers_usable(self):
        content = _content("Regulars", [_item("cup", "Two cups please.")])
        # Should not raise
        _raise_if_missing_examples([content], "word_cloze", play_audio=False)
